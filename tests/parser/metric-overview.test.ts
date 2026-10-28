import { metricChart, metricOverview, metricState } from '../../src/domain/metric-overview';
import type { MetricSeries, SeriesPoint } from '../../src/domain/types';
const point = (value: string, reference: string, date = '2026-10-18'): SeriesPoint => ({
  reportId: date,
  observationId: date,
  date,
  value,
  rawValue: value,
  reference,
});
const group = (key: string, points: SeriesPoint[]): MetricSeries => ({
  key,
  name: key,
  unit: 'U/L',
  points,
});

test.each([
  ['9', '9–50', 'within'],
  ['50', '9-50', 'within'],
  ['50.01', '9-50', 'high'],
  ['8.99', '9-50', 'low'],
  ['5', '<5', 'high'],
  ['5', '≤5', 'within'],
  ['5', '>5', 'low'],
  ['5', '≥5', 'within'],
  ['0.1', '', 'unknown'],
  ['3', '成人 0-5', 'unknown'],
  ['3', '0-5 / 10-20', 'unknown'],
  ['3', '5-0', 'unknown'],
  ['3', '0-0', 'unknown'],
  ['3', '阴性', 'unknown'],
  ['<3', '0-5', 'unknown'],
  ['1e-30', '0-2e-30', 'within'],
])('classifies %s only from the printed reference %s', (value, range, expected) => {
  expect(metricState(point(value, range))).toBe(expected);
});

test('summary uses latest results, keeps original order inside categories, and never mutates input', () => {
  const groups = [
    group('now-within', [point('100', '9-50', '2026-07-12'), point('40', '9-50')]),
    group('high', [point('80', '9-50')]),
    group('unknown', [point('50', '')]),
    group('low', [point('5', '9-50')]),
    group('empty', []),
  ];
  expect(metricOverview(groups, 'all')).toMatchObject({
    counts: { outside: 2, within: 1, unknown: 1 },
  });
  expect(metricOverview(groups, 'all').visible.map((g) => g.key)).toEqual([
    'high',
    'low',
    'now-within',
    'unknown',
  ]);
  expect(metricOverview(groups, 'within').visible.map((g) => g.key)).toEqual(['now-within']);
  expect(metricOverview(groups, 'unknown').visible.map((g) => g.key)).toEqual(['unknown']);
  expect(metricOverview(groups, 'outside')).toMatchObject({
    counts: { outside: 2, within: 1, unknown: 1 },
    visible: [groups[1], groups[3]],
  });
  expect(groups.map((g) => g.key)).toEqual(['now-within', 'high', 'unknown', 'low', 'empty']);
});

test('chart includes the whole shared range and uses actual date spacing', () => {
  const data = metricChart(
    group('alt', [
      point('100', '9-50', '2026-01-01'),
      point('90', '9–50', '2026-01-02'),
      point('80', '9.0-50.0', '2026-01-11'),
    ]),
  );
  expect(data.commonRange).toEqual({ lower: 9, upper: 50 });
  expect(data.low).toBeLessThanOrEqual(9);
  expect(data.high).toBeGreaterThanOrEqual(100);
  expect(data.points.map((p) => p.x)).toEqual([0, 0.1, 1]);
  expect(data.points.every((p) => p.y >= 0 && p.y <= 1)).toBe(true);
});

test('changing, missing or single-sided ranges never produce a misleading shared band', () => {
  for (const reference of ['9-60', '', '<50']) {
    const data = metricChart(
      group('changed', [point('55', '9-50', '2026-01-01'), point('55', reference)]),
    );
    expect(data.commonRange).toBeNull();
    expect(data.points[0]?.state).toBe('high');
    expect(data.points[1]?.state).toBe(
      reference === '9-60' ? 'within' : reference ? 'high' : 'unknown',
    );
  }
});

test('same-day values do not imply a chronological line', () => {
  expect(
    metricChart(group('same-day', [point('40', '9-50'), point('80', '9-50')])).distinctDates,
  ).toBe(false);
});

test('tiny values retain nonzero tick spacing and finite coordinates', () => {
  const data = metricChart(
    group('tiny', [point('1e-30', '0-2e-30', '2026-01-01'), point('2e-30', '0-2e-30')]),
  );
  expect(new Set(data.ticks).size).toBe(data.ticks.length);
  expect(data.ticks.length).toBeGreaterThan(1);
  expect(data.points.every((p) => Number.isFinite(p.y))).toBe(true);
});
