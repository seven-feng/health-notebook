import { parsePages } from '../../src/parser';
import { parseDocument } from '../../src/parser/document';
import { resultKind } from '../../src/parser/sections';
import { buildSeries } from '../../src/domain/metrics';
import { reviewCopy } from '../../src/domain/review-messages';
import { needsIndividualReview } from '../../src/domain/review-groups';
import { page, span, header, row, sectionFixture } from '../fixtures/section-layout';
import type { Report } from '../../src/domain/types';

test.each([
  'clear-zero',
  'two-values',
  'other-row',
  'other-column',
  'primary-present',
  'unreadable',
])('cell retry is confined to a missing numeric value: %s', (kind) => {
  const source = page(0, [
    span('单项检查', 0.1, 0.12, 0.25),
    ...header(0.2),
    ...row('项目甲', kind === 'primary-present' ? '5' : '', '0-10', 'U/L', 0.25),
    ...row('项目乙', '7', '0-10', 'U/L', 0.3),
  ]);
  source.extractionMethod = 'ocr';
  source.cellSpans =
    kind === 'two-values'
      ? [span('1', 0.46, 0.25, 0.02), span('2', 0.56, 0.25, 0.02)]
      : [
          span(
            kind === 'unreadable' ? 'O' : '0',
            kind === 'other-column' ? 0.7 : 0.46,
            kind === 'other-row' ? 0.3 : 0.25,
            0.03,
          ),
        ];
  const item = parseDocument([source]).reports[0]!.observations[0]!;
  expect(item.rawValue).toBe(kind === 'clear-zero' ? '0' : kind === 'primary-present' ? '5' : '');
  expect(needsIndividualReview(item)).toBe(true);
  if (kind === 'clear-zero') {
    expect(item.originalValue).toBe('0');
    expect(item.warnings).toContain(reviewCopy.value);
    expect(item.warnings).not.toContain(reviewCopy.missingValue);
  }
});

test.each([
  ['↑', '0', 'high'],
  ['↓', '0', 'low'],
  ['↑', '↓0', undefined],
] as const)(
  'cell retry keeps original arrows and flags conflicts: %s / %s',
  (primary, retry, flag) => {
    const source = page(0, [
      span('单项检查', 0.1, 0.12, 0.25),
      ...header(0.2),
      ...row('项目甲', primary, '0-10', 'U/L', 0.25),
    ]);
    source.extractionMethod = 'ocr';
    source.cellSpans = [span(retry, 0.46, 0.25, 0.03)];
    const item = parseDocument([source]).reports[0]!.observations[0]!;
    expect(item.rawValue).toBe('0');
    expect(item.reportFlag).toBe(flag);
    expect(item.warnings).toContain(reviewCopy.value);
    if (!flag) expect(item.warnings).toContain(reviewCopy.marker);
  },
);

