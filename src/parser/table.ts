import type { LayoutPage, Observation, Rect, Span } from '../domain/types';
import { parseValue, validDate } from '../domain/metrics';
import { reviewCopy } from '../domain/review-messages';
import { bounds, cx, cy, lines, median } from './layout';
import { isTableMetadata } from './table-metadata';
import { normalizeConcentrationUnit } from '../domain/units';
import { alignTiltedTable } from './table-skew';
import type { ParsedReport } from './index';

const clean = (s: string) =>
  s.normalize('NFKC').replace(/\s+/g, '').replace(/項/g, '项').replace(/參/g, '参');
const join = (spans: Span[]) =>
  clean(
    [...spans]
      .sort((a, b) => a.rect.x - b.rect.x)
      .map((s) => s.text)
      .join(''),
  );
type Row = { spans: Span[]; center: number; height: number };

// Use a stable median baseline, not the expanding union of tall OCR boxes.
// A tall Chinese glyph must not join two adjacent numeric rows together.
function rows(spans: Span[]): Row[] {
  if (!spans.length) return [];
  const height = median(spans.map((s) => s.rect.height));
  const result: Row[] = [];
  const core = spans.filter((s) => s.rect.height >= height * 0.6 && s.rect.height <= height * 1.5);
  for (const s of [...core].sort((a, b) => cy(a) - cy(b))) {
    const row = result.at(-1);
    if (row && Math.abs(row.center - cy(s)) < height * 0.48) {
      row.spans.push(s);
      row.center = median(row.spans.map(cy));
    } else result.push({ spans: [s], center: cy(s), height });
  }
  const assigned = new Set(core);
  for (const s of spans.filter((s) => !assigned.has(s))) {
    const row = [...result].sort(
      (a, b) => Math.abs(a.center - cy(s)) - Math.abs(b.center - cy(s)),
    )[0];
    if (row && Math.abs(row.center - cy(s)) < height * 0.7) row.spans.push(s);
  }
  return result;
}

type Role = 'name' | 'value' | 'unit' | 'reference' | 'code' | 'flag' | 'method';
type Header = { role: Role; rect: Rect };
const headerPattern =
  /项目名称|检验项目|实验项目|中文名称|项目|检验结果|检测结果|结果|测定值|果|单位|参[考辛老]?(?:范围|区间|值(?:\/区间)?|范[田国園])|代号|缩写|代码|提示|标志|(?:检测|检验|测定)?方法/g;
function headers(spans: Span[]): Header[] {
  const ordered = [...spans].sort((a, b) => a.rect.x - b.rect.x);
  const chars = ordered.flatMap((s) => [...clean(s.text)].map((c) => ({ c, span: s })));
  const text = chars.map((v) => v.c).join('');
  return [...text.matchAll(headerPattern)].map((m) => ({
    role: /项目|名称/.test(m[0])
      ? 'name'
      : /结果|测定值|果/.test(m[0])
        ? 'value'
        : /^参/.test(m[0])
          ? 'reference'
          : m[0] === '单位'
            ? 'unit'
            : /方法/.test(m[0])
              ? 'method'
              : /代号|缩写|代码/.test(m[0])
                ? 'code'
                : 'flag',
    rect: bounds(chars.slice(m.index, m.index + m[0].length).map((c) => c.span)),
  }));
}

