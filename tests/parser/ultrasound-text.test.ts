import { ultrasoundParagraph } from '../../src/parser/ultrasound-text';
import { parseUltrasoundPage } from '../../src/parser/ultrasound';
import type { LayoutPage, Span } from '../../src/domain/types';
import { ultrasoundFixture } from '../fixtures/ultrasound-layout';
import { needsIndividualReview } from '../../src/domain/review-groups';

function sample() {
  const page = ultrasoundFixture();
  const rows: Span[] = [
    { text: '原文尺寸约0.31*0.42*0', rect: { x: 0.1, y: 0.53, width: 0.75, height: 0.02 } },
    { text: '35mm，原文描述。', rect: { x: 0.1, y: 0.56, width: 0.5, height: 0.02 } },
  ];
  page.readingLines = page
    .readingLines!.filter((r) => r.rect.y < 0.53 || r.rect.y >= 0.65)
    .concat(rows);
  // Vision can give a whole word's rectangle to each character.
  page.numericSpans = [
    ...[...'0.31*0.42*0.'].map((text) => ({
      text,
      rect: { x: 0.65, y: 0.53, width: 0.2, height: 0.02 },
    })),
    { text: '35', rect: { x: 0.1, y: 0.56, width: 0.08, height: 0.02 } },
  ];
  page.tableSpans = [
    { text: '0', rect: { x: 0.82, y: 0.53, width: 0.03, height: 0.02 } },
    { text: '35mm', rect: { x: 0.1, y: 0.56, width: 0.11, height: 0.02 } },
  ];
  return { page, rows };
}

test('recovers a wrapped decimal only from matching positional evidence and keeps the OCR original', () => {
  const { page } = sample();
  const before = JSON.stringify(page);
  const finding = parseUltrasoundPage(page)!.observations.find((o) => o.name === '检查所见')!;
  expect(finding.rawValue).toBe('原文尺寸约0.31*0.42*0.35mm，原文描述。');
  expect(finding.originalValue).toBe('原文尺寸约0.31*0.42*0\n35mm，原文描述。');
  expect(finding.warnings).toContain(
    '已根据同位置的另一份识别结果恢复跨行小数点，请对照原件核对。',
  );
  expect(needsIndividualReview(finding)).toBe(true);
  expect(JSON.stringify(page)).toBe(before);
});

test.each([
  'missing',
  'other-row',
  'other-column',
  'whole-conflict',
  'fraction-conflict',
  'fraction-missing',
  'text-pdf',
])('keeps ambiguous numeric boundaries without inserting or deleting digits: %s', (kind) => {
  const { page, rows } = sample();
  if (kind === 'missing') page.numericSpans = [];
  if (kind === 'other-row')
    page.numericSpans!.forEach((s) => (s.rect = { ...s.rect, y: s.rect.y + 0.1 }));
  if (kind === 'other-column')
    page.numericSpans!.forEach((s) => (s.rect = { ...s.rect, x: s.rect.x - 0.1 }));
  if (kind === 'whole-conflict') page.tableSpans![0]!.text = '8.';
  if (kind === 'fraction-conflict') page.tableSpans![1]!.text = '36mm';
  if (kind === 'fraction-missing') {
    page.numericSpans!.pop();
    page.tableSpans!.pop();
  }
  if (kind === 'text-pdf') page.extractionMethod = 'text';
  const result = ultrasoundParagraph(rows, page);
  expect(result.text).toBe(result.original);
  expect(result.warnings).toContain(
    '有数字跨行且无法确认是否缺少小数点，已保留断行，请对照原件核对。',
  );
});

test('an explicit printed decimal point is joined without alternate OCR', () => {
  const { page, rows } = sample();
  page.numericSpans = [];
  page.tableSpans = [];
  rows[0]!.text += '.';
  const result = ultrasoundParagraph(rows, page);
  expect(result.text).toBe('原文尺寸约0.31*0.42*0.35mm，原文描述。');
  expect(result.original).toContain('0.\n35mm');
  expect(result.warnings).toEqual([]);
});

test('numerals, list starts, short lines and distant paragraphs are never blindly concatenated', () => {
  const page: LayoutPage = { pageIndex: 0, width: 600, height: 800, spans: [] };
  const result = ultrasoundParagraph(
    [
      { text: '原文尺寸12', rect: { x: 0.1, y: 0.1, width: 0.75, height: 0.02 } },
      { text: '34mm', rect: { x: 0.1, y: 0.13, width: 0.75, height: 0.02 } },
      { text: '2. 原文第二项', rect: { x: 0.1, y: 0.16, width: 0.4, height: 0.02 } },
      { text: '独立短行', rect: { x: 0.1, y: 0.19, width: 0.75, height: 0.02 } },
      { text: '另一段', rect: { x: 0.1, y: 0.3, width: 0.75, height: 0.02 } },
    ],
    page,
  );
  expect(result.text).toBe('原文尺寸12\n34mm\n2. 原文第二项\n独立短行\n另一段');
});

test('medical words, negations and classifications are not autocorrected by dictionary rules', () => {
  const { page, rows } = sample();
  rows[0]!.text = '原文虫部、天小、未见，TI-RADS 4B类。';
  expect(ultrasoundParagraph([rows[0]!], page).text).toBe(rows[0]!.text);
});

test('a decimal followed by an unclear unit stays separate and requires review', () => {
  const { page, rows } = sample();
  rows[0]!.text += '.';
  rows[1]!.text = '350m，原文描述。';
  const result = ultrasoundParagraph(rows, page);
  expect(result.text).toBe(result.original);
  expect(result.warnings).toContain('跨行数字的单位或接续关系未识别清楚，请对照原件核对。');
  expect(result.text).not.toContain('0.350m');
});
