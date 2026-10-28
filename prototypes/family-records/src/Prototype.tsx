import { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  IoChevronDown,
  IoChevronForward,
  IoChevronBack,
  IoAdd,
  IoCheckmark,
  IoPersonOutline,
  IoPeopleOutline,
  IoDocumentTextOutline,
  IoCameraOutline,
  IoImagesOutline,
  IoFolderOpenOutline,
  IoLockClosedOutline,
  IoPulseOutline,
  IoSettingsOutline,
  IoAlertCircleOutline,
  IoCalendarOutline,
  IoCheckmarkCircleOutline,
  IoExpandOutline,
  IoArrowUp,
  IoArrowDown,
  IoSquare,
  IoCreateOutline,
  IoClose,
  IoLinkOutline,
  IoTrashOutline,
} from 'react-icons/io5';
import {
  BottomSheet,
  KeyboardInput,
  KeyboardTextarea,
  FlowStack,
  useFlow,
  type FlowScreen,
  MobileScroll,
  useKeyboard,
  useKeyboardInsets,
  useScreenPortal,
} from './mobile';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceArea,
  ReferenceLine,
  Dot,
} from 'recharts';
import './prototype.css';

type Member = { id: string; label: string; name: string; birth: string; tone: string };
type RecordItem = {
  id: string;
  memberId: string;
  patient: string;
  date: string;
  title: string;
  count: number;
  value: string;
  status: 'confirmed' | 'review';
  source?: string;
};
type Route = 'main' | 'report' | 'add' | 'welcome' | 'visit' | 'document';
const deletionExampleIds = ['s-blood', 's-crp'];
const initialMembers: Member[] = [
  { id: 'self', label: '我', name: '林晓', birth: '1993-06-12', tone: 'green' },
  { id: 'mom', label: '妈妈', name: '陈静', birth: '1967-03-08', tone: 'rose' },
  { id: 'dad', label: '爸爸', name: '林建国', birth: '1965-08-21', tone: 'blue' },
  { id: 'child', label: '孩子', name: '林小满', birth: '2020-05-16', tone: 'ochre' },
];
const initialRecords: RecordItem[] = [
  {
    id: 's1',
    memberId: 'self',
    patient: '林晓',
    date: '2026-10-18',
    title: '生化检验报告',
    count: 18,
    value: '5.1',
    status: 'confirmed',
  },
  {
    id: 's2',
    memberId: 'self',
    patient: '林晓',
    date: '2026-07-12',
    title: '生化检验报告',
    count: 18,
    value: '5.3',
    status: 'confirmed',
  },
  {
    id: 's3',
    memberId: 'self',
    patient: '林晓',
    date: '2026-04-05',
    title: '生化检验报告',
    count: 18,
    value: '5.0',
    status: 'confirmed',
  },
  {
    id: 'm1',
    memberId: 'mom',
    patient: '陈静',
    date: '2026-09-20',
    title: '生化检验报告',
    count: 18,
    value: '6.2',
    status: 'confirmed',
  },
  {
    id: 'm2',
    memberId: 'mom',
    patient: '陈静',
    date: '2026-06-15',
    title: '生化检验报告',
    count: 18,
    value: '6.8',
    status: 'confirmed',
  },
  {
    id: 'd1',
    memberId: 'dad',
    patient: '林建国',
    date: '2026-10-09',
    title: '生化检验报告',
    count: 18,
    value: '5.6',
    status: 'confirmed',
  },
  {
    id: 'c1',
    memberId: 'child',
    patient: '林小满',
    date: '2026-09-03',
    title: '血常规报告',
    count: 23,
    value: '',
    status: 'confirmed',
  },
  {
    id: 'u1',
    memberId: 'mom',
    patient: '陈静',
    date: '2026-10-22',
    title: '生化检验报告',
    count: 5,
    value: '5.9',
    status: 'review',
    source: '支付宝导入',
  },
  {
    id: 'u2',
    memberId: 'self',
    patient: '',
    date: '2026-10-21',
    title: '生化检验报告',
    count: 5,
    value: '5.4',
    status: 'review',
    source: '相册导入',
  },
];
const cnDate = (date: string) => date.replaceAll('-', '.');
const reportExampleValues = (r: RecordItem) => r.title.includes('血常规')
  ? [['白细胞', '10⁹/L', '6.2', '3.5–9.5'], ['血红蛋白', 'g/L', '136', '115–150']]
  : r.title.includes('反应蛋白') ? [['C 反应蛋白', 'mg/L', '2.1', '0–8']]
  : [['钾', 'mmol/L', '3.31', '3.50–5.30'], ['钠', 'mmol/L', '140', '137–147'], ['氯', 'mmol/L', '103', '99–110'], ['钙', 'mmol/L', '2.27', '2.11–2.52'], ['葡萄糖', 'mmol/L', r.value || '5.1', '3.90–6.10']];
const reportSourceImage = (r: RecordItem) => `/assets/visit/sample-${r.title.includes('血常规') ? 'blood' : r.title.includes('反应蛋白') ? 'crp' : 'lab'}.png`;

type MetricPoint = {
  date: string;
  value: number;
  raw: string;
  reference?: [number, number];
  referenceText?: string;
};
type MetricItem = { id: string; name: string; unit: string; points: MetricPoint[] };
type MetricState = 'high' | 'low' | 'within' | 'unknown';
type MetricFilter = 'all' | 'outside' | 'within' | 'unknown';
const metricState = (p: MetricPoint): MetricState =>
  !p.reference
    ? 'unknown'
    : p.value < p.reference[0]
      ? 'low'
      : p.value > p.reference[1]
        ? 'high'
        : 'within';
const stateLabel: Record<MetricState, string> = {
  high: '偏高',
  low: '偏低',
  within: '范围内',
  unknown: '无参考范围',
};
const point = (
  date: string,
  raw: string,
  reference?: [number, number],
  referenceText?: string,
): MetricPoint => ({ date, raw, value: Number(raw), reference, referenceText });
const rangeText = (p: MetricPoint) =>
  p.referenceText ?? (p.reference ? p.reference.join('–') : '报告未提供');
