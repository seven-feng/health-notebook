import type { LayoutPage, Span } from '../../src/domain/types';
export const span = (text: string, x: number, y: number, width = 0.09, height = 0.016): Span => ({
  text,
  rect: { x, y, width, height },
});
export function page(
  index: number,
  spans: Span[],
  person = '测试甲',
  number = 'SYNTHETIC-001',
  date = '2026-10-01',
): LayoutPage {
  return {
    pageIndex: index,
    width: 600,
    height: 800,
    extractionMethod: 'text',
    spans: [
      span(`姓名：${person}`, 0.1, 0.04, 0.22),
      span(`报告编号：${number}`, 0.5, 0.04, 0.35),
      span(`体检日期：${date}`, 0.1, 0.065, 0.4),
      ...spans,
    ],
  };
}
export const header = (y: number) => [
  span('检查项目', 0.1, y, 0.1),
  span('测量结果', 0.45, y, 0.09),
  span('参考区间', 0.66, y, 0.1),
  span('单位', 0.85, y, 0.06),
];
export const row = (name: string, value: string, reference: string, unit: string, y: number) => [
  span(name, 0.11, y, 0.22),
  ...(value ? [span(value, 0.46, y, 0.12)] : []),
  ...(reference ? [span(reference, 0.67, y, 0.12)] : []),
  ...(unit ? [span(unit, 0.86, y, 0.07)] : []),
];
export function sectionFixture(): LayoutPage[] {
  return [
    page(0, [span('合成检查', 0.1, 0.82, 0.2), ...header(0.87)]),
    page(1, [
      ...row('项目甲', '0', '0—10', 'U/L', 0.12),
      ...row('项目乙', '阴性', '阴性', '', 0.17),
      span('小结：仅用于软件测试', 0.1, 0.24, 0.7),
      span('双项检查', 0.1, 0.35, 0.25),
      ...header(0.4),
      ...row('项目丙', '<5', '<10', 'U/L', 0.45),
      ...row('项目丁', '未见异常', '', '', 0.5),
      span('小结：仅用于软件测试', 0.1, 0.58, 0.7),
    ]),
    page(2, [span('使用说明', 0.1, 0.1, 0.3), span('此页只用于测试原件保留。', 0.1, 0.2, 0.7)]),
  ];
}
