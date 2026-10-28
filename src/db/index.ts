import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as FS from 'expo-file-system/legacy';
import { LocalPdf } from '../../modules/local-pdf';
import type { DocumentRecord, Member, Observation, Report, Visit } from '../domain/types';
import {
  documentKey,
  needsIdentityReview,
  normalizedName,
  validateMember,
} from '../domain/members';
import { migrateDatabase } from './migrations';
import { resolveDocument } from '../domain/files';
import { clearDocumentPreviews } from '../services/source-preview';
import { validDate } from '../domain/metrics';
import { reviewCopy, reviewMessages } from '../domain/review-messages';

let connection: Promise<SQLite.SQLiteDatabase> | undefined;
export const filesDirectory = `${FS.documentDirectory}reports/`;
const keyName = 'doctor-db-key-v1';

async function open(): Promise<SQLite.SQLiteDatabase> {
  const dbDirectory = SQLite.defaultDatabaseDirectory.startsWith('file:')
    ? SQLite.defaultDatabaseDirectory
    : `file://${SQLite.defaultDatabaseDirectory}`;
  const databaseFile = `${dbDirectory}/doctor.db`;
  let key = await SecureStore.getItemAsync(keyName);
  if (!key) {
    const exists = await FS.getInfoAsync(databaseFile);
    if (exists.exists) throw new Error('本地密钥不可用。原有文件已保留，请勿卸载或清除 App 数据。');
    key = Array.from(await Crypto.getRandomBytesAsync(32), (x) =>
      x.toString(16).padStart(2, '0'),
    ).join('');
    await SecureStore.setItemAsync(keyName, key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('本地密钥格式无效。');
  const db = await SQLite.openDatabaseAsync('doctor.db');
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  const cipher = await db.getFirstAsync<Record<string, string>>('PRAGMA cipher_version');
  if (!cipher || !Object.values(cipher).some(Boolean)) {
    await db.closeAsync();
    throw new Error('此安装包未启用本地数据库加密，请重新编译。');
  }
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  await migrateDatabase(db);
  await FS.makeDirectoryAsync(filesDirectory, { intermediates: true });
  await LocalPdf.protectFile(FS.documentDirectory!);
  await LocalPdf.protectFile(dbDirectory);
  return db;
}
export function database(): Promise<SQLite.SQLiteDatabase> {
  return (connection ??= open().catch((e) => {
    connection = undefined;
    throw e;
  }));
}
export async function getDocuments(memberId?: string): Promise<DocumentRecord[]> {
  return access(async (db) =>
    (
      await db.getAllAsync<{ data: string }>(
        'SELECT data FROM documents' + (memberId ? " WHERE json_extract(data,'$.memberId')=?" : ''),
        ...(memberId ? [memberId] : []),
      )
    ).map((x) => resolveDocument(JSON.parse(x.data) as DocumentRecord, filesDirectory)),
  );
}
export async function findDuplicate(
  hash: string,
  memberId: string,
): Promise<DocumentRecord | null> {
  return access(async (db) => {
    const row = await db.getFirstAsync<{ data: string }>(
      'SELECT data FROM documents WHERE hash = ?',
      documentKey(memberId, hash),
    );
    return row ? resolveDocument(JSON.parse(row.data) as DocumentRecord, filesDirectory) : null;
  });
}
export async function putDocument(doc: DocumentRecord): Promise<void> {
  await transaction(async (db) => {
    await assertMember(db, doc.memberId);
    await assertOwner(db, 'documents', doc.id, doc.memberId);
    await db.runAsync(
      'INSERT INTO documents (id, hash, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      doc.id,
      documentKey(doc.memberId, doc.hash),
      JSON.stringify(doc),
    );
  });
}
export async function updateDocument(doc: DocumentRecord): Promise<void> {
  await transaction(async (db) => {
    await assertOwner(db, 'documents', doc.id, doc.memberId);
    const result = await db.runAsync(
      'UPDATE documents SET data=? WHERE id=?',
      JSON.stringify(doc),
      doc.id,
    );
    if (!result.changes) throw new Error('文件已被删除。');
  });
}
export async function getReports(memberId?: string): Promise<Report[]> {
  return access(async (db) => {
    const rows = await db.getAllAsync<{ data: string }>(
      'SELECT data FROM reports' + (memberId ? " WHERE json_extract(data,'$.memberId')=?" : ''),
      ...(memberId ? [memberId] : []),
    );
    const items = await db.getAllAsync<{ report_id: string; data: string }>(
      'SELECT report_id, data FROM observations ORDER BY rowid',
    );
    return rows
      .map((row) => {
        const r = JSON.parse(row.data) as Omit<Report, 'observations'>;
        return {
          ...r,
          observations: items
            .filter((x) => x.report_id === r.id)
            .map((x) => JSON.parse(x.data) as Observation),
        };
      })
      .sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));
  });
}
let writes: Promise<unknown> = Promise.resolve();
function access<T>(action: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const run = async () => action(await database());
  const next = writes.then(run, run);
  writes = next.catch(() => {});
  return next;
}
function transaction(action: (db: SQLite.SQLiteDatabase) => Promise<void>): Promise<void> {
  return access((db) => db.withTransactionAsync(() => action(db)));
}
async function writeReport(tx: SQLite.SQLiteDatabase, report: Report) {
  const member = await assertMember(tx, report.memberId);
  await assertOwner(tx, 'reports', report.id, report.memberId);
  if (report.documentId) {
    const doc = await tx.getFirstAsync<{ data: string }>(
      'SELECT data FROM documents WHERE id=?',
      report.documentId,
    );
    if (!doc || JSON.parse(doc.data).memberId !== report.memberId)
      throw new Error('报告与原件的所属成员不同。');
  }
  if (report.status === 'confirmed' && needsIdentityReview(member, report))
    throw new Error('请先核对报告姓名与成员姓名。');
  const { observations, ...metadata } = report;
  await tx.runAsync(
    'INSERT INTO reports (id, document_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
    report.id,
    report.documentId || null,
    JSON.stringify(metadata),
  );
  await tx.runAsync('DELETE FROM observations WHERE report_id = ?', report.id);
  for (const o of observations)
    await tx.runAsync(
      'INSERT INTO observations (id, report_id, data) VALUES (?, ?, ?)',
      o.id,
      report.id,
      JSON.stringify(o),
    );
}
export async function saveReport(report: Report): Promise<void> {
  await transaction(async (tx) => {
    const old = await tx.getFirstAsync<{ data: string }>(
      'SELECT data FROM reports WHERE id = ?',
      report.id,
    );
    if (old) {
      const items = await tx.getAllAsync<{ data: string }>(
        'SELECT data FROM observations WHERE report_id=?',
        report.id,
      );
      await tx.runAsync(
        'INSERT INTO revisions (report_id,data,created_at) VALUES(?,?,?)',
        report.id,
        JSON.stringify({
          report: JSON.parse(old.data),
          observations: items.map((x) => JSON.parse(x.data)),
        }),
        new Date().toISOString(),
      );
    }
    await writeReport(tx, report);
  });
}

