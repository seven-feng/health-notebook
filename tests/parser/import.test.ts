import * as FS from 'expo-file-system/legacy';
import { LocalPdf } from '../../modules/local-pdf';
import * as db from '../../src/db';
import {
  consumeInbox,
  importPdf,
  importPickedPdf,
  recoverImports,
  archiveUnreadable,
  retryImport,
  reparseReport,
  reparseDocument,
  saveDocumentCandidate,
  importReportImage,
} from '../../src/services/import';
import fixture from '../fixtures/first-layout.json';
import type { DocumentRecord, Report } from '../../src/domain/types';

jest.mock('../../modules/local-pdf', () => ({
  LocalPdf: {
    extract: jest.fn(),
    getIncomingFiles: jest.fn(),
    deleteIncomingFile: jest.fn(),
    hashFile: jest.fn(),
    protectFile: jest.fn(),
    imageToPdf: jest.fn(),
  },
}));
jest.mock('../../src/db', () => ({
  filesDirectory: 'file:///saved/',
  findDuplicate: jest.fn(),
  getDocuments: jest.fn(),
  getReports: jest.fn(),
  getVisits: jest.fn(),
  putDocument: jest.fn(),
  updateDocument: jest.fn(),
  commitImport: jest.fn(),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
  removeSetting: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
  readDirectoryAsync: jest.fn(async () => []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'new-id') }));
jest.mock('../../src/services/analytics', () => ({ track: jest.fn() }));
const doc: DocumentRecord = {
  memberId: 'self',
  id: 'doc',
  uri: 'file:///saved/report.pdf',
  hash: 'hash',
  fileName: 'sample.pdf',
  state: 'failed',
  pageCount: 0,
  error: null,
  createdAt: '2026-10-22T00:00:00Z',
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(db.getVisits).mockResolvedValue([]);
  jest.mocked(FS.readDirectoryAsync).mockResolvedValue([]);
  jest.mocked(FS.deleteAsync).mockResolvedValue();
  jest.requireMock('expo-crypto').randomUUID.mockReturnValue('new-id');
  jest.mocked(FS.getInfoAsync).mockResolvedValue({
    exists: true,
    uri: '',
    isDirectory: false,
    size: 100,
    modificationTime: 0,
  });
});
test('a queued retry cannot parse a document already completed by an earlier retry', async () => {
  jest.mocked(db.getDocuments).mockResolvedValue([{ ...doc, state: 'ready' }]);
  jest.mocked(db.getReports).mockResolvedValue([{ id: 'report', documentId: 'doc' } as Report]);
  expect(await retryImport(doc)).toEqual(['report']);
  expect(LocalPdf.extract).not.toHaveBeenCalled();
});
test('failed extraction with a durable original clears the inbox and continues receiving other files', async () => {
  jest
    .mocked(LocalPdf.getIncomingFiles)
    .mockResolvedValue(['file:///inbox/bad.pdf', 'file:///inbox/good.pdf']);
  jest
    .mocked(LocalPdf.hashFile)
    .mockImplementation(async (uri) => (uri.includes('bad') ? 'bad' : 'good'));
  jest
    .mocked(db.findDuplicate)
    .mockImplementation(async (hash) =>
      hash === 'bad' ? doc : { ...doc, id: 'good', state: 'ready' },
    );
  jest.mocked(db.getReports).mockResolvedValue([{ id: 'r2', documentId: 'good' } as Report]);
  jest.mocked(LocalPdf.extract).mockRejectedValue(new Error('INVALID_PDF'));
  await expect(consumeInbox()).rejects.toThrow('有文件未能自动读取');
  expect(LocalPdf.deleteIncomingFile).toHaveBeenCalledWith('file:///inbox/bad.pdf');
  expect(LocalPdf.deleteIncomingFile).toHaveBeenCalledWith('file:///inbox/good.pdf');
  expect(LocalPdf.deleteIncomingFile).not.toHaveBeenCalledWith(doc.uri);
  expect(FS.deleteAsync).not.toHaveBeenCalled();
});
test('failure before durable registration must retain the inbox copy', async () => {
  jest.mocked(LocalPdf.getIncomingFiles).mockResolvedValue(['file:///inbox/only-copy.pdf']);
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('hash');
  jest.mocked(db.findDuplicate).mockResolvedValue(null);
  jest.mocked(FS.copyAsync).mockRejectedValue(new Error('NO_SPACE'));
  await expect(consumeInbox()).rejects.toThrow('有文件未能自动读取');
  expect(LocalPdf.deleteIncomingFile).not.toHaveBeenCalled();
  expect(FS.deleteAsync).toHaveBeenCalledWith('file:///saved/new-id.pdf', { idempotent: true });
  expect(FS.deleteAsync).not.toHaveBeenCalledWith('file:///inbox/only-copy.pdf', expect.anything());
});

