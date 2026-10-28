import { parseVisitPage } from '../../src/parser/visit';
import { parseRecords } from '../../src/parser/records';
import { syntheticVisitText, visitFixture } from '../fixtures/visit-layout';
import reportFixture from '../fixtures/first-layout.json';
import type { LayoutPage, Span } from '../../src/domain/types';

test('native lines recover split headings and prose with source bounds, without using slanted table geometry', () => {
  const page = visitFixture();
  const value = parseVisitPage(page)!;
  expect(value).toMatchObject({
    date: '2026-10-23',
    patient: '测试甲',
    hospital: '示例医院',
    department: '呼吸内科',
  });
  expect(value.sections.chief?.text).toBe('咳嗽 3 天。');
  expect(value.sections.plan?.text).toBe(
    '完善相关检查，携结果复诊。\n药品示例 0.25 g，每次 1 片。',
  );
  expect(value.sections.chief?.rect.y).toBe(page.readingLines![4]!.rect.y);
  expect(value.sections.chief?.rect.height).toBeGreaterThan(page.readingLines![4]!.rect.height);
  expect(value.lines).toEqual(page.readingLines);
  expect(Object.keys(value.sections)).toHaveLength(6);
});
test('missing visit date does not borrow birthday, print date or a future visit date from instructions', () => {
  const value = parseVisitPage(
    visitFixture(
      syntheticVisitText
        .map((x) => x.replace('就诊时间：', '出生日期：'))
        .concat('建议就诊日期：2027-01-01'),
    ),
  )!;
  expect(value.date).toBe('');
});
test.each(['2026-02-30', '2026-13-01'])('invalid visit date %s stays empty', (date) => {
  expect(
    parseVisitPage(visitFixture(syntheticVisitText.map((x) => x.replace('2026-10-23', date))))
      ?.date,
  ).toBe('');
});
test('conflicting labelled dates require manual resolution', () => {
  expect(parseVisitPage(visitFixture(['就诊日期：2025-01-01', ...syntheticVisitText]))?.date).toBe(
    '',
  );
});
test('a lab header mentioning diagnosis is not a visit', () => {
  expect(
    parseVisitPage(
      visitFixture(['检验报告', '临床诊断：复查', '项目 结果 单位', '葡萄糖 5.4 mmol/L']),
    ),
  ).toBeNull();
});
test('a mixed PDF creates independent visit and lab records with original page numbers', () => {
  const lab = { ...reportFixture[0]!, pageIndex: 1 } as LayoutPage;
  const value = parseRecords([visitFixture(), lab]);
  expect(value.recordKind).toBe('mixed');
  expect(value.visits).toHaveLength(1);
  expect(value.visits[0]!.sourcePage).toBe(0);
  expect(value.reports).toHaveLength(1);
  expect(value.reports[0]!.observations).toHaveLength(3);
  expect(value.reports[0]!.sourcePages).toEqual([1]);
});
test('unknown content creates no fake report or visit', () => {
  const value = parseRecords([visitFixture(['无法分类的资料'])]);
  expect(value.recordKind).toBe('unknown');
  expect(value.reports).toEqual([]);
  expect(value.visits).toEqual([]);
  expect(value.parsing.unprocessed).toHaveLength(1);
});
test('explicit manual fallback keeps all source text without generating missing paragraphs', () => {
  const page = visitFixture(['无标题的文字']);
  const value = parseVisitPage(page, true)!;
  expect(value.sections).toEqual({});
  expect(value.lines).toEqual(page.readingLines);
  expect(value.date).toBe('');
});
test('text PDFs can use layout rows when native line extraction is absent', () => {
  const page = visitFixture(
    syntheticVisitText.filter((x) => x !== '主').map((x) => x.replace(/^诉/, '主诉')),
  );
  page.spans = page.readingLines!;
  delete page.readingLines;
  page.extractionMethod = 'text';
  expect(parseVisitPage(page)?.sections.chief?.text).toBe('咳嗽 3 天。');
});

function splitDecimalVisit(value = '18.5'): LayoutPage {
  const [whole, fraction] = value.split('.');
  const page = visitFixture([
    '示例医院门诊病历',
    '主诉：复查。',
    '诊断：原文示例。',
    `处理：检查记录【BMI<${whole}`,
    `${fraction}】，携结果复诊。`,
  ]);
  page.readingLines![3]!.rect = { x: 0.1, y: 0.39, width: 0.45, height: 0.055 };
  page.readingLines![4]!.rect = { x: 0.55, y: 0.418, width: 0.3, height: 0.027 };
  const glyphs = (text: string): Span[] =>
    [...text].map((text, i) => ({
      text,
      rect: { x: 0.53 + i * 0.008, y: 0.42, width: 0.008, height: 0.02 },
    }));
  page.numericSpans = glyphs(value);
  page.tableSpans = glyphs(value);
  return page;
}

test.each(['18.5', '0.25', '12.34'])(
  'recovers a split decimal %s only from matching local OCR evidence, keeping raw lines',
  (value) => {
    const page = splitDecimalVisit(value);
    const rawLines = JSON.parse(JSON.stringify(page.readingLines));
    const parsed = parseVisitPage(page)!;
    expect(parsed.sections.plan?.text).toBe(`检查记录【BMI<${value}】，携结果复诊。`);
    expect(parsed.lines).toEqual(rawLines);
    expect(page.readingLines).toEqual(rawLines);
    expect(parsed.sections.plan?.rect).toMatchObject({ x: 0.1, y: 0.39 });
    expect(parsed.sections.plan?.rect.width).toBeCloseTo(0.75);
    expect(parsed.sections.plan?.rect.height).toBeCloseTo(0.055);
  },
);

test.each([
  'absent',
  'integer',
  'different digits',
  'different location',
  'conflicting reads',
  'next printed line',
])('does not guess a decimal when evidence is %s', (kind) => {
  const page = splitDecimalVisit();
  if (kind === 'absent') page.numericSpans = page.tableSpans = [];
  if (kind === 'integer') {
    page.numericSpans = page.numericSpans!.filter((s) => s.text !== '.');
    page.tableSpans = page.tableSpans!.filter((s) => s.text !== '.');
  }
  if (kind === 'different digits' || kind === 'conflicting reads') {
    page.numericSpans = page.numericSpans!.map((s) => (s.text === '5' ? { ...s, text: '6' } : s));
    if (kind === 'different digits') page.tableSpans = page.numericSpans;
  }
  if (kind === 'different location') {
    page.numericSpans = page.numericSpans!.map((s) => ({ ...s, rect: { ...s.rect, y: 0.7 } }));
    page.tableSpans = page.numericSpans;
  }
  if (kind === 'next printed line')
    page.readingLines![4]!.rect = { x: 0.1, y: 0.46, width: 0.3, height: 0.027 };
  expect(parseVisitPage(page)?.sections.plan?.text).toBe('检查记录【BMI<18\n5】，携结果复诊。');
});

test('an alternate-scale read can supply the decimal when the numeric read omits it', () => {
  const page = splitDecimalVisit();
  page.numericSpans = page.numericSpans!.filter((s) => s.text !== '.');
  expect(parseVisitPage(page)?.sections.plan?.text).toBe('检查记录【BMI<18.5】，携结果复诊。');
});
