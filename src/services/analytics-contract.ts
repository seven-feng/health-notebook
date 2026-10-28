export const eventNames = [
  'app_open',
  'screen_view',
  'import_started',
  'import_finished',
  'report_confirmed',
] as const;
export type EventName = (typeof eventNames)[number];
export type UsageEvent = {
  id: string;
  installation: string;
  name: EventName;
  at: string;
  platform: 'ios' | 'android';
  version: string;
  screen?: 'records' | 'metrics' | 'settings';
  outcome?: 'extracted' | 'unsupported' | 'failed';
  duration?: 'under_1s' | '1_to_5s' | '5_to_20s' | 'over_20s';
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const keys = new Set([
  'id',
  'installation',
  'name',
  'at',
  'platform',
  'version',
  'screen',
  'outcome',
  'duration',
]);
export function validateEvent(input: unknown): input is UsageEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const e = input as Record<string, unknown>;
  if (Object.keys(e).some((k) => !keys.has(k))) return false;
  if (
    typeof e.id !== 'string' ||
    !uuid.test(e.id) ||
    typeof e.installation !== 'string' ||
    !uuid.test(e.installation)
  )
    return false;
  if (
    !eventNames.includes(e.name as EventName) ||
    !['ios', 'android'].includes(e.platform as string)
  )
    return false;
  if (
    typeof e.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.at) ||
    !Number.isFinite(Date.parse(e.at))
  )
    return false;
  if (typeof e.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(e.version)) return false;
  if (e.screen !== undefined && !['records', 'metrics', 'settings'].includes(e.screen as string))
    return false;
  if (
    e.outcome !== undefined &&
    !['extracted', 'unsupported', 'failed'].includes(e.outcome as string)
  )
    return false;
  if (
    e.duration !== undefined &&
    !['under_1s', '1_to_5s', '5_to_20s', 'over_20s'].includes(e.duration as string)
  )
    return false;
  return e.name !== 'screen_view' || e.screen !== undefined;
}
