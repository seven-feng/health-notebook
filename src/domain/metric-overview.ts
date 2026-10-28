import { Decimal } from 'decimal.js';
import { parseValue } from './metrics';
import { referencePosition } from './reference-range';
import type { MetricGroup, MetricSeries, TextSeriesPoint } from './types';

export type MetricState = 'high' | 'low' | 'within' | 'unknown';
export type MetricFilter = 'all' | 'outside' | 'within' | 'unknown';
export const metricStateLabel: Record<MetricState, string> = {
  high: '高于参考范围',
  low: '低于参考范围',
  within: '参考范围内',
  unknown: '暂无法判断',
};

export function metricState(point: TextSeriesPoint): MetricState {
  const range = referencePosition(point.rawValue, point.reference);
  if (range) return range.state;
  // Single-sided printed limits are comparable too; preserve strict/inclusive boundaries.
  const result = parseValue(point.rawValue);
  const limit = parseValue(point.reference);
  if (!result || result.operator !== '=' || !limit || limit.operator === '=') return 'unknown';
  const value = new Decimal(result.value),
    boundary = new Decimal(limit.value);
  switch (limit.operator) {
    case '<':
      return value.lt(boundary) ? 'within' : 'high';
    case '<=':
      return value.lte(boundary) ? 'within' : 'high';
    case '>':
      return value.gt(boundary) ? 'within' : 'low';
    case '>=':
      return value.gte(boundary) ? 'within' : 'low';
  }
}

export function metricOverview(groups: MetricGroup[], filter: MetricFilter) {
  const counts = { outside: 0, within: 0, unknown: 0 };
  const outside: MetricGroup[] = [],
    other: MetricGroup[] = [];
  for (const group of groups) {
    const latest = group.points.at(-1);
    if (!latest) continue;
    if (group.kind === 'text') {
      if (filter === 'all') other.push(group);
      continue;
    }
    const state = metricState(latest);
    const category = state === 'high' || state === 'low' ? 'outside' : state;
    counts[category]++;
    if (filter === 'all' || category === filter)
      (category === 'outside' ? outside : other).push(group);
  }
  return { counts, visible: [...outside, ...other] };
}

export function metricChart(series: MetricSeries) {
  const ranges = series.points.map((p) => referencePosition(p.rawValue, p.reference));
  const first = ranges[0];
  const commonRange =
    first &&
    ranges.every(
      (r) => r && new Decimal(r.lower).eq(first.lower) && new Decimal(r.upper).eq(first.upper),
    )
      ? { lower: Number(first.lower), upper: Number(first.upper) }
      : null;
  const values = series.points.map((p) => Number(p.value));
  const bounds = commonRange ? [...values, commonRange.lower, commonRange.upper] : values;
  const min = Math.min(...bounds),
    max = Math.max(...bounds);
  const spread = max - min;
  const pad = spread > 0 ? spread * 0.15 : Math.max(Math.abs(max) * 0.15, 1);
  const rawStep = (spread + pad * 2) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 5, 10].find((n) => n * magnitude >= rawStep) ?? 10) * magnitude;
  const low =
    min >= 0
      ? Math.max(0, Math.floor((min - pad) / step) * step)
      : Math.floor((min - pad) / step) * step;
  const high = Math.ceil((max + pad) / step) * step;
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) =>
    Number(new Decimal(low).plus(new Decimal(step).times(i)).toPrecision(12)),
  );
  const dates = series.points.map((p) => Date.parse(`${p.date}T00:00:00Z`));
  const start = Math.min(...dates),
    end = Math.max(...dates);
  const points = series.points.map((p, i) => ({
    ...p,
    state: metricState(p),
    x: end === start ? 0.5 : (dates[i]! - start) / (end - start),
    y: (Number(p.value) - low) / (high - low),
  }));
  return {
    commonRange,
    low,
    high,
    ticks,
    points,
    distinctDates: new Set(dates).size === dates.length,
  };
}
