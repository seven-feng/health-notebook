import type { Observation, Report } from './types';
import { normalizeConcentrationUnit } from './units';

type Category = 'cbc' | 'chemistry' | 'body';
type Definition = {
  id: string;
  name: string;
  units: string[];
  aliases: string[];
  category: Category;
};
const definition = (
  category: Category,
  id: string,
  name: string,
  units: string[],
  aliases: string[] = [],
): Definition => ({ category, id, name, units, aliases: [name, ...aliases] });
const cbc = (id: string, name: string, units: string[], aliases: string[] = []) =>
  definition('cbc', id, name, units, aliases);
const chemistry = (id: string, name: string, unit: string, aliases: string[] = []) =>
  definition('chemistry', id, name, [unit], aliases);
const body = (id: string, name: string, units: string[], aliases: string[] = []) =>
  definition('body', id, name, units, aliases);
// Deliberate aliases only. Do not infer from abbreviation fragments, similar
// spelling, reference ranges or the magnitude of a patient's result.
const definitions: Definition[] = [
  cbc('WBC', '白细胞计数', ['10^9/L'], ['白细胞']),
  cbc('RBC', '红细胞计数', ['10^12/L'], ['红细胞']),
  cbc('HGB', '血红蛋白', ['g/L']),
  cbc('HCT', '红细胞压积', ['%'], ['红细胞比容']),
  cbc('MCV', '平均红细胞体积', ['fL']),
  cbc('MCH', '平均血红蛋白含量', ['pg'], ['平均红细胞血红蛋白含量']),
  cbc('MCHC', '平均血红蛋白浓度', ['g/L'], ['平均红细胞血红蛋白浓度']),
  cbc(
    'RDW_CV',
    '红细胞分布宽度（变异系数）',
    ['%'],
    ['红细胞分布宽度', '红细胞分布宽度-变异系数', '红细胞分布宽度(CV)', 'RDW-CV'],
  ),
  cbc(
    'RDW_SD',
    '红细胞分布宽度（标准差）',
    ['fL'],
    ['红细胞分布宽度-标准差', '红细胞分布宽度(SD)', 'RDW-SD'],
  ),
  cbc('PLT', '血小板计数', ['10^9/L'], ['血小板']),
  cbc('PCT', '血小板压积', ['%']),
  cbc('PDW', '血小板分布宽度', ['fL', '%']),
  cbc('MPV', '平均血小板体积', ['fL']),
  ...(
    [
      ['NEUT', '中性粒细胞', []],
      ['LYMPH', '淋巴细胞', []],
      ['MONO', '单核细胞', []],
      ['EO', '嗜酸性粒细胞', ['嗜酸性细胞']],
      ['BASO', '嗜碱性粒细胞', ['嗜碱性细胞']],
    ] as [string, string, string[]][]
  ).flatMap(([id, name, aliases]) => [
    cbc(
      id,
      name,
      ['10^9/L'],
      [name, ...aliases].flatMap((n) => [n, `${n}计数`, `${n}绝对值`]),
    ),
    cbc(
      `${id}_PERCENT`,
      `${name}(%)`,
      ['%'],
      [name, ...aliases].flatMap((n) => [`${n}(%)`, `${n}百分比`, `${n}百分率`]),
    ),
  ]),
  cbc('NRBC_PERCENT', '有核红细胞百分比', ['/100WBC']),
  chemistry('HSCRP', '超敏C反应蛋白', 'mg/L', ['超敏C-反应蛋白', 'hs-CRP']),
  chemistry('CRP', 'C反应蛋白', 'mg/L', ['C-反应蛋白']),
  chemistry('TP', '总蛋白', 'g/L'),
  chemistry('ALB', '白蛋白', 'g/L'),
  chemistry('GLOB', '球蛋白', 'g/L'),
  chemistry('AG_RATIO', '白球蛋白比例', '', ['白蛋白/球蛋白比值', '白球比', '白蛋白/球蛋白']),
  chemistry('ALT', '谷丙转氨酶', 'U/L', ['丙氨酸氨基转移酶', '丙氨酸转氨酶']),
  chemistry('AST', '谷草转氨酶', 'U/L', ['天门冬氨酸氨基转移酶', '天门冬氨酸转氨酶']),
  chemistry('AST_ALT_RATIO', '谷草谷丙比值', '', ['谷草/谷丙', 'AST/ALT']),
  chemistry('ALP', '碱性磷酸酶', 'U/L'),
  chemistry('CHE', '胆碱酯酶', 'U/L'),
  chemistry('TBA', '总胆汁酸', 'μmol/L'),
  chemistry('TBIL', '总胆红素', 'μmol/L'),
  chemistry('DBIL', '直接胆红素', 'μmol/L'),
  chemistry('IBIL', '间接胆红素', 'μmol/L'),
  chemistry('ADA', '腺苷酸脱氨酶', 'U/L'),
  chemistry('GGT', '谷氨酰转肽酶', 'U/L', [
    'γ-谷氨酰转移酶',
    'γ-谷氨酰转肽酶',
    'γ谷氨酰转移酶',
    '谷氨酰转移酶',
  ]),
  chemistry('CREA', '肌酐', 'μmol/L'),
  chemistry('UREA', '尿素', 'mmol/L'),
  chemistry('BUN_CREA_RATIO', '尿素氮/肌酐', ''),
  chemistry('UA', '尿酸', 'μmol/L'),
  chemistry('TG', '甘油三酯', 'mmol/L'),
  chemistry('TC', '总胆固醇', 'mmol/L'),
  chemistry('HDL_C', '高密度脂蛋白-C', 'mmol/L', ['高密度脂蛋白胆固醇', 'HDL-C']),
  chemistry('LDL_C', '低密度脂蛋白-C', 'mmol/L', ['低密度脂蛋白胆固醇', 'LDL-C']),
  chemistry('VLDL_C', '极低密度脂蛋白-C', 'mmol/L', ['极低密度脂蛋白胆固醇', 'VLDL-C']),
  chemistry('FPG', '空腹血糖', 'mmol/L', ['空腹血葡萄糖', '空腹葡萄糖']),
  chemistry('GLU', '葡萄糖', 'mmol/L', ['血糖', '血葡萄糖']),
  chemistry('K', '钾', 'mmol/L'),
  chemistry('NA', '钠', 'mmol/L'),
  chemistry('CL', '氯', 'mmol/L'),
  chemistry('CA', '总钙', 'mmol/L', ['钙']),
  chemistry('P', '无机磷', 'mmol/L'),
  chemistry('CK', '磷酸肌酸激酶', 'U/L', ['肌酸激酶']),
  // eGFR equations and indexed/non-indexed units cannot be inferred from a name.
  body('HEIGHT', '身高', ['cm']),
  body('WEIGHT', '体重', ['kg']),
  body('BMI', '体重指数', ['', 'kg/m²'], ['BMI', '体质指数']),
  body('SBP', '收缩压', ['mmHg']),
  body('DBP', '舒张压', ['mmHg']),
];
const normalizeName = (name: string) =>
  name
    .normalize('NFKC')
    .replace(/\s/g, '')
    .replace(/^[★☆*•]+/, '');