// Explicit bulk entry for one document. Only blank names on pending reports
// are filled; observations, review status, existing names and links stay intact.
export async function fillDocumentPatient(
  documentId: string,
  memberId: string,
  input: string,
): Promise<string[]> {
  const patient = input.trim();
  if (!patient || patient.length > 30) throw new Error('请填写 1–30 个字的原报告姓名。');
  const updated: string[] = [];
  await transaction(async (tx) => {
    await assertMember(tx, memberId);
    const doc = await tx.getFirstAsync<{ data: string }>(
      'SELECT data FROM documents WHERE id=?',
      documentId,
    );
    if (!doc || JSON.parse(doc.data).memberId !== memberId)
      throw new Error('报告已删除或所属成员已改变，请重新打开。');
    const rows = await tx.getAllAsync<{ id: string; data: string }>(
      'SELECT id,data FROM reports WHERE document_id=?',
      documentId,
    );
    const reports = rows.map((row) => ({
      row,
      metadata: JSON.parse(row.data) as Omit<Report, 'observations'>,
    }));
    if (reports.some(({ metadata }) => metadata.memberId !== memberId))
      throw new Error('报告归属不一致，请分别核对。');
    if (
      reports.some(
        ({ metadata }) =>
          metadata.patient.trim() && normalizedName(metadata.patient) !== normalizedName(patient),
      )
    )
      throw new Error('这份报告中已有不同姓名，请分别核对填写。');
    for (const { row, metadata } of reports) {
      if (metadata.status !== 'review' || metadata.patient.trim()) continue;
      const items = await tx.getAllAsync<{ data: string }>(
        'SELECT data FROM observations WHERE report_id=?',
        row.id,
      );
      await tx.runAsync(
        'INSERT INTO revisions (report_id,data,created_at) VALUES(?,?,?)',
        row.id,
        JSON.stringify({
          report: metadata,
          observations: items.map((item) => JSON.parse(item.data)),
        }),
        new Date().toISOString(),
      );
      await tx.runAsync(
        'UPDATE reports SET data=? WHERE id=?',
        JSON.stringify({
          ...metadata,
          patient,
          identityConfirmation: undefined,
          warnings: metadata.warnings.filter(
            (warning) => !reviewMessages([warning]).includes(reviewCopy.patient),
          ),
        }),
        row.id,
      );
      updated.push(row.id);
    }
  });
  return updated;
}

