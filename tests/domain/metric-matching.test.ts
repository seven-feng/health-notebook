import { buildMetricData, buildSeries, delta } from '../../src/domain/metrics';
import { normalizeMetricUnit } from '../../src/domain/metric-matching';
import type { Observation, Report } from '../../src/domain/types';

const observation = (
  name = '低密度脂蛋白胆固醇',
  unit = 'mmol/L',
  patch: Partial<Observation> = {},
): Observation => ({
  id: 'ldl',
  name,
  unit,
  rawValue: '3.2',
  originalValue: '3.2',
  reference: '<3.4',
  code: '',
  specimen: '',
  method: '',
  page: 0,
  ...patch,
});
const report = (id: string, patch: Partial<Report> = {}): Report => ({
  id,
  documentId: id,
  memberId: 'self',
  patient: 'SYNTHETIC',
  date: '2025-12-18',
  dateKind: 'exam',
  status: 'confirmed',
  template: 'section-table-v1',
  title: '实验室检查',
  createdAt: '2026-10-26',
  warnings: [],
  observations: [
    observation(),
    observation('总蛋白', 'g/L', { id: 'tp' }),
    observation('总胆固醇', 'mmol/L', { id: 'tc' }),
  ],
  ...patch,
});
const exam = report('exam');
const clinical = report('clinical', {
  date: '2026-08-16',
  dateKind: 'sample',
  template: 'fahzu-yh-chemistry-double-v1',
  title: '生化检验报告 · 浙一余杭',
  observations: [
    observation('低密度脂蛋白-C', 'mmol/L', {
      id: 'clinical-ldl',
      code: 'fahzu-yh:chemistry:LDL_C',
      specimen: 'blood',
      method: 'not-reported:fahzu-yuhang-chemistry',
      rawValue: '2.8',
      reference: '<3.1',
    }),
  ],
});
const ldl = (reports: Report[]) => buildSeries(reports).filter((g) => /低密度/.test(g.name));

test('existing confirmed exam LDL joins clinical LDL without modifying any persisted field', () => {
  const before = JSON.stringify([exam, clinical]);
  const groups = ldl([clinical, exam]);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.points.map((p) => p.reportId)).toEqual(['exam', 'clinical']);
  expect(groups[0]!.points.map((p) => p.reference)).toEqual(['<3.4', '<3.1']);
  expect(groups[0]!.points[0]!.sourceName).toBe('低密度脂蛋白胆固醇');
  expect(delta(groups[0]!)).toBe('-0.4');
  expect(groups[0]!.comparisonNote).toContain('未注明');
  expect(JSON.stringify([exam, clinical])).toBe(before);
});

test.each([
  ['umol/L', 'μmol/L'],
  ['µmol/L', 'μmol/L'],
  ['10⁹/L', '10^9/L'],
  ['×10^9/L', '10^9/L'],
  ['10¹²/L', '10^12/L'],
  ['Kg', 'kg'],
  ['g%/L', 'g%/L'],
  ['10E%9/L', '10E%9/L'],
  ['×10~9/L', '×10~9/L'],
  ['mg/dL', 'mg/dL'],
  ['mIU/L', 'mIU/L'],
  ['MIU/L', 'MIU/L'],
  ['ng/ml', 'ng/mL'],
  ['ng/mL', 'ng/mL'],
  ['ng/l', 'ng/L'],
  ['ng/L', 'ng/L'],
  ['mg/dl', 'mg/dL'],
  ['mIU/ml', 'mIU/mL'],
  ['MIU/ml', 'MIU/mL'],
  ['Ng/ml', 'Ng/ml'],
  ['ng/ML', 'ng/ML'],
  ['ng/ml-', 'ng/ml-'],
])('unit %s becomes %s without guessing OCR errors or converting values', (raw, normalized) => {
  expect(normalizeMetricUnit(raw)).toBe(normalized);
});

test('equivalent unit spelling joins histories but preserves original unit and reference', () => {
  const a = report('a', {
    title: '肾功能',
    observations: [observation('肌酐', 'umol/L', { rawValue: '70' })],
  });
  const b = report('b', {
    title: '肾功能',
    date: '2026-01-01',
    observations: [observation('肌酐', 'μmol/L', { rawValue: '72', reference: '40-90' })],
  });
  const g = buildSeries([a, b])[0]!;
  expect(g.unit).toBe('μmol/L');
  expect(g.points).toHaveLength(2);
  expect(g.points[0]!.sourceUnit).toBe('umol/L');
  expect(g.points[0]!.rawValue).toBe('70');
  expect(g.points[1]!.reference).toBe('40-90');
});