const byName = new Map(
  definitions.flatMap((d) => d.aliases.map((name) => [normalizeName(name), d] as const)),
);
export const hasMetricDefinition = (name: string) => byName.has(normalizeName(name));

export function normalizeMetricUnit(unit: string): string {
  const value = unit
    .replace(/10⁹/g, '10^9')
    .replace(/10¹²/g, '10^12')
    .normalize('NFKC')
    .replace(/\s/g, '')
    .replace(/µ/g, 'μ');
  const aliases: Record<string, string> = {
    'umol/L': 'μmol/L',
    'umol/l': 'μmol/L',
    'μmol/l': 'μmol/L',
    'mmol/l': 'mmol/L',
    'g/l': 'g/L',
    'mg/l': 'mg/L',
    'U/l': 'U/L',
    fl: 'fL',
    pg: 'pg',
    Kg: 'kg',
    'kg/m2': 'kg/m²',
    'kg/m^2': 'kg/m²',
  };
  if (/^(?:[×x*])?10(?:\^|E)(?:9)\/[Ll]$/.test(value)) return '10^9/L';
  if (/^(?:[×x*])?10(?:\^|E)(?:12)\/[Ll]$/.test(value)) return '10^12/L';
  return aliases[value] ?? normalizeConcentrationUnit(value);
}