test('image import saves a durable source before OCR and requires every extracted item to be checked', async () => {
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('pixels');
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: fixture });
  jest.mocked(db.findDuplicate).mockResolvedValue(null);
  await importReportImage('file:///cache/photo.jpg');
  expect(LocalPdf.imageToPdf).toHaveBeenCalledWith(
    'file:///cache/photo.jpg',
    'file:///cache/photo-import-new-id/report.pdf',
  );
  expect(jest.mocked(db.putDocument).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(LocalPdf.extract).mock.invocationCallOrder[0]!,
  );
  const [saved, reports] = jest.mocked(db.commitImport).mock.calls[0]!;
  expect(saved.sourceType).toBe('image');
  expect(saved.hash).toBe('image:pixels');
  expect(reports[0]!.observations.map((o) => [o.rawValue, o.needsReview])).toEqual([
    ['100', true],
    ['48', true],
    ['5.4', true],
  ]);
  expect(FS.deleteAsync).toHaveBeenCalledWith('file:///cache/photo-import-new-id/', {
    idempotent: true,
  });
  expect(FS.deleteAsync).not.toHaveBeenCalledWith(saved.uri, expect.anything());
});

test('image deduplication uses image pixels instead of generated PDF metadata', async () => {
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('same-pixels');
  jest.mocked(db.findDuplicate).mockResolvedValue({ ...doc, sourceType: 'image', state: 'ready' });
  jest.mocked(db.getReports).mockResolvedValue([{ id: 'existing', documentId: doc.id } as Report]);
  await expect(importReportImage('file:///cache/photo.jpg')).resolves.toEqual({
    ids: ['existing'],
    duplicate: true,
  });
  expect(db.findDuplicate).toHaveBeenCalledWith('image:same-pixels', 'self');
  expect(LocalPdf.extract).not.toHaveBeenCalled();
  expect(db.putDocument).not.toHaveBeenCalled();
});

test('failed photo OCR keeps the durable document for retry and cleans only the temporary PDF', async () => {
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('pixels');
  jest.mocked(db.findDuplicate).mockResolvedValue(null);
  jest.mocked(LocalPdf.extract).mockRejectedValue(new Error('OCR_FAILED'));
  await expect(importReportImage('file:///cache/photo.jpg')).rejects.toThrow('原件已保留');
  expect(db.updateDocument).toHaveBeenLastCalledWith(
    expect.objectContaining({
      sourceType: 'image',
      state: 'failed',
      uri: 'file:///saved/new-id.pdf',
    }),
  );
  expect(FS.deleteAsync).not.toHaveBeenCalledWith('file:///saved/new-id.pdf', expect.anything());
  expect(FS.deleteAsync).toHaveBeenCalledWith('file:///cache/photo-import-new-id/', {
    idempotent: true,
  });
});
test('inbox cleanup failure preserves successful reports and retries without duplicating them', async () => {
  jest.mocked(LocalPdf.getIncomingFiles).mockResolvedValue(['file:///inbox/received.pdf']);
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('hash');
  jest.mocked(db.findDuplicate).mockResolvedValue({ ...doc, state: 'ready' });
  jest.mocked(db.getReports).mockResolvedValue([{ id: 'report', documentId: doc.id } as Report]);
  jest.mocked(LocalPdf.deleteIncomingFile).mockRejectedValueOnce(new Error('NOT_WRITABLE'));
  await expect(consumeInbox()).resolves.toEqual(['report']);
  await expect(consumeInbox()).resolves.toEqual(['report']);
  expect(LocalPdf.deleteIncomingFile).toHaveBeenCalledTimes(2);
  expect(db.commitImport).not.toHaveBeenCalled();
  expect(LocalPdf.extract).not.toHaveBeenCalled();
  expect(FS.deleteAsync).not.toHaveBeenCalled();
});
test('reparsing generates an unsaved candidate with the same report id and original untouched', async () => {
  const old = {
    id: 'r',
    documentId: 'doc',
    sourcePage: 0,
    status: 'confirmed',
    patient: 'USER',
    createdAt: 'old',
    observations: [],
  } as unknown as Report;
  jest.mocked(db.getReports).mockResolvedValue([old]);
  jest.mocked(db.getDocuments).mockResolvedValue([{ ...doc, pageCount: 1, state: 'ready' }]);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: fixture });
  const candidate = await reparseReport('r');
  expect(candidate.id).toBe('r');
  expect(candidate.documentId).toBe('doc');
  expect(candidate.status).toBe('review');
  expect(candidate.observations).toHaveLength(3);
  expect(old.patient).toBe('USER');
  expect(old.status).toBe('confirmed');
  expect(old.observations).toEqual([]);
  expect(db.commitImport).not.toHaveBeenCalled();
  expect(db.putDocument).not.toHaveBeenCalled();
});
test('a failed reparse cannot overwrite or delete the existing report or original', async () => {
  jest
    .mocked(db.getReports)
    .mockResolvedValue([
      { id: 'r', documentId: 'doc', sourcePage: 0, observations: [] } as unknown as Report,
    ]);
  jest.mocked(db.getDocuments).mockResolvedValue([{ ...doc, pageCount: 1 }]);
  jest.mocked(LocalPdf.extract).mockRejectedValue(new Error('OCR_FAILED'));
  await expect(reparseReport('r')).rejects.toThrow('原有记录已保留');
  expect(db.commitImport).not.toHaveBeenCalled();
  expect(db.putDocument).not.toHaveBeenCalled();
  expect(FS.deleteAsync).not.toHaveBeenCalled();
});

