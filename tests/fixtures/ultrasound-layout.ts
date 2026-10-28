import type { LayoutPage, Span } from '../../src/domain/types';

export const ultrasoundText = [
  '合成医院超声诊断报告单',
  '姓名：测试甲 性别：女 年龄：40岁',
  '检查项目：合成部位超声检查',
  '临床诊断：原文复查记录',
  '检查所见；',
  '原文所见示例，大小约0.23*0.41cm。',
  '原文第二行，保留数字与描述。',
  '提示：',
  '1. 原文分级示例 TI-RADS 3类。',
  '报告时间：2026-08-16 09:30 会诊医师：测试医师',
  '本报告仅供临床医师参考',
];
export function ultrasoundFixture(text = ultrasoundText): LayoutPage {
  const ys = [0.04, 0.09, 0.14, 0.18, 0.5, 0.53, 0.56, 0.65, 0.68, 0.9, 0.95];
  const readingLines: Span[] = text.map((text, i) => ({
    text,
    rect: { x: 0.1, y: ys[i] ?? 0.97, width: 0.75, height: 0.02 },
  }));
  return {
    pageIndex: 0,
    width: 600,
    height: 800,
    extractionMethod: 'ocr',
    readingLines,
    spans: readingLines,
  };
}