// Repair metadata only. Re-read inside the write queue so an edit or deletion
// during OCR cannot be overwritten; observations and confirmation stay intact.
export async function fillMissingReportDate(
  expected: Report,
  date: Pick<Report, 'date' | 'dateKind' | 'dateSource'>,
): Promise<void> {
  if (expected.date.trim() || !validDate(date.date) || date.dateKind === 'unknown') return;
  await transaction(async (tx) => {
    const row = await tx.getFirstAsync<{ data: string }>(
      'SELECT data FROM reports WHERE id=?',
      expected.id,
    );
    const { observations: _observations, ...metadata } = expected;
    if (!row || row.data !== JSON.stringify(metadata) || expected.status === 'archived') return;
    const items = await tx.getAllAsync<{ data: string }>(
      'SELECT data FROM observations WHERE report_id=?',
      expected.id,
    );
    await tx.runAsync(
      'INSERT INTO revisions (report_id,data,created_at) VALUES(?,?,?)',
      expected.id,
      JSON.stringify({
        report: metadata,
        observations: items.map((item) => JSON.parse(item.data)),
      }),
      new Date().toISOString(),
    );
    await tx.runAsync(
      'UPDATE reports SET data=? WHERE id=?',
      JSON.stringify({
        ...metadata,
        ...date,
        dateSource: date.dateSource,
        warnings: metadata.warnings.filter(
          (warning) => !reviewMessages([warning]).includes(reviewCopy.date),
        ),
      }),
      expected.id,
    );
  });
}
export async function commitImport(
  doc: DocumentRecord,
  reports: Report[],
  visits: Visit[] = [],
): Promise<void> {
  await transaction(async (tx) => {
    await assertOwner(tx, 'documents', doc.id, doc.memberId);
    if (!(await tx.getFirstAsync('SELECT id FROM documents WHERE id=?', doc.id)))
      throw new Error('文件已被删除。');
    for (const visit of visits) {
      if (visit.memberId !== doc.memberId || visit.documentId !== doc.id)
        throw new Error('病历与原件的归属不一致。');
      await writeVisit(tx, visit);
    }
    for (const report of reports) {
      if (report.memberId !== doc.memberId || report.documentId !== doc.id)
        throw new Error('报告与原件的归属不一致。');
      await writeReport(tx, report);
    }
    await tx.runAsync(
      'UPDATE documents SET data=? WHERE id=?',
      JSON.stringify({ ...doc, state: 'ready', error: null }),
      doc.id,
    );
  });
}
export async function deleteReport(id: string): Promise<void> {
  await transaction(async (tx) => {
    const row = await tx.getFirstAsync<{ document_id: string | null }>(
      'SELECT document_id FROM reports WHERE id=?',
      id,
    );
    await tx.runAsync('DELETE FROM reports WHERE id=?', id);
    if (row?.document_id) {
      const count = await tx.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM reports WHERE document_id=?',
        row.document_id,
      );
      const visits = await tx.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM visits WHERE document_id=?',
        row.document_id,
      );
      if (count?.n === 0 && !visits?.n) {
        const doc = await tx.getFirstAsync<{ data: string }>(
          'SELECT data FROM documents WHERE id=?',
          row.document_id,
        );
        // The last structured section is not the whole multi-page document:
        // narrative/image pages may still be its only remaining content.
        if (doc && (JSON.parse(doc.data) as DocumentRecord).pageCount > 1) return;
        if (doc)
          await tx.runAsync(
            'INSERT OR IGNORE INTO pending_file_deletions (document_id,report_id) VALUES (?,?)',
            row.document_id,
            id,
          );
        await tx.runAsync('DELETE FROM documents WHERE id=?', row.document_id);
      }
    }
  });
  await cleanupFileDeletions(id);
}
export async function getSetting(key: string): Promise<string | null> {
  return access(
    async (db) =>
      (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', key))
        ?.value ?? null,
  );
}
export async function setSetting(key: string, value: string): Promise<void> {
  await transaction(async (db) => {
    await db.runAsync(
      'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key,
      value,
    );
  });
}
export async function getVisits(memberId?: string): Promise<Visit[]> {
  return access(async (db) => {
    const visits = await db.getAllAsync<{ data: string }>(
      'SELECT data FROM visits' + (memberId ? " WHERE json_extract(data,'$.memberId')=?" : ''),
      ...(memberId ? [memberId] : []),
    );
    const links = await db.getAllAsync<{ visit_id: string; report_id: string }>(
      'SELECT * FROM visit_reports',
    );
    return visits.map((x) => {
      const visit = JSON.parse(x.data) as Visit;
      return {
        ...visit,
        reportIds: links.filter((l) => l.visit_id === visit.id).map((l) => l.report_id),
      };
    });
  });
}
async function writeVisit(db: SQLite.SQLiteDatabase, visit: Visit): Promise<void> {
  const member = await assertMember(db, visit.memberId);
  await assertOwner(db, 'visits', visit.id, visit.memberId);
  const old = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM visits WHERE id=?',
    visit.id,
  );
  const previous = old ? (JSON.parse(old.data) as Visit) : undefined;
  if (previous?.documentId && previous.documentId !== visit.documentId)
    throw new Error('不能修改病历原件。');
  if (visit.documentId) {
    const doc = await db.getFirstAsync<{ data: string }>(
      'SELECT data FROM documents WHERE id=?',
      visit.documentId,
    );
    if (!doc || JSON.parse(doc.data).memberId !== visit.memberId)
      throw new Error('病历与原件的所属成员不同。');
  }
  if (
    visit.status === 'confirmed' &&
    needsIdentityReview(member, { ...visit, patient: visit.patient ?? '' })
  )
    throw new Error('请先核对病历姓名与成员姓名。');
  const { reportIds, ...data } = visit;
  for (const id of reportIds ?? []) {
    const report = await db.getFirstAsync<{ data: string }>(
      'SELECT data FROM reports WHERE id=?',
      id,
    );
    if (!report || JSON.parse(report.data).memberId !== visit.memberId)
      throw new Error('只能关联当前成员的报告。');
  }
  await db.runAsync(
    'INSERT INTO visits (id,data,document_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,document_id=excluded.document_id',
    visit.id,
    JSON.stringify({ ...data, original: previous?.original ?? data.original }),
    visit.documentId || null,
  );
  await db.runAsync('DELETE FROM visit_reports WHERE visit_id=?', visit.id);
  for (const reportId of new Set(reportIds ?? []))
    await db.runAsync('INSERT INTO visit_reports VALUES (?,?)', visit.id, reportId);
}
export async function saveVisit(visit: Visit): Promise<void> {
  await transaction((db) => writeVisit(db, visit));
}
export async function removeVisit(id: string): Promise<void> {
  await transaction(async (db) => {
    const row = await db.getFirstAsync<{ document_id: string | null }>(
      'SELECT document_id FROM visits WHERE id=?',
      id,
    );
    await db.runAsync('DELETE FROM visits WHERE id=?', id);
    if (!row?.document_id) return;
    const reports = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM reports WHERE document_id=?',
      row.document_id,
    );
    const visits = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM visits WHERE document_id=?',
      row.document_id,
    );
    const doc = await db.getFirstAsync<{ data: string }>(
      'SELECT data FROM documents WHERE id=?',
      row.document_id,
    );
    if (
      !reports?.n &&
      !visits?.n &&
      doc &&
      (JSON.parse(doc.data) as DocumentRecord).pageCount <= 1
    ) {
      await db.runAsync(
        'INSERT OR IGNORE INTO pending_file_deletions (document_id,report_id) VALUES (?,?)',
        row.document_id,
        id,
      );
      await db.runAsync('DELETE FROM documents WHERE id=?', row.document_id);
    }
  });
  await cleanupFileDeletions(id);
}
export async function deleteUnlinkedDocument(id: string): Promise<void> {
  await transaction(async (db) => {
    const count = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM reports WHERE document_id=?',
      id,
    );
    const visits = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM visits WHERE document_id=?',
      id,
    );
    if (count?.n || visits?.n) throw new Error('文件仍有关联记录，请先删除记录。');
    const row = await db.getFirstAsync<{ data: string }>(
      'SELECT data FROM documents WHERE id=?',
      id,
    );
    if (row)
      await db.runAsync(
        'INSERT OR IGNORE INTO pending_file_deletions (document_id,report_id) VALUES (?,NULL)',
        id,
      );
    await db.runAsync('DELETE FROM documents WHERE id=?', id);
  });
  await cleanupFileDeletions(id);
}