test('PDF and all its parsed pages retain the member selected at import, regardless of OCR name', async () => {
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('new-pdf');
  jest.mocked(db.findDuplicate).mockResolvedValue(null);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: fixture });
  await importPdf('file:///picked.pdf', 'sample.pdf', 'mom');
  expect(db.findDuplicate).toHaveBeenCalledWith('new-pdf', 'mom');
  const [saved, reports] = jest.mocked(db.commitImport).mock.calls[0]!;
  expect(saved.memberId).toBe('mom');
  expect(reports.every((r) => r.memberId === 'mom')).toBe(true);
  expect(reports[0]?.patient).toBe('SAMPLE');
});

test('recovery and manual fallback use the durable owner', async () => {
  const queued = { ...doc, memberId: 'mom', state: 'queued' as const };
  jest.mocked(db.getDocuments).mockResolvedValue([queued]);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: fixture });
  await recoverImports();
  expect(jest.mocked(db.commitImport).mock.calls[0]![1][0]?.memberId).toBe('mom');
  jest.mocked(db.getReports).mockResolvedValue([]);
  await archiveUnreadable(queued);
  expect(jest.mocked(db.commitImport).mock.calls[1]![1][0]?.memberId).toBe('mom');
});

test('inbox cleanup retry after member switching keeps its original owner', async () => {
  jest.mocked(LocalPdf.getIncomingFiles).mockResolvedValue(['file:///inbox/report.pdf']);
  jest.mocked(db.getSetting).mockResolvedValue('mom');
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('same');
  jest.mocked(db.findDuplicate).mockResolvedValue({ ...doc, memberId: 'mom', state: 'ready' });
  jest
    .mocked(db.getReports)
    .mockResolvedValue([{ ...({} as Report), id: 'r', documentId: doc.id, memberId: 'mom' }]);
  await consumeInbox('self');
  expect(db.findDuplicate).toHaveBeenCalledWith('same', 'mom');
  expect(db.removeSetting).toHaveBeenCalledWith('incoming-member:file:///inbox/report.pdf');
});

test('a multi-page import persists document coverage and sections in one commit', async () => {
  const { sectionFixture } = require('../fixtures/section-layout');
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('multi');
  jest.mocked(db.findDuplicate).mockResolvedValue(null);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 3, pages: sectionFixture() });
  await importPdf('file:///multi.pdf', 'multi.pdf', 'mom');
  const [saved, reports] = jest.mocked(db.commitImport).mock.calls[0]!;
  expect(reports).toHaveLength(2);
  expect(reports.every((r) => r.memberId === 'mom')).toBe(true);
  expect(reports[0]!.sourcePages).toEqual([0, 1]);
  expect(saved.parsing!.unprocessed.some((r) => r.page === 2)).toBe(true);
});

