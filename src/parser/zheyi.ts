import type { LayoutPage, Observation, Rect, Span } from '../domain/types';
import { parseValue, validDate } from '../domain/metrics';
import { reviewCopy } from '../domain/review-messages';
import { lines, union } from './layout';
import type { ParsedReport } from './index';
import { parseZheyiDate } from './zheyi-date';
import { normalizeConcentrationUnit } from '../domain/units';

const clean = (s: string) =>
  s.normalize('NFKC').replace(/\s+/g, '').replace(/紅/g, '红').replace(/細/g, '细');
const nameKey = (s: string) =>
  clean(s)
    .replace(/^\d+[.、]/, '')
    .replace(/[.。·]$/, '');
const cbcDefinitions = [
  ['白细胞计数', 'WBC', '10^9/L'],
  ['中性粒细胞(%)', 'NEUT_PERCENT', '%'],
  ['淋巴细胞(%)', 'LYMPH_PERCENT', '%'],
  ['单核细胞(%)', 'MONO_PERCENT', '%'],
  ['嗜酸性粒细胞(%)', 'EO_PERCENT', '%'],
  ['嗜碱性粒细胞(%)', 'BASO_PERCENT', '%'],
  ['中性粒细胞', 'NEUT', '10^9/L'],
  ['淋巴细胞', 'LYMPH', '10^9/L'],
  ['单核细胞', 'MONO', '10^9/L'],
  ['嗜酸性粒细胞', 'EO', '10^9/L'],
  ['嗜碱性粒细胞', 'BASO', '10^9/L'],
  ['红细胞计数', 'RBC', '10^12/L'],
  ['血红蛋白', 'HGB', 'g/L'],
  ['红细胞压积', 'HCT', '%'],
  ['平均红细胞体积', 'MCV', 'fL'],
  ['平均血红蛋白含量', 'MCH', 'pg'],
  ['平均血红蛋白浓度', 'MCHC', 'g/L'],
  ['红细胞分布宽度', 'RDW', '%'],
  ['血小板计数', 'PLT', '10^9/L'],
  ['血小板压积', 'PCT', '%'],
  ['血小板分布宽度', 'PDW', 'fL'],
  ['平均血小板体积', 'MPV', 'fL'],
  ['有核红细胞百分比', 'NRBC_PERCENT', '/100WBC'],
  ['超敏C反应蛋白', 'HSCRP', 'mg/L'],
] as const;
const chemistryDefinitions = [
  ['总蛋白', 'TP', 'g/L'],
  ['白蛋白', 'ALB', 'g/L'],
  ['球蛋白', 'GLOB', 'g/L'],
  ['白球蛋白比例', 'AG_RATIO', ''],
  ['谷丙转氨酶', 'ALT', 'U/L'],
  ['谷草转氨酶', 'AST', 'U/L'],
  ['谷草谷丙比值', 'AST_ALT_RATIO', ''],
  ['碱性磷酸酶', 'ALP', 'U/L'],
  ['胆碱酯酶', 'CHE', 'U/L'],
  ['总胆汁酸', 'TBA', 'μmol/L'],
  ['总胆红素', 'TBIL', 'μmol/L'],
  ['直接胆红素', 'DBIL', 'μmol/L'],
  ['间接胆红素', 'IBIL', 'μmol/L'],
  ['腺苷酸脱氨酶', 'ADA', 'U/L'],
  ['谷氨酰转肽酶', 'GGT', 'U/L'],
  ['肌酐', 'CREA', 'μmol/L'],
  ['尿素', 'UREA', 'mmol/L'],
  ['尿素氮/肌酐', 'BUN_CREA_RATIO', ''],
  ['尿酸', 'UA', 'μmol/L'],
  ['甘油三酯', 'TG', 'mmol/L'],
  ['总胆固醇', 'TC', 'mmol/L'],
  ['高密度脂蛋白-C', 'HDL_C', 'mmol/L'],
  ['低密度脂蛋白-C', 'LDL_C', 'mmol/L'],
  ['极低密度脂蛋白-C', 'VLDL_C', 'mmol/L'],
  ['空腹血糖', 'FPG', 'mmol/L'],
  ['钾', 'K', 'mmol/L'],
  ['钠', 'NA', 'mmol/L'],
  ['氯', 'CL', 'mmol/L'],
  ['总钙', 'CA', 'mmol/L'],
  ['无机磷', 'P', 'mmol/L'],
  ['磷酸肌酸激酶', 'CK', 'U/L'],
  ['肾小球滤过率', 'EGFR', 'ml/min'],
] as const;
const nameSuggestions: Record<string, string> = {
  '单枝细胞(%)': '单核细胞(%)',
  淋已细胞: '淋巴细胞',
  階酸性粒细胞: '嗜酸性粒细胞',
  乎均红细胞体积: '平均红细胞体积',
  乎均血红蛋白含量: '平均血红蛋白含量',
  平均血红蛋白會量: '平均血红蛋白含量',
  平均血小板休积: '平均血小板体积',
  谷草转氦酶: '谷草转氨酶',
};

