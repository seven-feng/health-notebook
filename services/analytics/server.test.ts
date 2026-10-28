import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics } from './server.ts';
import type { AddressInfo } from 'node:net';
test('collector deduplicates and rejects extra fields; stats require authorization', async () => {
  const token = 'local-test-token-123456789';
  const server = createAnalytics(':memory:', token);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const event = {
    id: '11111111-1111-4111-8111-111111111111',
    installation: '22222222-2222-4222-8222-222222222222',
    name: 'screen_view',
    screen: 'records',
    at: new Date().toISOString(),
    platform: 'android',
    version: '0.1.0',
  };
  try {
    const send = (data: unknown) =>
      fetch(base + '/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    assert.equal((await send(event)).status, 202);
    assert.equal((await send(event)).status, 202);
    assert.equal((await send({ ...event, fileName: 'report.pdf' })).status, 400);
    assert.equal((await fetch(base + '/stats')).status, 401);
    const stats = (await (
      await fetch(base + '/stats', { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as { pages: { pv: number; uv: number }[] };
    assert.equal(stats.pages[0]?.pv, 1);
    assert.equal(stats.pages[0]?.uv, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