export type DocumentDeletionScope = {
  documentId: string;
  memberId: string;
  memberLabel: string;
  fileName: string;
  sourceType: 'pdf' | 'image';
  reportCount: number;
  observationCount: number;
  visitCount: number;
  retainedVisitCount: number;
  retainedReportCount: number;
  token: string;
};
export type DocumentDeletionResult =
  | { status: 'changed'; scope: DocumentDeletionScope }
  | { status: 'deleted'; cleanupPending: boolean };

async function readDocumentDeletionScope(
  db: SQLite.SQLiteDatabase,
  documentId: string,
  memberId: string,
): Promise<DocumentDeletionScope> {
  const member = await assertMember(db, memberId);
  const row = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM documents WHERE id=?',
    documentId,
  );
  if (!row) throw new Error('文件已被删除，请返回记录列表。');
  const doc = JSON.parse(row.data) as DocumentRecord;
  if (doc.memberId !== memberId) throw new Error('这份资料不属于当前成员，无法删除。');
  const reports = await db.getAllAsync<{ id: string; data: string }>(
    'SELECT id,data FROM reports WHERE document_id=? ORDER BY id',
    documentId,
  );
  const visits = await db.getAllAsync<{ id: string; data: string }>(
    'SELECT id,data FROM visits WHERE document_id=? ORDER BY id',
    documentId,
  );
  if ([...reports, ...visits].some((record) => JSON.parse(record.data).memberId !== memberId))
    throw new Error('资料归属不一致，未删除任何记录。');
  const observations = await db.getAllAsync<{ id: string; data: string }>(
    'SELECT id,data FROM observations WHERE report_id IN (SELECT id FROM reports WHERE document_id=?) ORDER BY id',
    documentId,
  );
  const revisions = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM revisions WHERE report_id IN (SELECT id FROM reports WHERE document_id=?) ORDER BY id',
    documentId,
  );
  const links = await db.getAllAsync<{ visit_id: string; report_id: string }>(
    `SELECT visit_id,report_id FROM visit_reports
     WHERE report_id IN (SELECT id FROM reports WHERE document_id=?)
        OR visit_id IN (SELECT id FROM visits WHERE document_id=?)
     ORDER BY visit_id,report_id`,
    documentId,
    documentId,
  );
  const reportIds = new Set(reports.map((record) => record.id));
  const visitIds = new Set(visits.map((record) => record.id));
  const scope = {
    documentId,
    memberId,
    memberLabel: member.label,
    fileName: doc.fileName,
    sourceType: doc.sourceType === 'image' ? ('image' as const) : ('pdf' as const),
    reportCount: reports.length,
    observationCount: observations.length,
    visitCount: visits.length,
    retainedVisitCount: new Set(
      links.filter((link) => !visitIds.has(link.visit_id)).map((link) => link.visit_id),
    ).size,
    retainedReportCount: new Set(
      links.filter((link) => !reportIds.has(link.report_id)).map((link) => link.report_id),
    ).size,
  };
  // Compare identities as well as counts: replacing one record with another must
  // require reconfirmation, even when all displayed totals stay the same.
  return {
    ...scope,
    token: JSON.stringify([scope, reports, visits, observations, revisions, links]),
  };
}

