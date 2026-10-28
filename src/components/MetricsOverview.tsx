import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { delta } from '../domain/metrics';
import {
  metricOverview,
  metricState,
  metricStateLabel,
  type MetricFilter,
} from '../domain/metric-overview';
import type { MetricGroup, TextSeriesPoint } from '../domain/types';
import { color, Empty, styles } from '../ui';
import { MetricTrend, metricTone } from './MetricTrend';

function resultDescription(point: TextSeriesPoint, text: boolean): string {
  if (text)
    return `${point.rawValue}${point.reference.trim() ? `，参考结果${point.reference}` : ''}`;
  return `${point.rawValue}，${metricStateLabel[metricState(point)]}，参考范围${point.reference || '未提供'}`;
}

function Result({
  point,
  text = false,
  large = false,
}: {
  point: TextSeriesPoint;
  text?: boolean;
  large?: boolean;
}) {
  const state = text ? null : metricState(point);
  return (
    <View
      accessible
      accessibilityLabel={state ? `${point.rawValue}，${metricStateLabel[state]}` : point.rawValue}
      style={{ flexDirection: 'row', gap: large ? 6 : 4, alignItems: 'center', flexShrink: 1 }}
    >
      <Text
        style={[
          large ? local.latest : local.historyValue,
          text && large && local.latestText,
          { color: state ? metricTone(state) : color.ink, flexShrink: 1 },
        ]}
      >
        {point.rawValue}
      </Text>
      {(state === 'high' || state === 'low') && (
        <Ionicons
          name={state === 'high' ? 'arrow-up' : 'arrow-down'}
          size={large ? 15 : 13}
          color={metricTone(state)}
          accessible={false}
        />
      )}
    </View>
  );
}

