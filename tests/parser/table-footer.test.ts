import { parseDocument } from '../../src/parser/document';
import { parseLabTable } from '../../src/parser/table';
import { reviewCopy } from '../../src/domain/review-messages';
import { page, span, header, row } from '../fixtures/section-layout';
import type { LayoutPage } from '../../src/domain/types';

function report(extra: LayoutPage['spans'] = []): LayoutPage {
  return page(9, [
    span('尿常规', 0.1, 0.12, 0.25),
    ...header(0.2),
    ...row('项目甲', '0', '0-10', 'U/L', 0.3),
    ...row('项目乙', '2', '0-10', 'U/L', 0.35),
    ...row('项目丙', '3', '0-10', 'U/L', 0.4),
    ...extra,
  ]);
}

test.each([
  ['text', 0.955],
  ['ocr', 0.955],
  ['text', 0.6],
  ['ocr', 0.6],
] as const)('footer does not become a separate report or section item: %s at %s', (method, y) => {
  const input = report([...row('某某机构辨识不清', '', '注', ':自费增项10/26', y)]);
  input.extractionMethod = method;
  const parsed = parseDocument([input]);
  expect(parsed.reports).toHaveLength(1);
  expect(parsed.reports[0]!.title).toBe('尿常规');
  expect(parsed.reports[0]!.observations.map((o) => o.name)).toEqual([
    '项目甲',
    '项目乙',
    '项目丙',
  ]);
  // Filtering an annotation must not remove its original-page coverage.
  expect(
    parsed.parsing.unprocessed.some(
      ({ page, rect }) =>
        page === 9 &&
        rect.x <= 0.2 &&
        rect.x + rect.width >= 0.2 &&
        rect.y <= y + 0.008 &&
        rect.y + rect.height >= y + 0.008,
    ),
  ).toBe(true);
});

test.each([
  ['全国统一服务热线', '400', '0-1000', 'U/L'],
  ['示例体检分院', '10', '0-26', 'U/L'],
  ['第10页共26页', '10', '0-26', 'U/L'],
  ['底部不明文字', '', '注', '10/26'],
])('legacy parser excludes administrative row %s', (name, value, reference, unit) => {
  const input = report(row(name!, value!, reference!, unit!, 0.955));
  expect(parseLabTable(input)!.observations.map((o) => o.name)).toEqual([
    '项目甲',
    '项目乙',
    '项目丙',
  ]);
});

test.each([
  ['0-10', ''],
  ['', 'U/L'],
  ['', 'mIU/mL'],
  ['', '个/HPF'],
  ['阴性(-)', ''],
])('real missing values remain reviewable with reference %s and unit %s', (reference, unit) => {
  const input = report(row('待补结果项', '', reference, unit, 0.45));
  for (const observations of [
    parseLabTable(input)!.observations,
    parseDocument([input]).reports.flatMap((r) => r.observations),
  ]) {
    const missing = observations.find((o) => o.name === '待补结果项');
    expect(missing?.rawValue).toBe('');
    expect(missing?.warnings).toContain(reviewCopy.missingValue);
  }
});

test('a real bottom-page zero survives section and legacy merging', () => {
  const input = report(row('真实末项', '0', '0-10', 'U/L', 0.955));
  const observations = parseDocument([input]).reports.flatMap((r) => r.observations);
  expect(observations).toHaveLength(4);
  expect(observations.find((o) => o.name === '真实末项')?.rawValue).toBe('0');
});
