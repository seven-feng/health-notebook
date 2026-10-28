import type { LayoutPage, Span } from '../../src/domain/types';
export const syntheticVisitText = [
  '示例医院门诊病历', '姓名：测试甲 性别：女', '就诊时间：2026-10-23 09:15', '就诊科室：呼吸内科',
  '主', '诉：咳嗽 3 天。', '现病史：无发热。', '既往史：无特殊。', '体格检查：详见原件。',
  '诊断：上呼吸道感染。', '处理：完善相关检查，携结果复诊。', '药品示例 0.25 g，每次 1 片。', '医师：测试医生',
];
export function visitFixture(text = syntheticVisitText, pageIndex = 0): LayoutPage {
  const readingLines: Span[] = text.map((value, i) => ({ text: value, rect: { x: 0.08, y: 0.05 + i * 0.05, width: 0.8, height: 0.035 } }));
  // Glyphs deliberately slope across a baseline; native line order remains clear.
  const spans = readingLines.flatMap((line) => [...line.text].map((char, i) => ({ text: char, rect: { x: line.rect.x + i * 0.02, y: line.rect.y + i * 0.002, width: 0.02, height: 0.02 } })));
  return { pageIndex, width: 800, height: 1100, extractionMethod: 'ocr', spans, readingLines };
}
