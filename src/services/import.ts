import * as FS from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { LocalPdf } from '../../modules/local-pdf';
import {
  commitImport,
  filesDirectory,
  findDuplicate,
  getDocuments,
  getReports,
  getVisits,
  putDocument,
  updateDocument,
  getSetting,
  setSetting,
  removeSetting,
} from '../db';
import { SELF_ID } from '../domain/members';
import { track } from './analytics';
import { parseRecords } from '../parser/records';
import { parseVisitPage } from '../parser/visit';
import { extractPdf } from './extract';
import { withPickerCache, cleanupStalePickerFiles } from './picker-cache';
import { reviewCopy } from '../domain/review-messages';
import type { DocumentRecord, Observation, Report, Visit, VisitExtraction } from '../domain/types';

function prepareObservations(observations: Observation[], doc: DocumentRecord): Observation[] {
  return observations.map((observation) => ({
    ...observation,
    ...(doc.sourceType === 'image'
      ? {
          needsReview: true,
          warnings: [
            ...new Set([
              ...(observation.warnings ?? []),
              observation.resultKind === 'text' ? reviewCopy.text : reviewCopy.item,
            ]),
          ],
        }
      : {}),
    id: Crypto.randomUUID(),
  }));
}

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const p = queue.then(task, task);
  queue = p.catch(() => {});
  return p;
}

async function processDocument(doc: DocumentRecord): Promise<string[]> {
  const started = Date.now();
  track('import_started');
  try {
    await updateDocument({ ...doc, state: 'extracting', error: null });
    const extracted = await extractPdf(doc.uri);
    const {
      reports: parsed,
      parsing,
      visits: extractedVisits,
      recordKind,
    } = parseRecords(extracted.pages);
    const visits = extractedVisits.map((value) => visitFromExtraction(doc, value));
    const reports: Report[] = parsed.map((r) => {
      const id = Crypto.randomUUID();
      return {
        ...r,
        id,
        documentId: doc.id,
        memberId: doc.memberId,
        dateKind: r.dateKind ?? (r.date ? 'sample' : 'unknown'),
        status: 'review',
        createdAt: doc.createdAt,
        observations: prepareObservations(r.observations, doc),
      };
    });
    const saved = { ...doc, pageCount: extracted.pageCount, parsing, recordKind };
    await commitImport(saved, reports, visits);
    const elapsed = Date.now() - started;
    track('import_finished', {
      outcome: reports.length || visits.length ? 'extracted' : 'unsupported',
      duration:
        elapsed < 1000
          ? 'under_1s'
          : elapsed < 5000
            ? '1_to_5s'
            : elapsed < 20000
              ? '5_to_20s'
              : 'over_20s',
    });
    return visits.length || reports.length
      ? [...visits.map((v) => v.id), ...reports.map((r) => r.id)]
      : [doc.id];
  } catch {
    track('import_finished', { outcome: 'failed' });
    await updateDocument({
      ...doc,
      state: 'failed',
      error: '无法自动读取此文件。原件已保存，可重试或手动整理。',
    });
    throw new Error('无法读取报告。原件已保留，请在记录中重试或手动整理。');
  }
}
async function importFile(
  uri: string,
  fileName: string,
  memberId: string,
  sourceType?: 'image',
  imageHash?: string,
): Promise<{ ids: string[]; duplicate: boolean }> {
  const info = await FS.getInfoAsync(uri);
  if (!info.exists || info.isDirectory) throw new Error('文件不可读取，请重新选择。');
  if (info.size > 20 * 1024 * 1024) throw new Error('当前版本支持 20 MB 以内的报告。');
  const hash = imageHash ?? (await LocalPdf.hashFile(uri));
  const existing = await findDuplicate(hash, memberId);
  if (existing) {
    if (existing.state !== 'ready')
      return { ids: await processDocument(existing), duplicate: true };
    return {
      ids: await documentRecordIds(existing),
      duplicate: true,
    };
  }
  const id = Crypto.randomUUID();
  const target = `${filesDirectory}${id}.pdf`;
  await FS.makeDirectoryAsync(filesDirectory, { intermediates: true });
  const doc: DocumentRecord = {
    id,
    hash,
    memberId,
    fileName,
    uri: target,
    sourceType,
    pageCount: sourceType === 'image' ? 1 : 0,
    state: 'queued',
    error: null,
    createdAt: new Date().toISOString(),
  };
  try {
    await FS.copyAsync({ from: uri, to: target });
    await LocalPdf.protectFile(target);
    await putDocument(doc);
  } catch (error) {
    await FS.deleteAsync(target, { idempotent: true }).catch(() => {});
    throw error;
  }
  // The durable file is registered before OCR starts, including failed OCR.
  return { ids: await processDocument(doc), duplicate: false };
}
export function importPdf(uri: string, fileName = '报告.pdf', memberId = SELF_ID) {
  return serialized(() => importFile(uri, fileName, memberId));
}
export function importPickedPdf(uri: string, fileName: string, memberId: string) {
  return withPickerCache(uri, () => importPdf(uri, fileName, memberId));
}

