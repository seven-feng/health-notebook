import type { LayoutPage, Span, VisitExtraction, VisitSectionKey } from '../domain/types';
import { validDate } from '../domain/metrics';
import { lines, union } from './layout';
import { joinVisitDecimalFragments } from './visit-decimals';

export const visitLabels: Record<VisitSectionKey, string> = {
  chief: '就诊原因',
  diagnosis: '医生诊断',
  plan: '处理／医嘱',
  present: '现病史',
  past: '既往史',
  exam: '体格检查',
};
const headings: [VisitSectionKey, string][] = [
  ['chief', '主诉'],
  ['present', '现病史'],
  ['past', '既往史'],
  ['exam', '体格检查|查体|体检'],
  ['diagnosis', '初步诊断|临床诊断|门诊诊断|诊断'],
  ['plan', '诊疗意见|诊疗计划|治疗意见|处理意见|处理|处置|医嘱|治疗计划'],
];
const heading = new RegExp(
  `^\\s*(${headings.map(([, label]) => label).join('|')})(?:\\s*[:：]\\s*|\\s*$)`,
);
const clean = (text: string) =>
  text.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1').trim();

// Preserve OCR's line sequence; table row reconstruction can scramble slanted prose.
export function visitLines(page: LayoutPage): Span[] {
  return page.readingLines?.length ? page.readingLines : lines(page);
}
export function parseVisitPage(page: LayoutPage, force = false): VisitExtraction | null {
  const source = visitLines(page);
  const prepared = joinVisitDecimalFragments(source, page);
  const rows: Span[] = [];
  for (let i = 0; i < prepared.length; i++) {
    let row = { ...prepared[i]!, text: clean(prepared[i]!.text) };
    // Vision may return a spaced heading as separate observations (主 / 诉:).
    // Join only exact heading prefixes, never arbitrary body lines.
    const names = headings.flatMap(([, value]) => value.split('|'));
    while (
      i + 1 < prepared.length &&
      row.text &&
      names.some((name) => name.startsWith(row.text) && name !== row.text)
    ) {
      const next = prepared[i + 1]!;
      const combined = row.text + clean(next.text);
      if (!heading.test(combined) && !names.some((name) => name.startsWith(combined))) break;
      row = { text: combined, rect: union(row.rect, next.rect) };
      i++;
    }
    rows.push(row);
  }
  const text = rows.map((line) => line.text).join('\n');
  const keys = new Set(
    rows.flatMap((line) => {
      const match = line.text.match(heading);
      return match
        ? [headings.find(([, names]) => new RegExp(`^(?:${names})$`).test(match[1]!))![0]]
        : [];
    }),
  );
  const isVisit =
    keys.size >= 2 &&
    (keys.has('chief') || keys.has('diagnosis')) &&
    (/门诊病历|急诊病历|门急诊病历|门诊记录|就诊(?:时间|日期)/.test(text) || keys.size >= 3);
  if (!force && !isVisit) return null;
  const sections: VisitExtraction['sections'] = {};
  let current: VisitSectionKey | undefined;
  for (const row of rows) {
    const match = row.text.match(heading);
    if (match) {
      current = headings.find(([, names]) => new RegExp(`^(?:${names})$`).test(match[1]!))![0];
      const content = row.text.slice(match[0].length).trim();
      const old = sections[current];
      sections[current] = {
        text: [old?.text, content].filter(Boolean).join('\n'),
        rect: old ? union(old.rect, row.rect) : row.rect,
      };
    } else if (
      /^(医师|医生|签名|打印时间|打印日期|联系电话|温馨提示|复诊预约)\s*[:：]/.test(row.text)
    ) {
      current = undefined;
    } else if (current) {
      const old = sections[current]!;
      sections[current] = {
        text: [old.text, row.text].filter(Boolean).join('\n'),
        rect: union(old.rect, row.rect),
      };
    }
  }
  const firstHeading = rows.findIndex((row) => heading.test(row.text));
  const header = rows.slice(0, firstHeading < 0 ? rows.length : firstHeading);
  const headerText = header.map((line) => line.text).join('\n');
  const dates = [
    ...headerText.matchAll(
      /(?:就诊|就医|门诊|急诊)(?:时间|日期)\s*[:：]?\s*(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/g,
    ),
  ].map((match) => `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`);
  const uniqueDates = [...new Set(dates)];
  const date = uniqueDates.length === 1 ? uniqueDates[0]! : '';
  const metadata = (pattern: RegExp) =>
    headerText
      .match(pattern)?.[1]
      ?.split(/\s*(?:性别|年龄|出生|病历号|门诊号|就诊|科室|医生|医师|姓名)\s*[:：]|\s+\|\s*/)[0]
      ?.trim() ?? '';
  const hospital =
    header
      .map((row) => row.text.replace(/(?:门急诊病历|门诊病历|急诊病历|门诊记录)$/, '').trim())
      .find((text) =>
        /^[^:：\d]{2,50}(?:医院|卫生服务中心|卫生院|诊所)(?:[（(].*[）)])?$/.test(text),
      ) ?? '';
  return {
    version: 1,
    date: validDate(date) ? date : '',
    patient: metadata(/(?:患者姓名|姓名)\s*[:：]\s*([^\n]+)/),
    department: metadata(/(?:就诊科室|就诊科别|科室|科别)\s*[:：]\s*([^\n]+)/),
    hospital,
    sourcePage: page.pageIndex,
    sections,
    lines: source.map((line) => ({ ...line })),
  };
}