const selfMetrics: MetricItem[] = [
  {
    id: 'alt',
    name: '丙氨酸氨基转移酶',
    unit: 'U/L',
    points: [
      point('2026-04-05', '65', [9, 50]),
      point('2026-07-12', '100', [9, 50]),
      point('2026-10-18', '80', [9, 50]),
    ],
  },
  {
    id: 'ast',
    name: '天门冬氨酸氨基转移酶',
    unit: 'U/L',
    points: [
      point('2026-04-05', '38', [15, 40]),
      point('2026-07-12', '48', [15, 40]),
      point('2026-10-18', '35', [15, 40]),
    ],
  },
  {
    id: 'tg',
    name: '甘油三酯',
    unit: 'mmol/L',
    points: [
      point('2026-07-12', '2.35', [0.45, 1.7]),
      point('2026-10-18', '2.06', [0.45, 1.7], '0.45–1.70'),
    ],
  },
  {
    id: 'glucose',
    name: '葡萄糖',
    unit: 'mmol/L',
    points: [
      point('2026-04-05', '5.0', [3.9, 6.1]),
      point('2026-07-12', '5.3', [3.9, 6.1]),
      point('2026-10-18', '5.1', [3.9, 6.1]),
    ],
  },
  {
    id: 'k',
    name: '钾',
    unit: 'mmol/L',
    points: [
      point('2026-07-12', '3.68', [3.5, 5.3]),
      point('2026-10-18', '3.31', [3.5, 5.3], '3.50–5.30'),
    ],
  },
  {
    id: 'na',
    name: '钠',
    unit: 'mmol/L',
    points: [point('2026-07-12', '139', [137, 147]), point('2026-10-18', '140', [137, 147])],
  },
  {
    id: 'creatinine',
    name: '肌酐',
    unit: 'μmol/L',
    points: [point('2026-07-12', '86', [59, 104]), point('2026-10-18', '84', [57, 97])],
  },
  {
    id: 'cholesterol',
    name: '总胆固醇',
    unit: 'mmol/L',
    points: [point('2026-07-12', '4.9', [3.1, 5.2]), point('2026-10-18', '4.6', [3.1, 5.2])],
  },
  {
    id: 'uric',
    name: '尿酸',
    unit: 'μmol/L',
    points: [point('2026-04-05', '420', [208, 428]), point('2026-07-12', '390', [208, 428])],
  },
  {
    id: 'ck',
    name: '肌酸激酶',
    unit: 'U/L',
    points: [point('2026-07-12', '168'), point('2026-10-18', '156')],
  },
];
function metricsFor(memberId: string): MetricItem[] {
  if (memberId === 'self') return selfMetrics;
  if (memberId === 'mom')
    return [
      {
        id: 'glucose',
        name: '葡萄糖',
        unit: 'mmol/L',
        points: [point('2026-06-15', '6.8', [3.9, 6.1]), point('2026-09-20', '6.2', [3.9, 6.1])],
      },
      {
        id: 'alt',
        name: '丙氨酸氨基转移酶',
        unit: 'U/L',
        points: [point('2026-06-15', '27', [7, 40]), point('2026-09-20', '24', [7, 40])],
      },
    ];
  if (memberId === 'dad')
    return [
      {
        id: 'glucose',
        name: '葡萄糖',
        unit: 'mmol/L',
        points: [point('2026-10-09', '5.6', [3.9, 6.1])],
      },
    ];
  return [];
}
function MetricTrend({ item }: { item: MetricItem }) {
  const latest = item.points.at(-1)!;
  const previous = item.points.at(-2);
  const difference = previous ? Number((latest.value - previous.value).toFixed(3)) : null;
  const sameRange =
    !!latest.reference &&
    item.points.every(
      (p) => p.reference?.[0] === latest.reference![0] && p.reference?.[1] === latest.reference![1],
    );
  const values = item.points.map((p) => p.value).concat(sameRange ? latest.reference! : []);
  const min = Math.min(...values),
    max = Math.max(...values);
  const pad = (max - min || Math.abs(max) * 0.2 || 1) * 0.18;
  const rawStep = (max - min + pad * 2) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].find((n) => n * magnitude >= rawStep)! * magnitude;
  const bottom = Math.floor((min - pad) / step) * step;
  const top = Math.ceil((max + pad) / step) * step;
  const domain: [number, number] = [min >= 0 ? Math.max(0, bottom) : bottom, top];
  const ticks = Array.from({ length: Math.round((domain[1] - domain[0]) / step) + 1 }, (_, i) =>
    Number((domain[0] + step * i).toFixed(4)),
  );
  const chartData = item.points.map((p) => ({ ...p, time: Date.parse(`${p.date}T00:00:00Z`) }));
  return (
    <div className="metric-expanded" id={`trend-${item.id}`}>
      <div className="metric-trend-heading">
        <span>
          {difference === null ? (
            '目前只有一次检查结果'
          ) : (
            <>
              较上次{' '}
              <strong>
                {difference > 0 ? '+' : ''}
                {difference} {item.unit}
              </strong>
            </>
          )}
        </span>
        <span>{item.points.length} 次检查</span>
      </div>
      {item.points.length > 1 && (
        <>
          <div
            className="metric-chart"
            role="img"
            aria-label={`${item.name}变化趋势。${item.points.map((p) => `${p.date}：${p.raw} ${item.unit}`).join('；')}。${sameRange ? `阴影表示报告参考范围 ${rangeText(latest)}` : '参考范围不同或未提供，不绘制统一参考带'}`}
          >
            <ResponsiveContainer width="100%" height={164}>
              <LineChart
                data={chartData}
                margin={{ top: 12, right: 14, left: 0, bottom: 0 }}
                accessibilityLayer={false}
              >
                <CartesianGrid stroke="#E5EAE2" strokeDasharray="4 5" vertical={false} />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  ticks={chartData.map((p) => p.time)}
                  tickFormatter={(v) => new Date(v).toISOString().slice(5, 10).replace('-', '.')}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#72817A', fontSize: 10 }}
                  minTickGap={12}
                />
                <YAxis
                  domain={domain}
                  ticks={ticks}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#72817A', fontSize: 10 }}
                  width={32}
                />
                {sameRange && (
                  <ReferenceArea
                    y1={latest.reference![0]}
                    y2={latest.reference![1]}
                    fill="#E8F1E9"
                    fillOpacity={0.9}
                    strokeOpacity={0}
                  />
                )}
                {sameRange && (
                  <ReferenceLine y={latest.reference![1]} stroke="#A5C7B5" strokeDasharray="4 4" />
                )}
                {sameRange && (
                  <ReferenceLine y={latest.reference![0]} stroke="#A5C7B5" strokeDasharray="4 4" />
                )}
                <Line
                  type="linear"
                  dataKey="value"
                  stroke="#276B56"
                  strokeWidth={2.3}
                  isAnimationActive={false}
                  activeDot={false}
                  dot={(props: {
                    cx?: number;
                    cy?: number;
                    payload?: MetricPoint;
                    index?: number;
                  }) => (
                    <Dot
                      key={props.index}
                      cx={props.cx}
                      cy={props.cy}
                      r={4}
                      stroke="#fff"
                      strokeWidth={2}
                      fill={
                        props.payload && metricState(props.payload) === 'high'
                          ? '#A63D39'
                          : props.payload && metricState(props.payload) === 'low'
                            ? '#326B9B'
                            : '#276B56'
                      }
                    />
                  )}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className={`chart-reference ${sameRange ? '' : 'range-note'}`}>
            {sameRange ? (
              <>
                <IoSquare aria-hidden="true" />
                报告参考范围 {rangeText(latest)} {item.unit}
              </>
            ) : latest.reference ? (
              '各次报告的参考范围不同，分别列在下方。'
            ) : (
              '报告未提供参考范围，暂不判断偏高或偏低。'
            )}
          </p>
        </>
      )}
      <div className="metric-history-list">
        <div className="metric-history-label">
          <span>检查日期 / 参考范围</span>
          <span>结果 {item.unit}</span>
        </div>
        {[...item.points].reverse().map((p) => (
          <div key={p.date} className="metric-history-item">
            <div>
              <time>{cnDate(p.date)}</time>
              <small>{p.reference ? `参考 ${rangeText(p)}` : '参考范围未提供'}</small>
            </div>
            <div className={`metric-history-result state-${metricState(p)}`}>
              <strong>
                <span aria-label={`${p.raw}，${stateLabel[metricState(p)]}`}>{p.raw}</span>
              </strong>
              {metricState(p) === 'high' ? (
                <IoArrowUp aria-hidden="true" />
              ) : metricState(p) === 'low' ? (
                <IoArrowDown aria-hidden="true" />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function MetricsOverview({ memberId, memberLabel }: { memberId: string; memberLabel: string }) {
  const [filter, setFilter] = useState<MetricFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const items = metricsFor(memberId);
  const classify = (item: MetricItem) => metricState(item.points.at(-1)!);
  const outside = (item: MetricItem) => ['high', 'low'].includes(classify(item));
  const counts = {
    outside: items.filter(outside).length,
    within: items.filter((m) => classify(m) === 'within').length,
    unknown: items.filter((m) => classify(m) === 'unknown').length,
  };
  const visible = items
    .filter((m) => filter === 'all' || (filter === 'outside' ? outside(m) : classify(m) === filter))
    .sort((a, b) => Number(outside(b)) - Number(outside(a)));
  function select(next: MetricFilter) {
    setFilter((current) => (current === next ? 'all' : next));
    setExpanded(null);
  }
  if (!items.length)
    return (
      <div className="empty">
        <IoPulseOutline />
        <h2>还没有可比较的指标</h2>
        <p>
          导入并核对{memberLabel}的检验报告后，
          <br />
          这里会按日期整理结果。
        </p>
      </div>
    );
  return (
    <div className="metrics-overview">
      <div className="metrics-scope">
        <span>各指标最近一次已核对结果</span>
        <span className="metrics-demo">示例数据</span>
      </div>
      <section className="metrics-summary" aria-label="按参考范围筛选指标">
        {(
          [
            ['outside', '超出范围', counts.outside],
            ['within', '范围内', counts.within],
            ['unknown', '无参考范围', counts.unknown],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            className={`summary-stat ${key} ${filter === key ? 'selected' : ''}`}
            aria-pressed={filter === key}
            onClick={() => select(key)}
          >
            <strong>
              {count}
              <small>项</small>
            </strong>
            <span>{label}</span>
          </button>
        ))}
      </section>
      <div className="metrics-list-heading">
        <h2>
          {filter === 'all'
            ? '全部指标'
            : filter === 'outside'
              ? '超出参考范围'
              : filter === 'within'
                ? '参考范围内'
                : '无参考范围'}
          <span>{visible.length}</span>
        </h2>
        {filter === 'all' ? (
          <span>超出范围优先</span>
        ) : (
          <button onClick={() => select('all')}>
            查看全部
            <IoChevronForward />
          </button>
        )}
      </div>
      {visible.length ? (
        <div className="compact-metrics">
          {visible.map((item) => {
            const last = item.points.at(-1)!;
            const state = classify(item);
            const open = expanded === item.id;
            return (
              <section
                key={item.id}
                className={`compact-metric state-${state} ${open ? 'expanded' : ''}`}
              >
                <button
                  className="compact-metric-trigger"
                  aria-expanded={open}
                  aria-controls={`trend-${item.id}`}
                  onClick={() => setExpanded(open ? null : item.id)}
                >
                  <span className="metric-name-line">
                    <strong>{item.name}</strong>
                    <small>{item.unit}</small>
                    <IoChevronDown className="metric-expand-icon" />
                  </span>
                  <span className="metric-result-line">
                    <span className="metric-latest-result" aria-label={`${last.raw}，${stateLabel[state]}`}>
                      {last.raw}
                    </span>
                    {state === 'high' ? (
                      <IoArrowUp className="metric-state-icon" aria-hidden="true" />
                    ) : state === 'low' ? (
                      <IoArrowDown className="metric-state-icon" aria-hidden="true" />
                    ) : null}
                    <time>{cnDate(last.date)}</time>
                  </span>
                  <span className="metric-range-line">
                    {state === 'unknown'
                      ? '报告未提供参考范围，暂不判断'
                      : `参考范围 ${rangeText(last)}`}
                  </span>
                </button>
                {open && <MetricTrend item={item} />}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="metrics-filter-empty">
          <IoCheckmarkCircleOutline />
          <p>
            最近结果中没有
            {filter === 'outside'
              ? '超出参考范围'
              : filter === 'within'
                ? '参考范围内'
                : '缺少参考范围'}
            的指标
          </p>
          <button className="text-button" onClick={() => select('all')}>
            查看全部指标
          </button>
        </div>
      )}
      <p className="metrics-footnote">依据各次报告的参考范围展示，不作病情判断。</p>
    </div>
  );
}

export default function Prototype() {
  if (new URLSearchParams(window.location.search).has('visit-detail'))
    return <VisitPrototype initiallySaved readingDesign initial={{ ...exampleVisit, note: '复诊时带上这次的检查报告。' }} initialLinked={['blood', 'chemistry']} memberLabel="我" />;
  return <FamilyPrototype />;
}

function FamilyPrototype() {
  const deletionDemo = new URLSearchParams(window.location.search).has('delete');
  const [members, setMembers] = useState(initialMembers);
  const [records, setRecords] = useState<RecordItem[]>(() => [
    { id: 's-blood', memberId: 'self', patient: '林晓', date: '2026-10-23', title: '血常规报告', count: 23, value: '6.2', status: 'confirmed' },
    { id: 's-crp', memberId: 'self', patient: '林晓', date: '2026-10-23', title: 'C 反应蛋白', count: 1, value: '2.1', status: 'confirmed' },
    ...initialRecords,
  ]);
  const [visits, setVisits] = useState<ArchiveVisit[]>(() => [{ id: 'visit-self', memberId: 'self', draft: { ...exampleVisit }, linked: ['s-blood', 's-crp'] }]);
  const [selectedVisit, setSelectedVisit] = useState<ArchiveVisit | null>(null);
  const [recordViews, setRecordViews] = useState<Record<string, 'visits' | 'reports'>>(() => {
    try { return JSON.parse(localStorage.getItem('health-prototype-record-view') || '{}'); } catch { return {}; }
  });
  const [importMethod, setImportMethod] = useState<'pdf' | 'camera' | 'album'>('camera');
  const [reportSourceOpen, setReportSourceOpen] = useState(false);
  const [documentSourcePage, setDocumentSourcePage] = useState<number | null>(null);
  const [activeId, setActiveId] = useState('self');
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).has('metrics') ? 'metrics' : 'records',
  );
  const [route, setRoute] = useState<Route>(() =>
    deletionDemo ? 'document' : new URLSearchParams(window.location.search).has('onboarding') ? 'welcome' : 'main',
  );
  const [returnRoute, setReturnRoute] = useState<Route>('main');
  const [sheet, setSheet] = useState<'switch' | 'import' | 'delete-document' | null>(null);
  const [selectedId, setSelectedId] = useState('u1');
  const [mismatchAccepted, setMismatchAccepted] = useState(false);
  const [toast, setToast] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newName, setNewName] = useState('');
  const [newBirth, setNewBirth] = useState('');
  const [formError, setFormError] = useState('');
  const [addReturn, setAddReturn] = useState<Route>('main');
  const [welcomePreviewOpen, setWelcomePreviewOpen] = useState(false);
  const keyboard = useKeyboard();
  const { screenRef } = useScreenPortal();
  // Animated sheet autofocus must not scroll the outer device past its chrome.
  // Content scrolling remains owned by MobileScroll and the sheet itself.
  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const keepDeviceAligned = () => {
      screen.scrollTop = 0;
      screen.scrollLeft = 0;
    };
    screen.addEventListener('scroll', keepDeviceAligned);
    keepDeviceAligned();
    return () => screen.removeEventListener('scroll', keepDeviceAligned);
  }, [screenRef]);
  const { bottomInset } = useKeyboardInsets();
  const member = members.find((m) => m.id === activeId)!;
  const mine = records
    .filter((r) => r.memberId === activeId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const pending = mine.filter((r) => r.status === 'review');
  const report = records.find((r) => r.id === selectedId)!;
  const owner = members.find((m) => m.id === report.memberId)!;
  const mismatch = !!(
    report.status === 'review' &&
    report.patient &&
    owner.name &&
    owner.name !== report.patient
  );
  const myVisits = visits.filter(v => v.memberId === activeId).sort((a, b) => b.draft.date.localeCompare(a.draft.date));
  const documentReports = deletionDemo ? mine.filter(r => deletionExampleIds.includes(r.id)) : [];
  const documentResultCount = documentReports.reduce((n, r) => n + r.count, 0);
  const documentLinkedVisits = myVisits.filter(v => v.linked.some(id => documentReports.some(r => r.id === id)));
  const recordView = recordViews[activeId] || (myVisits.length ? 'visits' : 'reports');
  function changeRecordView(next: 'visits' | 'reports') {
    setRecordViews(prev => {
      const value = { ...prev, [activeId]: next };
      try { localStorage.setItem('health-prototype-record-view', JSON.stringify(value)); } catch { /* preference is optional */ }
      return value;
    });
  }
  function chooseImport(method: 'pdf' | 'camera' | 'album') {
    keyboard.hide(); setImportMethod(method); setSheet('import');
  }
  function openVisit(value: ArchiveVisit) { setSelectedVisit(value); go('visit'); }
  function importExample(kind: 'visit' | 'lab') {
    if (kind === 'visit') {
      setSelectedVisit({ id: `visit-${Date.now()}`, memberId: activeId, draft: { ...exampleVisit }, linked: [] });
      go('visit');
    } else {
      const next: RecordItem = { id: `lab-${Date.now()}`, memberId: activeId, patient: member.name, date: '2026-10-23', title: '生化检验报告', count: 5, value: '5.1', status: 'review', source: { pdf: 'PDF 导入', camera: '拍照识别', album: '相册导入' }[importMethod] };
      setRecords(prev => [next, ...prev]); setReturnRoute('main'); setSelectedId(next.id); setMismatchAccepted(false);
      go('report');
    }
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  const go = (next: Route) => {
    keyboard.hide();
    setSheet(null);
    setRoute(next);
  };
  function selectMember(id: string) {
    setActiveId(id);
    setSheet(null);
  }
  function openReport(item: RecordItem) {
    setReturnRoute(route);
    setSelectedId(item.id);
    setMismatchAccepted(false);
    go('report');
  }
  function saveReport() {
    if (mismatch && !mismatchAccepted) return;
    setRecords((prev) => prev.map((r) => (r.id === report.id ? { ...r, status: 'confirmed' } : r)));
    go('main');
    changeRecordView('reports');
    setToast(`已保存到${owner.label}的档案`);
  }
  function deleteExampleDocument() {
    const ids = new Set(documentReports.map(r => r.id));
    if (!ids.size) return;
    setRecords(prev => prev.filter(r => !ids.has(r.id)));
    setVisits(prev => prev.map(v => ({ ...v, linked: v.linked.filter(id => !ids.has(id)) })));
    setDocumentSourcePage(null);
    changeRecordView('reports');
    setTab('records');
    go('main');
    setToast('已删除整份报告');
  }
  function startAdd() {
    setAddReturn(route);
    setNewLabel('');
    setNewName('');
    setNewBirth('');
    setFormError('');
    go('add');
  }
  function addMember() {
    if (!newLabel.trim()) {
      setFormError('请填写一个方便辨认的称呼');
      return;
    }
    if (newBirth && (!/^\d{4}-\d{2}-\d{2}$/.test(newBirth) || Number.isNaN(Date.parse(newBirth)))) {
      setFormError('出生日期请填写为 YYYY-MM-DD，也可以留空');
      return;
    }
    const next = {
      id: `member-${Date.now()}`,
      label: newLabel.trim(),
      name: newName.trim(),
      birth: newBirth,
      tone: 'blue',
    };
    setMembers((prev) => [...prev, next]);
    setActiveId(next.id);
    setTab('records');
    go('main');
    setToast(`已添加${next.label}`);
  }
  const Avatar = ({ m, small = false }: { m: Member; small?: boolean }) => (
    <span className={`member-avatar ${m.tone} ${small ? 'small' : ''}`}>
      <IoPersonOutline aria-hidden="true" />
    </span>
  );
  const ReportRow = ({ r }: { r: RecordItem }) => (
    <button className="record-row" onClick={() => openReport(r)}>
      <span className="record-symbol">
        <IoDocumentTextOutline />
      </span>
      <span className="row-copy">
        <strong>{r.title}</strong>
        <span>
          {r.count} 项指标{myVisits.some(v => v.linked.includes(r.id)) ? ' · 已关联就诊' : ''}
        </span>
      </span>
      <span className={`badge ${r.status === 'review' ? 'amber' : ''}`}>
        {r.status === 'review' ? '待核对' : '已核对'}
      </span>
      <IoChevronForward className="muted" />
    </button>
  );

  if (route === 'visit' && selectedVisit) {
    const stored = visits.find(v => v.id === selectedVisit.id);
    const value = stored || selectedVisit;
    return <VisitPrototype key={value.id} initial={value.draft} initialLinked={value.linked} initiallySaved={!!stored}
      memberLabel={member.label} reports={mine.filter(r => r.status === 'confirmed')}
      requiresIdentityConfirmation={!stored && member.name !== '林晓'} memberName={member.name}
      onExit={() => { changeRecordView('visits'); go('main'); }}
      onSave={(draft, linked) => {
        const next = { ...value, draft, linked };
        setVisits(prev => prev.some(v => v.id === next.id) ? prev.map(v => v.id === next.id ? next : v) : [next, ...prev]);
        setSelectedVisit(next);
      }}
      onOpenReport={id => { setSelectedId(id); setReturnRoute('visit'); go('report'); }}
    />;
  }

  if (route === 'welcome') {
    const enterApp = (nextTab = 'records') => {
      setTab(nextTab);
      go('main');
    };
    return (
      <div className="health-app welcome-app">
        <header className="welcome-header">
          <span className="welcome-brand">
            <IoDocumentTextOutline aria-hidden="true" />
            我的健康记录
          </span>
          <button className="welcome-skip" onClick={() => enterApp()}>
            跳过
          </button>
        </header>
        <MobileScroll className="welcome-scroll" aria-label="首次使用介绍">
          <main className="welcome-content">
            <section className="welcome-intro">
              <h1>看清每一次变化</h1>
              <p>
                <IoCheckmarkCircleOutline aria-hidden="true" />
                报告识别与指标对比，免费使用
              </p>
            </section>
            <section className="welcome-methods" aria-label="支持的报告导入方式">
              <ul>
                <li>
                  <IoDocumentTextOutline aria-hidden="true" />
                  <span>PDF 导入</span>
                </li>
                <li>
                  <IoCameraOutline aria-hidden="true" />
                  <span>拍照识别</span>
                </li>
                <li>
                  <IoImagesOutline aria-hidden="true" />
                  <span>相册识别</span>
                </li>
              </ul>
            </section>
            <figure className="welcome-example">
              <button
                className="welcome-capture"
                aria-label="放大查看实际指标界面示例"
                onClick={() => setWelcomePreviewOpen(true)}
              >
                <img
                  src="/assets/onboarding/native-metric-card.png"
                  width="1062"
                  height="1284"
                  draggable={false}
                  alt="实际 App 的指标卡片，示例数据：丙氨酸氨基转移酶由 2026 年 9 月 18 日的 100 U/L 变为 10 月 18 日的 80 U/L，包含折线图和两次历史记录。"
                />
              </button>
              <figcaption>
                实际界面 · 示例数据
                <IoExpandOutline aria-hidden="true" />
              </figcaption>
            </figure>
          </main>
        </MobileScroll>
        <footer className="welcome-footer">
          <p>
            <IoLockClosedOutline aria-hidden="true" />
            无需注册 · 报告保存在本机
          </p>
          <button className="primary welcome-start" onClick={() => enterApp()}>
            开始记录
          </button>
        </footer>
        <BottomSheet
          open={welcomePreviewOpen}
          onOpenChange={setWelcomePreviewOpen}
          title="指标变化"
          description="实际 App 界面 · 示例数据"
        >
          <img
            className="welcome-enlarged"
            src="/assets/onboarding/native-metric-card.png"
            width="1062"
            height="1284"
            draggable={false}
            alt="丙氨酸氨基转移酶：100 U/L 变为 80 U/L，较上次 -20 U/L；折线图与历史记录。"
          />
          <button className="primary full" onClick={() => setWelcomePreviewOpen(false)}>
            返回引导
          </button>
        </BottomSheet>
      </div>
    );
  }

  return (
    <div className="health-app">
      <header className={`health-header ${route !== 'main' ? 'sub-header' : ''}`}>
        {route === 'main' ? (
          <>
            <div className="header-copy">
              <h1>
                {tab === 'records'
                  ? `${member.label}的健康记录`
                  : tab === 'metrics'
                    ? '指标变化'
                    : '设置'}
              </h1>
              <p>
                {tab === 'records'
                  ? '把每一次就诊和检查，慢慢整理好。'
                  : tab === 'metrics'
                    ? '先看参考范围，再看数值变化。'
                    : '你的记录，由你掌握。'}
              </p>
            </div>
            <button
              className="member-trigger"
              onClick={() => setSheet('switch')}
              aria-label={`切换成员，当前${member.label}`}
            >
              <Avatar m={member} small />
              <span>{member.label}</span>
              <IoChevronDown />
            </button>
          </>
        ) : (
          <>
            <button
              className="back-button"
              aria-label="返回"
              onClick={() => go(route === 'document' ? 'main' : route === 'report' ? returnRoute : addReturn)}
            >
              <IoChevronBack />
            </button>
            <strong>
              {route === 'document' ? '整份报告' : route === 'add'
                ? '添加家庭成员'
                : report.status === 'review'
                  ? '核对报告'
                  : '报告详情'}
            </strong>
            <span className="header-spacer" />
          </>
        )}
      </header>

      <MobileScroll
        key={`${route}-${tab}-${activeId}`}
        className={`health-scroll ${route === 'main' ? 'with-tabs' : route === 'add' ? 'with-form-footer' : ''}`}
      >
        <main className="health-content">
          {route === 'main' && tab === 'records' && (
            <>
              <section className="library-card archive-summary">
                <div className="spread"><span>{member.label}的资料库</span><span className="archive-example">示例数据 <IoLockClosedOutline /></span></div>
                <div className="archive-counts"><div><b>{myVisits.length}</b><span>次就诊</span></div><i /><div><b>{mine.length}</b><span>份检验</span></div></div>
                <p>资料保存在这台设备，可随时查看原件。</p>
              </section>
              <button className="primary" onClick={() => chooseImport('pdf')}><IoAdd />导入 PDF</button>
              <div className="two-buttons">
                <button className="secondary" onClick={() => chooseImport('camera')}><IoCameraOutline />拍照识别</button>
                <button className="secondary" onClick={() => chooseImport('album')}><IoImagesOutline />从相册选择</button>
              </div>
              <div className="archive-segments" role="tablist" aria-label="记录类型">
                <button role="tab" id="visits-tab" aria-controls="archive-panel" aria-selected={recordView === 'visits'} onClick={() => changeRecordView('visits')}>就诊记录</button>
                <button role="tab" id="reports-tab" aria-controls="archive-panel" aria-selected={recordView === 'reports'} onClick={() => changeRecordView('reports')}>检验报告{pending.length > 0 && <span className="archive-pending-dot" aria-label={`${pending.length} 份待核对`} />}</button>
              </div>
              <section id="archive-panel" role="tabpanel" aria-labelledby={recordView === 'visits' ? 'visits-tab' : 'reports-tab'} className="archive-panel">
                {recordView === 'visits' ? (myVisits.length ? myVisits.map(v => (
                  <section key={v.id}>
                    <div className="date-label"><IoCalendarOutline />{cnDate(v.draft.date)}</div>
                    <button className="archive-visit-row" onClick={() => openVisit(v)}>
                      <div className="spread"><h2>{v.draft.department || '门诊就诊'}</h2><IoChevronForward /></div>
                      <p>{v.draft.hospital}</p>
                      <strong>{v.draft.chief}</strong>
                      <span><IoDocumentTextOutline />病历 1 份<span className="archive-divider">·</span><IoLinkOutline />检验 {v.linked.length} 份</span>
                    </button>
                  </section>
                )) : <div className="empty archive-empty"><IoCalendarOutline /><h2>还没有就诊记录</h2><p>拍下门诊病历，自动整理这次就诊。</p><button className="text-button" onClick={() => chooseImport('camera')}>拍照识别<IoChevronForward /></button></div>) : (mine.length ? [...new Set(mine.map(r => r.date))].map(date => (
                  <section key={date}>
                    <div className="date-label"><IoCalendarOutline />{cnDate(date)}</div>
                    <div className="archive-report-group">
                      {documentReports.some(r => r.date === date) && <button className="report-row" onClick={() => go('document')}>
                        <IoDocumentTextOutline className="row-icon" /><span className="row-copy"><strong>报告.pdf</strong><span>{documentReports.length} 个检查分区 · {documentResultCount} 项结果</span></span><IoChevronForward />
                      </button>}
                      {mine.filter(r => r.date === date && !documentReports.some(d => d.id === r.id)).map(r => <ReportRow key={r.id} r={r} />)}
                    </div>
                  </section>
                )) : <div className="empty archive-empty"><IoDocumentTextOutline /><h2>还没有检验报告</h2><p>导入或拍下报告，核对后查看指标变化。</p><button className="text-button" onClick={() => chooseImport('pdf')}>导入 PDF<IoChevronForward /></button></div>)}
              </section>
            </>
          )}

          {route === 'main' && tab === 'metrics' && (
            <MetricsOverview key={activeId} memberId={activeId} memberLabel={member.label} />
          )}

          {route === 'main' && tab === 'settings' && (
            <>
              <section className="settings-card">
                <h2>
                  <IoLockClosedOutline />
                  本地资料
                </h2>
                <p>已保存 {myVisits.length} 次就诊 · {mine.length} 份检验</p>
                <span>PDF 和指标保存在本机，识别时不会上传报告。</span>
              </section>
              <button className="settings-member" onClick={() => setSheet('switch')}>
                <IoPeopleOutline />
                <span className="row-copy">
                  <strong>家庭成员</strong>
                  <span>
                    {members.length} 份独立档案 · 当前为{member.label}
                  </span>
                </span>
                <IoChevronForward />
              </button>
              <section className="settings-card">
                <h2>识别范围</h2>
                <span>支持 PDF 和图片，在本机提取报告内容。识别结果可对照原件核对。</span>
              </section>
              <section className="settings-card">
                <div className="spread">
                  <h2>帮助改进使用体验</h2>
                  <span className="badge">未开启</span>
                </div>
                <span>使用统计默认关闭，不发送报告内容、文件名或指标。</span>
              </section>
              <section className="settings-card">
                <h2>关于</h2>
                <span>我的健康记录 · 交互原型</span>
                <span>整理记录与展示数值变化，不提供诊断或治疗建议。</span>
              </section>
              <button className="settings-member" onClick={() => go('welcome')}>
                <IoDocumentTextOutline />
                <span className="row-copy">
                  <strong>使用引导</strong>
                  <span>看看如何开始记录</span>
                </span>
                <IoChevronForward />
              </button>
            </>
          )}

          {route === 'document' && (
            <>
              <div className="page-intro"><div className="spread"><h1>报告.pdf</h1><span className="badge">示例数据</span></div><p>2 页原件 · {member.label}的档案</p></div>
              <button className="visit-original-row" onClick={() => { keyboard.hide(); setDocumentSourcePage(0); }}>
                <img src="/assets/visit/sample-blood.png" alt="报告原件示例缩略图" /><span><strong>查看完整原件</strong><small>可翻页、放大查看</small></span><IoExpandOutline />
              </button>
              <div className="section-title"><h2>检查分区</h2><span>{documentReports.length} 份 · {documentResultCount} 项结果</span></div>
              <div className="archive-report-group">{documentReports.map((r, i) => <button className="report-row" key={r.id} onClick={() => openReport(r)}>
                <IoDocumentTextOutline className="row-icon" /><span className="row-copy"><strong>{r.title}</strong><span>第 {i + 1} 页 · {r.count} 项指标</span></span><span className="badge">已核对</span><IoChevronForward />
              </button>)}</div>
              {documentLinkedVisits.map(v => <button className="archive-report-link" key={v.id} onClick={() => openVisit(v)}><IoLinkOutline /><span>关联就诊 · {v.draft.department}<small>{cnDate(v.draft.date)} · {v.draft.hospital}</small></span><IoChevronForward /></button>)}
              <p className="document-help">本页管理整份文件；点进分区可查看单份检验。</p>
              <div className="document-delete-area"><button className="document-delete-link" onClick={() => { keyboard.hide(); setSheet('delete-document'); }}><IoTrashOutline />删除整份报告</button></div>
            </>
          )}

          {route === 'report' && (
            <>
              <div className="spread report-heading">
                <span className={`badge ${report.status === 'review' ? 'amber' : ''}`}>
                  {report.status === 'review' ? '待核对' : '已核对'}
                </span>
                <span className="muted small-copy">{cnDate(report.date)}</span>
              </div>
              <div className="page-intro">
                <h1>{report.title}</h1>
                <p>{report.status === 'review' ? '已识别为检验报告 · ' : ''}已提取 {report.count} 项指标</p>
              </div>
              <button className="visit-original-row" onClick={() => { keyboard.hide(); setReportSourceOpen(true); }}>
                <img src={reportSourceImage(report)} alt="检验报告示例缩略图" /><span><strong>报告原件</strong><small>示例报告 · 点开放大</small></span><IoExpandOutline />
              </button>
              {myVisits.filter(v => v.linked.includes(report.id)).map(v => <button className="archive-report-link" key={v.id} onClick={() => openVisit(v)}><IoLinkOutline /><span>关联就诊 · {v.draft.department}<small>{cnDate(v.draft.date)} · {v.draft.hospital}</small></span><IoChevronForward /></button>)}
              {mismatch && (
                <section className="warning-card">
                  <strong>
                    <IoAlertCircleOutline />
                    报告姓名与成员姓名不同
                  </strong>
                  <p>
                    原报告是“{report.patient}”，当前是{owner.label}的档案（{owner.name}
                    ）。请对照原件确认。
                  </p>
                  <button
                    className={`confirm-check ${mismatchAccepted ? 'checked' : ''}`}
                    role="checkbox"
                    aria-checked={mismatchAccepted}
                    onClick={() => setMismatchAccepted((v) => !v)}
                  >
                    <span>{mismatchAccepted && <IoCheckmark />}</span>我已核对，确实属于
                    {owner.label}
                  </button>
                </section>
              )}
              <div className="section-title">
                <h2>提取结果</h2>
                <span>{reportExampleValues(report).length} 项示例</span>
              </div>
              <div className="observations">
                {reportExampleValues(report).map(([name, unit, value, range]) => (
                  <div className="observation" key={name}>
                    <div>
                      <strong>
                        {name} <small>{unit}</small>
                      </strong>
                      <p>参考 {range}</p>
                    </div>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
              {report.status === 'review' ? (
                <>
                  <button
                    className="primary"
                    disabled={mismatch && !mismatchAccepted}
                    onClick={saveReport}
                  >
                    核对完成，保存
                  </button>
                  <button
                    className="text-button centered"
                    onClick={() => {
                      go(returnRoute);
                      setToast(`已暂存到${owner.label}的档案`);
                    }}
                  >
                    暂存，稍后核对
                  </button>
                </>
              ) : (
                <button className="primary" onClick={() => go(returnRoute)}>
                  返回
                </button>
              )}
            </>
          )}

          {route === 'add' && (
            <>
              <div className="page-intro">
                <h1>为家人建一份档案</h1>
                <p>起一个熟悉的称呼，方便下次找到。</p>
              </div>
              <form
                className="member-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  addMember();
                }}
              >
                <label>
                  怎么称呼 <span className="required">必填</span>
                  <KeyboardInput
                    value={newLabel}
                    onChange={(e) => {
                      setNewLabel(e.target.value);
                      setFormError('');
                    }}
                    placeholder="例如：奶奶"
                    maxLength={12}
                  />
                </label>
                <label>
                  报告上的姓名 <span>选填</span>
                  <KeyboardInput
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="用于核对报告姓名"
                    maxLength={30}
                  />
                  <small>姓名不一致时提醒核对，之后也可以补充。</small>
                </label>
                <label>
                  出生日期 <span>选填</span>
                  <KeyboardInput
                    value={newBirth}
                    onChange={(e) => setNewBirth(e.target.value)}
                    placeholder="YYYY-MM-DD"
                    maxLength={10}
                  />
                </label>
                {formError && (
                  <p role="alert" className="form-error">
                    {formError}
                  </p>
                )}
              </form>
            </>
          )}
        </main>
      </MobileScroll>
      {route === 'add' && (
        <div className="form-footer" style={{ bottom: bottomInset }}>
          <button className="primary" onPointerDown={(e) => e.preventDefault()} onClick={addMember}>
            <IoAdd />
            创建档案
          </button>
        </div>
      )}
      {route === 'main' && (
        <nav className="health-tabs" aria-label="主导航">
          {[
            { id: 'records', label: '记录', Icon: IoFolderOpenOutline },
            { id: 'metrics', label: '指标', Icon: IoPulseOutline },
            { id: 'settings', label: '设置', Icon: IoSettingsOutline },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => {
                keyboard.hide();
                setTab(id);
              }}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      {toast && (
        <div className="health-toast" role="status" style={{ bottom: bottomInset + 80 }}>
          <IoCheckmarkCircleOutline />
          {toast}
        </div>
      )}
      <BottomSheet open={sheet === 'delete-document'} onOpenChange={open => !open && setSheet(null)} title="删除整份报告？" description="报告.pdf" snap={0.64}>
        <div className="document-delete-confirm">
          <p>将从{member.label}的档案中删除：</p>
          <div className="document-delete-summary">
            <div><span>PDF 原件</span><strong>1 份</strong></div>
            <div><span>检验记录</span><strong>{documentReports.length} 份 · {documentResultCount} 项结果</strong></div>
          </div>
          <p>对应结果会从指标历史中移除。{documentLinkedVisits.length > 0 && '已关联的就诊记录保留，仅解除关联。'}</p>
          <p className="document-delete-note">仅删除本 App 中的资料，删除后无法恢复。</p>
          <div className="document-delete-actions"><button className="secondary" onClick={() => setSheet(null)}>取消</button><button className="danger-solid" onClick={deleteExampleDocument}>确认删除</button></div>
        </div>
      </BottomSheet>
      <BottomSheet
        open={sheet === 'switch'}
        onOpenChange={(open) => !open && setSheet(null)}
        title="切换成员"
        description="切换后，查看和导入的都是该成员的记录。"
        snap={0.83}
      >
        <div className="sheet-members">
          {members.map((m) => (
            <button
              className="member-row"
              key={m.id}
              onClick={() => selectMember(m.id)}
              aria-pressed={activeId === m.id}
            >
              <Avatar m={m} />
              <span className="row-copy">
                <strong>{m.label}</strong>
                <span>
                  {m.name || '姓名未填写'} · {visits.filter(v => v.memberId === m.id).length} 次就诊 · {records.filter(r => r.memberId === m.id).length} 份检验
                </span>
              </span>
              {activeId === m.id && <IoCheckmark className="selected-check" />}
            </button>
          ))}
        </div>
        <button className="secondary full" onClick={startAdd}>
          <IoAdd />
          添加家庭成员
        </button>
        <button className="text-button centered" onClick={() => setSheet(null)}>
          取消
        </button>
      </BottomSheet>
      <BottomSheet
        open={sheet === 'import'} onOpenChange={open => !open && setSheet(null)}
        title={importMethod === 'pdf' ? '选择示例 PDF' : importMethod === 'camera' ? '试拍一份示例资料' : '选择示例照片'}
        description="原型使用虚构资料。选择原件后，自动进入对应核对页。" snap={0.68}
      >
        <div className="archive-import-samples">
          <button onClick={() => importExample('visit')}><img src="/assets/visit/sample-note.png" alt="门诊病历示例" /><span><strong>10月23日_门诊病历.{importMethod === 'pdf' ? 'pdf' : 'jpg'}</strong><small>杭城医院 · 1 页</small></span><IoChevronForward /></button>
          <button onClick={() => importExample('lab')}><img src="/assets/visit/sample-lab.png" alt="检验报告示例" /><span><strong>10月23日_生化检验.{importMethod === 'pdf' ? 'pdf' : 'jpg'}</strong><small>杭城医院 · 1 页</small></span><IoChevronForward /></button>
        </div>
        <p className="small-copy muted">病历和检验报告共用这个入口，无需提前选择类型。</p>
        <button className="text-button centered" onClick={() => setSheet(null)}>取消</button>
      </BottomSheet>
      {documentSourcePage !== null && <VisitSourceViewer section="full" customImage={`/assets/visit/sample-${documentSourcePage === 0 ? 'blood' : 'crp'}.png`} customTitle="报告.pdf · 示例" page={documentSourcePage} onPageChange={setDocumentSourcePage} onClose={() => setDocumentSourcePage(null)} onManage={() => { setDocumentSourcePage(null); go('document'); }} />}
      {reportSourceOpen && <VisitSourceViewer section="full" customImage={reportSourceImage(report)} customTitle="报告原件 · 示例" onClose={() => setReportSourceOpen(false)} onManage={deletionDemo && deletionExampleIds.includes(report.id) ? () => { setReportSourceOpen(false); go('document'); } : undefined} />}
    </div>
  );
}

// Photo-to-visit exploration. All content below is fictional and session-only.
type VisitDraft = {
  note?: string;
  date: string; hospital: string; department: string;
  chief: string; diagnosis: string; advice: string;
  history: string; past: string; exam: string;
};
type ArchiveVisit = { id: string; memberId: string; draft: VisitDraft; linked: string[] };
type VisitPrototypeProps = {
  readingDesign?: boolean;
  initial?: VisitDraft;
  initialLinked?: string[];
  initiallySaved?: boolean;
  memberLabel?: string;
  reports?: Pick<RecordItem, 'id' | 'title' | 'date' | 'count'>[];
  onExit?: () => void;
  onSave?: (draft: VisitDraft, linked: string[]) => void;
  onOpenReport?: (id: string) => void;
  requiresIdentityConfirmation?: boolean;
  memberName?: string;
};
type VisitSection = 'chief' | 'diagnosis' | 'advice' | 'history' | 'past' | 'exam';
const exampleVisit: VisitDraft = {
  date: '2026-10-23', hospital: '杭城医院', department: '呼吸内科',
  chief: '咳嗽 3 天。', diagnosis: '上呼吸道感染。',
  advice: '完善相关检查，携结果门诊复诊。',
  history: '患者 3 天前出现咳嗽，偶有咳痰，无明显发热。',
  past: '既往体健。', exam: '咽部稍充血，双肺呼吸音清。',
};
const visitLabels: Record<VisitSection, string> = {
  chief: '就诊原因', diagnosis: '医生诊断', advice: '处理／医嘱',
  history: '现病史', past: '既往史', exam: '体格检查',
};
const visitReports = [
  { id: 'blood', title: '血常规', date: '2026-10-23', count: 23 },
  { id: 'chemistry', title: '生化检验', date: '2026-10-18', count: 18 },
];
type VisitContextValue = VisitPrototypeProps & {
  draft: VisitDraft;
  setDraft: React.Dispatch<React.SetStateAction<VisitDraft>>;
  saved: boolean;
  setSaved: (saved: boolean) => void;
  linked: string[];
  setLinked: (ids: string[]) => void;
  identityConfirmed: boolean;
  setIdentityConfirmed: (confirmed: boolean) => void;
};
const VisitContext = createContext<VisitContextValue | null>(null);
function useVisit() { return useContext(VisitContext)!; }

function VisitPrototype(props: VisitPrototypeProps = {}) {
  const [draft, setDraft] = useState<VisitDraft>(() => ({ ...(props.initial || exampleVisit) }));
  const [saved, setSaved] = useState(props.initiallySaved || false);
  const [linked, setLinked] = useState<string[]>(props.initialLinked || []);
  const [identityConfirmed, setIdentityConfirmed] = useState(!props.requiresIdentityConfirmation);
  const { screenRef } = useScreenPortal();
  useEffect(() => {
    const screen = screenRef.current;
    const keepAligned = () => { if (screen) { screen.scrollTop = 0; screen.scrollLeft = 0; } };
    screen?.addEventListener('scroll', keepAligned);
    return () => screen?.removeEventListener('scroll', keepAligned);
  }, [screenRef]);
  return <VisitContext.Provider value={{ ...props, draft, setDraft, saved, setSaved, linked, identityConfirmed, setIdentityConfirmed, setLinked: ids => { setLinked(ids); if (saved) props.onSave?.(draft, ids); } }}>
    <div className="health-app visit-app"><FlowStack initial={props.initiallySaved ? visitDetailScreen : visitReviewScreen} /></div>
  </VisitContext.Provider>;
}

function VisitHeader({ mode }: { mode: 'review' | 'capture' | 'detail' | 'timeline' }) {
  const flow = useFlow();
  const { saved, onExit, readingDesign } = useVisit();
  if (readingDesign && mode === 'detail') return <div className="visit-nav reader-nav">
    <button className="visit-back" onClick={() => flow.replace(visitTimelineScreen)}><IoChevronBack />返回</button>
    <strong>就诊详情</strong>
    <button className="reader-edit" onClick={() => flow.replace(visitReviewScreen)}>编辑</button>
  </div>;
  return <div className="visit-nav">
    {mode === 'timeline' ? <span className="visit-nav-title">我的健康记录</span> :
      <button className="visit-back" onClick={() => onExit ? onExit() : flow.replace(
        mode === 'review' ? (saved ? visitDetailScreen : visitCaptureScreen) : visitTimelineScreen,
      )}><IoChevronBack />返回</button>}
    <span className={mode === 'detail' ? 'visit-saved' : 'visit-demo'}>
      {mode === 'detail' ? <><IoCheckmarkCircleOutline />已保存</> : '示例病历'}
    </span>
  </div>;
}
const visitReviewScreen: FlowScreen = {
  id: 'visit-review', headerHeight: 52,
  header: () => <VisitHeader mode="review" />,
  footerHeight: 78, footer: () => <VisitSaveFooter />,
  render: () => <VisitBody editable />,
};
const visitCaptureScreen: FlowScreen = {
  id: 'visit-capture', headerHeight: 52,
  header: () => <VisitHeader mode="capture" />,
  render: () => <VisitCapture />,
};
const visitDetailScreen: FlowScreen = {
  id: 'visit-detail', headerHeight: 52,
  header: () => <VisitHeader mode="detail" />,
  render: () => <VisitDetailBody />,
};
function VisitDetailBody() {
  return useVisit().readingDesign ? <VisitReader /> : <VisitBody editable={false} />;
}

function VisitReader() {
  const { draft, setDraft, linked, setLinked, reports, memberLabel } = useVisit();
  const available = reports || visitReports;
  const [expanded, setExpanded] = useState(false);
  const [original, setOriginal] = useState(false);
  const [manage, setManage] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const note = draft.note || '';
  const [noteDraft, setNoteDraft] = useState(note);
  const [editNote, setEditNote] = useState(false);
  const keyboard = useKeyboard();
  const chosen = available.filter(r => linked.includes(r.id));
  const activeReport = available.find(r => r.id === report);
  const date = draft.date.split('-');
  return <>
    <MobileScroll className="visit-scroll">
      <article className="reader-content">
        <header className="reader-identity">
          <div className="reader-date"><span>{date[0]} 年 {Number(date[1])} 月 {Number(date[2])} 日</span><span className="reader-confirmed"><IoCheckmarkCircleOutline />已确认</span></div>
          <h1>{draft.department || '门诊'}就诊</h1>
          <p>{draft.hospital || '医院未填写'}<span>·</span>{memberLabel || '我'}</p>
          <button className="reader-source" onClick={() => setOriginal(true)}><IoDocumentTextOutline />病历原件<span>1 页</span><IoChevronForward /></button>
        </header>
        <section className="reader-paper" aria-label="已确认的病历内容">
          <div className="reader-chief"><h2>就诊原因</h2><p>{draft.chief || '未记录'}</p></div>
          <div className="reader-diagnosis"><h2>医生诊断</h2><p>{draft.diagnosis || '未记录'}</p></div>
          <div className="reader-advice"><h2>处理与医嘱</h2><p>{draft.advice || '未记录'}</p></div>
          <button className="reader-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span>{expanded ? '收起其余病历' : '其余病历内容'}<small>现病史、既往史、体格检查</small></span><IoChevronDown className={expanded ? 'is-open' : ''} /></button>
          {expanded && <div className="reader-history">{(['history','past','exam'] as VisitSection[]).map(key => <section key={key}><h3>{visitLabels[key]}</h3><p>{draft[key] || '未记录'}</p></section>)}</div>}
        </section>
        <section className="reader-reports">
          <div className="reader-section-title"><h2>相关检验<span>{chosen.length} 份</span></h2><button onClick={() => { setPending(linked); setManage(true); }}>管理</button></div>
          <div className="reader-report-list">{chosen.length ? chosen.map(r => <button key={r.id} onClick={() => setReport(r.id)}><IoDocumentTextOutline /><span><strong>{r.title}</strong><small>{r.date.replaceAll('-','.')} · {r.count} 项</small></span><IoChevronForward /></button>) : <button className="reader-empty" onClick={() => {setPending([]);setManage(true);}}><IoAdd /><span>关联这次就诊的检验报告</span><IoChevronForward /></button>}</div>
        </section>
        <section className="reader-note">
          <div className="reader-section-title"><h2>我的备注</h2><button aria-label="编辑我的备注" onClick={() => {setNoteDraft(note);setEditNote(true);}}><IoCreateOutline /></button></div>
          <p>{note || '添加想记住的事'}</p>
        </section>
        <p className="reader-demo">交互原型 · 全部为虚构示例</p>
      </article>
    </MobileScroll>
    {original && <VisitSourceViewer section="full" onClose={() => setOriginal(false)} />}
    <BottomSheet open={manage} onOpenChange={setManage} title="相关检验" description="选择与这次就诊有关的报告。" snap={0.6}>
      <div className="visit-report-options">{available.map(r => <button key={r.id} role="checkbox" aria-checked={pending.includes(r.id)} onClick={() => setPending(v => v.includes(r.id) ? v.filter(id => id !== r.id) : [...v,r.id])}><IoDocumentTextOutline /><span><strong>{r.title}</strong><small>{r.date} · {r.count} 项</small></span><span className={`visit-checkbox ${pending.includes(r.id) ? 'checked' : ''}`}>{pending.includes(r.id) && <IoCheckmark />}</span></button>)}</div>
      <button className="primary" onClick={() => { setLinked(pending);setManage(false); }}>保存关联</button>
    </BottomSheet>
    <BottomSheet open={!!report} onOpenChange={open => !open && setReport(null)} title={activeReport?.title || '检验报告'} description={`${activeReport?.date || ''} · 示例报告`} snap={0.52}>
      <div className="visit-report-preview">{(report === 'blood' ? [['白细胞','6.2','10⁹/L','3.5–9.5'],['血红蛋白','136','g/L','115–150']] : [['葡萄糖','5.1','mmol/L','3.9–6.1'],['丙氨酸氨基转移酶','32','U/L','9–50']]).map(([name,value,unit,range]) => <div key={name}><span>{name}<small>{unit}</small></span><strong>{value}</strong><small>参考范围 {range}</small></div>)}</div>
      <button className="secondary full" onClick={() => setReport(null)}>返回就诊详情</button>
    </BottomSheet>
    <BottomSheet open={editNote} onOpenChange={setEditNote} title="我的备注" snap={0.65}>
      <div className="visit-edit-form"><KeyboardTextarea aria-label="我的备注" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={4} /></div>
      <button className="primary" onClick={() => { keyboard.hide();setDraft(v => ({ ...v, note: noteDraft.trim() }));setEditNote(false); }}>保存备注</button>
    </BottomSheet>
  </>;
}
const visitTimelineScreen: FlowScreen = {
  id: 'visit-timeline', headerHeight: 52,
  header: () => <VisitHeader mode="timeline" />,
  render: () => <VisitTimeline />,
};
function VisitSaveFooter() {
  const flow = useFlow(); const { draft, setSaved, saved, linked, onSave, identityConfirmed } = useVisit();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && !!draft.chief.trim() && identityConfirmed;
  return <div className="visit-footer">
    <button className="primary" disabled={!valid} onClick={() => { setSaved(true); onSave?.(draft, linked); flow.replace(visitDetailScreen); }}>
      {saved ? '保存修改' : '保存就诊记录'}
    </button>
  </div>;
}

function VisitBody({ editable }: { editable: boolean }) {
  const { draft, setDraft, linked, setLinked, reports, memberLabel, onExit, onOpenReport, requiresIdentityConfirmation, memberName, identityConfirmed, setIdentityConfirmed } = useVisit();
  const availableReports = reports || visitReports;
  const flow = useFlow(); const keyboard = useKeyboard();
  const [more, setMore] = useState(false);
  const [edit, setEdit] = useState<VisitSection | 'meta' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editMeta, setEditMeta] = useState({ date: '', hospital: '', department: '' });
  const [fieldError, setFieldError] = useState('');
  const [source, setSource] = useState<VisitSection | 'full' | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [pendingLinks, setPendingLinks] = useState<string[]>([]);
  const [openReport, setOpenReport] = useState<string | null>(null);
  function beginEdit(key: VisitSection | 'meta') {
    keyboard.hide(); setFieldError('');
    if (key === 'meta') setEditMeta({ date: draft.date, hospital: draft.hospital, department: draft.department });
    else setEditValue(draft[key]);
    setEdit(key);
  }
  function finishEdit() {
    if (edit === 'meta') {
      const date = new Date(`${editMeta.date}T12:00:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(editMeta.date) || Number.isNaN(+date) || date.toISOString().slice(0, 10) !== editMeta.date) {
        setFieldError('请填写有效日期，例如 2026-10-23'); return;
      }
      setDraft(d => ({ ...d, ...editMeta }));
    } else if (edit) {
      if (edit === 'chief' && !editValue.trim()) { setFieldError('请保留就诊原因，方便以后查找。'); return; }
      setDraft(d => ({ ...d, [edit]: editValue.trim() }));
    }
    keyboard.hide(); setEdit(null);
  }
  function showSource(key: VisitSection | 'full') { keyboard.hide(); setSource(key); }
  function section(key: VisitSection) {
    const modified = draft[key] !== exampleVisit[key];
    return <section className="visit-section" key={key}>
      <div className="visit-section-heading">
        <h2>{visitLabels[key]}{(key === 'diagnosis' || key === 'advice') && <small>原文</small>}</h2>
        {editable && <button className="visit-edit-icon" aria-label={`修改${visitLabels[key]}`} onClick={() => beginEdit(key)}><IoCreateOutline /></button>}
      </div>
      <p className={!draft[key] ? 'visit-empty-value' : ''}>{draft[key] || '未识别到，可手动补充'}</p>
      {editable && <div className="visit-field-tools">
        <button onClick={() => showSource(key)}>查看原文<IoChevronForward /></button>
        {modified && <span>已修改</span>}
      </div>}
    </section>;
  }
  return <>
    <MobileScroll className="visit-scroll">
      <div className={`visit-content ${editable ? 'visit-with-footer' : ''}`}>
        <div className="visit-intro">
          <h1>{editable ? '核对就诊记录' : '就诊详情'}</h1>
          <p>{editable ? '已识别为门诊病历，内容可直接修改。' : `${draft.date.replaceAll('-', '.')} · ${draft.department || '门诊'}`}</p>
        </div>
        {editable && requiresIdentityConfirmation && <section className="warning-card">
          <strong><IoAlertCircleOutline />病历姓名与当前成员不同</strong>
          <p>原件姓名为“林晓”，当前是{memberLabel}的档案（{memberName || '姓名未填写'}）。</p>
          <button className={`confirm-check ${identityConfirmed ? 'checked' : ''}`} role="checkbox" aria-checked={identityConfirmed} onClick={() => setIdentityConfirmed(!identityConfirmed)}><span>{identityConfirmed && <IoCheckmark />}</span>我已核对，确实属于{memberLabel}</button>
        </section>}
        <div className="visit-meta">
          <div><strong>{draft.hospital || '医院未填写'}</strong><span>{draft.department || '科室未填写'}</span></div>
          <div className="visit-meta-bottom"><span><IoCalendarOutline />{draft.date}</span>
            {editable ? <button onClick={() => beginEdit('meta')}>修改<IoCreateOutline /></button> :
              <button onClick={() => flow.replace(visitReviewScreen)}>编辑记录<IoCreateOutline /></button>}
          </div>
        </div>
        <button className="visit-original-row" onClick={() => showSource('full')}>
          <img src="/assets/visit/sample-note.png" alt="门诊病历缩略图" draggable={false} />
          <span><strong>病历原件</strong><small>1 张照片 · 点开放大</small></span><IoExpandOutline />
        </button>
        <div className="visit-sections">{(['chief', 'diagnosis', 'advice'] as VisitSection[]).map(section)}</div>
        <div className="visit-more">
          <button className="visit-more-trigger" onClick={() => setMore(!more)} aria-expanded={more}>
            <span><strong>更多病历内容</strong><small>现病史、既往史、体格检查</small></span>
            <IoChevronDown className={more ? 'is-open' : ''} />
          </button>
          {more && <div>{(['history', 'past', 'exam'] as VisitSection[]).map(section)}</div>}
        </div>
        {!editable && <section className="visit-links">
          <div className="visit-section-heading"><h2>关联报告{linked.length > 0 && <small>{linked.length} 份</small>}</h2>
            <button className="visit-link-action" onClick={() => { keyboard.hide(); setPendingLinks(linked); setLinkOpen(true); }}><IoAdd />关联报告</button>
          </div>
          {linked.length === 0 ? <p>把这次检查的报告放在一起，复诊时更好找。</p> : linked.map(id => {
            const r = availableReports.find(r => r.id === id);
            if (!r) return null;
            return <button className="visit-linked-row" key={id} onClick={() => onOpenReport ? onOpenReport(id) : setOpenReport(id)}><IoDocumentTextOutline /><span><strong>{r.title}</strong><small>{r.date} · {r.count} 项指标</small></span><IoChevronForward /></button>;
          })}
        </section>}
        <p className="visit-disclaimer">{editable ? '只整理病历原文，不生成诊断或用药建议。' : '示例内容 · 原件与就诊记录一同保存'}</p>
        {!editable && <button className="secondary full" onClick={() => onExit ? onExit() : flow.replace(visitTimelineScreen)}>{onExit ? '返回就诊记录' : '返回就诊时间线'}</button>}
      </div>
    </MobileScroll>
    <BottomSheet open={edit !== null} onOpenChange={open => { if (!open) { keyboard.hide(); setEdit(null); } }} title={edit === 'meta' ? '就诊信息' : `修改${edit ? visitLabels[edit] : ''}`} description={edit === 'meta' ? '以病历中的就诊信息为准。' : '对照病历原文修改，原件会保留。'} snap={0.78}>
      {edit === 'meta' ? <div className="visit-edit-form">
        {(['date', 'hospital', 'department'] as const).map(key => <label key={key}>
          <span>{{ date: '就诊日期', hospital: '医院', department: '科室' }[key]}</span>
          <KeyboardInput aria-label={{ date: '就诊日期', hospital: '医院', department: '科室' }[key]} value={editMeta[key]} placeholder={key === 'date' ? 'YYYY-MM-DD' : '未填写'} onChange={e => setEditMeta(d => ({ ...d, [key]: e.target.value }))} />
        </label>)}
      </div> : edit && <div className="visit-edit-form">
        <div className="visit-edit-source"><span>病历原文</span><img src={`/assets/visit/${edit}.png`} alt={`${visitLabels[edit]}的原文截图`} /></div>
        <KeyboardTextarea aria-label={visitLabels[edit]} value={editValue} onChange={e => setEditValue(e.target.value)} rows={4} />
      </div>}
      {fieldError && <p className="visit-form-error" role="alert">{fieldError}</p>}
      <button className="primary" onClick={finishEdit}>完成</button>
    </BottomSheet>
    <BottomSheet open={linkOpen} onOpenChange={setLinkOpen} title="关联已有报告" description={`从${memberLabel || '我'}的已核对报告中选择，可随时取消关联。`} snap={0.68}>
      <div className="visit-report-options">{availableReports.map(r => <button key={r.id} role="checkbox" aria-checked={pendingLinks.includes(r.id)} onClick={() => setPendingLinks(ids => ids.includes(r.id) ? ids.filter(id => id !== r.id) : [...ids, r.id])}>
        <IoDocumentTextOutline /><span><strong>{r.title}</strong><small>{r.date} · {r.count} 项指标</small></span>
        <span className={`visit-checkbox ${pendingLinks.includes(r.id) ? 'checked' : ''}`}>{pendingLinks.includes(r.id) && <IoCheckmark />}</span>
      </button>)}</div>
      <button className="primary" onClick={() => { setLinked(pendingLinks); setLinkOpen(false); }}>完成{pendingLinks.length > 0 ? `（${pendingLinks.length} 份）` : ''}</button>
    </BottomSheet>
    <BottomSheet open={!!openReport} onOpenChange={open => !open && setOpenReport(null)} title={visitReports.find(r => r.id === openReport)?.title || '报告'} description="关联报告预览 · 示例数据" snap={0.56}>
      <div className="visit-report-preview">
        <p>{visitReports.find(r => r.id === openReport)?.date}</p>
        {(openReport === 'blood' ? [['白细胞', '6.2', '10⁹/L', '3.5–9.5'], ['血红蛋白', '136', 'g/L', '115–150']] : [['葡萄糖', '5.1', 'mmol/L', '3.9–6.1'], ['丙氨酸氨基转移酶', '32', 'U/L', '9–50']]).map(([name, value, unit, range]) => <div key={name}><span>{name}<small>{unit}</small></span><strong>{value}</strong><small>参考范围 {range}</small></div>)}
      </div>
    </BottomSheet>
    {source && <VisitSourceViewer section={source} onClose={() => setSource(null)} />}
  </>;
}

function VisitSourceViewer({ section, onClose, customImage, customTitle, onManage, page, onPageChange }: { section: VisitSection | 'full'; onClose: () => void; customImage?: string; customTitle?: string; onManage?: () => void; page?: number; onPageChange?: (page: number) => void }) {
  const { screenRef } = useScreenPortal();
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ distance: 0, scale: 1 });
  const clamp = (v: number) => Math.min(4, Math.max(1, v));
  const release = (id: number) => { pointers.current.delete(id); gesture.current.distance = 0; };
  useEffect(() => { setScale(1); setPan({ x: 0, y: 0 }); }, [customImage]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return <Dialog.Root open onOpenChange={open => !open && onClose()}><Dialog.Portal container={screenRef.current ?? undefined}><Dialog.Content className="visit-image-modal" aria-describedby={undefined}>
    <div className="visit-image-nav"><Dialog.Title>{customTitle || (section === 'full' ? '病历原件' : `${visitLabels[section]} · 原文`)}</Dialog.Title><div className="document-viewer-actions">{onManage && <button className="document-manage" onClick={onManage}>管理报告</button>}<button aria-label="关闭原文预览" autoFocus onClick={onClose}><IoClose /></button></div></div>
    <div className="visit-image-canvas" data-scroll-drag="ignore"
      onDoubleClick={() => { setScale(scale > 1 ? 1 : 2.3); setPan({ x: 0, y: 0 }); }}
      onWheel={e => { setScale(s => clamp(s - e.deltaY * 0.008)); if (scale <= 1.1) setPan({ x: 0, y: 0 }); }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }}
      onPointerMove={e => {
        const old = pointers.current.get(e.pointerId); if (!old) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const pts = [...pointers.current.values()];
        if (pts.length === 2) {
          const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (!gesture.current.distance) gesture.current = { distance, scale };
          setScale(clamp(gesture.current.scale * distance / gesture.current.distance));
        } else if (scale > 1) {
          const bounds = e.currentTarget.getBoundingClientRect();
          const maxX = bounds.width * (scale - 1) / 2; const maxY = bounds.height * (scale - 1) / 2;
          setPan(p => ({ x: Math.min(maxX, Math.max(-maxX, p.x + e.clientX - old.x)), y: Math.min(maxY, Math.max(-maxY, p.y + e.clientY - old.y)) }));
        }
      }} onPointerUp={e => release(e.pointerId)} onPointerCancel={e => release(e.pointerId)}>
      <img draggable={false} src={customImage || `/assets/visit/${section === 'full' ? 'sample-note' : section}.png`} alt={customTitle || (section === 'full' ? '完整示例门诊病历' : `${visitLabels[section]}原文`)} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }} />
    </div>
    {page !== undefined && onPageChange && <div className="document-page-switch"><button aria-label="上一页" disabled={page === 0} onClick={() => onPageChange(page - 1)}><IoChevronBack /></button><span>{page + 1} / 2 页</span><button aria-label="下一页" disabled={page === 1} onClick={() => onPageChange(page + 1)}><IoChevronForward /></button></div>}
    <p>双指缩放 · 双击放大{section !== 'full' && ' · 原文节选'}</p>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function VisitCapture() {
  const flow = useFlow(); const { setDraft, setSaved, setLinked } = useVisit();
  const [picked, setPicked] = useState(false);
  return <MobileScroll className="visit-scroll"><div className="visit-content">
    <div className="visit-intro"><h1>拍照记录就诊</h1><p>把纸质病历，留在自己的就诊时间线里。</p></div>
    <div className="visit-capture-paper"><img src="/assets/visit/sample-note.png" alt="用于体验识别流程的虚构门诊病历" /></div>
    <p className="visit-disclaimer">原型使用示例照片，点击下方体验识别后的效果。</p>
    {picked ? <><div className="visit-recognized"><IoCheckmarkCircleOutline /><span>已选择示例病历<small>将整理就诊日期、诊断与医嘱</small></span></div><button className="primary" onClick={() => { setDraft({ ...exampleVisit }); setSaved(false); setLinked([]); flow.replace(visitReviewScreen); }}>识别这张病历<IoChevronForward /></button><button className="text-button centered" onClick={() => setPicked(false)}>重新选择</button></> : <div className="visit-capture-actions"><button className="primary" onClick={() => setPicked(true)}><IoCameraOutline />拍照识别</button><button className="secondary" onClick={() => setPicked(true)}><IoImagesOutline />从相册选择</button></div>}
  </div></MobileScroll>;
}
function VisitTimeline() {
  const flow = useFlow(); const { draft, saved, linked } = useVisit();
  return <MobileScroll className="visit-scroll"><div className="visit-content">
    <div className="visit-intro"><h1>就诊时间线</h1><p>每一次就诊，都有迹可循。</p></div>
    <button className="primary" onClick={() => flow.push(visitCaptureScreen)}><IoAdd />记录一次就诊</button>
    {saved ? <div className="visit-timeline">
      <div className="visit-timeline-date"><IoCalendarOutline /><strong>{draft.date.replaceAll('-', '.')}</strong><span>1 次就诊</span></div>
      <button className="visit-timeline-card" onClick={() => flow.push(visitDetailScreen)}>
        <div><h2>{draft.department || '门诊就诊'}</h2><IoChevronForward /></div>
        <p>{draft.hospital}</p><strong>{draft.chief}</strong>
        <span>医生诊断：{draft.diagnosis || '未记录'}</span>
        <small><IoDocumentTextOutline />1 张病历原件{linked.length > 0 && <> · <IoLinkOutline />{linked.length} 份报告</>}</small>
      </button>
      <p className="visit-disclaimer">已显示全部就诊 · 示例数据</p>
    </div> : <div className="empty"><IoCalendarOutline /><h2>从第一张病历开始</h2><p>拍照或选取病历照片，整理成一次就诊。</p></div>}
    <a className="visit-existing-link" href="/?metrics=1">查看现有指标原型<IoChevronForward /></a>
  </div></MobileScroll>;
}
