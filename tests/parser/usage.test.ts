import { UsageCollector } from '../../src/services/usage-collector';
const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
function setup() {
  let value: string | null = null;
  let n = 0;
  const send = jest.fn(async (_event: unknown, _signal: AbortSignal) => true);
  const collector = new UsageCollector({
    load: async () => value,
    save: async (v) => {
      value = v;
    },
    uuid: () => uuid(++n),
    now: () => Date.parse('2026-10-22T01:00:00.000Z'),
    platform: 'ios',
    send,
  });
  return { collector, send, stored: () => JSON.parse(value ?? '{}') };
}
test('opt out collects nothing; withdrawal removes installation and pending events', async () => {
  const { collector, send, stored } = setup();
  await collector.track('app_open');
  expect(send).not.toHaveBeenCalled();
  expect(stored()).toEqual({});
  await collector.consent(true);
  const first = stored().installation;
  send.mockResolvedValue(false);
  await collector.track('app_open');
  expect(stored().events).toHaveLength(1);
  await collector.consent(false);
  expect(stored()).toEqual({ consent: false, events: [] });
  await collector.track('app_open');
  expect(send).toHaveBeenCalledTimes(1);
  await collector.consent(true);
  expect(stored().installation).not.toBe(first);
});
test('retry keeps event IDs; never serializes arbitrary report properties', async () => {
  const { collector, send, stored } = setup();
  await collector.consent(true);
  send.mockResolvedValue(false);
  await collector.track('app_open');
  const id = stored().events[0].id;
  send.mockResolvedValue(true);
  await collector.track('screen_view', { screen: 'records' });
  expect(send.mock.calls[1]?.[0]).toMatchObject({ id });
  expect(stored().events).toHaveLength(0);
  await collector.track('app_open', { patient: 'private' } as never);
  expect(send).toHaveBeenCalledTimes(3);
});
test('revocation aborts an active upload and clears the queued event', async () => {
  let abortSeen = false;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { collector, send, stored } = setup();
  await collector.consent(true);
  send.mockImplementation(
    (_event?: unknown, signal?: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        started();
        signal!.addEventListener('abort', () => {
          abortSeen = true;
          resolve(false);
        });
      }),
  );
  const pending = collector.track('app_open');
  await ready;
  await collector.consent(false);
  await pending;
  expect(abortSeen).toBe(true);
  expect(stored()).toEqual({ consent: false, events: [] });
});