type Column = { role: Role; left: number; right: number; header: Header };
type Table = { left: number; right: number; top: number; bottom: number; columns: Column[] };
function tables(page: LayoutPage, spans = page.spans): Table[] {
  const found: Table[] = [];
  for (const row of rows(spans)) {
    const hs = headers(row.spans);
    const names = hs.filter((h) => h.role === 'name');
    if (!names.length) continue;
    const starts = names.map((name, i) => {
      if (i === 0) return 0;
      const before = hs.filter((h) => h.rect.x > names[i - 1]!.rect.x && h.rect.x < name.rect.x);
      const lastField = before.filter((h) => h.role === 'unit' || h.role === 'reference').at(-1);
      const prefix =
        before.find((h) => h.role === 'code' && h.rect.x > (lastField?.rect.x ?? -1)) ?? name;
      if (!lastField) return prefix.rect.x - 0.012;
      // Find the actual vertical gutter. Row numbers often start to the left
      // of the next header, so header midpoints alone can steal their digits.
      const from = lastField.rect.x + lastField.rect.width / 2;
      const to = prefix.rect.x;
      const ink = spans.filter(
        (s) => cy(s) > row.center + row.height && cy(s) < row.center + row.height * 15,
      );
      const preferred = (from + to) / 2;
      const choices = Array.from({ length: 31 }, (_, n) => from + ((to - from) * n) / 30);
      return choices.sort((a, b) => {
        const cost = (x: number) =>
          ink.filter((s) => s.rect.x < x + 0.001 && s.rect.x + s.rect.width > x - 0.001).length +
          Math.abs(x - preferred);
        return cost(a) - cost(b);
      })[0]!;
    });
    // Duplicate names identify separate side-by-side tables, even if their
    // column orders differ. No hospital identity or fixed page fractions.
    for (const [i, name] of names.entries()) {
      const left = Math.max(0, starts[i]!);
      const right = starts[i + 1] ?? 1;
      const relevant = hs.filter((h) => h.rect.x >= left && h.rect.x < right);
      if (
        !['name', 'value', 'unit', 'reference'].every(
          (role) => relevant.filter((h) => h.role === role).length === 1,
        )
      )
        continue;
      const value = relevant.find((h) => h.role === 'value')!;
      const reference = relevant.find((h) => h.role === 'reference')!;
      const unit = relevant.find((h) => h.role === 'unit')!;
      if (
        value.rect.x <= name.rect.x ||
        reference.rect.x <= value.rect.x ||
        unit.rect.x <= value.rect.x
      )
        continue;
      const columns = relevant.map((header, n) => ({
        role: header.role,
        header,
        left: n
          ? (relevant[n - 1]!.rect.x + relevant[n - 1]!.rect.width + header.rect.x) / 2
          : left,
        right:
          n + 1 < relevant.length
            ? (header.rect.x + header.rect.width + relevant[n + 1]!.rect.x) / 2
            : right,
      }));
      found.push({ left, right, top: row.center + row.height * 0.5, bottom: 1, columns });
    }
  }
  // Repeated headers on a page terminate the preceding table.
  for (const table of found) {
    const next = found.find((t) => t.top > table.top && Math.abs(t.left - table.left) < 0.03);
    if (next) table.bottom = next.top - 0.025;
  }
  return found;
}

