import { parsePages } from '../../src/parser';
import { buildSeries, delta, parseValue, validDate } from '../../src/domain/metrics';
import type { LayoutPage, Report } from '../../src/domain/types';
import first from '../fixtures/first-layout.json';
import second from '../fixtures/second-layout.json';

function report(layout: LayoutPage[], id: string): Report {
  const parsed = parsePages(layout)[0]!;
  return {
    ...parsed,
    id,
    memberId: 'self',
    documentId: id,
    dateKind: 'sample',
    status: 'confirmed',
    createdAt: '2026-10-22T00:00:00Z',
  };
}
const a = report(first as LayoutPage[], 'a'),
  b = report(second as LayoutPage[], 'b');

test('extracts the actual PDFKit text and coordinates from both authored PDFs', () => {
  expect(a.patient).toBe('SAMPLE');
  expect(a.date).toBe('2026-09-18');
  expect(a.observations.map((o) => [o.code, o.rawValue, o.unit, o.reference])).toEqual([
    ['sample:ALT', '100', 'U/L', '0-40'],
    ['sample:AST', '48', 'U/L', '0-40'],
    ['sample:GLU', '5.4', 'mmol/L', '3.9-6.1'],
  ]);
  expect(b.date).toBe('2026-10-18');
  expect(b.observations.map((o) => o.rawValue)).toEqual(['80', '35', '5.1']);
  expect(a.warnings).toEqual([]);
  expect(b.warnings).toEqual([]);
});
test('unverified layouts retain no guessed fields', () => {
  const pages = structuredClone(first) as LayoutPage[];
  pages.forEach((p) => (p.spans = p.spans.filter((s) => s.rect.y < 0.9)));
  expect(parsePages(pages)[0]?.template).toBeNull();
  expect(parsePages(pages)[0]?.observations).toEqual([]);
});
test('multiple report pages retain independent dates and provenance', () => {
  const pages = [...first, ...second.map((p) => ({ ...p, pageIndex: 1 }))] as LayoutPage[];
  const result = parsePages(pages);
  expect(result.map((r) => r.date)).toEqual(['2026-09-18', '2026-10-18']);
  expect(result[1]?.observations.every((o) => o.page === 1)).toBe(true);
});
test('orders by clinical date and computes 100 to 80', () => {
  const series = buildSeries([b, a]);
  expect(series).toHaveLength(3);
  expect(series[0]?.points.map((p) => p.value)).toEqual(['100', '80']);
  expect(delta(series[0]!)).toBe('-20');
  expect(delta(series[2]!)).toBe('-0.3');
});
test('unconfirmed results do not enter trends', () =>
  expect(buildSeries([{ ...a, status: 'review' }])).toEqual([]));
test('missing dates never become import dates', () =>
  expect(buildSeries([{ ...a, date: '' }])).toEqual([]));
test('different units are separate series', () => {
  const changed = { ...b, observations: b.observations.map((o) => ({ ...o, unit: 'different' })) };
  expect(buildSeries([a, changed])).toHaveLength(6);
});
test('different specimens and unknown mappings remain visible without being combined', () => {
  const changed = {
    ...b,
    observations: b.observations.map((o) => ({ ...o, specimen: 'whole blood' })),
  };
  expect(buildSeries([a, changed])).toHaveLength(6);
  const unmapped = buildSeries([
    { ...a, observations: a.observations.map((o) => ({ ...o, code: '' })) },
  ]);
  expect(unmapped).toHaveLength(3);
  expect(unmapped.every((group) => group.points.length === 1 && group.comparisonNote)).toBe(true);
});
test('censored and qualitative results are not exact measurements', () => {
  for (const raw of ['<5', '>100', '阴性'])
    expect(
      buildSeries([{ ...a, observations: [{ ...a.observations[0]!, rawValue: raw }] }]),
    ).toEqual([]);
  expect(parseValue('≤5')).toEqual({ operator: '<=', value: '5' });
  expect(parseValue('NaN')).toBeNull();
  expect(parseValue('Infinity')).toBeNull();
});
test('reference ranges stay with each measurement', () => {
  const next = { ...b, observations: [{ ...b.observations[0]!, reference: '0-50' }] };
  expect(buildSeries([a, next])[0]?.points.map((p) => p.reference)).toEqual(['0-40', '0-50']);
});
test('same-day measurements do not imply an order or delta', () => {
  expect(delta(buildSeries([a, { ...b, date: a.date }])[0]!)).toBeNull();
});
test('strict dates reject rollover and accept leap years', () => {
  expect(validDate('2026-02-30')).toBe(false);
  expect(validDate('2024-02-29')).toBe(true);
  expect(validDate('2026-13-01')).toBe(false);
});
