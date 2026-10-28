import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateEvent } from '../../src/services/analytics-contract.ts';

export function createAnalytics(databasePath: string, adminToken: string) {
  if (adminToken.length < 16) throw new Error('统计查看令牌至少需要 16 个字符。');
  const db = new DatabaseSync(databasePath);
  db.exec(
    'CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY,installation TEXT NOT NULL,name TEXT NOT NULL,at TEXT NOT NULL,screen TEXT,outcome TEXT,duration TEXT,platform TEXT,version TEXT); CREATE INDEX IF NOT EXISTS events_time ON events(at);',
  );
  db.prepare("DELETE FROM events WHERE at < datetime('now','-180 days')").run();
  const rates = new Map<string, { at: number; count: number }>();
  const respond = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/events' && req.method === 'POST') {
      const address = req.socket.remoteAddress ?? 'unknown';
      const now = Date.now();
      const prior = rates.get(address);
      const rate = prior && now - prior.at < 60000 ? prior : { at: now, count: 0 };
      if (rates.size > 10000) rates.clear();
      rates.set(address, rate);
      if (++rate.count > 120) {
        respond(res, 429, { error: 'RATE_LIMIT' });
        return;
      }
      try {
        let text = '';
        for await (const chunk of req) {
          text += chunk.toString();
          if (Buffer.byteLength(text) > 2048) {
            respond(res, 413, { error: 'TOO_LARGE' });
            return;
          }
        }
        const event: unknown = JSON.parse(text);
        if (!validateEvent(event) || Math.abs(Date.parse(event.at) - now) > 7 * 86400000) {
          respond(res, 400, { error: 'INVALID_EVENT' });
          return;
        }
        db.prepare('INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?)').run(
          event.id,
          event.installation,
          event.name,
          event.at,
          event.screen ?? null,
          event.outcome ?? null,
          event.duration ?? null,
          event.platform,
          event.version,
        );
        respond(res, 202, { accepted: true });
      } catch {
        respond(res, 400, { error: 'INVALID_EVENT' });
      }
      return;
    }
    if (req.url === '/stats' && req.method === 'GET') {
      const actual = Buffer.from(req.headers.authorization ?? ''),
        expected = Buffer.from(`Bearer ${adminToken}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        respond(res, 401, { error: 'UNAUTHORIZED' });
        return;
      }
      const daily = db
        .prepare(
          "SELECT date(at,'+8 hours') AS day,COUNT(DISTINCT installation) AS active_installations FROM events GROUP BY day ORDER BY day DESC LIMIT 90",
        )
        .all();
      const monthly = db
        .prepare(
          "SELECT strftime('%Y-%m',at,'+8 hours') AS month,COUNT(DISTINCT installation) AS active_installations FROM events GROUP BY month ORDER BY month DESC",
        )
        .all();
      const pages = db
        .prepare(
          "SELECT screen,COUNT(*) AS pv,COUNT(DISTINCT installation) AS uv FROM events WHERE name='screen_view' GROUP BY screen",
        )
        .all();
      const imports = db
        .prepare(
          "SELECT outcome,COUNT(*) AS count FROM events WHERE name='import_finished' GROUP BY outcome",
        )
        .all();
      respond(res, 200, {
        scope: '仅同意统计的安装，不等于独立人数',
        timezone: 'Asia/Shanghai',
        daily,
        monthly,
        pages,
        imports,
      });
      return;
    }
    respond(res, 404, { error: 'NOT_FOUND' });
  });
  server.on('close', () => db.close());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.ANALYTICS_ADMIN_TOKEN ?? '';
  mkdirSync('services/analytics/data', { recursive: true });
  createAnalytics('services/analytics/data/usage.sqlite', token).listen(
    Number(process.env.PORT ?? 4318),
    '127.0.0.1',
    () => console.log('使用统计接口已启动：http://127.0.0.1:4318（开发环境）'),
  );
}