export function MetricsOverview({
  groups,
  hasUntrended = false,
}: {
  groups: MetricGroup[];
  hasUntrended?: boolean;
}) {
  const [filter, setFilter] = useState<MetricFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { counts, visible } = useMemo(() => metricOverview(groups, filter), [groups, filter]);
  const hasNumeric = groups.some((g) => g.kind !== 'text' && g.points.length);
  const hasText = groups.some((g) => g.kind === 'text' && g.points.length);
  const unknownLabel = groups.some(
    (g) =>
      g.kind !== 'text' &&
      g.points.length &&
      metricState(g.points.at(-1)!) === 'unknown' &&
      g.points.at(-1)!.reference.trim(),
  )
    ? '暂未判定'
    : '无参考范围';
  const heading =
    filter === 'all'
      ? '全部指标'
      : filter === 'outside'
        ? '超出参考范围'
        : filter === 'within'
          ? '参考范围内'
          : unknownLabel;
  function select(next: MetricFilter) {
    setFilter((current) => (current === next ? 'all' : next));
    setExpanded(null);
  }
  if (!groups.length)
    return (
      <Empty
        title={hasUntrended ? '已核对结果暂未形成趋势' : '还没有可比较的指标'}
        detail={
          hasUntrended
            ? '展开“暂未进入趋势”，查看每项原结果和原因。'
            : '先导入并核对报告，体检指标也会显示在这里。'
        }
      />
    );
  return (
    <View testID="metrics-overview" style={{ gap: 18 }}>
      <Text style={styles.small}>各指标最近一次已核对结果</Text>
      {hasNumeric && (
        <View style={{ gap: 8 }}>
          {hasText && <Text style={styles.small}>数值结果的参考范围</Text>}
          <View style={local.summary}>
            {(
              [
                ['outside', '超出范围', counts.outside],
                ['within', '范围内', counts.within],
                ['unknown', unknownLabel, counts.unknown],
              ] as const
            ).map(([key, label, count], index) => (
              <Pressable
                key={key}
                testID={`metrics-filter-${key}`}
                accessibilityRole="button"
                accessibilityLabel={`${label}，${count}项`}
                accessibilityState={{ selected: filter === key }}
                onPress={() => select(key)}
                style={[
                  local.stat,
                  filter === key && {
                    backgroundColor: key === 'outside' ? '#FBEEEA' : color.mint,
                    borderColor: key === 'outside' ? '#E8BCB3' : '#B8D1C0',
                  },
                ]}
              >
                {index > 0 && filter !== key && (
                  <View pointerEvents="none" style={local.statDivider} />
                )}
                <Text
                  style={[
                    local.count,
                    {
                      color:
                        key === 'outside'
                          ? color.red
                          : key === 'unknown'
                            ? color.muted
                            : color.green,
                    },
                  ]}
                >
                  {count}
                  <Text style={local.countUnit}> 项</Text>
                </Text>
                <Text
                  style={[
                    local.statLabel,
                    filter === key && { color: color.ink, fontWeight: '600' },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      <View style={styles.between}>
        <Text style={local.listHeading}>
          {heading} <Text style={styles.small}>{visible.length}</Text>
        </Text>
        {filter === 'all' ? (
          hasNumeric ? (
            <Text style={local.date}>超出范围优先</Text>
          ) : null
        ) : (
          <Pressable
            testID="metrics-filter-all"
            accessibilityRole="button"
            onPress={() => select('all')}
            hitSlop={10}
            style={local.inline}
          >
            <Text style={[styles.small, { color: color.green }]}>查看全部</Text>
            <Ionicons name="chevron-forward" size={13} color={color.green} />
          </Pressable>
        )}
      </View>
      {visible.length ? (
        <View style={local.list}>
          {visible.map((g, index) => {
            const last = g.points.at(-1)!;
            const open = expanded === g.key;
            const text = g.kind === 'text';
            const change = g.kind === 'text' ? null : delta(g);
            return (
              <View
                key={g.key}
                style={[index > 0 && local.itemDivider, open && { backgroundColor: '#FCFDFB' }]}
              >
                <Pressable
                  testID={`metric-row-${g.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${g.name}，${g.unit}，${resultDescription(last, text)}，${last.date}`}
                  accessibilityState={{ expanded: open }}
                  accessibilityHint={
                    open ? '收起检查历史' : text ? '展开历次检查结果' : '展开趋势和检查历史'
                  }
                  onPress={() => setExpanded(open ? null : g.key)}
                  style={local.trigger}
                >
                  <View style={[local.inline, { alignItems: 'flex-start' }]}>
                    <View style={local.nameLine}>
                      <Text style={local.name}>{g.name}</Text>
                      {!!g.unit && <Text style={local.unit}>{g.unit}</Text>}
                    </View>
                    <Ionicons
                      name={open ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={color.muted}
                    />
                  </View>
                  {g.separationLabel && <Text style={styles.small}>{g.separationLabel}</Text>}
                  <View style={[styles.between, { gap: 8, flexWrap: 'wrap' }]}>
                    <Result point={last} text={text} large />
                    <Text style={local.date}>{last.date.replaceAll('-', '.')}</Text>
                  </View>
                  {(!text || !!last.reference.trim()) && (
                    <Text style={local.reference}>
                      {last.reference.trim()
                        ? `${text ? '参考结果' : '参考范围'} ${last.reference}`
                        : '报告未提供参考范围，暂不判断'}
                    </Text>
                  )}
                </Pressable>
                {open && (
                  <View testID={`metric-expanded-${g.key}`} style={local.expanded}>
                    <View style={[styles.between, local.trendHeading]}>
                      <Text style={[styles.small, { flex: 1 }]}>
                        {text ? (
                          '历次结果'
                        ) : g.points.length === 1 ? (
                          g.comparisonNote ? (
                            '这组目前收录 1 次结果'
                          ) : (
                            '目前只有一次检查结果'
                          )
                        ) : change === null ? (
                          '最近同日多次检查'
                        ) : (
                          <>
                            较上次{' '}
                            <Text
                              testID={`delta-${g.name}`}
                              style={{ color: color.ink, fontWeight: '600' }}
                            >
                              {change} {g.unit}
                            </Text>
                          </>
                        )}
                      </Text>
                      <Text style={local.date}>{g.points.length} 次检查</Text>
                    </View>
                    {g.comparisonNote && (
                      <Text testID={`metric-note-${g.key}`} style={styles.small}>
                        {g.comparisonNote}
                      </Text>
                    )}
                    {g.kind !== 'text' && g.points.length > 1 && <MetricTrend series={g} />}
                    <View style={{ gap: 2 }}>
                      <View style={[styles.between, { paddingVertical: 9 }]}>
                        <Text style={local.historyLabel}>
                          {text ? '检查日期' : '检查日期 / 参考范围'}
                        </Text>
                        <Text style={local.historyLabel}>结果 {g.unit}</Text>
                      </View>
                      {[...g.points].reverse().map((p, historyIndex) => (
                        <Pressable
                          key={`${p.reportId}:${p.observationId}`}
                          testID={`metric-history-${p.observationId}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${p.date}，${resultDescription(p, text)} ${g.unit}，查看报告`}
                          onPress={() => router.push(`/report/${p.reportId}`)}
                          style={[
                            styles.between,
                            local.historyRow,
                            historyIndex > 0 && local.itemDivider,
                          ]}
                        >
                          <View style={{ flex: 1, gap: 3 }}>
                            <Text style={{ color: color.ink, fontSize: 12 }}>
                              {p.date.replaceAll('-', '.')}
                            </Text>
                            {(!text || !!p.reference.trim()) && (
                              <Text style={local.historyLabel}>
                                {p.reference.trim()
                                  ? `${text ? '参考结果' : '参考'} ${p.reference}`
                                  : '参考范围未提供'}
                              </Text>
                            )}
                            {p.reportTitle && (
                              <Text style={local.historyLabel}>{p.reportTitle}</Text>
                            )}
                            {((p.sourceName && p.sourceName !== g.name) ||
                              (p.sourceUnit !== undefined && p.sourceUnit !== g.unit)) && (
                              <Text style={local.historyLabel}>
                                原报告：{p.sourceName ?? g.name}
                                {p.sourceUnit ? ` · ${p.sourceUnit}` : ''}
                              </Text>
                            )}
                          </View>
                          <Result point={p} text={text} />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={local.filterEmpty}>
          <Ionicons name="checkmark-circle-outline" size={28} color={color.muted} />
          <Text style={[styles.body, { textAlign: 'center' }]}>
            最近结果中没有
            {filter === 'outside'
              ? '超出参考范围'
              : filter === 'within'
                ? '处于参考范围内'
                : '暂未判定'}
            的指标
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => select('all')}
            style={{ padding: 12 }}
          >
            <Text style={{ color: color.green }}>查看全部指标</Text>
          </Pressable>
        </View>
      )}
      {hasNumeric && (
        <Text style={[styles.small, { fontSize: 11, textAlign: 'center' }]}>
          依据各次报告的参考范围展示，不作病情判断。
        </Text>
      )}
    </View>
  );
}
const local = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    padding: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.paper,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 76,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: 8,
    paddingHorizontal: 3,
  },
  statDivider: {
    position: 'absolute',
    left: -1,
    top: 18,
    height: 40,
    borderLeftWidth: 1,
    borderLeftColor: color.line,
  },
  count: { fontSize: 29, fontWeight: '600', fontVariant: ['tabular-nums'] },
  countUnit: { fontSize: 11, color: color.muted, fontWeight: '400' },
  statLabel: { fontSize: 12, color: color.muted, textAlign: 'center' },
  listHeading: { fontSize: 16, fontWeight: '600', color: color.ink },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  list: {
    backgroundColor: color.paper,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
  },
  itemDivider: { borderTopWidth: 1, borderTopColor: color.line },
  trigger: { padding: 17, gap: 7 },
  nameLine: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 7,
    rowGap: 2,
  },
  name: { fontSize: 15, fontWeight: '600', color: color.ink, flexShrink: 1 },
  unit: { fontSize: 11, color: color.muted },
  latest: { fontSize: 24, fontWeight: '600', fontVariant: ['tabular-nums'] },
  latestText: { fontSize: 20, lineHeight: 28 },
  date: { fontSize: 11, color: color.muted, fontVariant: ['tabular-nums'] },
  reference: { fontSize: 12, lineHeight: 18, color: color.muted },
  expanded: { paddingHorizontal: 17, paddingBottom: 16, gap: 12 },
  trendHeading: { borderTopWidth: 1, borderTopColor: color.line, paddingTop: 13 },
  historyRow: { paddingVertical: 9, minHeight: 48 },
  historyLabel: { fontSize: 10, lineHeight: 16, color: color.muted, flexShrink: 1 },
  historyValue: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  filterEmpty: {
    paddingVertical: 32,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 14,
    backgroundColor: color.paper,
    borderRadius: 20,
  },
});
