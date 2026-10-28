import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as SQLite from 'expo-sqlite';
import * as FS from 'expo-file-system/legacy';
import * as db from '../../src/db';
import { clearDocumentPreviews } from '../../src/services/source-preview';
import { selfMember } from '../../src/domain/members';
import { migrateDatabase } from '../../src/db/migrations';
import type { DocumentRecord, Report, Visit } from '../../src/domain/types';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  defaultDatabaseDirectory: 'file:///db',
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => 'a'.repeat(64)) }));
jest.mock('expo-crypto', () => ({}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///local/',
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('../../modules/local-pdf', () => ({ LocalPdf: { protectFile: jest.fn() } }));
jest.mock('../../src/services/source-preview', () => ({ clearDocumentPreviews: jest.fn() }));

function adapter(raw: DatabaseSync): SQLiteDatabase {
  return {
    execAsync: async (sql: string) => raw.exec(sql),
    getFirstAsync: async (sql: string, ...params: (string | number | null)[]) =>
      sql === 'PRAGMA cipher_version'
        ? { cipher_version: 'test-adapter' }
        : (raw.prepare(sql).get(...params) ?? null),
    getAllAsync: async (sql: string, ...params: (string | number | null)[]) =>
      raw.prepare(sql).all(...params),
    runAsync: async (sql: string, ...params: (string | number | null)[]) =>
      raw.prepare(sql).run(...params),
    withTransactionAsync: async (action: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await action();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
}
const raw = new DatabaseSync(':memory:');
const document: DocumentRecord = {
  memberId: 'self',
  id: 'synthetic',
  hash: 'hash',
  uri: 'file:///previous-sandbox/reports/synthetic.pdf',
  fileName: 'synthetic.pdf',
  pageCount: 1,
  state: 'failed',
  error: null,
  createdAt: '2026-10-23',
};
const report: Report = {
  memberId: 'self',
  documentId: 'synthetic',
  id: 'report',
  title: '合成检查',
  patient: '合成用户',
  date: '',
  dateKind: 'unknown',
  status: 'review',
  template: null,
  warnings: [],
  observations: [],
  createdAt: '2026-10-23',
};
const jobs = () => raw.prepare('SELECT * FROM pending_file_deletions').all();
beforeAll(async () => {
  jest.mocked(SQLite.openDatabaseAsync).mockResolvedValue(adapter(raw));
  await db.database();
});
beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(FS.deleteAsync).mockResolvedValue();
  jest.mocked(clearDocumentPreviews).mockResolvedValue();
  raw.exec(
    'DELETE FROM pending_file_deletions; DELETE FROM visits; DELETE FROM reports; DELETE FROM documents;',
  );
  await db.putDocument(document);
});
afterAll(() => raw.close());

test('file cleanup failure retains a durable job and the same delete operation retries it', async () => {
  jest.mocked(FS.deleteAsync).mockRejectedValueOnce(new Error('IO_ERROR'));
  await expect(db.deleteUnlinkedDocument(document.id)).rejects.toThrow('清理');
  expect(await db.getDocuments()).toEqual([]);
  expect(jobs()).toHaveLength(1);
  await db.deleteUnlinkedDocument(document.id);
  expect(FS.deleteAsync).toHaveBeenCalledTimes(2);
  expect(FS.deleteAsync).toHaveBeenLastCalledWith('file:///local/reports/synthetic.pdf', {
    idempotent: true,
  });
  expect(jobs()).toEqual([]);
});

test('a deleted report id can still retry removal of its last single-page original', async () => {
  await db.saveReport(report);
  jest.mocked(FS.deleteAsync).mockRejectedValueOnce(new Error('IO_ERROR'));
  await expect(db.deleteReport(report.id)).rejects.toThrow('清理');
  expect(await db.getReports()).toEqual([]);
  expect(jobs()[0]).toMatchObject({ document_id: document.id, report_id: report.id });
  await db.deleteReport(report.id);
  expect(FS.deleteAsync).toHaveBeenCalledTimes(2);
  expect(jobs()).toEqual([]);
});

test('preview failure still attempts original removal and retains the job for both retries', async () => {
  jest.mocked(clearDocumentPreviews).mockRejectedValueOnce(new Error('PREVIEW_ERROR'));
  await expect(db.deleteUnlinkedDocument(document.id)).rejects.toThrow('清理');
  expect(FS.deleteAsync).toHaveBeenCalledTimes(1);
  expect(jobs()).toHaveLength(1);
  await db.retryFileDeletions();
  expect(clearDocumentPreviews).toHaveBeenCalledTimes(2);
  expect(jobs()).toEqual([]);
});

test('a fresh module connection resumes the committed deletion using the current sandbox', async () => {
  jest.mocked(FS.deleteAsync).mockRejectedValueOnce(new Error('IO_ERROR'));
  await expect(db.deleteUnlinkedDocument(document.id)).rejects.toThrow();
  let restarted!: typeof db;
  let deleteFile!: jest.Mock;
  jest.isolateModules(() => {
    jest.requireMock('expo-sqlite').openDatabaseAsync.mockResolvedValue(adapter(raw));
    deleteFile = jest.requireMock('expo-file-system/legacy').deleteAsync;
    restarted = require('../../src/db');
  });
  await restarted.retryFileDeletions();
  expect(deleteFile).toHaveBeenCalledWith('file:///local/reports/synthetic.pdf', {
    idempotent: true,
  });
  expect(jobs()).toEqual([]);
});

test('a rolled-back deletion cannot enqueue removal of a live original', async () => {
  raw.exec(
    "CREATE TRIGGER reject_delete BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT, 'TEST_ROLLBACK'); END;",
  );
  try {
    await expect(db.deleteUnlinkedDocument(document.id)).rejects.toThrow('TEST_ROLLBACK');
    expect((await db.getDocuments()).map((d) => d.id)).toEqual([document.id]);
    expect(jobs()).toEqual([]);
    expect(FS.deleteAsync).not.toHaveBeenCalled();
  } finally {
    raw.exec('DROP TRIGGER reject_delete');
  }
});

test('background recovery continues past a failed job without touching live documents', async () => {
  raw.exec(
    "DELETE FROM documents; INSERT INTO pending_file_deletions VALUES('first',NULL),('second',NULL);",
  );
  await db.putDocument({ ...document, id: 'live' });
  jest.mocked(FS.deleteAsync).mockRejectedValueOnce(new Error('IO_ERROR'));
  await expect(db.retryFileDeletions()).rejects.toThrow('清理');
  expect(FS.deleteAsync).toHaveBeenCalledTimes(2);
  expect(jobs()).toEqual([{ document_id: 'first', report_id: null }]);
  expect((await db.getDocuments()).map((d) => d.id)).toEqual(['live']);
});

test('an import finishing after deletion cannot recreate a document record', async () => {
  await db.deleteUnlinkedDocument(document.id);
  await expect(db.updateDocument({ ...document, state: 'failed' })).rejects.toThrow('已被删除');
  expect(await db.getDocuments()).toEqual([]);
});

test('v4 upgrade preserves records and pending jobs survive idempotent v6 migration', async () => {
  raw.exec(
    'DROP TABLE pending_file_deletions; DROP INDEX visits_document; ALTER TABLE visits DROP COLUMN document_id; PRAGMA user_version=4;',
  );
  await migrateDatabase(adapter(raw));
  expect(raw.prepare('PRAGMA user_version').get()!.user_version).toBe(6);
  expect((await db.getDocuments()).map((d) => d.id)).toEqual([document.id]);
  raw.exec("INSERT INTO pending_file_deletions VALUES('previous','previous-report');");
  await migrateDatabase(adapter(raw));
  expect(jobs()).toEqual([{ document_id: 'previous', report_id: 'previous-report' }]);
});

const visit: Visit = {
  id: 'visit',
  memberId: 'self',
  documentId: document.id,
  title: '合成就诊',
  date: '',
  note: '',
  status: 'review',
  reportIds: [],
};
async function mixedDocument() {
  await db.updateDocument({ ...document, pageCount: 3 });
  await db.saveReport({
    ...report,
    observations: [
      {
        id: 'value',
        name: '合成指标',
        code: '',
        rawValue: '1',
        originalValue: '1',
        unit: 'U/L',
        reference: '0-10',
        specimen: '',
        method: '',
        page: 0,
      },
    ],
  });
  // Create an actual revision, not a hand-written approximation of cascades.
  await db.saveReport((await db.getReports())[0]!);
  await db.putDocument({ ...document, id: 'external', hash: 'external' });
  await db.saveReport({ ...report, id: 'external-report', documentId: 'external' });
  await db.saveVisit({ ...visit, reportIds: [report.id, 'external-report'] });
  await db.saveVisit({
    ...visit,
    id: 'independent',
    documentId: 'external',
    reportIds: [report.id, 'external-report'],
  });
}
const scopeForDocument = () => db.getDocumentDeletionScope(document.id, 'self');

test('whole-document deletion atomically removes sourced records, results and revisions but preserves independent linked records', async () => {
  await mixedDocument();
  const scope = await scopeForDocument();
  expect(scope).toMatchObject({
    reportCount: 1,
    observationCount: 1,
    visitCount: 1,
    retainedVisitCount: 1,
    retainedReportCount: 1,
    memberId: 'self',
    sourceType: 'pdf',
  });
  expect(raw.prepare('SELECT * FROM revisions').all()).toHaveLength(1);
  expect(await db.deleteWholeDocument(scope)).toEqual({ status: 'deleted', cleanupPending: false });
  expect((await db.getDocuments()).map((item) => item.id)).toEqual(['external']);
  expect((await db.getReports()).map((item) => item.id)).toEqual(['external-report']);
  expect(await db.getVisits()).toEqual([
    expect.objectContaining({ id: 'independent', reportIds: ['external-report'] }),
  ]);
  expect(raw.prepare('SELECT * FROM observations').all()).toEqual([]);
  expect(raw.prepare('SELECT * FROM revisions').all()).toEqual([]);
  expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(FS.deleteAsync).toHaveBeenCalledTimes(1);
  expect(FS.deleteAsync).toHaveBeenCalledWith('file:///local/reports/synthetic.pdf', {
    idempotent: true,
  });
  expect(clearDocumentPreviews).toHaveBeenCalledWith(document.id);
});

test('same-file copies owned by other members survive; another member cannot preview or confirm deletion', async () => {
  await db.saveMember({ ...selfMember, id: 'mother', label: '妈妈' });
  await db.putDocument({ ...document, memberId: 'mother', id: 'mother-copy' });
  await db.saveReport({
    ...report,
    memberId: 'mother',
    documentId: 'mother-copy',
    id: 'mother-report',
  });
  await expect(db.getDocumentDeletionScope(document.id, 'mother')).rejects.toThrow(
    '不属于当前成员',
  );
  const scope = await scopeForDocument();
  await expect(db.deleteWholeDocument({ ...scope, memberId: 'mother' })).rejects.toThrow(
    '不属于当前成员',
  );
  expect(FS.deleteAsync).not.toHaveBeenCalled();
  await db.deleteWholeDocument(scope);
  expect((await db.getDocuments('mother')).map((item) => item.id)).toEqual(['mother-copy']);
  expect((await db.getReports('mother')).map((item) => item.id)).toEqual(['mother-report']);
});

test('a changed record identity requires reconfirmation even when all counts are unchanged', async () => {
  await db.updateDocument({ ...document, pageCount: 3 });
  await db.saveReport(report);
  const scope = await scopeForDocument();
  await db.deleteReport(report.id);
  await db.saveReport({ ...report, id: 'replacement' });
  const result = await db.deleteWholeDocument(scope);
  expect(result).toMatchObject({ status: 'changed', scope: { reportCount: 1 } });
  expect((await db.getReports()).map((item) => item.id)).toEqual(['replacement']);
  expect(FS.deleteAsync).not.toHaveBeenCalled();
  expect(jobs()).toEqual([]);
  if (result.status !== 'changed') throw new Error('Expected updated scope');
  expect(await db.deleteWholeDocument(result.scope)).toEqual({
    status: 'deleted',
    cleanupPending: false,
  });
});

test('new independent associations update confirmation scope before any deletion', async () => {
  await db.saveReport(report);
  const scope = await scopeForDocument();
  await db.saveVisit({ ...visit, documentId: undefined, reportIds: [report.id] });
  expect(await db.deleteWholeDocument(scope)).toMatchObject({
    status: 'changed',
    scope: { retainedVisitCount: 1 },
  });
  expect(await db.getReports()).toHaveLength(1);
  expect(FS.deleteAsync).not.toHaveBeenCalled();
});

test('empty photo documents can be deleted without inventing structured counts', async () => {
  await db.updateDocument({ ...document, sourceType: 'image' });
  const scope = await scopeForDocument();
  expect(scope).toMatchObject({
    sourceType: 'image',
    reportCount: 0,
    observationCount: 0,
    visitCount: 0,
  });
  await db.deleteWholeDocument(scope);
  expect(await db.getDocuments()).toEqual([]);
});

test('whole-document rollback restores records, observations, revisions, links and cleanup intent', async () => {
  await mixedDocument();
  const scope = await scopeForDocument();
  raw.exec(
    "CREATE TRIGGER reject_whole_delete BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT, 'TEST_ROLLBACK'); END;",
  );
  try {
    await expect(db.deleteWholeDocument(scope)).rejects.toThrow('TEST_ROLLBACK');
    expect(await scopeForDocument()).toEqual(scope);
    expect(raw.prepare('SELECT * FROM revisions').all()).toHaveLength(1);
    expect(jobs()).toEqual([]);
    expect(FS.deleteAsync).not.toHaveBeenCalled();
  } finally {
    raw.exec('DROP TRIGGER reject_whole_delete');
  }
});

test('file failure after logical whole deletion returns pending cleanup and retries durably', async () => {
  await mixedDocument();
  jest.mocked(FS.deleteAsync).mockRejectedValueOnce(new Error('IO_ERROR'));
  expect(await db.deleteWholeDocument(await scopeForDocument())).toEqual({
    status: 'deleted',
    cleanupPending: true,
  });
  expect((await db.getDocuments()).map((item) => item.id)).toEqual(['external']);
  expect(jobs()).toEqual([{ document_id: document.id, report_id: null }]);
  await db.retryFileDeletions();
  expect(jobs()).toEqual([]);
});

test('late import, reparse and edit writes cannot resurrect a deleted document or its records', async () => {
  await mixedDocument();
  await db.deleteWholeDocument(await scopeForDocument());
  await expect(db.commitImport(document, [])).rejects.toThrow('已被删除');
  await expect(db.commitImport(document, [report], [visit])).rejects.toThrow('已被删除');
  await expect(db.saveReport(report)).rejects.toThrow();
  await expect(db.saveVisit(visit)).rejects.toThrow();
  await expect(db.updateDocument(document)).rejects.toThrow('已被删除');
  expect((await db.getReports()).map((item) => item.id)).toEqual(['external-report']);
  expect((await db.getVisits()).map((item) => item.id)).toEqual(['independent']);
});

test('owner is checked again at confirmation and corrupted child ownership fails closed', async () => {
  await db.saveMember({ ...selfMember, id: 'mother', label: '妈妈' });
  const scope = await scopeForDocument();
  raw
    .prepare("UPDATE documents SET data=json_set(data,'$.memberId','mother') WHERE id=?")
    .run(document.id);
  await expect(db.deleteWholeDocument(scope)).rejects.toThrow('不属于当前成员');
  raw
    .prepare("UPDATE documents SET data=json_set(data,'$.memberId','self') WHERE id=?")
    .run(document.id);
  await db.saveReport(report);
  const next = await scopeForDocument();
  raw
    .prepare("UPDATE reports SET data=json_set(data,'$.memberId','mother') WHERE id=?")
    .run(report.id);
  await expect(db.deleteWholeDocument(next)).rejects.toThrow('归属不一致');
  expect(FS.deleteAsync).not.toHaveBeenCalled();
  expect(jobs()).toEqual([]);
});

test('edits made while confirmation is open require reconfirmation without losing the edit', async () => {
  await mixedDocument();
  const scope = await scopeForDocument();
  const original = (await db.getReports()).find((item) => item.id === report.id)!;
  await db.saveReport({
    ...original,
    observations: original.observations.map((item) => ({ ...item, rawValue: '2' })),
  });
  expect(await db.deleteWholeDocument(scope)).toMatchObject({
    status: 'changed',
    scope: { reportCount: scope.reportCount, observationCount: scope.observationCount },
  });
  expect(
    (await db.getReports()).find((item) => item.id === report.id)?.observations[0]?.rawValue,
  ).toBe('2');
  expect(FS.deleteAsync).not.toHaveBeenCalled();
});

test('individual section deletion still keeps a multi-page document and its visits', async () => {
  await mixedDocument();
  await db.deleteReport(report.id);
  expect((await db.getDocuments()).some((item) => item.id === document.id)).toBe(true);
  expect((await db.getReports()).map((item) => item.id)).toEqual(['external-report']);
  expect(await db.getVisits()).toHaveLength(2);
  expect((await db.getVisits()).every((item) => !item.reportIds?.includes(report.id))).toBe(true);
  expect(FS.deleteAsync).not.toHaveBeenCalled();
});
