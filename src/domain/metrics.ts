import { Decimal } from 'decimal.js';
import type {
  MetricGroup,
  MetricSeries,
  Observation,
  ParsedValue,
  Report,
  TextMetricSeries,
  UntrendedResult,
} from './types';
import { hasMetricDefinition, matchMetric, unmatchedReason } from './metric-matching';

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function parseValue(raw: string): ParsedValue {
  const m = raw
    .trim()
    .replace('≤', '<=')
    .replace('≥', '>=')
    .match(/^(<=|>=|<|>)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/);
  if (!m?.[2]) return null;
  try {
    const n = new Decimal(m[2]);
    if (!n.isFinite() || n.abs().gt('1e20')) return null;
    return { operator: (m[1] ?? '=') as NonNullable<ParsedValue>['operator'], value: n.toString() };
  } catch {
    return null;
  }
}
export function seriesKey(o: Observation): string | null {
  // Unmapped manual names do not establish medical equivalence.
  if (!o.code || !o.unit || !o.specimen || !o.method || o.needsReview) return null;
  return JSON.stringify([o.code, o.unit, o.specimen, o.method]);
}

function isTextResult(raw: string): boolean {
  const text = raw.normalize('NFKC').replace(/\s/g, '');
  // Qualitative symbols and prose are valid results. A malformed number or
  // exponent alone must not silently become a text history.
  return /\p{L}/u.test(text.replace(/[eE]/g, '')) || /^(?:\(?[+±−-]{1,4}\)?|[1-4]\+)$/.test(text);
}

function textSeriesKey(report: Report, o: Observation, sourceKey: string): string {
  const normalized = (text: string) => text.normalize('NFKC').replace(/\s/g, '');
  const title = normalized(report.title),
    name = normalized(o.name);
  // Generic report/page titles do not identify a test category. Keep those
  // sources separate; exact names alone cannot establish equivalent tests.
  const hasContext =
    name &&
    title &&
    !/^(?:报告|检验报告|体检报告|检查报告|实验室检查)(?:[·・]?第\d+页)?$/.test(title);
  return JSON.stringify([
    report.memberId,
    'text',
    ...(hasContext
      ? [title, name, o.code, normalized(o.unit), normalized(o.specimen), normalized(o.method)]
      : [sourceKey]),
  ]);
}

export function buildMetricData(reports: Report[]): {
  groups: MetricGroup[];
  untrended: UntrendedResult[];
} {
  const groups = new Map<string, MetricSeries>();
  const textGroups = new Map<string, TextMetricSeries>();
  const untrended: UntrendedResult[] = [];
  const identities = new Map<string, Set<string>>();
  const contexts = new Map<string, string>();
  const seen = new Set<string>();
  for (const r of reports) {
    if (r.status !== 'confirmed' || r.reportType === 'imaging') continue;
    for (const o of r.observations) {
      const sourceKey = JSON.stringify([r.memberId, r.id, o.id]);
      if (seen.has(sourceKey)) continue;
      seen.add(sourceKey);
      const value = parseValue(o.rawValue);
      const textResult = !value && isTextResult(o.rawValue);
      const reasons = [
        !r.memberId && '缺少成员归属',
        !r.patient.trim() && '缺少报告姓名',
        !validDate(r.date) && '日期缺失或无效',
        o.needsReview && '这项结果仍需核对',
        !value && !textResult
          ? o.rawValue.trim()
            ? '非精确数值，保留原结果'
            : '结果缺失'
          : value && value.operator !== '=' && '带有限定符，不能当作精确数值',
      ].filter((reason): reason is string => !!reason);
      if (reasons.length) {
        untrended.push({
          key: sourceKey,
          reportId: r.id,
          name: o.name,
          rawValue: o.rawValue,
          unit: o.unit,
          reference: o.reference,
          date: r.date,
          reportTitle: r.title,
          reasons,
        });
        continue;
      }
      const point = {
        reportId: r.id,
        observationId: o.id,
        date: r.date,
        rawValue: o.rawValue,
        reference: o.reference,
        sourceName: o.name,
        sourceUnit: o.unit,
        reportTitle: r.title,
      };
      if (textResult) {
        const key = textSeriesKey(r, o, sourceKey);
        const group: TextMetricSeries = textGroups.get(key) ?? {
          kind: 'text',
          key,
          name: o.name,
          unit: o.unit,
          points: [],
          separationLabel: [
            r.title,
            o.specimen,
            o.method.startsWith('not-reported:') ? '' : o.method,
          ]
            .filter(Boolean)
            .join(' · '),
        };
        group.points.push(point);
        textGroups.set(key, group);
        continue;
      }
      if (!value) continue;
      const matched = matchMetric(r, o);
      const legacy =
        matched || (o.code.startsWith('fahzu-yh:') && hasMetricDefinition(o.name))
          ? null
          : seriesKey(o);
      const key = JSON.stringify([r.memberId, matched?.key ?? legacy ?? sourceKey]);
      const identity = JSON.stringify([
        r.memberId,
        matched?.identity ?? (legacy ? o.code : sourceKey),
      ]);
      const group = groups.get(key) ?? {
        key,
        name: matched?.name ?? o.name,
        unit: matched?.unit ?? o.unit,
        points: [],
        comparisonNote: matched ? matched.note : legacy ? undefined : unmatchedReason(r, o),
        ...(!matched && !legacy ? { separationLabel: `单独展示 · ${r.title}` } : {}),
      };
      group.points.push({ ...point, value: value.value });
      groups.set(key, group);
      const variants = identities.get(identity) ?? new Set<string>();
      variants.add(key);
      identities.set(identity, variants);
      contexts.set(key, matched?.context ?? [o.specimen, o.method].filter(Boolean).join(' · '));
    }
  }
  for (const variants of identities.values()) {
    if (variants.size < 2) continue;
    for (const key of variants) {
      const group = groups.get(key)!;
      group.separationLabel = contexts.get(key);
      group.comparisonNote = [group.comparisonNote, '单位、标本或检测方法不同的结果已分开显示。']
        .filter(Boolean)
        .join(' ');
    }
  }
  const histories: MetricGroup[] = [...groups.values(), ...textGroups.values()];
  for (const group of histories)
    group.points.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.reportId.localeCompare(b.reportId) ||
        a.observationId.localeCompare(b.observationId),
    );
  return {
    groups: histories,
    untrended: untrended.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key)),
  };
}
export function buildSeries(reports: Report[]): MetricSeries[] {
  return buildMetricData(reports).groups.filter((g): g is MetricSeries => g.kind !== 'text');
}
export function delta(series: MetricSeries): string | null {
  const a = series.points.at(-2),
    b = series.points.at(-1);
  if (!a || !b || a.date === b.date) return null;
  const d = new Decimal(b.value).minus(a.value);
  return `${d.isPositive() ? '+' : ''}${d.toString()}`;
}