test('reparsing a section rebuilds full context and leaves the saved record untouched', async () => {
  const { sectionFixture } = require('../fixtures/section-layout');
  const { parseDocument } = require('../../src/parser/document');
  const source = sectionFixture();
  const old = {
    ...parseDocument(source).reports[0],
    id: 'r',
    documentId: 'doc',
    memberId: 'self',
    status: 'confirmed',
    createdAt: 'old',
  } as Report;
  jest.mocked(db.getReports).mockResolvedValue([old]);
  jest.mocked(db.getDocuments).mockResolvedValue([{ ...doc, pageCount: 3, state: 'ready' }]);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 3, pages: source });
  const next = await reparseReport('r');
  expect(next.sourcePages).toEqual([0, 1]);
  expect(next.observations.map((o) => o.rawValue)).toEqual(['0', '阴性']);
  expect(next.status).toBe('review');
  expect(old.status).toBe('confirmed');
  expect(db.commitImport).not.toHaveBeenCalled();
});

test('ambiguous legacy page mapping cannot replace an existing record', async () => {
  const { sectionFixture } = require('../fixtures/section-layout');
  jest
    .mocked(db.getReports)
    .mockResolvedValue([
      { id: 'r', documentId: 'doc', sourcePage: 1, observations: [] } as unknown as Report,
    ]);
  jest.mocked(db.getDocuments).mockResolvedValue([{ ...doc, pageCount: 3 }]);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 3, pages: sectionFixture() });
  await expect(reparseReport('r')).rejects.toThrow('多类检查');
  expect(db.commitImport).not.toHaveBeenCalled();
});

test('whole document reparsing is read-only until explicitly saved as separate records', async () => {
  const { sectionFixture } = require('../fixtures/section-layout');
  const { reparseDocument, saveDocumentCandidate } = require('../../src/services/import');
  jest.mocked(db.getDocuments).mockResolvedValue([{ ...doc, pageCount: 3, state: 'ready' }]);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 3, pages: sectionFixture() });
  const candidate = await reparseDocument('doc');
  expect(db.commitImport).not.toHaveBeenCalled();
  expect(db.putDocument).not.toHaveBeenCalled();
  await saveDocumentCandidate(candidate);
  expect(db.commitImport).toHaveBeenCalledTimes(1);
  expect(jest.mocked(db.commitImport).mock.calls[0]![1]).toHaveLength(2);
});

test('system and app inbox copies of one PDF produce one saved report and clean up after saving', async () => {
  const system = 'file:///Documents/Inbox/shared.pdf';
  const local = 'file:///Application%20Support/incoming/copied.pdf';
  jest.mocked(LocalPdf.getIncomingFiles).mockResolvedValue([system, local]);
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('same-pdf');
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: fixture });
  let saved: DocumentRecord | null = null;
  jest.mocked(db.findDuplicate).mockImplementation(async () => saved);
  jest.mocked(db.commitImport).mockImplementation(async (document) => {
    saved = { ...document, state: 'ready' };
  });
  jest.mocked(db.getReports).mockResolvedValue([{ id: 'new-id', documentId: 'new-id' } as Report]);
  const started = jest.fn();
  await consumeInbox('self', started);
  expect(started).toHaveBeenCalledTimes(1);
  expect(LocalPdf.extract).toHaveBeenCalledTimes(1);
  expect(db.commitImport).toHaveBeenCalledTimes(1);
  expect(LocalPdf.deleteIncomingFile).toHaveBeenCalledWith(system);
  expect(LocalPdf.deleteIncomingFile).toHaveBeenCalledWith(local);
});

test('an empty inbox does not display import progress', async () => {
  jest.mocked(LocalPdf.getIncomingFiles).mockResolvedValue([]);
  const started = jest.fn();
  await expect(consumeInbox('self', started)).resolves.toEqual([]);
  expect(started).not.toHaveBeenCalled();
});