export function importReportImage(uri: string, memberId = SELF_ID) {
  return serialized(async () => {
    if (typeof LocalPdf.imageToPdf !== 'function')
      throw new Error('当前安装包尚不支持图片，请更新 App 后重试。');
    const info = await FS.getInfoAsync(uri);
    if (!info.exists || info.isDirectory || info.size > 20 * 1024 * 1024)
      throw new Error('图片不可读取或超过 20 MB，请重新选择。');
    const folder = `${FS.cacheDirectory}photo-import-${Crypto.randomUUID()}/`;
    const pdf = `${folder}report.pdf`;
    await FS.makeDirectoryAsync(folder, { intermediates: true });
    try {
      await LocalPdf.protectFile(folder);
      const hash = `image:${await LocalPdf.hashFile(uri)}`;
      await LocalPdf.imageToPdf(uri, pdf);
      return await importFile(pdf, '拍照资料.pdf', memberId, 'image', hash);
    } finally {
      await FS.deleteAsync(folder, { idempotent: true }).catch(() => {});
    }
  });
}
export function recoverImports(): Promise<void> {
  return serialized(async () => {
    await cleanupStalePickerFiles();
    for (const doc of await getDocuments())
      if (doc.state === 'queued' || doc.state === 'extracting')
        await processDocument(doc).catch(() => {});
  });
}
export function retryImport(doc: DocumentRecord): Promise<string[]> {
  return serialized(async () => {
    const current = (await getDocuments()).find((d) => d.id === doc.id);
    if (!current) throw new Error('文件已被删除。');
    if (current.state === 'ready') return documentRecordIds(current);
    return processDocument(current);
  });
}