export function getDocumentDeletionScope(documentId: string, memberId: string) {
  return access((db) => readDocumentDeletionScope(db, documentId, memberId));
}

export async function deleteWholeDocument(
  expected: DocumentDeletionScope,
): Promise<DocumentDeletionResult> {
  let changed: DocumentDeletionScope | undefined;
  await transaction(async (db) => {
    const current = await readDocumentDeletionScope(db, expected.documentId, expected.memberId);
    if (current.token !== expected.token) {
      changed = current;
      return;
    }
    await db.runAsync(
      'INSERT OR IGNORE INTO pending_file_deletions (document_id,report_id) VALUES (?,NULL)',
      current.documentId,
    );
    // Cascades remove observations, revisions and links, never the independent
    // record at the other end of a link. All logical changes commit together.
    await db.runAsync('DELETE FROM visits WHERE document_id=?', current.documentId);
    await db.runAsync('DELETE FROM reports WHERE document_id=?', current.documentId);
    await db.runAsync('DELETE FROM documents WHERE id=?', current.documentId);
  });
  if (changed) return { status: 'changed', scope: changed };
  const cleanupPending = await cleanupFileDeletions(expected.documentId).then(
    () => false,
    () => true,
  );
  return { status: 'deleted', cleanupPending };
}

// The intent is committed with the logical deletion; it survives file errors,
// process termination and iOS sandbox relocation. Serialize cleanup with DB
// access so two retries cannot race each other or a document write.
async function cleanupFileDeletions(id?: string): Promise<void> {
  await access(async (db) => {
    const jobs = await db.getAllAsync<{ document_id: string }>(
      'SELECT document_id FROM pending_file_deletions' +
        (id ? ' WHERE document_id=? OR report_id=?' : ''),
      ...(id ? [id, id] : []),
    );
    let failed = false;
    for (const job of jobs) {
      try {
        if (!/^[a-zA-Z0-9-]+$/.test(job.document_id)) throw new Error('INVALID_DOCUMENT_ID');
        const current = await db.getFirstAsync(
          'SELECT id FROM documents WHERE id=?',
          job.document_id,
        );
        if (current) throw new Error('DOCUMENT_STILL_EXISTS');
        try {
          await clearDocumentPreviews(job.document_id);
        } finally {
          await FS.deleteAsync(`${filesDirectory}${job.document_id}.pdf`, { idempotent: true });
        }
        await db.runAsync(
          'DELETE FROM pending_file_deletions WHERE document_id=?',
          job.document_id,
        );
      } catch {
        failed = true;
      }
    }
    if (failed) throw new Error('部分文件尚未清理完成，请重试；下次打开 App 也会继续清理。');
  });
}
export function retryFileDeletions(): Promise<void> {
  return cleanupFileDeletions();
}