test('pending headers continue on adjacent pages and split same-page sections without empty page records', () => {
  const result = parseDocument(sectionFixture());
  expect(
    result.reports.map((r) => [r.title, r.sourcePages, r.observations.map((o) => o.rawValue)]),
  ).toEqual([
    ['合成检查', [0, 1], ['0', '阴性']],
    ['双项检查', [1], ['<5', '未见异常']],
  ]);
  expect(result.reports[0]!.observations[0]!.headerSource!.page).toBe(0);
  expect(result.reports[0]!.observations[0]!.page).toBe(1);
  expect(result.parsing.unprocessed.some((r) => r.page === 2)).toBe(true);
  expect(result.reports[0]!.dateKind).toBe('exam');
});
test.each(['patient', 'number', 'date', 'nonadjacent', 'newtitle', 'shifted'] as const)(
  'a %s conflict stops continuation',
  (kind) => {
    const input = sectionFixture().slice(0, 2);
    const second = input[1]!;
    if (kind === 'patient') second.spans[0]!.text = '姓名：测试乙';
    if (kind === 'number') second.spans[1]!.text = '报告编号：DIFFERENT';
    if (kind === 'date') second.spans[2]!.text = '体检日期：2026-10-02';
    if (kind === 'nonadjacent') second.pageIndex = 3;
    if (kind === 'newtitle') second.spans.push(span('另一检查', 0.1, 0.09, 0.25));
    if (kind === 'shifted')
      second.spans = second.spans.map((s) =>
        s.rect.y < 0.3 && s.rect.y > 0.08 ? { ...s, rect: { ...s.rect, x: s.rect.x + 0.2 } } : s,
      );
    expect(parsePages(input).find((r) => r.title === '合成检查')).toBeUndefined();
  },
);
test('missing identity alone cannot authorize continuation', () => {
  const p = sectionFixture()
    .slice(0, 2)
    .map((p) => ({ ...p, spans: p.spans.filter((s) => s.rect.y > 0.08) }));
  expect(parsePages(p).find((r) => r.title === '合成检查')).toBeUndefined();
});
test.each(['0', '-1.5', '<5', '≥100', '阴性', '弱阳性', '±', 'Ⅱ度', '未见异常'])(
  'a single measured row with a section and header preserves %s',
  (value) => {
    const parsed = parsePages([
      page(0, [
        span('单项检查', 0.1, 0.12, 0.25),
        ...header(0.2),
        ...row('检查项', value, '', '', 0.25),
        span('小结：原文', 0.1, 0.32, 0.5),
      ]),
    ]);
    expect(parsed[0]!.observations[0]!.rawValue).toBe(value.normalize('NFKC'));
    expect(parsed[0]!.observations[0]!.originalValue).toBe(value);
  },
);
test('blank results with a printed name/reference are retained as missing, never zero', () => {
  const parsed = parsePages([
    page(0, [
      span('检查分区', 0.1, 0.12, 0.25),
      ...header(0.2),
      ...row('空结果', '', '0—10', 'U/L', 0.25),
      ...row('零结果', '0', '0—10', 'U/L', 0.3),
    ]),
  ]);
  expect(parsed[0]!.observations.map((o) => [o.rawValue, o.resultKind])).toEqual([
    ['', 'missing'],
    ['0', 'numeric'],
  ]);
});
test('reference introductions and isolated prose numbers are not measured results', () => {
  const p = page(0, [
    span('参考值介绍', 0.1, 0.12, 0.25),
    ...header(0.2),
    ...row('说明项目', '10', '0—20', 'U/L', 0.25),
    span('建议每天步行100步', 0.1, 0.4, 0.7),
  ]);
  expect(parsePages([p]).flatMap((r) => r.observations)).toEqual([]);
});
test('a wrapped name stays in its column and is never joined to the next result', () => {
  const p = page(0, [
    span('折行检查', 0.1, 0.12, 0.25),
    ...header(0.2),
    span('较长项目', 0.11, 0.245, 0.22),
    span('(补充名称)', 0.11, 0.265, 0.22),
    span('1', 0.46, 0.255, 0.05),
    span('0—10', 0.67, 0.255, 0.1),
    ...row('下一项', '2', '0—10', '', 0.31),
  ]);
  expect(parsePages([p])[0]!.observations.map((o) => [o.name, o.rawValue])).toEqual([
    ['较长项目(补充名称)', '1'],
    ['下一项', '2'],
  ]);
});
test('missing cross-page names are not guessed from a preceding row', () => {
  const p = sectionFixture().slice(0, 2);
  p[1]!.spans = p[1]!.spans.filter((s) => !(s.rect.x === 0.11 && s.text === '项目甲'));
  expect(
    parsePages(p)
      .flatMap((r) => r.observations)
      .some((o) => o.rawValue === '0'),
  ).toBe(false);
});
test('qualitative, graded and limited results do not become numeric trend points', () => {
  expect(['0', '<5', '阴性', 'Ⅱ度', ''].map(resultKind)).toEqual([
    'numeric',
    'qualified',
    'qualitative',
    'text',
    'missing',
  ]);
  const reports = parsePages(sectionFixture()).map((r, i) => ({
    ...r,
    id: String(i),
    memberId: 'self',
    documentId: 'd',
    status: 'confirmed',
    createdAt: '',
    observations: r.observations.map((o) => ({
      ...o,
      code: 'KNOWN',
      unit: 'U/L',
      specimen: 'serum',
      method: 'method',
      needsReview: false,
    })),
  })) as Report[];
  expect(
    buildSeries(reports)
      .flatMap((s) => s.points)
      .map((p) => p.rawValue),
  ).toEqual(['0']);
});