test('mass and molar concentrations are separate and explain why', () => {
  const changed = { ...clinical, observations: [observation('低密度脂蛋白-C', 'mg/dL')] };
  const groups = ldl([exam, changed]);
  expect(groups).toHaveLength(2);
  expect(groups.every((g) => g.points.length === 1)).toBe(true);
  expect(groups.find((g) => g.unit === 'mg/dL')!.comparisonNote).toContain('单位');
});

test('CBC aliases join but absolute, percentage and distribution-width types remain distinct', () => {
  const a = report('a', {
    title: '血常规',
    observations: [
      observation('红细胞比容', '%'),
      observation('中性粒细胞百分比', '%', { id: 'percent' }),
      observation('中性粒细胞绝对值', '10^9/L', { id: 'absolute' }),
      observation('红细胞分布宽度-标准差', 'fL', { id: 'sd' }),
      observation('红细胞分布宽度-变异系数', '%', { id: 'cv' }),
    ],
  });
  const b = report('b', {
    template: 'fahzu-yh-cbc-double-v3',
    title: '血常规',
    observations: [observation('红细胞压积', '%')],
  });
  const groups = buildSeries([a, b]);
  expect(groups).toHaveLength(5);
  expect(groups.find((g) => g.name === '红细胞压积')!.points).toHaveLength(2);
});

test('fasting glucose is never inferred from glucose; hs-CRP is not ordinary CRP', () => {
  const source = report('a', {
    title: '生化检验',
    observations: [
      observation('空腹血葡萄糖', 'mmol/L', { id: 'fast' }),
      observation('葡萄糖', 'mmol/L', { id: 'any' }),
      observation('C反应蛋白', 'mg/L', { id: 'crp' }),
      observation('超敏C反应蛋白', 'mg/L', { id: 'hscrp' }),
    ],
  });
  expect(buildSeries([source])).toHaveLength(4);
});

test.each(['specimen', 'method'] as const)(
  'explicit different %s and missing metadata remain separate, independent of input order',
  (field) => {
    const a = {
      ...clinical,
      id: 'a',
      observations: [
        observation('低密度脂蛋白-C', 'mmol/L', {
          [field]: field === 'specimen' ? 'serum' : '直接法',
        }),
      ],
    };
    const b = {
      ...a,
      id: 'b',
      observations: [
        observation('低密度脂蛋白-C', 'mmol/L', {
          [field]: field === 'specimen' ? 'plasma' : '计算法',
        }),
      ],
    };
    const first = ldl([a, exam, b]);
    const reverse = ldl([b, exam, a]);
    expect(first).toHaveLength(3);
    expect(first.map((g) => g.key).sort()).toEqual(reverse.map((g) => g.key).sort());
    expect(
      first.every(
        (g) => g.points.length === 1 && g.separationLabel && g.comparisonNote?.includes('分开'),
      ),
    ).toBe(true);
  },
);

test('same explicit conditions join and do not acquire a false missing-method note', () => {
  const source = {
    ...clinical,
    observations: [
      observation('低密度脂蛋白-C', 'mmol/L', { specimen: 'serum', method: '直接法' }),
    ],
  };
  const groups = ldl([source, { ...source, id: 'other', date: '2026-09-01' }]);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.points).toHaveLength(2);
  expect(groups[0]!.comparisonNote).toBeUndefined();
});

test('unknown or conflicting document context cannot establish blood equivalence', () => {
  for (const title of ['尿常规', '尿液生化', '脑脊液', '未知记录']) {
    const unknown = { ...exam, title };
    const groups = ldl([unknown, clinical]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.points.length === 1)).toBe(true);
  }
  const manual = { ...exam, template: null };
  expect(ldl([manual, clinical])).toHaveLength(2);
});

test('a repeated chemistry name cannot manufacture a biochemical panel context', () => {
  const source = report('a', {
    observations: [
      observation(),
      observation(undefined, undefined, { id: 'b' }),
      observation(undefined, undefined, { id: 'c' }),
    ],
  });
  const groups = ldl([source, clinical]);
  expect(groups).toHaveLength(4);
  expect(groups.every((g) => g.points.length === 1)).toBe(true);
});

test('unmatched exact numbers are visible separately; no implicit matching by equal labels', () => {
  const source = report('a', { observations: [observation('未知项目', 'X/L')] });
  const data = buildMetricData([source, { ...source, id: 'b' }]);
  expect(data.groups).toHaveLength(2);
  expect(
    data.groups.every((g) => g.comparisonNote?.includes('对应关系') && g.separationLabel),
  ).toBe(true);
  expect(data.untrended).toEqual([]);
});

