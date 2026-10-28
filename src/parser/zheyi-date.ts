import type { LayoutPage, Report } from '../domain/types';
import { validDate } from '../domain/metrics';
import { lines } from './layout';

export type ReportDate = Pick<Report, 'date' | 'dateKind' | 'dateSource'>;
const empty: ReportDate = { date: '', dateKind: 'unknown' };
const compact = (text: string) => text.normalize('NFKC').replace(/[\s|]/g, '');
const datePattern = '(\\d{4})[-年/.](\\d{1,2})[-月/.](\\d{1,2})';
function dateValue(match: RegExpMatchArray | null): string {
  if (!match) return '';
  const date = `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`;
  return validDate(date) ? date : '';
}
function unique(dates: string[]): string {
  return dates.length && dates.every((date) => date && date === dates[0]) ? dates[0]! : '';
}

// Called only after the hospital, report title and table columns are verified.
// Cropped photos often retain the upper-right date but omit the sampling footer.
export function parseZheyiDate(page: LayoutPage, tableTop: number): ReportDate {
  const rows = lines(page).map((row) => ({ ...row, text: compact(row.text) }));
  for (const [label, dateKind] of [
    ['(?:采集|采样)(?:时间|日期)', 'sample'],
    ['报告(?:时间|日期)', 'report'],
  ] as const) {
    const labelled = rows.filter((row) => new RegExp(label).test(row.text));
    if (labelled.length) {
      const date = unique(
        labelled.map((row) =>
          dateValue(row.text.match(new RegExp(`${label}[:：]?${datePattern}`))),
        ),
      );
      // Conflicting or unreadable labelled dates must not be replaced by a guess.
      return date ? { date, dateKind } : empty;
    }
  }
  const candidates: string[] = [];
  for (const row of rows.filter((row) => row.rect.y + row.rect.height <= tableTop)) {
    if (/出生|生日|打印|复印|接收|接样|送检|预约|就诊/.test(row.text)) continue;
    const right = page.spans.filter(
      (span) =>
        span.rect.x >= 0.5 &&
        Math.abs(span.rect.y + span.rect.height / 2 - (row.rect.y + row.rect.height / 2)) <
          Math.max(0.002, Math.min(span.rect.height, row.rect.height) * 0.45),
    );
    for (const cell of lines({ ...page, spans: right }).flatMap((line) => line.text.split('|'))) {
      const match = compact(cell).match(
        new RegExp(`^${datePattern}日?(?:\\d{2}:\\d{2}(?::\\d{2})?)?$`),
      );
      if (match) candidates.push(dateValue(match));
    }
  }
  const date = unique(candidates);
  return date ? { date, dateKind: 'sample', dateSource: 'header' } : empty;
}
