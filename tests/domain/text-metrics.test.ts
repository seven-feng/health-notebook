import { buildMetricData, buildSeries } from '../../src/domain/metrics';
import { metricOverview } from '../../src/domain/metric-overview';
import type { Observation, Report } from '../../src/domain/types';

const observation = (patch: Partial<Observation> = {}): Observation => ({
  id: 'protein',
  name: '尿蛋白',
  rawValue: '阴性',
  originalValue: '阴性',
  code: '',
  unit: '',
  reference: '阴性',
  specimen: '',
  method: '',
  page: 0,
  ...patch,
});
const report = (id: string, patch: Partial<Report> = {}): Report => ({
  id,
  memberId: 'self',
  documentId: id,
  title: '尿常规',
  patient: 'SYNTHETIC',
  date: '2026-10-01',
  dateKind: 'exam',
  status: 'confirmed',
  template: 'section-table-v1',
  observations: [observation()],
  warnings: [],
  createdAt: '2026-10-26',
  ...patch,
});

test('text results form chronological histories without synthetic numbers or persistence changes', () => {
  const reports = [
    report('new', {
      date: '2026-10-20',
      observations: [observation({ rawValue: '阳性', reference: '阴性（-）' })],
    }),
    report('old'),
  ];
  const before = JSON.stringify(reports);
  const data = buildMetricData(reports);
  expect(data.untrended).toEqual([]);
  expect(data.groups).toHaveLength(1);
  expect(data.groups[0]).toMatchObject({
    kind: 'text',
    name: '尿蛋白',
    unit: '',
    points: [
      { date: '2026-10-01', rawValue: '阴性', reference: '阴性', reportId: 'old' },
      { date: '2026-10-20', rawValue: '阳性', reference: '阴性（-）', reportId: 'new' },
    ],
  });
  expect(data.groups[0]!.points.every((p) => !('value' in p))).toBe(true);
  expect(buildSeries(reports)).toEqual([]);
  expect(JSON.stringify(reports)).toBe(before);
});

test.each([
  '阴性',
  '弱阳性',
  '未检出',
  '浅黄色',
  '未见明显异常',
  'negative',
  '+',
  '±',
  '(-)',
  '2+',
])('%s is a valid text result even in an older record with no resultKind', (rawValue) => {
  const data = buildMetricData([report('text', { observations: [observation({ rawValue })] })]);
  expect(data.untrended).toEqual([]);
  expect(data.groups[0]).toMatchObject({ kind: 'text', points: [{ rawValue }] });
});

test.each(['name', 'code', 'unit', 'specimen', 'method'] as const)(
  'different %s cannot silently join text histories',
  (field) => {
    const a = report('a');
    const b = report('b', { observations: [observation({ [field]: 'DIFFERENT' })] });
    const first = buildMetricData([a, b]);
    const reverse = buildMetricData([b, a]);
    expect(first.groups).toHaveLength(2);
    expect(first.groups.map((g) => g.key).sort()).toEqual(reverse.groups.map((g) => g.key).sort());
    expect(first.groups.every((g) => g.points.length === 1)).toBe(true);
  },
);

test('text histories retain member and test-category boundaries', () => {
  const data = buildMetricData([
    report('a'),
    report('b', { title: '粪便常规' }),
    report('c', { memberId: 'mom' }),
  ]);
  expect(data.groups).toHaveLength(3);
  expect(data.groups.every((g) => g.points.length === 1)).toBe(true);
});

test('generic page headings retain standalone results without claiming test equivalence', () => {
  const data = buildMetricData([
    report('a', { title: '检验报告 · 第 1 页' }),
    report('b', { title: '检验报告 · 第 1 页' }),
  ]);
  expect(data.groups).toHaveLength(2);
  expect(data.untrended).toEqual([]);
});

test('format-only spacing joins text histories while retaining original names and values', () => {
  const data = buildMetricData([
    report('a'),
    report('b', {
      title: '尿 常规',
      observations: [observation({ name: '尿 蛋白', rawValue: ' 阴性 ' })],
    }),
  ]);
  expect(data.groups).toHaveLength(1);
  expect(data.groups[0]!.points[1]).toMatchObject({ sourceName: '尿 蛋白', rawValue: ' 阴性 ' });
});

test('same-day sources stay distinct but repeated input does not duplicate an observation', () => {
  const a = report('a'),
    b = report('b', { observations: [observation({ rawValue: '阳性' })] });
  const data = buildMetricData([b, a, a]);
  expect(data.groups).toHaveLength(1);
  expect(data.groups[0]!.points.map((p) => p.reportId)).toEqual(['a', 'b']);
});

test.each([{ date: '' }, { date: '2026-02-30' }, { patient: '' }, { memberId: '' }])(
  'incomplete identity/date %p retains a visible reason for text results',
  (patch) => {
    const data = buildMetricData([report('a', patch)]);
    expect(data.groups).toEqual([]);
    expect(data.untrended).toHaveLength(1);
    expect(data.untrended[0]!.reasons).toHaveLength(1);
    expect(data.untrended[0]!.rawValue).toBe('阴性');
  },
);

test('unresolved text results stay inspectable and unconfirmed reports remain excluded', () => {
  const data = buildMetricData([
    report('pending', { observations: [observation({ needsReview: true })] }),
    report('draft', { status: 'review' }),
    report('archived', { status: 'archived' }),
  ]);
  expect(data.groups).toEqual([]);
  expect(data.untrended).toHaveLength(1);
  expect(data.untrended[0]!.reasons).toEqual(['这项结果仍需核对']);
});

test.each(['', '1..2', '1e30', '<5', '≥10', '1-3'])(
  'incomplete or qualified numeric result %s is not reclassified as a text history',
  (rawValue) => {
    const data = buildMetricData([report('a', { observations: [observation({ rawValue })] })]);
    expect(data.groups).toEqual([]);
    expect(data.untrended).toHaveLength(1);
    expect(data.untrended[0]!.reasons.length).toBeGreaterThan(0);
  },
);

test('text and numeric results coexist; text never contributes to numeric range filters', () => {
  const data = buildMetricData([
    report('text'),
    report('numeric', { observations: [observation({ rawValue: '0', reference: '0-1' })] }),
  ]);
  expect(data.groups).toHaveLength(2);
  const all = metricOverview(data.groups, 'all');
  expect(all.counts).toEqual({ outside: 0, within: 1, unknown: 0 });
  expect(all.visible).toHaveLength(2);
  expect(metricOverview(data.groups, 'unknown').visible).toEqual([]);
  expect(metricOverview(data.groups, 'outside').visible).toEqual([]);
  expect(metricOverview(data.groups, 'within').visible).toHaveLength(1);
  expect(buildSeries([report('text')])).toEqual([]);
});

test('editing the result reclassifies it from the current raw value instead of a stale parser tag', () => {
  const numeric = report('a', {
    observations: [observation({ rawValue: '0', resultKind: 'qualitative' })],
  });
  expect(buildMetricData([numeric]).groups[0]?.kind).not.toBe('text');
  const text = report('a', {
    observations: [observation({ rawValue: '阴性', resultKind: 'numeric' })],
  });
  expect(buildMetricData([text]).groups[0]?.kind).toBe('text');
});
