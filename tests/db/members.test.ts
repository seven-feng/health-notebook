import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as SQLite from 'expo-sqlite';
import { migrateDatabase } from '../../src/db/migrations';
import * as db from '../../src/db';
import { selfMember } from '../../src/domain/members';
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
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as SQLiteDatabase;
}
const document: DocumentRecord = {
  memberId: 'self',
  id: 'doc',
  hash: 'identical-pdf',
  uri: 'file:///old/doc.pdf',
  fileName: 'old.pdf',
  pageCount: 1,
  state: 'ready',
  error: null,
  createdAt: '2026-10-18',
};
const report: Report = {
  memberId: 'self',
  id: 'report',
  documentId: 'doc',
  patient: '甲',
  title: '原报告',
  date: '2026-10-18',
  dateKind: 'report',
  status: 'confirmed',
  createdAt: '2026-10-18',
  template: null,
  warnings: [],
  observations: [],
};

test('v2 upgrade preserves originals, observations, revisions and visit links, and is idempotent', async () => {
  const raw = new DatabaseSync(':memory:');
  const oldDocument = { ...document, memberId: undefined };
  const oldReport = { ...report, memberId: undefined, observations: undefined };
  raw.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE documents(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,data TEXT NOT NULL);
    CREATE TABLE reports(id TEXT PRIMARY KEY,document_id TEXT REFERENCES documents(id),data TEXT NOT NULL);
    CREATE TABLE observations(id TEXT PRIMARY KEY,report_id TEXT REFERENCES reports(id) ON DELETE CASCADE,data TEXT NOT NULL);
    CREATE TABLE revisions(id INTEGER PRIMARY KEY,report_id TEXT REFERENCES reports(id) ON DELETE CASCADE,data TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE visits(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE visit_reports(visit_id TEXT REFERENCES visits(id),report_id TEXT REFERENCES reports(id),PRIMARY KEY(visit_id,report_id));
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO settings VALUES('patient','甲');
    PRAGMA user_version=2;
  `);
  raw
    .prepare('INSERT INTO documents VALUES(?,?,?)')
    .run('doc', 'identical-pdf', JSON.stringify(oldDocument));
  raw.prepare('INSERT INTO reports VALUES(?,?,?)').run('report', 'doc', JSON.stringify(oldReport));
  raw.exec(`INSERT INTO observations VALUES('o','report','{"rawValue":"100","rect":{"x":0.1}}');
    INSERT INTO revisions VALUES(1,'report','{"original":"unchanged"}','2026-10-18');
    INSERT INTO visits VALUES('v','{"id":"v","title":"复查"}'); INSERT INTO visit_reports VALUES('v','report');`);
  const connection = adapter(raw);
  await migrateDatabase(connection);
  const first = raw.prepare('SELECT * FROM documents').get();
  expect(JSON.parse(first!.data as string)).toEqual({ ...oldDocument, memberId: 'self' });
  expect(first!.hash).toBe('["self","identical-pdf"]');
  expect(JSON.parse(raw.prepare('SELECT data FROM reports').get()!.data as string).memberId).toBe(
    'self',
  );
  expect(JSON.parse(raw.prepare('SELECT data FROM visits').get()!.data as string).memberId).toBe(
    'self',
  );
  expect(JSON.parse(raw.prepare('SELECT data FROM members').get()!.data as string)).toMatchObject({
    id: 'self',
    name: '甲',
    label: '我',
  });
  expect(raw.prepare('SELECT data FROM observations').get()!.data).toBe(
    '{"rawValue":"100","rect":{"x":0.1}}',
  );
  expect(raw.prepare('SELECT data FROM revisions').get()!.data).toBe('{"original":"unchanged"}');
  expect(raw.prepare('SELECT * FROM visit_reports').get()).toMatchObject({
    visit_id: 'v',
    report_id: 'report',
  });
  expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  await migrateDatabase(connection);
  expect(raw.prepare('SELECT * FROM documents').get()).toEqual(first);
  expect(raw.prepare('SELECT * FROM members').all()).toHaveLength(1);
  raw.close();
});

describe('persistent ownership boundaries', () => {
  const raw = new DatabaseSync(':memory:');
  beforeAll(async () => {
    jest.mocked(SQLite.openDatabaseAsync).mockResolvedValue(adapter(raw));
    await db.database();
  });
  beforeEach(async () => {
    raw.exec(
      'DELETE FROM pending_file_deletions; DELETE FROM visit_reports; DELETE FROM visits; DELETE FROM observations; DELETE FROM revisions; DELETE FROM reports; DELETE FROM documents; DELETE FROM members; DELETE FROM settings;',
    );
    await db.saveMember(selfMember);
    await db.saveMember({ ...selfMember, id: 'mom', label: '妈妈', name: '乙' });
  });
  afterAll(() => raw.close());
  test('bulk patient entry only fills pending blanks in this document and preserves results and links', async () => {
    await db.putDocument({ ...document, pageCount: 3 });
    await db.putDocument({ ...document, id: 'other-doc', hash: 'other' });
    const blank: Report = {
      ...report,
      id: 'blank',
      patient: ' ',
      status: 'review',
      identityConfirmation: { memberName: '旧名字', patient: '' },
      warnings: ['患者名称未能提取', '保留提示'],
      observations: [
        {
          id: 'zero',
          name: '测试指标',
          rawValue: '0',
          unit: '%',
          reference: '0-1',
          page: 0,
          needsReview: true,
          code: '',
          specimen: '',
          method: '',
          originalValue: '0',
        },
      ],
    };
    await db.saveReport(blank);
    await db.saveReport({ ...report, id: 'blank-2', patient: '', status: 'review' });
    await db.saveReport({ ...report, id: 'named', patient: '甲', status: 'review' });
    await db.saveReport({ ...report, id: 'confirmed-blank', patient: '' });
    await db.saveReport({ ...report, id: 'archived-blank', patient: '', status: 'archived' });
    await db.saveReport({
      ...report,
      id: 'other',
      documentId: 'other-doc',
      patient: '',
      status: 'review',
    });
    await db.saveVisit({
      id: 'v',
      memberId: 'self',
      title: '复查',
      date: '',
      note: '',
      reportIds: ['blank'],
    });
    const before = await db.getReports();
    const documents = await db.getDocuments(),
      visits = await db.getVisits();
    const observations = raw.prepare('SELECT * FROM observations').all();
    expect((await db.fillDocumentPatient('doc', 'self', ' 甲 ')).sort()).toEqual([
      'blank',
      'blank-2',
    ]);
    const after = await db.getReports();
    expect(after.find((r) => r.id === 'blank')).toEqual({
      ...blank,
      patient: '甲',
      identityConfirmation: undefined,
      warnings: ['保留提示'],
    });
    for (const r of before.filter((r) => !['blank', 'blank-2'].includes(r.id)))
      expect(after.find((next) => next.id === r.id)).toEqual(r);
    expect(raw.prepare('SELECT * FROM observations').all()).toEqual(observations);
    expect(await db.getDocuments()).toEqual(documents);
    expect(await db.getVisits()).toEqual(visits);
    expect(raw.prepare('SELECT * FROM revisions').all()).toHaveLength(2);
    expect(await db.fillDocumentPatient('doc', 'self', '甲')).toEqual([]);
    expect(raw.prepare('SELECT * FROM revisions').all()).toHaveLength(2);
  });
  test('bulk entry rejects other owners, deleted documents, invalid input and conflicting names without writes', async () => {
    await db.putDocument(document);
    await db.saveReport({ ...report, id: 'blank', patient: '', status: 'review' });
    await db.saveReport(report);
    const before = await db.getReports();
    await expect(db.fillDocumentPatient('doc', 'mom', '甲')).rejects.toThrow('所属成员');
    await expect(db.fillDocumentPatient('gone', 'self', '甲')).rejects.toThrow('已删除');
    await expect(db.fillDocumentPatient('doc', 'self', ' ')).rejects.toThrow('1–30');
    await expect(db.fillDocumentPatient('doc', 'self', '甲'.repeat(31))).rejects.toThrow('1–30');
    await expect(db.fillDocumentPatient('doc', 'self', '乙')).rejects.toThrow('不同姓名');
    expect(await db.getReports()).toEqual(before);
    expect(raw.prepare('SELECT * FROM revisions').all()).toHaveLength(0);
  });
  test('bulk entry rolls back names and revisions when a later write fails', async () => {
    await db.putDocument(document);
    await db.saveReport({ ...report, id: 'a', patient: '', status: 'review' });
    await db.saveReport({ ...report, id: 'b', patient: '', status: 'review' });
    const before = await db.getReports();
    raw.exec(
      "CREATE TRIGGER fail_patient BEFORE UPDATE ON reports WHEN NEW.id='b' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
    );
    try {
      await expect(db.fillDocumentPatient('doc', 'self', '甲')).rejects.toThrow(
        'synthetic failure',
      );
      expect(await db.getReports()).toEqual(before);
      expect(raw.prepare('SELECT * FROM revisions').all()).toHaveLength(0);
    } finally {
      raw.exec('DROP TRIGGER fail_patient');
    }
  });
  test('bulk entry does not accept identity mismatch or confirm medical results', async () => {
    await db.putDocument({ ...document, memberId: 'mom' });
    await db.saveReport({ ...report, memberId: 'mom', patient: '', status: 'review' });
    await db.fillDocumentPatient('doc', 'mom', '甲');
    const filled = (await db.getReports('mom'))[0]!;
    expect(filled.status).toBe('review');
    expect(filled.identityConfirmation).toBeUndefined();
    await expect(db.saveReport({ ...filled, status: 'confirmed' })).rejects.toThrow('姓名');
  });
  test('multi-page candidates preserve revisions and visit links; failed commits roll back all sections', async () => {
    await db.putDocument({ ...document, pageCount: 3 });
    const original = { ...report, sourcePages: [0, 1], sectionKey: 'section-a' };
    await db.saveReport(original);
    await db.saveVisit({
      id: 'v',
      memberId: 'self',
      title: '复查',
      date: '2026-10-18',
      note: '',
      reportIds: [report.id],
    });
    await db.saveReport({ ...original, status: 'review', title: '新结果' });
    expect((await db.getReports())[0]!.sourcePages).toEqual([0, 1]);
    expect((await db.getVisits())[0]!.reportIds).toEqual([report.id]);
    const revision = JSON.parse(raw.prepare('SELECT data FROM revisions').get()!.data as string);
    expect(revision.report.title).toBe('原报告');
    const first = { ...report, id: 'candidate-1', status: 'review' as const, sourcePages: [1, 2] };
    await expect(
      db.commitImport({ ...document, pageCount: 3 }, [
        first,
        { ...first, id: 'invalid', memberId: 'mom' },
      ]),
    ).rejects.toThrow();
    expect((await db.getReports()).map((r) => r.id)).toEqual([report.id]);
    await db.commitImport({ ...document, pageCount: 3 }, [first]);
    expect((await db.getReports()).map((r) => r.id).sort()).toEqual(
      ['candidate-1', report.id].sort(),
    );
    expect((await db.getVisits())[0]!.reportIds).toEqual([report.id]);
  });
  test('date repair preserves reviewed observations, ownership, confirmation and revision history', async () => {
    await db.putDocument(document);
    const old: Report = {
      ...report,
      date: '',
      dateKind: 'unknown',
      warnings: ['请按原报告填写采样日期；无法确认时可留空。', '保留其他提示'],
      observations: [
        {
          id: 'o',
          name: '已编辑项目',
          rawValue: '80',
          unit: 'U/L',
          reviewed: true,
        } as Report['observations'][number],
      ],
    };
    await db.saveReport(old);
    const originalItems = raw.prepare('SELECT data FROM observations').all();
    await db.fillMissingReportDate(old, {
      date: '2024-05-04',
      dateKind: 'sample',
      dateSource: 'header',
    });
    expect((await db.getReports())[0]).toEqual({
      ...old,
      date: '2024-05-04',
      dateKind: 'sample',
      dateSource: 'header',
      warnings: ['保留其他提示'],
    });
    expect(raw.prepare('SELECT data FROM observations').all()).toEqual(originalItems);
    const revision = JSON.parse(raw.prepare('SELECT data FROM revisions').get()!.data as string);
    expect(revision.report.date).toBe('');
    expect(revision.observations).toEqual(old.observations);
    await db.fillMissingReportDate(old, {
      date: '2024-05-04',
      dateKind: 'sample',
      dateSource: 'header',
    });
    expect(raw.prepare('SELECT data FROM revisions').all()).toHaveLength(1);
  });
  test('date repair cannot replace a concurrent edit or recreate a deleted report', async () => {
    await db.putDocument(document);
    const old: Report = { ...report, date: '', dateKind: 'unknown' };
    await db.saveReport(old);
    await db.saveReport({ ...old, date: '2024-05-01' });
    await db.fillMissingReportDate(old, { date: '2024-05-04', dateKind: 'sample' });
    expect((await db.getReports())[0]?.date).toBe('2024-05-01');
    await db.deleteReport(old.id);
    await db.fillMissingReportDate(old, { date: '2024-05-04', dateKind: 'sample' });
    expect(await db.getReports()).toEqual([]);
  });
  test('deleting the last section retains the multi-page original until explicit file deletion', async () => {
    await db.putDocument({ ...document, pageCount: 3 });
    await db.saveReport({ ...report, sourcePages: [0, 1] });
    await db.deleteReport(report.id);
    expect(await db.getReports()).toEqual([]);
    expect((await db.getDocuments()).map((d) => d.id)).toEqual([document.id]);
    await db.deleteUnlinkedDocument(document.id);
    expect(await db.getDocuments()).toEqual([]);
  });
  test('same PDF can belong to two members and deleting one copy keeps the other', async () => {
    await db.putDocument(document);
    await db.putDocument({ ...document, id: 'mom-doc', memberId: 'mom' });
    await db.saveReport(report);
    await db.saveReport({
      ...report,
      id: 'mom-report',
      memberId: 'mom',
      documentId: 'mom-doc',
      patient: '乙',
    });
    expect((await db.findDuplicate(document.hash, 'self'))?.id).toBe('doc');
    expect((await db.findDuplicate(document.hash, 'mom'))?.id).toBe('mom-doc');
    expect((await db.getReports('mom')).map((r) => r.id)).toEqual(['mom-report']);
    await db.deleteReport('report');
    expect(await db.findDuplicate(document.hash, 'self')).toBeNull();
    expect((await db.getDocuments('mom')).map((d) => d.id)).toEqual(['mom-doc']);
    expect((await db.getReports('mom')).map((r) => r.id)).toEqual(['mom-report']);
  });
  test('cross-member original links, ownership edits and visit associations are rejected atomically', async () => {
    await db.putDocument(document);
    await db.saveReport(report);
    await expect(db.saveReport({ ...report, memberId: 'mom' })).rejects.toThrow();
    await expect(db.saveReport({ ...report, id: 'invalid', memberId: 'mom' })).rejects.toThrow();
    const visit: Visit = {
      id: 'v',
      memberId: 'mom',
      title: '复查',
      date: '2026-10-18',
      note: '',
      reportIds: ['report'],
    };
    await expect(db.saveVisit(visit)).rejects.toThrow('只能关联');
    expect(await db.getVisits('mom')).toEqual([]);
    expect((await db.getReports('self'))[0]?.patient).toBe('甲');
    expect(raw.prepare('SELECT * FROM revisions').all()).toEqual([]);
  });
  test('visit originals and edits persist separately, and cannot cross member boundaries', async () => {
    const { visitFixture } = require('../fixtures/visit-layout');
    const { parseVisitPage } = require('../../src/parser/visit');
    await db.putDocument(document);
    const original = parseVisitPage(visitFixture());
    const visit: Visit = {
      id: 'v',
      memberId: 'self',
      documentId: document.id,
      date: '2026-10-23',
      title: '门诊',
      note: '',
      status: 'review',
      original,
      sections: { chief: '咳嗽' },
    };
    await db.commitImport(document, [], [visit]);
    await db.saveVisit({
      ...visit,
      original: { ...original, date: '' },
      sections: { chief: '用户修正' },
    });
    const saved = (await db.getVisits())[0]!;
    expect(saved.original).toEqual(original);
    expect(saved.sections?.chief).toBe('用户修正');
    await expect(db.saveVisit({ ...visit, id: 'other', memberId: 'mom' })).rejects.toThrow(
      '所属成员',
    );
    await expect(db.deleteUnlinkedDocument(document.id)).rejects.toThrow('关联记录');
    expect((await db.getDocuments()).length).toBe(1);
  });
  test('visit identity confirmation is bound to both names', async () => {
    const visit: Visit = {
      id: 'v',
      memberId: 'mom',
      date: '2026-10-23',
      title: '门诊',
      note: '',
      patient: '甲',
      status: 'confirmed',
    };
    await expect(db.saveVisit(visit)).rejects.toThrow('姓名');
    const accepted = { ...visit, identityConfirmation: { patient: '甲', memberName: '乙' } };
    await db.saveVisit(accepted);
    await expect(db.saveVisit({ ...accepted, patient: '丙' })).rejects.toThrow('姓名');
    await db.saveMember({ ...selfMember, id: 'mom', label: '妈妈', name: '丁' });
    await expect(db.saveVisit(accepted)).rejects.toThrow('姓名');
  });
  test('deleting a visit removes only its own original and keeps the linked lab', async () => {
    await db.putDocument(document);
    await db.saveReport(report);
    await db.putDocument({ ...document, id: 'visit-doc', hash: 'visit-source' });
    await db.saveVisit({
      id: 'v',
      memberId: 'self',
      documentId: 'visit-doc',
      date: '',
      title: '就诊',
      note: '',
      reportIds: [report.id],
    });
    await db.removeVisit('v');
    expect(await db.getVisits()).toEqual([]);
    expect((await db.getReports()).map((r) => r.id)).toEqual([report.id]);
    expect((await db.getDocuments()).map((d) => d.id)).toEqual([document.id]);
  });
  test('shared original remains while either a lab or visit still uses it', async () => {
    await db.putDocument(document);
    await db.saveReport(report);
    await db.saveVisit({
      id: 'v',
      memberId: 'self',
      documentId: document.id,
      date: '',
      title: '就诊',
      note: '',
    });
    await db.deleteReport(report.id);
    expect((await db.getDocuments()).map((d) => d.id)).toEqual([document.id]);
    await db.removeVisit('v');
    expect(await db.getDocuments()).toEqual([]);
  });
  test('name mismatch confirmation is bound to the exact report name and member name', async () => {
    const r = { ...report, documentId: '', memberId: 'mom' };
    await expect(db.saveReport(r)).rejects.toThrow('姓名');
    const accepted = { ...r, identityConfirmation: { memberName: '乙', patient: '甲' } };
    await db.saveReport(accepted);
    await expect(db.saveReport({ ...accepted, patient: '丙' })).rejects.toThrow('姓名');
    await db.saveMember({ ...selfMember, id: 'mom', label: '妈妈', name: '丁' });
    await expect(db.saveReport(accepted)).rejects.toThrow('姓名');
  });
});

test('v3 upgrades without rewriting records; v6 blocks older apps and future schemas are rejected', async () => {
  const raw = new DatabaseSync(':memory:');
  const connection = adapter(raw);
  await migrateDatabase(connection);
  raw.exec(
    'DROP INDEX visits_document; ALTER TABLE visits DROP COLUMN document_id; PRAGMA user_version=3',
  );
  raw.prepare('INSERT INTO documents VALUES(?,?,?)').run('d', 'unique', JSON.stringify(document));
  await migrateDatabase(connection);
  expect(raw.prepare('PRAGMA user_version').get()!.user_version).toBe(6);
  expect(raw.prepare('SELECT data FROM documents').get()!.data).toBe(JSON.stringify(document));
  raw.exec('PRAGMA user_version=7');
  await expect(migrateDatabase(connection)).rejects.toThrow('较新版本');
  expect(raw.prepare('SELECT COUNT(*) AS n FROM documents').get()!.n).toBe(1);
  raw.close();
});
