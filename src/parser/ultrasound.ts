import type { LayoutPage, Observation, Span } from '../domain/types';
import type { ParsedReport } from './index';
import { validDate } from '../domain/metrics';
import { reviewCopy } from '../domain/review-messages';
import { bounds, lines } from './layout';
import { ultrasoundParagraph } from './ultrasound-text';

const clean = (text: string) =>
  text.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1').trim();
const heading =
  /^(检查所见|超声所见|声像图所见|超声提示|诊断意见|检查结论|提示)(?:\s*[:：;；]\s*|\s*$)/;
const footer =
  /^(?:报告(?:时间|日期)|检查(?:时间|日期|医师|医生)|会诊医师|医师助理|审核(?:医师|医生)|医生签名|打印(?:时间|日期)|本报告)/;
const impression = /^(?:超声提示|诊断意见|检查结论|提示)$/;

export function parseUltrasoundPage(page: LayoutPage): ParsedReport | null {
  const source = (page.readingLines?.length ? page.readingLines : lines(page))
    .map((s) => ({ ...s, text: clean(s.text) }))
    .filter((s) => s.text && Object.values(s.rect).every(Number.isFinite))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const firstHeading = source.findIndex((s) => heading.test(s.text));
  if (firstHeading < 0) return null;
  const header = source
    .slice(0, firstHeading)
    .map((s) => s.text)
    .join('\n');
  if (!/超声(?:诊断|检查)?报告(?:单)?/.test(header) || /科普|参考值介绍|报告示例|样例/.test(header))
    return null;
  const patients = [...header.matchAll(/(?:患者姓名|姓名)\s*[:：]\s*([^\n]+)/g)].map((m) =>
    m[1]!.split(/\s*(?:性别|年龄|出生|病区|床号|科室|病案号|超声号)\s*[:：]/)[0]!.trim(),
  );
  const uniquePatients = [...new Set(patients.filter(Boolean))];
  if (uniquePatients.length !== 1) return null;

  const blocks: { name: string; rows: Span[]; content: Span[]; fragments: boolean }[] = [];
  let current: (typeof blocks)[number] | undefined;
  for (const row of source.slice(firstHeading)) {
    const match = row.text.match(heading);
    if (match) {
      current = {
        name: impression.test(match[1]!) ? '报告提示' : '检查所见',
        rows: [row],
        content: [],
        fragments: false,
      };
      const rest = row.text.slice(match[0].length).trim();
      if (rest) current.content.push({ ...row, text: rest });
      blocks.push(current);
    } else if (footer.test(row.text)) {
      current = undefined;
    } else if (current) {
      // Keep the printed paragraph's left alignment. Side notes and neighbouring
      // sheets remain in the original, with an explicit review warning.
      const start = current.rows[0]!.rect.x;
      if (
        row.rect.x < start - 0.04 ||
        row.rect.x > start + Math.max(0.04, Math.min(0.08, current.rows[0]!.rect.height * 3))
      ) {
        current.fragments = true;
        current.rows.push(row);
        continue;
      }
      current.rows.push(row);
      current.content.push(row);
    }
  }
  const body = blocks.filter((b) => b.content.some((row) => row.text.trim()));
  if (!body.some((b) => b.name === '检查所见') || !body.some((b) => b.name === '报告提示'))
    return null;
  const observations: Observation[] = [];
  const add = (
    name: string,
    content: string,
    rows: Span[],
    fragments = false,
    original = content,
    warnings: string[] = [],
  ) => {
    observations.push({
      id: `ultrasound-p${page.pageIndex}-${observations.length}`,
      name,
      originalName: name,
      rawValue: content,
      originalValue: original,
      resultKind: 'text',
      unit: '',
      reference: '',
      code: '',
      specimen: '',
      method: '',
      page: page.pageIndex,
      sourceRect: bounds(rows),
      rect: bounds(rows),
      needsReview: true,
      warnings: [
        reviewCopy.text,
        ...warnings,
        ...(fragments ? ['本段附近有旁注或零散文字未整理，请连同原件核对。'] : []),
      ],
    });
  };
  for (const row of source.slice(0, firstHeading)) {
    const match = row.text.match(/^(检查项目|检查部位|临床诊断)\s*[:：;；]\s*(.+)$/);
    if (match)
      add(match[1] === '临床诊断' ? '报告所载临床诊断' : match[1]!, match[2]!.trim(), [row]);
  }
  for (const block of body) {
    const paragraph = ultrasoundParagraph(block.content, page);
    add(
      block.name,
      paragraph.text,
      block.rows,
      block.fragments,
      paragraph.original,
      paragraph.warnings,
    );
  }

  // A report date is a report date, not a sampling date. Never borrow a birth,
  // print or handwritten follow-up date. Conflicting or invalid dates stay empty.
  const readDates = (label: string) =>
    source.flatMap((row) => {
      const match = row.text.match(
        new RegExp(
          `^(?:${label})(?:时间|日期)\\s*[:：]?\\s*(\\d{4})[-/.年](\\d{1,2})[-/.月](\\d{1,2})`,
        ),
      );
      return match
        ? [`${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`]
        : [];
    });
  const examDates = readDates('检查'),
    reportDates = readDates('报告');
  const dates = [...new Set(examDates.length ? examDates : reportDates)];
  const date = dates.length === 1 && validDate(dates[0]!) ? dates[0]! : '';
  return {
    reportType: 'imaging',
    title: '超声检查报告',
    patient: uniquePatients[0]!,
    date,
    dateKind: date ? (examDates.length ? 'exam' : 'report') : 'unknown',
    template: 'ultrasound-text-v1',
    sourcePage: page.pageIndex,
    sourcePages: [page.pageIndex],
    sectionKey: `ultrasound-p${page.pageIndex}`,
    extractionMethod: page.extractionMethod,
    observations,
    warnings: [reviewCopy.text, ...(!date ? ['检查／报告日期未识别清楚，请对照原件补充。'] : [])],
  };
}