// Read-only candidate generation. Existing data and visit links change only when
// the user explicitly saves this draft through saveReport (which keeps a revision).
export function reparseReport(reportId: string): Promise<Report> {
  return serialized(async () => {
    const report = (await getReports()).find((r) => r.id === reportId);
    if (!report) throw new Error('记录已不存在，请返回列表。');
    const doc = (await getDocuments()).find((d) => d.id === report.documentId);
    if (!doc) throw new Error('找不到原始报告。');
    const sourcePage =
      report.sourcePage ?? report.observations[0]?.page ?? (doc.pageCount === 1 ? 0 : undefined);
    if (sourcePage === undefined)
      throw new Error('此旧记录无法确定对应页面，请保留原记录并重新导入原件。');
    const extracted = await extractPdf(doc.uri).catch(() => {
      throw new Error('无法完成本次识别，原有记录已保留。请确认原件清晰、完整，稍后重试。');
    });
    const candidates = parseRecords(extracted.pages).reports;
    const matches = report.sectionKey
      ? candidates.filter((r) => r.sectionKey === report.sectionKey)
      : candidates.filter((r) => r.sourcePages.includes(sourcePage));
    const parsed = matches.length === 1 ? matches[0] : undefined;
    const siblings = (await getReports()).filter(
      (r) => r.documentId === doc.id && r.id !== report.id,
    );
    if (
      matches.length > 1 ||
      (parsed &&
        !report.sectionKey &&
        siblings.some((r) =>
          (r.sourcePages ?? [r.sourcePage ?? r.observations[0]?.page ?? -1]).some((p) =>
            parsed.sourcePages.includes(p),
          ),
        ))
    )
      throw new Error(
        '这一页包含多类检查。请打开整份报告，选择“重新整理整份报告”；已有记录会保留，新结果另行保存。',
      );
    if (!parsed?.template || !parsed.observations.length)
      throw new Error('本次仍未能提取结果，原有记录保持不变。可检查原件清晰度或手动整理。');
    return {
      ...report,
      ...parsed,
      reportType: parsed.reportType,
      memberId: report.memberId,
      identityConfirmation: undefined,
      dateSource: parsed.dateSource,
      dateKind: parsed.dateKind ?? (parsed.date ? 'sample' : 'unknown'),
      status: 'review',
      confirmedAt: undefined,
      observations: prepareObservations(parsed.observations, doc),
    };
  });
}
export function archiveUnreadable(doc: DocumentRecord): Promise<string> {
  return serialized(async () => {
    const existing = (await getReports()).find((r) => r.documentId === doc.id);
    if (existing) return existing.id;
    const id = Crypto.randomUUID();
    await commitImport(doc, [
      {
        id,
        documentId: doc.id,
        memberId: doc.memberId,
        title: '手动整理报告',
        patient: '',
        date: '',
        dateKind: 'unknown',
        status: 'review',
        template: null,
        warnings: ['此文件未能自动读取，请对照原件手动整理。'],
        observations: [],
        createdAt: doc.createdAt,
      },
    ]);
    return id;
  });
}
export async function consumeInbox(memberId = SELF_ID, onStart?: () => void): Promise<string[]> {
  // Capture the received file set before waiting behind any ongoing OCR job.
  const incoming = await LocalPdf.getIncomingFiles();
  if (incoming.length) onStart?.();
  return serialized(async () => {
    const ids: string[] = [];
    let failed = false;
    for (const uri of incoming) {
      if (!(await FS.getInfoAsync(uri)).exists) continue;
      let savedOriginal = false;
      const binding = `incoming-member:${uri}`;
      const ownerId = (await getSetting(binding)) || memberId;
      await setSetting(binding, ownerId);
      try {
        const result = await importFile(uri, '报告.pdf', ownerId);
        ids.push(...result.ids);
        savedOriginal = true;
      } catch {
        failed = true;
        // Drop an inbox copy only after its durable original has been registered.
        const saved = await LocalPdf.hashFile(uri)
          .then((hash) => findDuplicate(hash, ownerId))
          .catch(() => null);
        savedOriginal = !!saved && (await FS.getInfoAsync(saved.uri)).exists;
      }
      if (savedOriginal) {
        // The native inbox is outside Expo's writable directories on iOS.
        // Cleanup failure must not turn a saved report into an import failure.
        // Keep the inbox copy for the next pass; importPdf deduplicates it.
        try {
          await LocalPdf.deleteIncomingFile(uri);
          await removeSetting(binding);
        } catch {
          // Also tolerate an older development build until it is reinstalled.
        }
      }
    }
    if (failed) throw new Error('有文件未能自动读取，请在记录中手动整理或重试。');
    return ids;
  });
}

// Resolve all import paths (picker, images and the external inbox) consistently.
export async function importedDestination(
  ids: string[],
): Promise<`/document/${string}` | `/report/${string}` | `/visit?id=${string}` | '/'> {
  const visit = (await getVisits()).find((v) => v.id === ids[0]);
  const report = visit ? undefined : (await getReports()).find((r) => r.id === ids[0]);
  const doc = (await getDocuments()).find(
    (d) => d.id === (visit?.documentId ?? report?.documentId ?? ids[0]),
  );
  if (doc && (doc.pageCount > 1 || (!visit && !report))) return `/document/${doc.id}`;
  if (visit) return `/visit?id=${visit.id}`;
  return report ? `/report/${report.id}` : '/';
}