function normalizeUnit(text: string): string {
  const s = normalizeConcentrationUnit(clean(text));
  // Keep the original OCR and a review warning when dropping a trailing speck.
  const withoutSpeck = normalizeConcentrationUnit(s.slice(0, -1));
  if (/[.-]$/.test(s) && validUnit(withoutSpeck)) return withoutSpeck;
  if (/^10(?:[\^*'"~×]|E)?9\/L$/i.test(s)) return '10^9/L';
  if (/^10(?:[\^*'"~×]|E)?12\/L$/i.test(s)) return '10^12/L';
  if (/^[uμµ]mol\/L$/i.test(s)) return 'μmol/L';
  if (/^mmol\/L$/i.test(s)) return 'mmol/L';
  if (/^fl$/i.test(s)) return 'fL';
  if (/^pg$/i.test(s)) return 'pg';
  if (/^u\/l$/i.test(s)) return 'U/L';
  return s;
}
const validUnit = (s: string) =>
  /^(?:%|10\^(?:9|12)\/L|(?:μmol|mmol|nmol|[mpnuμµ]?g|IU|U)\/(?:dL|mL|L)|fL|pg|\/100WBC)$/.test(s);
const normalizeRange = (s: string) =>
  clean(s)
    .replace(/[—–−~～]+/g, '-')
    .replace(/-{2,}/g, '-');
const validRange = (s: string) => /^(?:[<>≤≥]=?\d+(?:\.\d+)?|\d+(?:\.\d+)?-\d+(?:\.\d+)?)$/.test(s);

function readReference(spans: Span[]) {
  const ordered = [...spans].sort((a, b) => a.rect.x - b.rect.x);
  const runs: Span[][] = [];
  const charWidth = median(ordered.map((s) => s.rect.width / Math.max(1, s.text.length)));
  for (const s of ordered) {
    const previous = runs.at(-1)?.at(-1);
    if (previous && s.rect.x - (previous.rect.x + previous.rect.width) <= charWidth * 1.8)
      runs.at(-1)!.push(s);
    else runs.push([s]);
  }
  const ranges = runs.filter((run) => validRange(normalizeRange(join(run))));
  const selected = ranges.length === 1 ? ranges[0]! : ordered;
  return {
    text: normalizeRange(join(selected)),
    excluded: ordered.filter((s) => !selected.includes(s)),
  };
}
// Unknown but unit-shaped labels remain reviewable; this is evidence of a
// measured row, not validation of the unit or permission to compare trends.
const hasResultContext = (unit: string, reference: string) =>
  validUnit(unit) ||
  (/[A-Za-zμµ]/.test(unit) && /^[A-Za-zμµ\d^*×·./%()+\-个次]+$/.test(unit)) ||
  validRange(reference) ||
  /^(?:阴性|阳性|弱阴性|弱阳性|正常|未见异常|未检出|[+±-]{1,4})(?:\([+±-]+\))?$/.test(reference);

type CellValue = {
  raw: string;
  original: string;
  spans: Span[];
  flag?: 'high' | 'low';
  ambiguous: boolean;
};
function readValue(spans: Span[]): CellValue {
  const ordered = [...spans].sort((a, b) => a.rect.x - b.rect.x);
  const original = join(ordered);
  const arrows = new Set([...original].filter((c) => c === '↑' || c === '↓'));
  const flag = arrows.size === 1 ? (arrows.has('↑') ? 'high' : 'low') : undefined;
  // Text extending from a long name may enter this column. Only a trailing
  // numeric token is eligible; multiple tokens are never concatenated.
  const widths = ordered.filter((s) => /^\d$/.test(s.text)).map((s) => s.rect.width);
  const digitWidth = median(widths) || 0.006;
  const runs: Span[][] = [];
  for (const s of ordered) {
    if (/^[↑↓]$/.test(s.text)) {
      runs.push([]);
      continue;
    }
    const previous = runs.at(-1)?.at(-1);
    if (
      previous &&
      s.rect.x - (previous.rect.x + previous.rect.width) <= digitWidth * 1.8 &&
      /^[\d.,eE+\-<>≤≥IlO]+$/.test(clean(s.text))
    )
      runs.at(-1)!.push(s);
    else if (/^[\d.,eE+\-<>≤≥IlO]+$/.test(clean(s.text))) runs.push([s]);
    else runs.push([]); // A Chinese name or marker separates numeric tokens.
  }
  const candidates = runs
    .filter((r) => /\d/.test(join(r)))
    .sort((a, b) => join(b).length - join(a).length || bounds(b).x - bounds(a).x);
  const numberSpans = candidates[0] ?? [];
  const token = join(numberSpans);
  const otherText = ordered.filter((s) => !numberSpans.includes(s));
  const remainder = join(otherText).replace(/[↑↓]/g, '');
  // A second separated number might be a marker or a broken result. Preserve
  // ambiguity; never choose a short valid prefix of an illegible numeric token.
  const raw = parseValue(token) ? token : '';
  const trailing = numberSpans.at(-1);
  const thinTrailingOne =
    trailing?.text === '1' && numberSpans.length > 2 && trailing.rect.width < digitWidth * 0.75;
  return {
    raw,
    original,
    spans: numberSpans,
    flag,
    ambiguous:
      !raw ||
      !!remainder ||
      !!thinTrailingOne ||
      arrows.size > 1 ||
      spans.some((s) => (s.confidence ?? 1) < 0.3),
  };
}

const unitlessName = /(?:比值|比例|白球比|A\/G|pH值)$/i;
function reportMetadata(page: LayoutPage) {
  const text = metadataLines(page)
    .map((r) => r.text)
    .join('\n');
  const patient =
    text.match(/姓名[:：]([^\n:：|]+?)(?=性别|年龄|科室|床号|病历|标本|样本|\||$)/m)?.[1] ?? '';
  const dateMatch = text.match(
    /(?:采样|采集)(?:日期|时间)[:：]?(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/,
  );
  const dateCandidate = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2]!.padStart(2, '0')}-${dateMatch[3]!.padStart(2, '0')}`
    : '';
  return { patient, date: validDate(dateCandidate) ? dateCandidate : '' };
}

function metadataLines(page: LayoutPage) {
  return page.readingLines?.length
    ? page.readingLines.map((s) => ({ text: clean(s.text), center: cy(s) }))
    : lines(page).map((r) => ({ text: clean(r.text), center: cy(r) }));
}

function identifiedLabReport(page: LayoutPage, table: Table): boolean {
  const { patient, date } = reportMetadata(page);
  const headingLines = metadataLines(page)
    .filter((r) => r.center < table.top)
    .map((r) => r.text);
  const heading = headingLines.join('\n');
  // A cropped footer need not discard an otherwise complete lab result. An
  // isolated header date is report evidence, not proof of a sampling date.
  // Leave the report date empty until its meaning is explicitly confirmed.
  const headerCells = lines(page)
    .filter((r) => r.rect.y + r.rect.height / 2 < table.top)
    .filter((r) => !/出生|生日|打印|接收|接样|送检|预约|就诊/.test(r.text))
    .flatMap((r) => r.text.split('|').map(clean));
  const hasHeaderDate = headerCells.some((line) => {
    const match = line.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
    return (
      !!match &&
      validDate(`${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`)
    );
  });
  return (
    !!patient &&
    (!!date || hasHeaderDate) &&
    /(?:检验|检测)报告(?:单)?/.test(heading) &&
    !/(?:参考值介绍|参考范围说明|健康知识|科普|示例|样例)/.test(heading)
  );
}

function parseTable(page: LayoutPage, table: Table): Observation[] {
  const belongs = (s: Span) =>
    cx(s) >= table.left && cx(s) < table.right && cy(s) > table.top && cy(s) < table.bottom;
  const primary = page.spans.filter(belongs);
  const tableRows = rows(primary);
  const column = (role: Role) => table.columns.find((c) => c.role === role)!;
  const valueCol = column('value');
  const observations: Observation[] = [];
  for (const [index, row] of tableRows.entries()) {
    const inCell = (spans: Span[], role: Role) => {
      const c = column(role);
      return c ? spans.filter((s) => cx(s) >= c.left && cx(s) < c.right) : [];
    };
    const near = (s: Span) => belongs(s) && Math.abs(cy(s) - row.center) < row.height * 0.55;
    const secondary = (page.numericSpans ?? []).filter(near);
    const first = readValue(inCell(row.spans, 'value'));
    const second = readValue(inCell(secondary, 'value'));
    const retry = readValue(inCell((page.cellSpans ?? []).filter(near), 'value'));
    const value = first.raw ? first : second.raw ? second : retry.raw ? retry : first;
    const primaryReference = readReference(inCell(row.spans, 'reference'));
    const secondaryReference = readReference(inCell(secondary, 'reference'));
    const originalReference = primaryReference.text;
    const reference = originalReference || secondaryReference.text;
    const originalUnit = join(inCell(row.spans, 'unit')) || join(inCell(secondary, 'unit'));
    const unit = normalizeUnit(originalUnit);
    // Retain Chinese names printed beyond their nominal header boundary.
    // Stop at the actual result so long names aren't truncated to fit a template.
    const valueLeft = value.spans.length
      ? Math.min(...value.spans.map((s) => s.rect.x))
      : valueCol.left;
    const labelSpans = row.spans.filter(
      (s) =>
        cx(s) < Math.max(valueCol.left, valueLeft) &&
        !(
          column('code')?.header.rect.x > column('name').header.rect.x &&
          cx(s) >= column('code').left &&
          !/[\u3400-\u9fff]/.test(s.text)
        ),
    );
    const originalName = join(labelSpans);
    const codeBeforeName = column('code')?.header.rect.x < column('name').header.rect.x;
    let nameSpans = codeBeforeName
      ? labelSpans.filter((s) => cx(s) >= column('name').left)
      : labelSpans;
    // A missing Chinese name may still leave a usable printed abbreviation.
    if (!nameSpans.length) nameSpans = labelSpans;
    nameSpans = [...nameSpans].sort((a, b) => a.rect.x - b.rect.x);
    // Remove a separated row number, not meaningful prefixes such as C, β2,
    // α-L- or 5′. Column geometry, never the first Chinese glyph, separates codes.
    const firstLabel = nameSpans.findIndex((s, i) => {
      if (!i || !nameSpans.slice(0, i).every((v) => /^[\d.、:：]+$/.test(v.text))) return false;
      const previous = nameSpans[i - 1]!;
      return s.rect.x - (previous.rect.x + previous.rect.width) > row.height * 0.5;
    });
    if (firstLabel > 0) nameSpans = nameSpans.slice(firstLabel);
    const name = join(nameSpans)
      .replace(/^[|•*、:：]+/, '')
      .replace(/^\d+[.、](?=[\u3400-\u9fff])/, '')
      .replace(/[|]+/g, '');
    if (!name || /(?:报告|签名|采集|时间|日期|备注|参考|本结果|样本|诊断|检查)/.test(name))
      continue;
    if (isTableMetadata(name, join(row.spans))) continue;
    if (!/[\u3400-\u9fff]/.test(name) && !/^[A-Za-z][A-Za-z0-9#%/()\-]{0,12}$/.test(name)) continue;
    if (!reference && !unit) continue;
    // Preserve genuinely missing results when a unit or reference identifies
    // the row. Arbitrary notes in those columns do not establish a lab item.
    if (!value.raw && !hasResultContext(unit, reference)) continue;
    if (!/[\u3400-\u9fff]/.test(name) && !validRange(reference)) continue;
    // A reference-range-only table cannot establish a measured result column.
    const warnings: string[] = [reviewCopy.item];
    if (!value.raw) warnings.push(reviewCopy.missingValue);
    else if (value.ambiguous || value !== first || (second.raw && second.raw !== first.raw))
      warnings.push(reviewCopy.value);
    if (
      (!validUnit(unit) && !(unit === '' && unitlessName.test(name))) ||
      /[.-]$/.test(originalUnit)
    )
      warnings.push(reviewCopy.unit);
    if (!validRange(reference)) warnings.push(reviewCopy.reference);
    const secondRange = secondaryReference.text;
    if (originalReference && secondRange && reference !== secondRange)
      warnings.push(reviewCopy.reference);
    const secondUnit = normalizeUnit(join(inCell(secondary, 'unit')));
    if (originalUnit && secondUnit && unit !== secondUnit) warnings.push(reviewCopy.unit);
    const extraReferenceSpans = [...primaryReference.excluded, ...secondaryReference.excluded];
    if (extraReferenceSpans.some((s) => !/^[↑↓]$/.test(s.text)))
      warnings.push(reviewCopy.reference, reviewCopy.marker);
    const flagSpans = [
      ...inCell(row.spans, 'flag'),
      ...inCell(secondary, 'flag'),
      ...extraReferenceSpans,
    ];
    const flagText = join(flagSpans);
    const allFlags = new Set(
      [
        first.flag,
        second.flag,
        ...[...flagText].map((c) => (c === '↑' ? 'high' : c === '↓' ? 'low' : undefined)),
      ].filter(Boolean),
    );
    const reportFlag = allFlags.size === 1 ? ([...allFlags][0] as 'high' | 'low') : undefined;
    if (allFlags.size > 1 || /[^↑↓]/.test(flagText)) warnings.push(reviewCopy.marker);
    if (!/[\u3400-\u9fff]/.test(name) || nameSpans.some((s) => (s.confidence ?? 1) < 0.3))
      warnings.push(reviewCopy.name);
    const top = Math.max(
      table.top,
      row.center - row.height * 0.7,
      index ? (tableRows[index - 1]!.center + row.center) / 2 : 0,
    );
    const bottom = Math.min(
      table.bottom,
      row.center + row.height * 0.7,
      tableRows[index + 1] ? (tableRows[index + 1]!.center + row.center) / 2 : 1,
    );
    if (bottom <= top) continue;
    const region = { x: table.left, y: top, width: table.right - table.left, height: bottom - top };
    const retryRect = {
      x: valueCol.left,
      y: top,
      width: valueCol.right - valueCol.left,
      height: bottom - top,
    };
    observations.push({
      id: `p${page.pageIndex}-table-${table.top.toFixed(4)}-${table.left.toFixed(4)}-${index}`,
      name,
      originalName,
      code: '',
      rawValue: value.raw,
      originalValue: value.original,
      unit,
      originalUnit,
      reference,
      reportFlag,
      specimen: '',
      method: '',
      page: page.pageIndex,
      rect: bounds(row.spans),
      sourceRect: region,
      valueRect: retryRect.width <= 0.3 && retryRect.height <= 0.08 ? retryRect : undefined,
      needsReview: true,
      warnings: [...new Set(warnings)],
    });
  }
  // Short lab reports still need full columns and actual result/range pairs,
  // plus a report heading, patient and sampling/header date. Do not lower the default
  // threshold for anonymous fragments or reference-only tables.
  const evidence = observations.filter((o) => parseValue(o.rawValue) && validRange(o.reference));
  const shortReport =
    observations.length <= 2 &&
    evidence.length === observations.length &&
    evidence.length > 0 &&
    identifiedLabReport(page, table);
  return shortReport || evidence.length >= Math.max(3, observations.length * 0.65)
    ? observations
    : [];
}

function parseAlignedTable(page: LayoutPage): ParsedReport | null {
  if (page.spans.some((s) => !Object.values(s.rect).every(Number.isFinite))) return null;
  const candidates: { layout: Table; observations: Observation[] }[] = [];
  const variants = [page];
  if (page.tableSpans?.length)
    variants.push({ ...page, spans: page.tableSpans, numericSpans: page.spans });
  for (const variant of variants) {
    const layouts = tables(variant);
    for (const t of tables(variant, variant.numericSpans ?? [])) {
      if (!layouts.some((p) => Math.abs(p.top - t.top) < 0.03 && Math.abs(p.left - t.left) < 0.05))
        layouts.push(t);
    }
    for (const layout of layouts) {
      const observations = parseTable(variant, layout);
      if (!observations.length) continue;
      const existing = candidates.find(
        (p) =>
          Math.abs(p.layout.top - layout.top) < 0.03 &&
          Math.abs(p.layout.left - layout.left) < 0.05,
      );
      const score = (items: Observation[]) =>
        items.reduce(
          (n, o) => n + (parseValue(o.rawValue) ? 2 : 0) + (validRange(o.reference) ? 1 : 0),
          0,
        );
      if (!existing) candidates.push({ layout, observations });
      else if (score(observations) > score(existing.observations)) {
        existing.layout = layout;
        existing.observations = observations;
      }
    }
  }
  const observations = candidates
    .sort((a, b) =>
      Math.abs(a.layout.top - b.layout.top) < 0.03
        ? a.layout.left - b.layout.left
        : a.layout.top - b.layout.top,
    )
    .flatMap((c) => c.observations);
  if (!observations.length) return null;
  const { patient, date } = reportMetadata(page);
  return {
    title: `检验报告 · 第 ${page.pageIndex + 1} 页`,
    patient,
    date,
    dateKind: date ? 'sample' : 'unknown',
    sourcePage: page.pageIndex,
    extractionMethod: page.extractionMethod,
    template: 'lab-table-v1',
    observations,
    warnings: [
      reviewCopy.table,
      ...(!patient ? [reviewCopy.patient] : []),
      ...(!date ? [reviewCopy.date] : []),
      reviewCopy.specimen,
      reviewCopy.method,
    ],
  };
}

export function parseLabTable(page: LayoutPage): ParsedReport | null {
  const direct = parseAlignedTable(page);
  if (direct) return direct;
  const aligned = alignTiltedTable(page);
  if (!aligned) return null;
  const parsed = parseAlignedTable(aligned.page);
  if (!parsed) return null;
  return {
    ...parsed,
    observations: parsed.observations.map((o) => {
      const valueRect = o.valueRect && aligned.originalRect(o.valueRect);
      return {
        ...o,
        rect: o.rect && aligned.originalRect(o.rect),
        sourceRect: o.sourceRect && aligned.originalRect(o.sourceRect),
        valueRect: valueRect && valueRect.height <= 0.08 ? valueRect : undefined,
      };
    }),
  };
}
