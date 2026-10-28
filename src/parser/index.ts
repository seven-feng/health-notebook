import type { LayoutPage, Observation } from '../domain/types';
import { validDate } from '../domain/metrics';
import { reviewCopy } from '../domain/review-messages';
import { lines } from './layout';
import { parseZheyiPage } from './zheyi';
import { parseLabTable } from './table';
import { parseSections } from './sections';
import { parseUltrasoundPage } from './ultrasound';
export { lines } from './layout';

export type ParsedReport = {
  reportType?: 'imaging';
  dateKind?: 'sample' | 'report' | 'exam' | 'unknown';
  dateSource?: 'header';
  sourcePage?: number;
  sourcePages?: number[];
  sectionKey?: string;
  extractionMethod?: 'text' | 'ocr';
  patient: string;
  date: string;
  title: string;
  template: string | null;
  warnings: string[];
  observations: Observation[];
};
// Verified templates take priority; other reports need explicit table headers
// and multiple measured rows (or an identified short lab report).
// Unstructured/ambiguous pages stay unparsed.
function parseIndependentPages(pages: LayoutPage[]): ParsedReport[] {
  const reports: ParsedReport[] = [];
  for (const page of pages) {
    const ultrasound = parseUltrasoundPage(page);
    if (ultrasound) {
      reports.push(ultrasound);
      continue;
    }
    const hospital = parseZheyiPage(page);
    if (hospital) {
      reports.push(hospital);
      continue;
    }
    const rows = lines(page);
    const text = rows.map((r) => r.text).join('\n');
    if (!text.includes('DOCTOR-SAMPLE-V1')) {
      const table = parseLabTable(page);
      if (table) {
        reports.push(table);
        continue;
      }
      reports.push({
        title: `待整理报告 · 第 ${page.pageIndex + 1} 页`,
        patient: '',
        date: '',
        template: null,
        sourcePage: page.pageIndex,
        extractionMethod: page.extractionMethod,
        observations: [],
        warnings: [page.spans.length ? reviewCopy.unsupported : reviewCopy.unreadable],
      });
      continue;
    }
    const patient = text.match(/Patient:\s*([^\n|]+)/)?.[1]?.trim() ?? '';
    const date = text.match(/Sample date:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
    const observations: Observation[] = [];
    const warnings: string[] = [];
    const definitions: Record<string, { name: string; code: string; unit: string }> = {
      ALT: { name: '丙氨酸氨基转移酶', code: 'sample:ALT', unit: 'U/L' },
      AST: { name: '天门冬氨酸氨基转移酶', code: 'sample:AST', unit: 'U/L' },
      GLU: { name: '葡萄糖', code: 'sample:GLU', unit: 'mmol/L' },
    };
    for (const row of rows) {
      const cells = row.text.split('|').map((x) => x.trim());
      const def = definitions[cells[0] ?? ''];
      if (!def) continue;
      if (cells.length !== 4 || !cells[1] || cells[2] !== def.unit || !cells[3]) {
        warnings.push(`${def.name} 行格式不完整，请对照原件补录。`);
        continue;
      }
      observations.push({
        id: `p${page.pageIndex}-${def.code}`,
        name: def.name,
        code: def.code,
        rawValue: cells[1],
        originalValue: cells[1],
        unit: cells[2],
        reference: cells[3],
        specimen: 'sample:serum',
        method: 'sample:verified-v1',
        page: page.pageIndex,
        rect: row.rect,
      });
    }
    if (!validDate(date)) warnings.push(reviewCopy.date);
    if (observations.length !== 3) warnings.push('样本应包含三项指标，当前提取不完整。');
    if (!patient) warnings.push(reviewCopy.patient);
    reports.push({
      title: '检验报告 · 示例',
      patient,
      date: validDate(date) ? date : '',
      template: 'synthetic-v1',
      observations,
      warnings,
    });
  }
  return reports;
}

export function parsePages(pages: LayoutPage[]): ParsedReport[] {
  const independent = parseIndependentPages(pages);
  const protectedPages = new Set(
    independent.flatMap((r, i) =>
      r.template && r.template !== 'lab-table-v1' ? [pages[i]!.pageIndex] : [],
    ),
  );
  const sections = parseSections(pages.filter((p) => !protectedPages.has(p.pageIndex)));
  const legacy = independent.flatMap((r, i) => {
    if (!r.template) return pages.length === 1 && !sections.length ? [r] : [];
    if (r.template !== 'lab-table-v1') return [r];
    // A new section may start at the bottom of a page containing another,
    // older-style table. Claim only overlapping rows, never the whole page.
    const observations = r.observations.filter(
      (o) =>
        !sections.some((section) =>
          section.observations.some((item) => {
            const region = item.sourceRect;
            const old = o.sourceRect ?? o.rect;
            return (
              region &&
              old &&
              o.page === item.page &&
              old.y + old.height / 2 >= region.y &&
              old.y + old.height / 2 <= region.y + region.height &&
              old.x + old.width / 2 >= region.x &&
              old.x + old.width / 2 <= region.x + region.width
            );
          }),
        ),
    );
    if (!observations.length) return [];
    const explanation = lines(pages[i]!).some((l) =>
      /^(?:参考值介绍|参考范围说明|健康知识|科普说明)\s*$/.test(l.text),
    );
    return explanation ? [] : [{ ...r, observations }];
  });
  const reports = [...sections, ...legacy];
  if (!reports.length && pages.length) {
    reports.push({
      ...independent[0]!,
      title: '待整理报告',
      template: null,
      observations: [],
      warnings: [reviewCopy.unsupported],
      sourcePages: pages.map((p) => p.pageIndex),
    });
  }
  return reports.sort(
    (a, b) =>
      (a.sourcePage ?? a.observations[0]?.page ?? 0) -
      (b.sourcePage ?? b.observations[0]?.page ?? 0),
  );
}