function unitText(s: string): string {
  const unit = normalizeConcentrationUnit(clean(s));
  if (/^10(?:E|\^)?9\/L$/i.test(unit)) return '10^9/L';
  if (/^10(?:E|\^)?12\/L$/i.test(unit)) return '10^12/L';
  if (/^fl$/i.test(unit)) return 'fL';
  if (/^pg$/i.test(unit)) return 'pg';
  return unit;
}

export function zheyiCode(name: string, unit: string): string {
  for (const [kind, definitions] of [
    ['cbc', cbcDefinitions],
    ['chemistry', chemistryDefinitions],
  ] as const) {
    const def = definitions.find(
      ([label, , expected]) => label === nameKey(name) && expected === unit,
    );
    if (def) return `fahzu-yh:${kind}:${def[1]}`;
  }
  return '';
}

type Column = {
  name: [number, number];
  value: [number, number];
  range: [number, number];
  unit: [number, number];
};
const single: Column = {
  name: [0.05, 0.35],
  value: [0.36, 0.51],
  range: [0.59, 0.79],
  unit: [0.82, 0.97],
};
const double: Column[] = [
  { name: [0, 0.21], value: [0.215, 0.2715], range: [0.3, 0.411], unit: [0.415, 0.497] },
  { name: [0.5, 0.7], value: [0.71, 0.777], range: [0.79, 0.907], unit: [0.91, 1] },
];
// The biochemistry form starts its right-hand results slightly further left.
const chemistryColumns: Column[] = [
  { name: [0, 0.205], value: [0.205, 0.28], range: [0.3, 0.411], unit: [0.415, 0.497] },
  { name: [0.5, 0.695], value: [0.695, 0.777], range: [0.79, 0.907], unit: [0.91, 1] },
];
function inColumn(s: Span, [left, right]: [number, number]) {
  const x = s.rect.x + s.rect.width / 2;
  return x >= left && x < right;
}
function join(spans: Span[]): string {
  return clean(
    [...spans]
      .sort((a, b) => a.rect.x - b.rect.x)
      .map((s) => s.text)
      .join(''),
  );
}

export function parseZheyiPage(page: LayoutPage): ParsedReport | null {
  // Screenshots can crop away the blank bottom of an A4 report. Keep vertical
  // template distances relative to the unchanged page width, then return all
  // source regions in the original image coordinates used by previews/OCR.
  const scale = Math.min(1, page.height / ((page.width * 842) / 595));
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const normalize = (spans: Span[]) =>
    spans.map((s) => ({
      ...s,
      rect: { ...s.rect, y: s.rect.y * scale, height: s.rect.height * scale },
    }));
  const result = parseTemplatePage({
    ...page,
    spans: normalize(page.spans),
    numericSpans: page.numericSpans && normalize(page.numericSpans),
    cellSpans: page.cellSpans && normalize(page.cellSpans),
  });
  if (!result) return null;
  const restore = (rect: Rect): Rect => {
    const y = Math.max(0, Math.min(1, rect.y / scale));
    return { ...rect, y, height: Math.max(0, Math.min(1 - y, rect.height / scale)) };
  };
  return {
    ...result,
    observations: result.observations.map((o) => ({
      ...o,
      rect: o.rect && restore(o.rect),
      sourceRect: o.sourceRect && restore(o.sourceRect),
      valueRect: o.valueRect && restore(o.valueRect),
    })),
  };
}

