import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { getSetting, setSetting } from '../db';
import { UsageCollector } from './usage-collector';
import type { EventName, UsageEvent } from './analytics-contract';
const url = process.env.EXPO_PUBLIC_ANALYTICS_URL ?? '';
export const analyticsConfigured =
  /^https:\/\//.test(url) ||
  (__DEV__ && /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/.test(url));
const collector = new UsageCollector({
  load: () => getSetting('usage-state'),
  save: (value) => setSetting('usage-state', value),
  uuid: Crypto.randomUUID,
  now: Date.now,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  send: async (event, signal) =>
    (
      await fetch(`${url.replace(/\/$/, '')}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal,
      })
    ).ok,
});
export const usageEnabled = () =>
  analyticsConfigured ? collector.enabled() : Promise.resolve(false);
export const setUsageConsent = (enabled: boolean) =>
  collector.consent(enabled && analyticsConfigured);
export function track(
  name: EventName,
  properties: Pick<UsageEvent, 'screen' | 'outcome' | 'duration'> = {},
): void {
  if (analyticsConfigured) void collector.track(name, properties);
}