test.each(['saved', 'duplicate', 'copy-failed', 'ocr-failed'])(
  'picker import releases its cache on %s without deleting the persistent original',
  async (kind) => {
    const cached = 'file:///cache/DocumentPicker/synthetic.pdf';
    jest.mocked(LocalPdf.hashFile).mockResolvedValue('hash');
    jest
      .mocked(db.findDuplicate)
      .mockResolvedValue(kind === 'duplicate' ? { ...doc, state: 'ready' } : null);
    jest
      .mocked(db.getReports)
      .mockResolvedValue([{ id: 'existing', documentId: doc.id } as Report]);
    jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: fixture });
    if (kind === 'copy-failed') jest.mocked(FS.copyAsync).mockRejectedValue(new Error('NO_SPACE'));
    if (kind === 'ocr-failed')
      jest.mocked(LocalPdf.extract).mockRejectedValue(new Error('OCR_FAILED'));
    const result = importPickedPdf(cached, 'synthetic.pdf', 'self');
    if (kind.endsWith('failed')) await expect(result).rejects.toThrow();
    else await expect(result).resolves.toMatchObject({ duplicate: kind === 'duplicate' });
    expect(FS.deleteAsync).toHaveBeenCalledWith(cached, { idempotent: true });
    if (kind !== 'copy-failed')
      expect(FS.deleteAsync).not.toHaveBeenCalledWith(
        'file:///saved/new-id.pdf',
        expect.anything(),
      );
    if (kind === 'saved') {
      const cleanup = jest.mocked(FS.deleteAsync).mock.calls.findIndex(([file]) => file === cached);
      expect(jest.mocked(FS.deleteAsync).mock.invocationCallOrder[cleanup]).toBeGreaterThan(
        jest.mocked(db.commitImport).mock.invocationCallOrder[0]!,
      );
    }
  },
);

test('one photo of a visit commits original text and paragraphs without creating a lab report', async () => {
  const { visitFixture } = require('../fixtures/visit-layout');
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('visit-pixels');
  jest.mocked(db.findDuplicate).mockResolvedValue(null);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [visitFixture()] });
  await importReportImage('file:///cache/visit.jpg', 'mom');
  const [document, reports, visits] = jest.mocked(db.commitImport).mock.calls[0]!;
  expect(document.recordKind).toBe('visit');
  expect(reports).toEqual([]);
  expect(visits).toHaveLength(1);
  expect(visits![0]).toMatchObject({
    memberId: 'mom',
    documentId: document.id,
    status: 'review',
    date: '2026-10-23',
    reportIds: [],
  });
  expect(visits![0]!.original?.sections.chief?.text).toBe('咳嗽 3 天。');
  expect(visits![0]!.sections?.chief).toBe('咳嗽 3 天。');
});
test('deduplicated visits route to the existing visit without another OCR pass', async () => {
  const { importedDestination } = require('../../src/services/import');
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('visit');
  jest
    .mocked(db.findDuplicate)
    .mockResolvedValue({ ...doc, pageCount: 1, state: 'ready', recordKind: 'visit' });
  jest.mocked(db.getDocuments).mockResolvedValue([{ ...doc, pageCount: 1 }]);
  jest
    .mocked(db.getVisits)
    .mockResolvedValue([{ id: 'v1', documentId: doc.id, memberId: doc.memberId } as never]);
  jest.mocked(db.getReports).mockResolvedValue([]);
  const result = await importPdf('file:///visit.pdf');
  expect(result).toEqual({ ids: ['v1'], duplicate: true });
  expect(await importedDestination(result.ids)).toBe('/visit?id=v1');
  expect(LocalPdf.extract).not.toHaveBeenCalled();
});
test('unknown input retains its document and routes to explicit type choice', async () => {
  const { visitFixture } = require('../fixtures/visit-layout');
  const { importedDestination } = require('../../src/services/import');
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('unknown');
  jest.mocked(db.findDuplicate).mockResolvedValue(null);
  jest
    .mocked(LocalPdf.extract)
    .mockResolvedValue({ pageCount: 1, pages: [visitFixture(['普通文字'])] });
  const result = await importPdf('file:///unknown.pdf');
  const [document, reports] = jest.mocked(db.commitImport).mock.calls[0]!;
  expect(document.recordKind).toBe('unknown');
  expect(reports).toEqual([]);
  jest.mocked(db.getDocuments).mockResolvedValue([document]);
  jest.mocked(db.getReports).mockResolvedValue([]);
  expect(await importedDestination(result.ids)).toBe(`/document/${document.id}`);
});
test('an interrupted visit import recovers under its persisted member', async () => {
  const { visitFixture } = require('../fixtures/visit-layout');
  jest
    .mocked(db.getDocuments)
    .mockResolvedValue([{ ...doc, memberId: 'mom', state: 'extracting' }]);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [visitFixture()] });
  await recoverImports();
  expect(jest.mocked(db.commitImport).mock.calls[0]![2]![0]!.memberId).toBe('mom');
});
test('manual visit fallback reuses a saved page and never mutates an existing lab', async () => {
  const { organizeAsVisit } = require('../../src/services/import');
  jest.mocked(db.getDocuments).mockResolvedValue([{ ...doc, pageCount: 1, state: 'ready' }]);
  jest
    .mocked(db.getVisits)
    .mockResolvedValue([{ id: 'saved-visit', documentId: doc.id, sourcePage: 0 } as never]);
  expect(await organizeAsVisit(doc.id)).toBe('saved-visit');
  expect(LocalPdf.extract).not.toHaveBeenCalled();
  expect(db.commitImport).not.toHaveBeenCalled();
});