function parseTemplatePage(page: LayoutPage): ParsedReport | null {
  const rows = lines(page);
  const text = rows.map((r) => clean(r.text).replace(/\|/g, '')).join('\n');
  const chemistry = text.includes('肝肾脂糖电解质测定');
  const kind = chemistry ? 'chemistry' : 'cbc';
  const definitions = chemistry ? chemistryDefinitions : cbcDefinitions;
  const rangeHeader = chemistry ? '参考区间' : '参考范围';
  if (
    !(page.extractionMethod === 'ocr'
      ? /浙江[大犬]学医学院附属第一医院/.test(text)
      : text.includes('浙江大学医学院附属第一医院')) ||
    !text.includes('余杭') ||
    (!chemistry && !/血常[规規]/.test(text))
  )
    return null;
  const header = rows.find(
    (r) =>
      r.rect.y < 0.2 &&
      clean(r.text).includes(rangeHeader) &&
      clean(r.text).includes('结果') &&
      clean(r.text).includes('单位'),
  );
  if (!header) return null;
  const dual = (header.text.match(/结果/g) ?? []).length === 2;
  if (chemistry && !dual) return null;
  const columns = chemistry ? chemistryColumns : dual ? double : [single];
  const top = header.rect.y + header.rect.height;
  // Fail closed if a superficially similar report moved its table columns.
  for (const col of columns) {
    const headerSpans = page.spans.filter((s) => Math.abs(s.rect.y - header.rect.y) < 0.015);
    if (
      !join(headerSpans.filter((s) => inColumn(s, col.range))).includes(rangeHeader) ||
      !join(headerSpans.filter((s) => inColumn(s, col.unit))).includes('单位')
    )
      return null;
  }
  const warnings: string[] = [];
  const patientRow = rows.find(
    (r) => r.rect.y < top && /姓名[:：]/.test(clean(r.text).replace(/\|/g, '')),
  );
  const patient = patientRow
    ? (clean(patientRow.text)
        .replace(/\|/g, '')
        .match(/姓名[:：]([^:：]+?)(?:年龄|性别|样本类型|$)/)?.[1] ?? '')
    : '';
  const reportDate = parseZheyiDate(page, header.rect.y);
  const { date } = reportDate;
  const blood = /样本类型[:：]?血液/.test(text.replace(/\n/g, ''));
  if (!patient) warnings.push(reviewCopy.patient);
  if (!validDate(date)) warnings.push(reviewCopy.date);
  if (!blood) warnings.push(reviewCopy.specimen);
  const observations: Observation[] = [];
  for (const col of columns) {
    const labelSpans = page.spans.filter(
      (s) => s.rect.y > top && s.rect.y < 0.9 && inColumn(s, col.name),
    );
    const labelRows = lines({ ...page, spans: labelSpans });
    for (const [rowIndex, row] of labelRows.entries()) {
      const originalName = nameKey(row.text.replace(/\|/g, ''));
      const name = nameSuggestions[originalName] ?? originalName;
      if (!name || /^[↑↓个亻\d.]+$/.test(name)) continue;
      const def = definitions.find(([label]) => label === name);
      const center = row.rect.y + row.rect.height / 2;
      const near = (s: Span) =>
        Math.abs(s.rect.y + s.rect.height / 2 - center) < Math.max(0.004, row.rect.height * 0.65);
      const primary = page.spans.filter(near);
      const aligned = page.numericSpans?.length ? page.numericSpans.filter(near) : primary;
      // This template prints WBC's arrow on a separate line; other left-hand
      // results are right-aligned before the adjacent flag column.
      const valueColumn: [number, number] =
        dual && col === double[0] && name === '白细胞计数' ? [0.215, 0.29] : col.value;
      const firstSpans = primary.filter((s) => inColumn(s, valueColumn));
      const secondarySpans = aligned.filter((s) => inColumn(s, valueColumn));
      const initialSpans = firstSpans.length ? firstSpans : secondarySpans;
      const cellSpans = (page.cellSpans ?? []).filter((s) => near(s) && inColumn(s, valueColumn));
      const usedCell = !join(initialSpans).replace(/[↑↓]/g, '') && cellSpans.length > 0;
      const valueSpans = usedCell ? cellSpans : initialSpans;
      let rawValue = join(valueSpans).replace(/[↑↓]/g, '');
      const primaryUnit = join(primary.filter((s) => inColumn(s, col.unit)));
      const secondaryUnit = join(aligned.filter((s) => inColumn(s, col.unit)));
      const originalUnit =
        def && unitText(secondaryUnit) === def[2] ? secondaryUnit : primaryUnit || secondaryUnit;
      let unit = unitText(originalUnit);
      const primaryReference = join(primary.filter((s) => inColumn(s, col.range)));
      const secondaryReference = join(aligned.filter((s) => inColumn(s, col.range)));
      const reference = (primaryReference || secondaryReference).replace(/[—–−~～]/g, '-');
      const itemWarnings: string[] = [];
      if (chemistry) {
        // A trailing nonnumeric glyph can be an OCR-misread report arrow. Keep
        // its direction unknown and require the user to check the original.
        const marked = rawValue.match(/^([<>≤≥]?[+-]?\d+(?:\.\d+)?)([+v])$/i);
        if (marked) {
          rawValue = marked[1]!;
          itemWarnings.push(reviewCopy.marker);
        }
        // This newly supported layout has only one validation sample. In
        // particular, an arrow can look like a trailing 1 even in both passes.
        itemWarnings.push(reviewCopy.item);
      }
      if (usedCell) itemWarnings.push(reviewCopy.value);
      const markerColumn: [number, number] = [valueColumn[0], col.range[0]];
      const markerSpans = [...primary, ...aligned].filter(
        (s) => inColumn(s, markerColumn) && /[↑↓]/.test(s.text),
      );
      // This verified layout places WBC's marker below its value. Stop before
      // the next label so a neighbouring result cannot donate its arrow.
      if (dual && col === double[0] && name === '白细胞计数') {
        const bottom = row.rect.y + row.rect.height;
        const end = Math.min(labelRows[rowIndex + 1]?.rect.y ?? bottom, bottom + 0.035);
        markerSpans.push(
          ...[...page.spans, ...(page.numericSpans ?? [])].filter(
            (s) =>
              /^[↑↓]$/.test(clean(s.text)) &&
              inColumn(s, valueColumn) &&
              s.rect.y >= bottom &&
              s.rect.y + s.rect.height <= end,
          ),
        );
      }
      const hasUp = markerSpans.some((s) => s.text.includes('↑'));
      const hasDown = markerSpans.some((s) => s.text.includes('↓'));
      const reportFlag = hasUp === hasDown ? undefined : hasUp ? 'high' : 'low';
      if (hasUp && hasDown) itemWarnings.push(reviewCopy.marker);
      if (markerSpans.some((s) => (s.confidence ?? 1) < 0.3)) itemWarnings.push(reviewCopy.marker);
      if (name !== originalName) itemWarnings.push(reviewCopy.name);
      const ambiguousMarker =
        dual &&
        col === double[0] &&
        name !== '白细胞计数' &&
        join(primary.filter((s) => inColumn(s, [valueColumn[1], col.range[0]])));
      if (ambiguousMarker && /\d/.test(ambiguousMarker)) itemWarnings.push(reviewCopy.marker);
      const secondValue = join(secondarySpans).replace(/[↑↓]/g, '');
      if (secondValue && rawValue && secondValue !== rawValue) {
        const markerJoined = ambiguousMarker && secondValue === rawValue + ambiguousMarker;
        if (!markerJoined) itemWarnings.push(reviewCopy.value);
      }
      if (primaryReference && secondaryReference && primaryReference !== secondaryReference)
        itemWarnings.push(reviewCopy.reference);
      if (primaryUnit && secondaryUnit && unitText(primaryUnit) !== unitText(secondaryUnit))
        itemWarnings.push(reviewCopy.unit);
      if (!rawValue && !reference && !originalUnit) continue;
      if (!def) itemWarnings.push(reviewCopy.name);
      if (!parseValue(rawValue)) itemWarnings.push(reviewCopy.missingValue);
      if (def?.[2] === 'fL' && ['f1', '£1', '£l', '£L'].includes(unit)) {
        unit = 'fL';
        itemWarnings.push(reviewCopy.suggestedUnit);
      }
      if (
        (def?.[2] === 'μmol/L' && /^(?:w|H|u|μ)mo[1l]\/L$/.test(unit)) ||
        (def?.[2] === 'ml/min' && unit === 'm1/min')
      ) {
        unit = def[2];
        itemWarnings.push(reviewCopy.suggestedUnit);
      }
      if (def && def[2] && !unit) {
        unit = def[2];
        itemWarnings.push(reviewCopy.suggestedUnit);
      }
      if (def && unit !== def[2]) itemWarnings.push(reviewCopy.unit);
      if (!reference || !/^[<>≤≥]?\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?$/.test(reference))
        itemWarnings.push(reviewCopy.reference);
      if (
        valueSpans.some(
          (s) =>
            (s.confidence ?? 1) < 0.3 ||
            (s.text.length > 1 && s.rect.x + s.rect.width > valueColumn[1] + 0.002),
        )
      )
        itemWarnings.push(reviewCopy.marker);
      const rects = [...valueSpans.map((s) => s.rect), row.rect];
      const printed = [...primary, ...aligned, ...markerSpans].filter((s) =>
        inColumn(s, [col.name[0], col.unit[1]]),
      );
      const printedBox = [...printed.map((s) => s.rect), row.rect].reduce(union);
      const previous = labelRows[rowIndex - 1]?.rect;
      const next = labelRows[rowIndex + 1]?.rect;
      const halfHeight = Math.min(0.025, Math.max(0.006, row.rect.height * 0.8));
      const cellTop = Math.max(
        0,
        center - halfHeight,
        previous ? (center + previous.y + previous.height / 2) / 2 : 0,
      );
      const cellBottom = Math.min(
        1,
        center + halfHeight,
        next ? (center + next.y + next.height / 2) / 2 : 1,
      );
      const sourceTop = Math.max(
        0,
        previous ? previous.y + previous.height : 0,
        printedBox.y - 0.003,
      );
      // The printed WBC arrow can be below the value even when OCR misses it.
      // Preview geometry must include that space independently of recognition.
      const printedBottom = Math.max(
        printedBox.y + printedBox.height + 0.003,
        dual && col === double[0] && name === '白细胞计数'
          ? row.rect.y + row.rect.height + 0.035
          : 0,
      );
      const sourceBottom = Math.min(1, next?.y ?? 1, printedBottom);
      observations.push({
        id: `p${page.pageIndex}-${observations.length}`,
        name: def?.[0] ?? name,
        code: def && unit === def[2] ? `fahzu-yh:${kind}:${def[1]}` : '',
        rawValue,
        originalValue: rawValue,
        originalName,
        originalUnit,
        reportFlag,
        unit,
        reference,
        specimen: blood ? 'blood' : '',
        method: `not-reported:fahzu-yuhang-${kind}`,
        page: page.pageIndex,
        rect: rects.reduce(union),
        sourceRect: {
          x: col.name[0],
          y: sourceTop,
          width: col.unit[1] - col.name[0],
          height: sourceBottom - sourceTop,
        },
        valueRect: def
          ? {
              x: valueColumn[0],
              y: cellTop,
              width: valueColumn[1] - valueColumn[0],
              height: cellBottom - cellTop,
            }
          : undefined,
        needsReview: itemWarnings.length > 0,
        warnings: itemWarnings,
      });
    }
  }
  if (!observations.length) return null;
  if (page.extractionMethod === 'ocr') warnings.push(reviewCopy.report);
  warnings.push(reviewCopy.method);
  return {
    title: chemistry ? '生化检验报告 · 浙一余杭' : '血常规检验报告 · 浙一余杭',
    patient,
    ...reportDate,
    sourcePage: page.pageIndex,
    extractionMethod: page.extractionMethod,
    template: chemistry
      ? 'fahzu-yh-chemistry-double-v1'
      : dual
        ? 'fahzu-yh-cbc-double-v3'
        : 'fahzu-yh-cbc-single-v3',
    warnings,
    observations,
  };
}
