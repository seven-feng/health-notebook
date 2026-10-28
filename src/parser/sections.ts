import type { LayoutPage, Observation, Rect, Span } from '../domain/types';
import type { ParsedReport } from './index';
import { parseValue, validDate } from '../domain/metrics';
import { reviewCopy } from '../domain/review-messages';
import { bounds, cx, cy, median } from './layout';
import { isTableMetadata } from './table-metadata';
import { normalizeConcentrationUnit } from '../domain/units';

// Geometry, labels and document identity establish a table; a hospital name or
// a particular test/value never establishes its layout.
const radicals: Record<string, string> = { '⻔': '门', '⻆': '角', '⻅': '见', '⻬': '齐' };
export const normalizedText = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[⻔⻆⻅⻬]/g, (c) => radicals[c]!)
    .replace(/\s+/g, '');
type Line = { spans: Span[]; rect: Rect; text: string };
function lines(spans: Span[]): Line[] {
  const groups: Span[][] = [];
  const usable = spans.filter((s) => s.text.trim() && Object.values(s.rect).every(Number.isFinite));
  const height = median(usable.map((s) => s.rect.height));
  const core = usable.filter((s) => s.rect.height >= height * 0.6);
  for (const s of core.sort((a, b) => cy(a) - cy(b) || a.rect.x - b.rect.x)) {
    const last = groups.at(-1);
    if (
      last &&
      Math.abs(median(last.map(cy)) - cy(s)) <
        Math.max(0.002, Math.min(median(last.map((v) => v.rect.height)), s.rect.height) * 0.65)
    )
      last.push(s);
    else groups.push([s]);
  }
  // PDFium uses ink boxes: decimal points, dashes and colons can be much
  // shorter and lower than the neighboring digits. Attach to a stable baseline.
  for (const s of usable.filter((s) => s.rect.height < height * 0.6)) {
    const nearest = [...groups].sort(
      (a, b) => Math.abs(median(a.map(cy)) - cy(s)) - Math.abs(median(b.map(cy)) - cy(s)),
    )[0];
    if (nearest && Math.abs(median(nearest.map(cy)) - cy(s)) < height * 0.9) nearest.push(s);
    else groups.push([s]);
  }
  return groups.map((ss) => {
    ss.sort((a, b) => a.rect.x - b.rect.x);
    return { spans: ss, rect: bounds(ss), text: normalizedText(ss.map((s) => s.text).join('')) };
  });
}
const text = (ss: Span[]) =>
  lines(ss)
    .map((l) => l.text)
    .join('');
const originalText = (ss: Span[]) =>
  lines(ss)
    .map((l) => l.spans.map((s) => s.text).join(''))
    .join('')
    .replace(/\s+/g, '');
type Role = 'name' | 'value' | 'unit' | 'reference' | 'code' | 'flag' | 'note';
type Column = { role: Role; rect: Rect; left: number; right: number };
type Header = { page: number; rect: Rect; columns: Column[] };
type Identity = {
  patient: string;
  number: string;
  date: string;
  dateKind: 'sample' | 'report' | 'exam' | 'unknown';
};
type Section = {
  report: ParsedReport;
  header: Header;
  identity: Identity;
  lastPage: number;
  open: boolean;
};
const endPattern =
  /^(?:小结|初步意[见⻅]|结论|检查所[见⻅]|建议|温馨提示|注[:：]|备注[:：]|\d+[.、].*(?:增高|降低))/;