test('a repeated header with matching identity/title/columns continues one section', () => {
  const first = page(0, [
    span('连续检查', 0.1, 0.12, 0.25),
    ...header(0.2),
    ...row('项目甲', '1', '0—10', 'U/L', 0.3),
  ]);
  const second = page(1, [
    span('连续检查', 0.1, 0.09, 0.25),
    ...header(0.14),
    ...row('项目乙', '2', '0—10', 'U/L', 0.21),
  ]);
  const result = parsePages([first, second]);
  expect(result).toHaveLength(1);
  expect(result[0]!.observations.map((o) => [o.name, o.headerSource!.page])).toEqual([
    ['项目甲', 0],
    ['项目乙', 1],
  ]);
  expect(result[0]!.sourcePages).toEqual([0, 1]);
});
test('a three-row reference explanation is also rejected by the legacy fallback', () => {
  const source = page(0, [
    span('参考值介绍', 0.1, 0.12, 0.25),
    ...header(0.2),
    ...row('项目甲', '1', '0—10', 'U/L', 0.3),
    ...row('项目乙', '2', '0—10', 'U/L', 0.35),
    ...row('项目丙', '3', '0—10', 'U/L', 0.4),
  ]);
  expect(parsePages([source]).flatMap((r) => r.observations)).toEqual([]);
});
test('conflicting OCR reads require individual review', () => {
  const p = page(0, [
    span('单项检查', 0.1, 0.12, 0.25),
    ...header(0.2),
    ...row('项目甲', '1', '0—10', 'U/L', 0.3),
  ]);
  p.extractionMethod = 'ocr';
  p.numericSpans = [span('7', 0.46, 0.3, 0.05)];
  const o = parsePages([p])[0]!.observations[0]!;
  expect(o.rawValue).toBe('1');
  expect(o.warnings!.length).toBeGreaterThan(1);
});

test('local sampling dates override the cover context only for their section', () => {
  const p = page(0, [
    span('检查甲', 0.1, 0.12, 0.25),
    span('采样日期：2026-10-02', 0.1, 0.16, 0.5),
    ...header(0.22),
    ...row('结果甲', '1', '0—10', 'U/L', 0.28),
    span('小结：原文', 0.1, 0.34, 0.5),
    span('检查乙', 0.1, 0.42, 0.25),
    span('报告日期：2026-10-03', 0.1, 0.46, 0.5),
    ...header(0.52),
    ...row('结果乙', '2', '0—10', 'U/L', 0.58),
  ]);
  expect(parsePages([p]).map((r) => [r.date, r.dateKind])).toEqual([
    ['2026-10-02', 'sample'],
    ['2026-10-03', 'report'],
  ]);
});

test('coverage retains unparsed content beside an extracted table at the same vertical position', () => {
  const p = page(0, [
    span('右栏检查', 0.5, 0.12, 0.18),
    span('检查项目', 0.5, 0.2, 0.1),
    span('测量结果', 0.66, 0.2, 0.08),
    span('参考区间', 0.78, 0.2, 0.09),
    span('单位', 0.91, 0.2, 0.04),
    span('项目甲', 0.51, 0.3, 0.1),
    span('0', 0.67, 0.3, 0.04),
    span('0—10', 0.79, 0.3, 0.08),
    span('U/L', 0.92, 0.3, 0.05),
    span('尚未整理的左栏内容', 0.1, 0.3, 0.3),
  ]);
  const result = parseDocument([p]);
  expect(result.reports[0]!.observations).toHaveLength(1);
  expect(
    result.parsing.unprocessed.some(
      ({ rect: r }) =>
        r.x <= 0.2 && r.x + r.width >= 0.2 && r.y <= 0.308 && r.y + r.height >= 0.308,
    ),
  ).toBe(true);
  expect(
    result.parsing.unprocessed.some(
      ({ rect: r }) =>
        r.x <= 0.68 && r.x + r.width >= 0.68 && r.y <= 0.308 && r.y + r.height >= 0.308,
    ),
  ).toBe(false);
});

test('a spatially separate named header can use the PDF radical form of 用户', () => {
  const p = page(0, [
    span('检查分区', 0.1, 0.12, 0.25),
    ...header(0.2),
    ...row('项目甲', '0', '0—10', 'U/L', 0.3),
  ]);
  p.spans = p.spans.filter((s) => s.rect.y > 0.08);
  p.spans.unshift(
    span('健康体检报告', 0.1, 0.04, 0.2),
    span('测试甲女士', 0.5, 0.04, 0.12),
    span('⽤⼾ID12345', 0.65, 0.04, 0.2),
  );
  expect(parsePages([p])[0]!.patient).toBe('测试甲');
});

test('numeric medical name prefixes are kept and separated readings are never concatenated', () => {
  const p = page(0, [
    span('检查分区', 0.1, 0.12, 0.25),
    ...header(0.2),
    ...row('1.25检测项', '5', '0—10', 'U/L', 0.3),
  ]);
  p.spans = p.spans.map((s) => (s.text === '5' ? { ...s, rect: { ...s.rect, width: 0.01 } } : s));
  p.spans.push(span('4', 0.54, 0.3, 0.01));
  const o = parsePages([p])[0]!.observations[0]!;
  expect(o.name).toBe('1.25检测项');
  expect(o.rawValue).toBe('5 4');
  expect(o.resultKind).toBe('text');
  expect(o.warnings!.length).toBeGreaterThan(1);
});