export type MetricMatch = {
  key: string;
  identity: string;
  name: string;
  unit: string;
  context: string;
  note?: string;
};
const specimenLabel = (raw: string) => {
  const known: Record<string, string> = {
    serum: '血清',
    plasma: '血浆',
    'whole blood': '全血',
    wholeblood: '全血',
    urine: '尿液',
    尿: '尿液',
  };
  const value = raw.trim();
  // Existing verified templates use "blood" for the broad category, not a
  // printed specimen. Preserve that uncertainty rather than invent serum.
  return value === 'blood' || value === '血液' ? '' : (known[value.toLowerCase()] ?? value);
};
function hasContext(report: Report, def: Definition): boolean {
  if (/尿常规|尿液|尿检|脑脊液|胸水|腹水|粪便/.test(report.title)) return false;
  if (report.template?.startsWith('fahzu-yh-')) {
    return def.category === 'cbc'
      ? report.template.includes('cbc')
      : def.category === 'chemistry' &&
          (report.template.includes('chemistry') || ['HSCRP', 'CRP'].includes(def.id));
  }
  if (!['section-table-v1', 'lab-table-v1'].includes(report.template ?? '')) return false;
  if (def.category === 'body') return /一般检查|一般体检|体格检查/.test(report.title);
  if (def.category === 'cbc') return /血常规|全血细胞/.test(report.title);
  if (['HSCRP', 'CRP'].includes(def.id) && /血常规|全血细胞/.test(report.title)) return true;
  if (/生化|血脂|肝功能|肾功能|血糖/.test(report.title)) return true;
  if (!/实验室|检验|检查/.test(report.title)) return false;
  const identities = new Set(
    report.observations.flatMap((o) => {
      const d = byName.get(normalizeName(o.name));
      return d?.category === 'chemistry' && d.units.includes(normalizeMetricUnit(o.unit))
        ? [d.id]
        : [];
    }),
  );
  return identities.size >= 3;
}

export function matchMetric(report: Report, o: Observation): MetricMatch | null {
  const def = byName.get(normalizeName(o.name));
  const unit = normalizeMetricUnit(o.unit);
  if (!def || !def.units.includes(unit) || !hasContext(report, def)) return null;
  const specimen = specimenLabel(o.specimen);
  if (specimen && !['全血', '血清', '血浆'].includes(specimen)) return null;
  const method = o.method.trim().startsWith('not-reported:') ? '' : o.method.trim();
  const identity = `common:${def.category}:${def.id}`;
  const context =
    def.category === 'body'
      ? method || '方法未注明'
      : `${specimen || '具体标本未注明'} · ${method || '方法未注明'}`;
  return {
    identity,
    key: JSON.stringify([identity, unit, specimen || 'not-reported', method || 'not-reported']),
    name: def.name,
    unit,
    context,
    ...(!method || (!specimen && def.category !== 'body')
      ? {
          note:
            def.category === 'body'
              ? '测量方法未注明，按同一项目和单位对照。'
              : '部分报告未注明具体标本或检测方法，按同类项目和单位作数值对照，请结合各次参考范围查看。',
        }
      : {}),
  };
}

export function unmatchedReason(report: Report, o: Observation): string {
  const def = byName.get(normalizeName(o.name));
  if (def && !def.units.includes(normalizeMetricUnit(o.unit)))
    return o.unit.trim()
      ? '单位尚不能统一，单独展示；请对照原报告。'
      : '缺少单位，暂不能合并历史。';
  if (def && !hasContext(report, def)) return '检验类别尚不能确认，暂不与其他报告合并。';
  return '尚未建立这个项目的对应关系，单独展示。';
}