const contextPattern = /^(?:检查者|操作者|审核者|检验者|报告者)(?:[:：]|$)/;
const excludedTitle = /参考|说明|介绍|科普|建议|目录|汇总|注意|解读/;
function titleOf(line: Line): string | null {
  const ss = line.spans;
  let last = ss[0];
  const chunk: Span[] = [];
  for (const s of ss) {
    if (last && s.rect.x - (last.rect.x + last.rect.width) > 0.035) break;
    chunk.push(s);
    last = s;
  }
  const name = normalizedText(chunk.map((s) => s.text).join(''));
  if (
    !name ||
    name.length > 28 ||
    excludedTitle.test(name) ||
    contextPattern.test(name) ||
    endPattern.test(name)
  )
    return null;
  // A title must be a stand-alone label, not a value, reference range or prose.
  if (/[:：。，；]/.test(name) || !/[\u3400-\u9fff]/.test(name) || /项目.*结果/.test(name))
    return null;
  const tail = normalizedText(
    ss
      .slice(chunk.length)
      .map((s) => s.text)
      .join(''),
  );
  return !tail || contextPattern.test(tail) ? name : null;
}
function readHeader(line: Line, page: number): Header | null {
  const chars = line.spans.flatMap((s) => [...normalizedText(s.text)].map((c) => ({ c, s })));
  const value = chars.map((c) => c.c).join('');
  const pattern =
    /检查项目|检验项目|检测项目|项目名称|项目|测量结果|检测结果|检验结果|测定值|结果|参考区间|参考范围|参考值|单位|缩写|代码|代号|提示|标志|异常描述|备注/g;
  const fields = [...value.matchAll(pattern)].map((m) => ({
    role: (/项目/.test(m[0])
      ? 'name'
      : /结果|测定/.test(m[0])
        ? 'value'
        : /^参考/.test(m[0])
          ? 'reference'
          : m[0] === '单位'
            ? 'unit'
            : /缩写|代码|代号/.test(m[0])
              ? 'code'
              : m[0] === '备注'
                ? 'note'
                : 'flag') as Role,
    rect: bounds(chars.slice(m.index, m.index + m[0].length).map((c) => c.s)),
  }));
  if (
    !['name', 'value'].every((role) => fields.filter((f) => f.role === role).length === 1) ||
    fields.length < 3
  )
    return null;
  if (!fields.some((f) => f.role === 'reference' || f.role === 'unit')) return null;
  if (new Set(fields.map((f) => f.role)).size !== fields.length) return null; // ambiguous/two-column tables use the existing parser
  if (
    fields.find((f) => f.role === 'name')!.rect.x >= fields.find((f) => f.role === 'value')!.rect.x
  )
    return null;
  return {
    page,
    rect: line.rect,
    columns: fields.map((f, i) => ({
      ...f,
      left: i
        ? (fields[i - 1]!.rect.x + fields[i - 1]!.rect.width + f.rect.x) / 2
        : Math.max(0, f.rect.x - 0.025),
      right:
        i + 1 < fields.length
          ? (f.rect.x + f.rect.width + fields[i + 1]!.rect.x) / 2
          : Math.min(1, line.rect.x + line.rect.width + 0.08),
    })),
  };
}
function identity(ls: Line[]): Identity {
  const t = ls.map((l) => l.text).join('\n');
  const separated = ls
    .map((l) =>
      l.spans
        .map(
          (s, i) =>
            (i && s.rect.x - (l.spans[i - 1]!.rect.x + l.spans[i - 1]!.rect.width) > 0.025
              ? '|'
              : '') + normalizedText(s.text),
        )
        .join(''),
    )
    .join('\n');
  const patient =
    t.match(/(?:姓名|受检者)[:：]([^\n:：]+?)(?=性别|年龄|体检|报告|$)/m)?.[1] ??
    separated.match(/(?:^|[|\n])([\u3400-\u9fff]{2,8})(?:女士|先生)\|?用[户戶]ID/)?.[1] ??
    '';
  const number = t.match(/(?:体检号|报告编号|报告单号|检验单号)[:：]?([\dA-Za-z-]{3,})/)?.[1] ?? '';
  const dateMatch = t.match(
    /(体检日期|检查日期|采样日期|采集日期|报告日期|采样时间|采集时间|报告时间)[:：]?(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/,
  );
  const date = dateMatch
    ? `${dateMatch[2]}-${dateMatch[3]!.padStart(2, '0')}-${dateMatch[4]!.padStart(2, '0')}`
    : '';
  return {
    patient,
    number,
    date: validDate(date) ? date : '',
    dateKind: !validDate(date)
      ? 'unknown'
      : /采样|采集/.test(dateMatch![1]!)
        ? 'sample'
        : /报告/.test(dateMatch![1]!)
          ? 'report'
          : 'exam',
  };
}
function conflict(a: Identity, b: Identity) {
  return (
    (a.patient && b.patient && a.patient !== b.patient) ||
    (a.number && b.number && a.number !== b.number) ||
    (a.date && b.date && a.date !== b.date)
  );
}
export function resultKind(value: string): Observation['resultKind'] {
  const v = value.normalize('NFKC').trim();
  if (!v) return 'missing';
  const number = parseValue(v);
  if (number) return number.operator === '=' ? 'numeric' : 'qualified';
  return /^(?:阴性|阳性|弱阳性|弱阴性|阴性\(-\)|阳性\(\+\)|[+±-]{1,4})$/.test(v)
    ? 'qualitative'
    : 'text';
}
function cell(ss: Span[], column: Column | undefined) {
  return column ? ss.filter((s) => cx(s) >= column.left && cx(s) < column.right) : [];
}
function numericRuns(spans: Span[]): string[] {
  const runs: Span[][] = [];
  for (const s of [...spans].sort((a, b) => a.rect.x - b.rect.x)) {
    const last = runs.at(-1)?.at(-1);
    if (!last || s.rect.x - (last.rect.x + last.rect.width) > Math.max(0.015, s.rect.height))
      runs.push([s]);
    else runs.at(-1)!.push(s);
  }
  return runs
    .map(text)
    .map((v) => v.replace(/[↑↓]/g, ''))
    .filter((v) => parseValue(v));
}
// Header labels are usually left-aligned. Locate the actual vertical gutter
// from blank space between columns instead of cutting long names in half.
function refine(header: Header, spans: Span[]): Header {
  const columns = header.columns.map((c) => ({ ...c }));
  for (let i = 1; i < columns.length; i++) {
    const previous = columns[i - 1]!,
      current = columns[i]!;
    const from = previous.rect.x + previous.rect.width,
      to = current.rect.x;
    if (to <= from) continue;
    const preferred = to - 0.008;
    const points = Array.from({ length: 41 }, (_, j) => from + ((to - from) * j) / 40);
    const cost = (x: number) =>
      spans.filter((s) => s.rect.x < x + 0.001 && s.rect.x + s.rect.width > x - 0.001).length +
      Math.abs(x - preferred);
    const cut = points.sort((a, b) => cost(a) - cost(b))[0]!;
    previous.right = cut;
    current.left = cut;
  }
  return { ...header, columns };
}
function readRows(page: LayoutPage, header: Header, top: number, bottom: number): Observation[] {
  const ss = page.spans.filter(
    (s) =>
      cy(s) > top &&
      cy(s) < bottom &&
      s.text.trim() &&
      !/^[A-F\d]{40,}$/.test(normalizedText(s.text)),
  );
  const h = refine(header, ss);
  const col = (role: Role) => h.columns.find((c) => c.role === role);
  const valueLines = lines(cell(ss, col('value'))).filter((l) => {
    const k = resultKind(l.text.replace(/[↑↓]/g, ''));
    return (
      (k === 'numeric' ||
        k === 'qualified' ||
        k === 'qualitative' ||
        (/^[\u3400-\u9fffⅠⅡⅢⅣIV度\d()（）+-]+$/.test(l.text) && l.text.length <= 30)) &&
      !endPattern.test(l.text)
    );
  });
  for (const line of lines(ss)) {
    if (
      text(cell(line.spans, col('value')))
        .replace(/[↑↓]/g, '')
        .trim() ||
      !cell(line.spans, col('name')).length ||
      (!cell(line.spans, col('reference')).length && !cell(line.spans, col('unit')).length)
    )
      continue;
    const center = line.rect.y + line.rect.height / 2;
    if (
      valueLines.some(
        (l) =>
          Math.abs(l.rect.y + l.rect.height / 2 - center) <
          Math.max(l.rect.height, line.rect.height) * 0.9,
      )
    )
      continue;
    if (endPattern.test(line.text) || contextPattern.test(line.text)) continue;
    valueLines.push({ spans: [], text: '', rect: line.rect });
  }
  valueLines.sort((a, b) => a.rect.y + a.rect.height / 2 - b.rect.y - b.rect.height / 2);
  if (!valueLines.length) return [];
  const centers = valueLines.map((l) => l.rect.y + l.rect.height / 2);
  const typical =
    median(centers.slice(1).map((c, i) => c - centers[i]!)) ||
    Math.max(valueLines[0]!.rect.height * 2.8, 0.025);
  const result: Observation[] = [];
  for (let i = 0; i < valueLines.length; i++) {
    const center = centers[i]!;
    const from = Math.max(top, i ? (centers[i - 1]! + center) / 2 : center - typical / 2);
    const to = Math.min(
      bottom,
      i + 1 < centers.length ? (center + centers[i + 1]!) / 2 : center + typical / 2,
    );
    const region = ss.filter((s) => cy(s) >= from && cy(s) < to);
    // Digits can be part of the medical name (for example 1.25…); only strip
    // explicit decoration, never a presumed row number inside the same text.
    const name = text(cell(region, col('name'))).replace(/^[★☆*•]+/, '');
    if (
      !name ||
      name.length > 80 ||
      endPattern.test(name) ||
      contextPattern.test(name) ||
      /报告|日期|签名|参考|注[:：]/.test(name)
    )
      continue;
    const rowText = text(
      region.filter((s) => cx(s) >= h.columns[0]!.left && cx(s) < h.columns.at(-1)!.right),
    );
    if (isTableMetadata(name, rowText)) continue;
    const primaryValue = originalText(cell(region, col('value')));
    let originalValue = primaryValue;
    let rawValue = normalizedText(originalValue).replace(/[↑↓]/g, '');
    const primaryNumbers = numericRuns(cell(region, col('value')));
    const ambiguousValue = primaryNumbers.length > 1;
    if (ambiguousValue) rawValue = primaryNumbers.join(' ');
    const retrySpans = cell(
      (page.cellSpans ?? []).filter((s) => cy(s) >= from && cy(s) < to),
      col('value'),
    );
    const retryText = text(retrySpans).replace(/[↑↓]/g, '');
    const clearRetry =
      lines(retrySpans).length === 1 &&
      numericRuns(retrySpans).length === 1 &&
      !!parseValue(retryText);
    const usedRetry = !rawValue && clearRetry;
    if (usedRetry) {
      rawValue = retryText;
      originalValue = originalText(retrySpans);
    }
    const printedFlag = text(cell(region, col('flag')));
    const flags = printedFlag + primaryValue + originalValue;
    const up = flags.includes('↑'),
      down = flags.includes('↓');
    const unit = normalizeConcentrationUnit(text(cell(region, col('unit')))),
      reference = text(cell(region, col('reference')));
    const rowRect = bounds(region);
    const warnings: string[] = [reviewCopy.item];
    if ((up && down) || /[^↑↓]/.test(printedFlag)) warnings.push(reviewCopy.marker);
    if (
      ambiguousValue ||
      usedRetry ||
      (retrySpans.length && (!clearRetry || retryText !== rawValue))
    )
      warnings.push(reviewCopy.value);
    if (!rawValue) warnings.push(reviewCopy.missingValue);
    if (cell(region, col('name')).some((s) => (s.confidence ?? 1) < 0.5))
      warnings.push(reviewCopy.name);
    if (cell(region, col('value')).some((s) => (s.confidence ?? 1) < 0.5))
      warnings.push(reviewCopy.value);
    const alternate = text(
      cell(
        (page.numericSpans ?? []).filter((s) => cy(s) >= from && cy(s) < to),
        col('value'),
      ),
    ).replace(/[↑↓]/g, '');
    if (alternate && parseValue(alternate) && alternate !== rawValue)
      warnings.push(reviewCopy.value);
    // A text extraction cannot establish that a graphic marker cell is empty.
    const markerUnread = !!col('flag') && page.extractionMethod === 'text' && !up && !down;
    const valueCol = col('value')!;
    result.push({
      id: `section-p${page.pageIndex}-${header.page}-${header.rect.y.toFixed(4)}-${i}`,
      name,
      originalName: originalText(cell(region, col('name'))),
      code: '',
      rawValue,
      originalValue,
      unit,
      originalUnit: originalText(cell(region, col('unit'))),
      reference,
      specimen: '',
      method: '',
      page: page.pageIndex,
      resultKind: resultKind(rawValue),
      headerSource: { page: header.page, rect: header.rect },
      rect: rowRect,
      sourceRect: {
        x: h.columns[0]!.left,
        y: from,
        width: h.columns.at(-1)!.right - h.columns[0]!.left,
        height: to - from,
      },
      valueRect: {
        x: valueCol.left,
        y: from,
        width: valueCol.right - valueCol.left,
        height: to - from,
      },
      reportFlag: up !== down ? (up ? 'high' : 'low') : undefined,
      markerStatus: markerUnread ? 'unavailable' : 'read',
      needsReview: true,
      warnings,
    });
  }
  return result;
}

export function parseSections(pages: LayoutPage[]): ParsedReport[] {
  const sections: Section[] = [];
  let active: Section | undefined;
  let context: Identity = { patient: '', number: '', date: '', dateKind: 'unknown' };
  let previousPage = -2;
  for (const page of [...pages].sort((a, b) => a.pageIndex - b.pageIndex)) {
    const all = lines(page.spans);
    // Repeated header/footer bands are not body rows. Do not remove recurring
    // test names: only page margins and explicit metadata are excluded.
    const body = all.filter(
      (l) =>
        l.rect.y >= 0.075 && l.rect.y + l.rect.height <= 0.925 && !/^[A-F\d]{35,}$/.test(l.text),
    );
    const headers = body
      .map((l, i) => ({ header: readHeader(l, page.pageIndex), i }))
      .filter((v) => v.header !== null);
    const boundaries = body.filter((l) => endPattern.test(l.text) || /检查所[见⻅]/.test(l.text));
    const starts = headers.map(({ header, i }) => {
      let title: string | null = null;
      let titleTop: number | undefined;
      for (let j = i - 1; j >= 0 && i - j <= 3; j--) {
        const l = body[j]!;
        if (
          contextPattern.test(l.text) ||
          /^(?:姓名|受检者|报告编号|体检号|检查日期|体检日期|采样日期|采集日期|报告日期|采样时间|采集时间|报告时间)[:：]/.test(
            l.text,
          )
        )
          continue;
        title = titleOf(l);
        if (title) titleTop = l.rect.y;
        break;
      }
      return { header: header!, title, titleTop, index: i };
    });
    const current = identity(
      all.filter((l) => l.rect.y < (starts[0]?.titleTop ?? starts[0]?.header.rect.y ?? 1)),
    );
    const clash = conflict(context, current);
    if (clash || page.pageIndex !== previousPage + 1) {
      active = undefined;
      context = current;
    } else
      context = {
        patient: current.patient || context.patient,
        number: current.number || context.number,
        date: current.date || context.date,
        dateKind: current.date ? current.dateKind : context.dateKind,
      };
    previousPage = page.pageIndex;
    const repeated = starts[0];
    let repeatedHeader = false;
    if (
      active?.open &&
      active.lastPage === page.pageIndex - 1 &&
      !conflict(active.identity, current) &&
      (active.identity.patient || active.identity.number) &&
      repeated &&
      repeated.header.rect.y < 0.25 &&
      (!repeated.title || repeated.title === active.report.title) &&
      repeated.header.columns.length === active.header.columns.length &&
      repeated.header.columns.every(
        (c, i) =>
          c.role === active!.header.columns[i]!.role &&
          Math.abs(c.rect.x - active!.header.columns[i]!.rect.x) < 0.025,
      ) &&
      !boundaries.some((l) => l.rect.y < repeated.header.rect.y)
    ) {
      const top = repeated.header.rect.y + repeated.header.rect.height;
      const end = boundaries.find((l) => l.rect.y > top);
      const next = starts[1];
      const bottom = Math.min(
        end?.rect.y ?? 0.925,
        next ? body[Math.max(0, next.index - 2)]!.rect.y : 0.925,
      );
      const rows = readRows(page, repeated.header, top, bottom);
      if (rows.length) {
        active.report.observations.push(...rows);
        active.report.sourcePages!.push(page.pageIndex);
        active.header = repeated.header;
        active.lastPage = page.pageIndex;
        active.open = !end && !next;
        repeatedHeader = true;
      }
    }
    // Continue only the immediately preceding table, with an established
    // identity and fresh rows at matching normalized column positions.
    if (
      !repeatedHeader &&
      active?.open &&
      active.lastPage === page.pageIndex - 1 &&
      !conflict(active.identity, current) &&
      (active.identity.patient || active.identity.number)
    ) {
      const stop = Math.min(
        starts[0] ? body[Math.max(0, starts[0].index - 2)]!.rect.y : 0.925,
        boundaries[0]?.rect.y ?? 0.925,
      );
      const first = body[0];
      const firstTitle = first && titleOf(first);
      const rows = firstTitle ? [] : readRows(page, active.header, 0.075, stop);
      if (rows.length && rows[0]!.sourceRect!.y < 0.2) {
        active.report.observations.push(...rows);
        active.report.sourcePages!.push(page.pageIndex);
        active.lastPage = page.pageIndex;
        active.open = !boundaries.some((l) => l.rect.y < (starts[0]?.header.rect.y ?? 1));
      } else active = undefined;
    } else if (!repeatedHeader) active = undefined;
    for (const [i, start] of starts.entries()) {
      if (i === 0 && repeatedHeader) continue;
      active = undefined;
      if (!start.title || excludedTitle.test(start.title)) continue;
      const top = start.header.rect.y + start.header.rect.height;
      const next = starts[i + 1];
      const nextTop = next ? body[Math.max(0, next.index - 2)]!.rect.y : 0.925;
      const end = boundaries.find((l) => l.rect.y > top);
      const bottom = Math.min(nextTop, end?.rect.y ?? 0.925);
      if (bottom <= top) continue;
      const observations = readRows(page, start.header, top, bottom);
      // Keep a header-only section only if it is genuinely at the page foot.
      if (!observations.length && top < 0.8) continue;
      const local = identity(
        body.filter((l) => l.rect.y >= (start.titleTop ?? top) && l.rect.y < start.header.rect.y),
      );
      const sectionIdentity: Identity = {
        patient: local.patient || context.patient,
        number: local.number || context.number,
        date: local.date || context.date,
        dateKind: local.date ? local.dateKind : context.dateKind,
      };
      const section: Section = {
        header: start.header,
        identity: sectionIdentity,
        lastPage: page.pageIndex,
        open: !end && !next,
        report: {
          title: start.title,
          patient: sectionIdentity.patient,
          date: sectionIdentity.date,
          dateKind: sectionIdentity.dateKind,
          template: 'section-table-v1',
          sourcePage: page.pageIndex,
          sourcePages: [page.pageIndex],
          sectionKey: `p${page.pageIndex}-y${Math.round(start.header.rect.y * 1000)}-${start.title}`,
          extractionMethod: page.extractionMethod,
          observations,
          warnings: [
            reviewCopy.table,
            ...(!sectionIdentity.patient ? [reviewCopy.patient] : []),
            ...(!sectionIdentity.date ? [reviewCopy.date] : []),
            reviewCopy.specimen,
            reviewCopy.method,
          ],
        },
      };
      sections.push(section);
      active = section;
    }
    if (
      active &&
      boundaries.some((l) => l.rect.y > active!.header.rect.y) &&
      active.lastPage === active.header.page
    )
      active.open = false;
  }
  return sections.filter((s) => s.report.observations.length).map((s) => s.report);
}
