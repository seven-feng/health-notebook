import { fireEvent, render, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { UntrendedResults } from '../../src/components/UntrendedResults';
import { MetricsOverview } from '../../src/components/MetricsOverview';
import { MissingDateNotice } from '../../src/components/MissingDateNotice';
import type { Report } from '../../src/domain/types';
import type { MetricSeries, TextMetricSeries } from '../../src/domain/types';
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const groups: MetricSeries[] = [
  {
    key: 'alt',
    name: '丙氨酸氨基转移酶',
    unit: 'U/L',
    points: [
      {
        reportId: 'a',
        observationId: 'a-alt',
        date: '2026-07-12',
        value: '100',
        rawValue: '100',
        reference: '9-50',
      },
      {
        reportId: 'b',
        observationId: 'b-alt',
        date: '2026-10-18',
        value: '80',
        rawValue: '80',
        reference: '9-50',
      },
    ],
  },
  {
    key: 'ast',
    name: '天门冬氨酸氨基转移酶',
    unit: 'U/L',
    points: [
      {
        reportId: 'b',
        observationId: 'b-ast',
        date: '2026-10-18',
        value: '35',
        rawValue: '35',
        reference: '15-40',
      },
    ],
  },
  {
    key: 'ck',
    name: '肌酸激酶',
    unit: 'U/L',
    points: [
      {
        reportId: 'b',
        observationId: 'b-ck',
        date: '2026-10-18',
        value: '156',
        rawValue: '156',
        reference: '',
      },
    ],
  },
];
test('compact rows expand on demand, show history ranges and open the source report', () => {
  const screen = render(<MetricsOverview groups={groups} />);
  expect(screen.queryByTestId('metric-trend-chart')).toBeNull();
  expect(screen.getByLabelText('超出范围，1项')).toBeTruthy();
  fireEvent.press(screen.getByTestId('metric-row-alt'));
  expect(screen.getByTestId('delta-丙氨酸氨基转移酶')).toHaveTextContent('-20 U/L');
  expect(screen.getByTestId('metric-reference-band')).toBeTruthy();
  expect(screen.getAllByText('参考 9-50')).toHaveLength(2);
  expect(screen.queryByText('偏高')).toBeNull();
  expect(screen.queryByText('偏低')).toBeNull();
  fireEvent.press(screen.getByTestId('metric-history-a-alt'));
  expect(router.push).toHaveBeenCalledWith('/report/a');
  fireEvent.press(screen.getByTestId('metric-row-ast'));
  expect(screen.queryByTestId('metric-expanded-alt')).toBeNull();
  expect(screen.getByText('目前只有一次检查结果')).toBeTruthy();
  expect(screen.queryByTestId('metric-trend-chart')).toBeNull();
  fireEvent.press(screen.getByTestId('metric-row-ast'));
  expect(screen.queryByTestId('metric-expanded-ast')).toBeNull();
});
test('filters latest results and supports reset and zero-count states', () => {
  const screen = render(<MetricsOverview groups={groups} />);
  fireEvent.press(screen.getByTestId('metric-row-alt'));
  fireEvent.press(screen.getByTestId('metrics-filter-within'));
  expect(screen.queryByTestId('metric-row-alt')).toBeNull();
  expect(screen.getByTestId('metric-row-ast')).toBeTruthy();
  fireEvent.press(screen.getByTestId('metrics-filter-all'));
  expect(screen.getByTestId('metric-row-alt')).toBeTruthy();
  expect(screen.queryByTestId('metric-expanded-alt')).toBeNull();
  fireEvent.press(screen.getByTestId('metrics-filter-unknown'));
  expect(screen.getByTestId('metric-row-ck')).toBeTruthy();
  expect(screen.queryByTestId('metric-row-ast')).toBeNull();
  screen.unmount();
  const single = render(<MetricsOverview groups={[groups[1]!]} />);
  fireEvent.press(single.getByTestId('metrics-filter-outside'));
  expect(single.getByText('最近结果中没有超出参考范围的指标')).toBeTruthy();
});
test('keeps unknown and changing references explicit', () => {
  const changed = {
    ...groups[0]!,
    points: groups[0]!.points.map((p, i) => ({ ...p, reference: i ? '9-90' : '9-50' })),
  };
  const screen = render(<MetricsOverview groups={[changed]} />);
  fireEvent.press(screen.getByTestId('metric-row-alt'));
  expect(screen.queryByTestId('metric-reference-band')).toBeNull();
  expect(screen.getByText('各次报告的参考范围不同，分别列在下方。')).toBeTruthy();
  expect(screen.getByText('参考 9-50')).toBeTruthy();
  expect(screen.getByText('参考 9-90')).toBeTruthy();
});
test('empty archive shows an import-and-review hint', () => {
  const screen = render(<MetricsOverview groups={[]} />);
  expect(screen.getByText('还没有可比较的指标')).toBeTruthy();
  expect(screen.queryByTestId('metrics-filter-outside')).toBeNull();
});
test('missing-date notice opens the affected report and disappears after correction', () => {
  const reports = [
    { id: 'missing-date', date: '', status: 'confirmed' },
    { id: 'draft', date: '', status: 'review' },
  ] as Report[];
  const screen = render(<MissingDateNotice reports={reports} />);
  expect(screen.getByText('1 份报告缺少日期，暂未计入趋势')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('补全报告日期'));
  expect(router.push).toHaveBeenCalledWith('/report/missing-date');
  screen.rerender(
    <MissingDateNotice reports={reports.map((r) => ({ ...r, date: '2024-05-04' }))} />,
  );
  expect(screen.queryByLabelText('补全报告日期')).toBeNull();
});

test('history shows original names, report sources and why comparison conditions are incomplete', () => {
  const group = {
    ...groups[0]!,
    comparisonNote: '部分报告未注明检测方法。',
    separationLabel: '血清 · 方法未注明',
    points: groups[0]!.points.map((p, i) => ({
      ...p,
      sourceName: i ? '丙氨酸氨基转移酶' : '谷丙转氨酶',
      sourceUnit: 'U/L',
      reportTitle: i ? '生化报告' : '体检报告',
    })),
  };
  const screen = render(<MetricsOverview groups={[group]} />);
  expect(screen.getByText('血清 · 方法未注明')).toBeTruthy();
  fireEvent.press(screen.getByTestId('metric-row-alt'));
  expect(screen.getByText('部分报告未注明检测方法。')).toBeTruthy();
  expect(screen.getByText('体检报告')).toBeTruthy();
  expect(screen.getByText('原报告：谷丙转氨酶 · U/L')).toBeTruthy();
  fireEvent.press(screen.getByTestId('metric-history-a-alt'));
  expect(router.push).toHaveBeenCalledWith('/report/a');
});

test('unmatched single results explain their isolation instead of claiming no history exists', () => {
  const screen = render(
    <MetricsOverview
      groups={[
        {
          ...groups[1]!,
          comparisonNote: '单位尚不能统一，单独展示；请对照原报告。',
          separationLabel: '单独展示 · 体检报告',
        },
      ]}
    />,
  );
  expect(screen.getByText('单独展示 · 体检报告')).toBeTruthy();
  fireEvent.press(screen.getByTestId('metric-row-ast'));
  expect(screen.getByText('这组目前收录 1 次结果')).toBeTruthy();
  expect(screen.queryByText('目前只有一次检查结果')).toBeNull();
  expect(screen.getByText('单位尚不能统一，单独展示；请对照原报告。')).toBeTruthy();
});

test('non-trended results have a visible count and reveal original value, range, reason and source', () => {
  const screen = render(
    <UntrendedResults
      results={[
        {
          key: 'source',
          reportId: 'urine',
          name: '尿蛋白质',
          rawValue: '<5',
          unit: 'mg/L',
          reference: '0-20',
          date: '2025-12-18',
          reportTitle: '尿常规',
          reasons: ['带有限定符，不能当作精确数值'],
        },
      ]}
    />,
  );
  expect(screen.getByText('暂未进入趋势 · 1 项')).toBeTruthy();
  expect(screen.queryByText('<5 mg/L')).toBeNull();
  fireEvent.press(screen.getByTestId('untrended-results-toggle'));
  expect(screen.getByText('<5 mg/L')).toBeTruthy();
  expect(screen.getByText('参考范围 0-20')).toBeTruthy();
  expect(screen.getByText('带有限定符，不能当作精确数值')).toBeTruthy();
  fireEvent.press(screen.getByTestId('untrended-result-source'));
  expect(router.push).toHaveBeenCalledWith('/report/urine');
  screen.rerender(<UntrendedResults results={[]} />);
  expect(screen.queryByTestId('untrended-results-toggle')).toBeNull();
});

test('when every result has a non-trend reason the empty message points to retained results', () => {
  const screen = render(<MetricsOverview groups={[]} hasUntrended />);
  expect(screen.getByText('已核对结果暂未形成趋势')).toBeTruthy();
  expect(screen.getByText('展开“暂未进入趋势”，查看每项原结果和原因。')).toBeTruthy();
});

const textHistory: TextMetricSeries = {
  kind: 'text',
  key: 'urine-protein',
  name: '尿蛋白',
  unit: '',
  separationLabel: '尿常规',
  points: [
    {
      reportId: 'old-urine',
      observationId: 'old-protein',
      date: '2026-09-01',
      rawValue: '阴性',
      reference: '阴性',
      reportTitle: '尿常规',
    },
    {
      reportId: 'new-urine',
      observationId: 'new-protein',
      date: '2026-10-01',
      rawValue: '弱阳性',
      reference: '阴性（-）',
      reportTitle: '尿常规',
    },
  ],
};

test('text results share the normal list and expand to original histories without a curve or numeric judgments', () => {
  const screen = render(<MetricsOverview groups={[...groups, textHistory]} />);
  expect(within(screen.getByTestId('metric-row-urine-protein')).getByText('弱阳性')).toBeTruthy();
  expect(screen.getByText('数值结果的参考范围')).toBeTruthy();
  expect(screen.getByLabelText('无参考范围，1项')).toBeTruthy();
  expect(screen.getByTestId('metric-row-urine-protein').props.accessibilityLabel).not.toContain(
    '暂无法判断',
  );
  expect(screen.getByTestId('metric-row-urine-protein').props.accessibilityHint).toBe(
    '展开历次检查结果',
  );
  fireEvent.press(screen.getByTestId('metric-row-urine-protein'));
  expect(screen.getByText('历次结果')).toBeTruthy();
  expect(screen.getByText('2 次检查')).toBeTruthy();
  expect(
    within(screen.getByTestId('metric-history-new-protein')).getByText('2026.10.01'),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('metric-history-old-protein')).getByText('2026.09.01'),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('metric-history-old-protein')).getByText('参考结果 阴性'),
  ).toBeTruthy();
  expect(screen.queryByTestId('metric-trend-chart')).toBeNull();
  expect(screen.queryByTestId('delta-尿蛋白')).toBeNull();
  expect(screen.queryByText(/暂未进入趋势/)).toBeNull();
  fireEvent.press(screen.getByTestId('metric-history-old-protein'));
  expect(router.push).toHaveBeenCalledWith('/report/old-urine');
  fireEvent.press(screen.getByTestId('metric-row-urine-protein'));
  expect(screen.queryByTestId('metric-expanded-urine-protein')).toBeNull();
  fireEvent.press(screen.getByTestId('metric-row-alt'));
  expect(screen.getByTestId('metric-trend-chart')).toBeTruthy();
  expect(screen.getByTestId('delta-丙氨酸氨基转移酶')).toHaveTextContent('-20 U/L');
});