async function assertMember(db: SQLite.SQLiteDatabase, id: string): Promise<Member> {
  if (!id) throw new Error('请先选择成员。');
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM members WHERE id=?', id);
  if (!row) throw new Error('成员档案不存在，请返回重试。');
  return JSON.parse(row.data) as Member;
}
async function assertOwner(
  db: SQLite.SQLiteDatabase,
  table: 'reports' | 'documents' | 'visits',
  id: string,
  memberId: string,
) {
  const old = await db.getFirstAsync<{ data: string }>(`SELECT data FROM ${table} WHERE id=?`, id);
  if (old && JSON.parse(old.data).memberId !== memberId)
    throw new Error('不能修改记录的所属成员。');
}
export async function getMembers(): Promise<Member[]> {
  return access(async (db) =>
    (await db.getAllAsync<{ data: string }>('SELECT data FROM members ORDER BY rowid')).map(
      (x) => JSON.parse(x.data) as Member,
    ),
  );
}
export async function saveMember(member: Member): Promise<void> {
  validateMember(member);
  await transaction(async (db) => {
    await db.runAsync(
      'INSERT INTO members (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      member.id,
      JSON.stringify({
        ...member,
        label: member.id === 'self' ? '我' : member.label.trim(),
        name: member.name.trim(),
      }),
    );
  });
}
export async function removeSetting(key: string): Promise<void> {
  await transaction(async (db) => {
    await db.runAsync('DELETE FROM settings WHERE key=?', key);
  });
}