function visitFromExtraction(doc: DocumentRecord, original: VisitExtraction): Visit {
  return {
    id: Crypto.randomUUID(),
    memberId: doc.memberId,
    documentId: doc.id,
    title: original.department ? `${original.department}就诊` : '门诊记录',
    note: '',
    date: original.date,
    patient: original.patient,
    hospital: original.hospital,
    department: original.department,
    sourcePage: original.sourcePage,
    status: 'review',
    createdAt: doc.createdAt,
    original,
    sections: Object.fromEntries(
      Object.entries(original.sections).map(([key, value]) => [key, value.text]),
    ),
    reportIds: [],
  };
}
async function documentRecordIds(doc: DocumentRecord): Promise<string[]> {
  const visits = (await getVisits()).filter((v) => v.documentId === doc.id);
  const reports = (await getReports()).filter((r) => r.documentId === doc.id);
  return visits.length || reports.length
    ? [...visits.map((v) => v.id), ...reports.map((r) => r.id)]
    : [doc.id];
}
// Explicit fallback for ambiguous pages. Reuse a saved draft on repeat taps.
export function organizeAsVisit(documentId: string, page = 0): Promise<string> {
  return serialized(async () => {
    const doc = (await getDocuments()).find((d) => d.id === documentId);
    if (!doc) throw new Error('原件已不存在。');
    const existing = (await getVisits()).find(
      (v) => v.documentId === doc.id && (v.sourcePage ?? 0) === page,
    );
    if (existing) return existing.id;
    const extracted = await extractPdf(doc.uri).catch(() => null);
    const source = extracted?.pages.find((p) => p.pageIndex === page);
    const original = source ? parseVisitPage(source, true) : null;
    const visit = original
      ? visitFromExtraction(doc, original)
      : {
          id: Crypto.randomUUID(),
          memberId: doc.memberId,
          documentId: doc.id,
          sourcePage: page,
          date: '',
          title: '门诊记录',
          note: '',
          status: 'review' as const,
          createdAt: doc.createdAt,
        };
    const reports = (await getReports()).filter((r) => r.documentId === doc.id);
    await commitImport(
      {
        ...doc,
        pageCount: extracted?.pageCount ?? Math.max(1, doc.pageCount),
        recordKind: reports.length ? 'mixed' : 'visit',
      },
      [],
      [visit],
    );
    return visit.id;
  });
}

export type DocumentCandidate = { document: DocumentRecord; reports: Report[] };
export function reparseDocument(documentId: string): Promise<DocumentCandidate> {
  return serialized(async () => {
    const doc = (await getDocuments()).find((d) => d.id === documentId);
    if (!doc) throw new Error('原件已不存在。');
    const extracted = await extractPdf(doc.uri);
    const parsed = parseRecords(extracted.pages);
    if (!parsed.reports.some((r) => r.observations.length))
      throw new Error('本次仍未能提取项目，已有记录保持不变。');
    return {
      document: {
        ...doc,
        pageCount: extracted.pageCount,
        parsing: parsed.parsing,
        recordKind: parsed.recordKind,
      },
      reports: parsed.reports.map((r) => ({
        ...r,
        id: Crypto.randomUUID(),
        memberId: doc.memberId,
        documentId: doc.id,
        dateKind: r.dateKind ?? 'unknown',
        status: 'review',
        createdAt: new Date().toISOString(),
        observations: prepareObservations(r.observations, doc),
      })),
    };
  });
}
export function saveDocumentCandidate(candidate: DocumentCandidate): Promise<void> {
  return serialized(async () => {
    const current = (await getDocuments()).find((d) => d.id === candidate.document.id);
    if (!current || current.memberId !== candidate.document.memberId)
      throw new Error('原件已删除或归属已改变，请重新打开。');
    // Additive save intentionally preserves all old corrections, revisions and
    // visit links when old page records cannot be uniquely mapped to sections.
    await commitImport(
      {
        ...current,
        parsing: candidate.document.parsing,
        recordKind: candidate.document.recordKind,
      },
      candidate.reports,
    );
  });
}
