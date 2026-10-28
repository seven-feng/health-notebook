import type { SQLiteDatabase } from 'expo-sqlite';
import { documentKey, selfMember } from '../domain/members';
import type { DocumentRecord } from '../domain/types';

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  const version =
    (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (version > 6) throw new Error('数据库来自较新版本，请升级 App。');
  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, document_id TEXT REFERENCES documents(id), data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reports_document ON reports(document_id);
      CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS observations_report ON observations(report_id);
      CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visit_reports (visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, PRIMARY KEY(visit_id,report_id));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_file_deletions (document_id TEXT PRIMARY KEY, report_id TEXT);
    `);
    if (version < 3) {
      const previous = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM settings WHERE key='patient'",
      );
      await db.runAsync(
        'INSERT OR IGNORE INTO members (id,data) VALUES (?,?)',
        selfMember.id,
        JSON.stringify({
          ...selfMember,
          name: previous?.value ?? '',
          createdAt: new Date().toISOString(),
        }),
      );
      // One transaction preserves originals, observations, revision history and
      // visit links. Existing records are explicitly assigned to the self archive.
      for (const table of ['documents', 'reports', 'visits'])
        await db.runAsync(`UPDATE ${table} SET data=json_set(data,'$.memberId',?)`, selfMember.id);
      const docs = await db.getAllAsync<{ id: string; data: string }>(
        'SELECT id,data FROM documents',
      );
      for (const row of docs) {
        const doc = JSON.parse(row.data) as DocumentRecord;
        await db.runAsync(
          'UPDATE documents SET hash=? WHERE id=?',
          documentKey(selfMember.id, doc.hash),
          row.id,
        );
      }
      await db.execAsync("DELETE FROM settings WHERE key='patient';");
    }
    if (version < 6) {
      await db.execAsync(
        'ALTER TABLE visits ADD COLUMN document_id TEXT REFERENCES documents(id);',
      );
    }
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS visits_document ON visits(document_id);
      CREATE INDEX IF NOT EXISTS documents_member ON documents(json_extract(data,'$.memberId'));
      CREATE INDEX IF NOT EXISTS reports_member ON reports(json_extract(data,'$.memberId'));
      CREATE INDEX IF NOT EXISTS visits_member ON visits(json_extract(data,'$.memberId'));
      PRAGMA user_version = 6;
    `);
  });
}