test('ultrasound photo import keeps its member and narrative source without creating lab metrics', async () => {
  const { ultrasoundFixture } = require('../fixtures/ultrasound-layout');
  jest.mocked(LocalPdf.hashFile).mockResolvedValue('ultrasound-pixels');
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [ultrasoundFixture()] });
  jest.mocked(db.findDuplicate).mockResolvedValue(null);
  await importReportImage('file:///cache/ultrasound.jpg', 'mom');
  const [saved, reports, visits] = jest.mocked(db.commitImport).mock.calls[0]!;
  expect(saved).toMatchObject({ memberId: 'mom', sourceType: 'image', recordKind: 'report' });
  expect(visits).toEqual([]);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({
    memberId: 'mom',
    reportType: 'imaging',
    dateKind: 'report',
    status: 'review',
  });
  expect(reports[0]!.observations).toHaveLength(4);
  expect(
    reports[0]!.observations.every(
      (o) =>
        o.resultKind === 'text' && o.needsReview && o.originalValue === o.rawValue && o.sourceRect,
    ),
  ).toBe(true);
});

test('an old manual ultrasound record can be reidentified without writing a candidate or changing its owner', async () => {
  const { ultrasoundFixture } = require('../fixtures/ultrasound-layout');
  const old = {
    id: 'r',
    memberId: 'mom',
    documentId: 'doc',
    sourcePage: 0,
    status: 'archived',
    patient: 'USER',
    observations: [],
  } as unknown as Report;
  const before = JSON.stringify(old);
  jest.mocked(db.getReports).mockResolvedValue([old]);
  jest
    .mocked(db.getDocuments)
    .mockResolvedValue([
      { ...doc, memberId: 'mom', sourceType: 'image', pageCount: 1, state: 'ready' },
    ]);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [ultrasoundFixture()] });
  const candidate = await reparseReport('r');
  expect(candidate).toMatchObject({
    id: 'r',
    memberId: 'mom',
    reportType: 'imaging',
    status: 'review',
  });
  expect(candidate.observations).toHaveLength(4);
  expect(JSON.stringify(old)).toBe(before);
  expect(db.commitImport).not.toHaveBeenCalled();
  expect(db.updateDocument).not.toHaveBeenCalled();
});

test('whole-document ultrasound reparse changes unknown classification only when the candidate is saved', async () => {
  const { ultrasoundFixture } = require('../fixtures/ultrasound-layout');
  const original: DocumentRecord = {
    ...doc,
    memberId: 'mom',
    state: 'ready',
    recordKind: 'unknown',
  };
  jest.mocked(db.getDocuments).mockResolvedValue([original]);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [ultrasoundFixture()] });
  const candidate = await reparseDocument('doc');
  expect(candidate.document.recordKind).toBe('report');
  expect(candidate.reports[0]).toMatchObject({ memberId: 'mom', reportType: 'imaging' });
  expect(original.recordKind).toBe('unknown');
  expect(db.commitImport).not.toHaveBeenCalled();
  await saveDocumentCandidate(candidate);
  expect(db.commitImport).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'doc', memberId: 'mom', recordKind: 'report' }),
    candidate.reports,
  );
});
