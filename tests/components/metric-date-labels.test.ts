import { metricDateLabels } from '../../src/components/metric-date-labels';

const points = (dates: string[]) => {
  const times = dates.map((date) => Date.parse(`${date}T00:00:00Z`));
  const first = Math.min(...times),
    last = Math.max(...times);
  return dates.map((date, i) => ({
    date,
    x: first === last ? 0.5 : (times[i]! - first) / (last - first),
  }));
};

test.each([
  ['2025-01-01', '2026-10-25', '2026-10-27'],
  ['2025-01-01', '2025-01-02', '2026-10-27'],
])('clustered dates keep the first and last labels without moving any points: %s', (...dates) => {
  const data = points(dates);
  const before = JSON.stringify(data);
  const labels = metricDateLabels(data, 38, 270);
  expect(labels.map((label) => label.date)).toEqual([dates[0], dates[2]]);
  expect(labels[0]!.right + 10).toBeLessThanOrEqual(labels[1]!.left);
  expect(labels.map((label) => label.x)).toEqual([38, 270]);
  expect(labels[0]!.text).toBe('25.01.01');
  expect(JSON.stringify(data)).toBe(before);
});

test('chooses an interior label with room when the middle report index is crowded', () => {
  const labels = metricDateLabels(
    points(['2026-01-01', '2026-06-01', '2026-12-30', '2026-12-31']),
    30,
    300,
  );
  expect(labels.map((label) => label.text)).toEqual(['01.01', '06.01', '12.31']);
  expect(labels[1]!.left).toBeGreaterThanOrEqual(labels[0]!.right + 10);
  expect(labels[1]!.right + 10).toBeLessThanOrEqual(labels[2]!.left);
});

test('adapts to a narrower chart and restores the middle date when there is space', () => {
  const data = points(['2026-01-01', '2026-07-01', '2026-12-31']);
  expect(metricDateLabels(data, 30, 190)).toHaveLength(3);
  expect(metricDateLabels(data, 30, 130)).toHaveLength(2);
  expect(metricDateLabels(data, 30, 90).map((label) => label.date)).toEqual(['2026-12-31']);
});

test('same-day points have one centered label', () => {
  expect(metricDateLabels(points(['2026-10-27', '2026-10-27']), 30, 270)).toMatchObject([
    { date: '2026-10-27', text: '10.27', x: 150, anchor: 'middle' },
  ]);
});

test('empty or unavailable plot space produces no labels', () => {
  expect(metricDateLabels([], 30, 270)).toEqual([]);
  expect(metricDateLabels(points(['2026-10-27']), 30, 20)).toEqual([]);
});