test('text-only and single-result lists have no empty-trend, missing-range or numeric-filter warning', () => {
  const single: TextMetricSeries = {
    ...textHistory,
    points: [{ ...textHistory.points[0]!, reference: '' }],
  };
  const screen = render(<MetricsOverview groups={[single]} />);
  expect(within(screen.getByTestId('metric-row-urine-protein')).getByText('阴性')).toBeTruthy();
  expect(screen.queryByText('还没有可比较的指标')).toBeNull();
  expect(screen.queryByTestId('metrics-filter-unknown')).toBeNull();
  expect(screen.queryByTestId('metrics-filter-outside')).toBeNull();
  expect(screen.queryByText('超出范围优先')).toBeNull();
  expect(screen.queryByText('报告未提供参考范围，暂不判断')).toBeNull();
  fireEvent.press(screen.getByTestId('metric-row-urine-protein'));
  expect(screen.getByText('历次结果')).toBeTruthy();
  expect(screen.getByText('1 次检查')).toBeTruthy();
  expect(screen.getByTestId('metric-history-old-protein')).toBeTruthy();
  expect(screen.queryByText('参考范围未提供')).toBeNull();
  expect(screen.queryByText('目前只有一次检查结果')).toBeNull();
  expect(screen.queryByTestId('metric-trend-chart')).toBeNull();
});

test('range filters include only numeric results and resetting restores text histories', () => {
  const screen = render(<MetricsOverview groups={[...groups, textHistory]} />);
  fireEvent.press(screen.getByTestId('metrics-filter-unknown'));
  expect(screen.getByTestId('metric-row-ck')).toBeTruthy();
  expect(screen.queryByTestId('metric-row-urine-protein')).toBeNull();
  fireEvent.press(screen.getByTestId('metrics-filter-all'));
  expect(screen.getByTestId('metric-row-urine-protein')).toBeTruthy();
  fireEvent.press(screen.getByTestId('metrics-filter-within'));
  expect(screen.getByTestId('metric-row-ast')).toBeTruthy();
  expect(screen.queryByTestId('metric-row-urine-protein')).toBeNull();
});