test('known dimensionless results and BMI are allowed; arbitrary missing units are not inferred', () => {
  const source = report('a', { title: '一般检查室', observations: [observation('体重指数', '')] });
  const groups = buildSeries([
    source,
    { ...source, id: 'b', observations: [observation('BMI', '')] },
  ]);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.points).toHaveLength(2);
  const missing = { ...clinical, observations: [observation('低密度脂蛋白-C', '')] };
  expect(ldl([missing, clinical])).toHaveLength(2);
  expect(ldl([missing])[0]!.comparisonNote).toContain('缺少单位');
});

test('body mass kg casing is equivalent, but height cm and m are not converted', () => {
  const source = report('a', { title: '一般检查室', observations: [observation('体重', 'Kg')] });
  expect(
    buildSeries([source, { ...source, id: 'b', observations: [observation('体重', 'kg')] }])[0]!
      .points,
  ).toHaveLength(2);
  expect(
    buildSeries([
      { ...source, observations: [observation('身高', 'cm')] },
      { ...source, id: 'b', observations: [observation('身高', 'm')] },
    ]),
  ).toHaveLength(2);
});

test('all confirmed results appear exactly once in a series or with a non-trend reason', () => {
  const observations = [
    observation(),
    observation('未知项', 'units', { id: 'unknown' }),
    observation('限定值', '', { id: 'qualified', rawValue: '<5' }),
    observation('尿蛋白', '', { id: 'qualitative', rawValue: '阴性' }),
    observation('空结果', '', { id: 'missing', rawValue: '' }),
    observation('未核对项', 'U/L', { id: 'review', needsReview: true }),
  ];
  const data = buildMetricData([report('a', { observations })]);
  expect(data.groups.reduce((n, g) => n + g.points.length, 0) + data.untrended.length).toBe(
    observations.length,
  );
  expect(data.untrended).toHaveLength(3);
  expect(data.untrended.every((item) => item.reasons.length > 0)).toBe(true);
  expect(data.groups.find((item) => item.name === '尿蛋白')).toMatchObject({
    kind: 'text',
    points: [{ rawValue: '阴性' }],
  });
});

test('missing dates, names and unresolved review issues remain inspectable without entering numeric trends', () => {
  for (const patch of [{ date: '' }, { date: '2026-02-30' }, { patient: '' }, { memberId: '' }]) {
    const data = buildMetricData([report('a', patch)]);
    expect(data.groups).toEqual([]);
    expect(data.untrended).toHaveLength(3);
  }
  expect(
    buildMetricData([report('a', { status: 'review' }), report('b', { status: 'archived' })]),
  ).toEqual({ groups: [], untrended: [] });
});

test('member boundaries persist and repeated input never duplicates a source observation', () => {
  const other = { ...clinical, id: 'mom', memberId: 'mom' };
  const groups = ldl([exam, clinical, other, exam]);
  expect(groups).toHaveLength(2);
  expect(groups.map((g) => g.points.length).sort()).toEqual([1, 2]);
});

test('same-day distinct reports remain distinct without an invented delta', () => {
  const groups = ldl([clinical, { ...exam, date: clinical.date }]);
  expect(groups[0]!.points).toHaveLength(2);
  expect(delta(groups[0]!)).toBeNull();
});

test('editing a name or unit recalculates grouping; removing a report removes its points', () => {
  expect(ldl([exam, clinical])[0]!.points).toHaveLength(2);
  const edited = { ...clinical, observations: [observation('极低密度脂蛋白-C', 'mmol/L')] };
  expect(ldl([exam, edited])).toHaveLength(2);
  expect(ldl([clinical])[0]!.points).toHaveLength(1);
});

test('an outdated hospital code cannot bypass incompatible units or specimen context', () => {
  const bad = {
    ...clinical,
    id: 'bad',
    observations: [{ ...clinical.observations[0]!, unit: 'mg/dL' }],
  };
  const groups = ldl([bad, clinical]);
  expect(groups).toHaveLength(2);
  expect(groups.find((g) => g.unit === 'mg/dL')!.comparisonNote).toContain('单位');
  const urine = {
    ...clinical,
    id: 'urine',
    observations: [{ ...clinical.observations[0]!, specimen: 'urine' }],
  };
  expect(ldl([urine, clinical])).toHaveLength(2);
  expect(ldl([urine])[0]!.separationLabel).toContain('单独展示');
});
