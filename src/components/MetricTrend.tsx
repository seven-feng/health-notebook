import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { metricChart, type MetricState } from '../domain/metric-overview';
import type { MetricSeries } from '../domain/types';
import { color, styles } from '../ui';
import { dateLabelFontSize, metricDateLabels } from './metric-date-labels';

export const metricTone = (state: MetricState) =>
  state === 'high' ? color.red : state === 'low' ? '#326B9B' : color.ink;

export function MetricTrend({ series }: { series: MetricSeries }) {
  const [width, setWidth] = useState(280);
  const chart = metricChart(series);
  const latest = series.points.at(-1)!;
  const tickText = (value: number) =>
    Math.abs(value) >= 1e5 || (value !== 0 && Math.abs(value) < 0.001)
      ? value.toExponential(1)
      : String(Number(value.toPrecision(6)));
  const left = Math.max(30, ...chart.ticks.map((t) => tickText(t).length * 6 + 8));
  const right = width - 12,
    top = 12,
    bottom = 136;
  const x = (fraction: number) => left + fraction * (right - left);
  const y = (value: number) =>
    bottom - ((value - chart.low) / (chart.high - chart.low)) * (bottom - top);
  const points = chart.points.map((p) => ({ ...p, cx: x(p.x), cy: y(Number(p.value)) }));
  const path = points.map((p, i) => `${i ? 'L' : 'M'} ${p.cx} ${p.cy}`).join(' ');
  const dateLabels = metricDateLabels(chart.points, left, right);
  const sameReferenceText = series.points.every(
    (p) => p.reference.trim() === latest.reference.trim(),
  );
  return (
    <View style={{ gap: 9 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Svg
        testID="metric-trend-chart"
        width={width}
        height={168}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${series.name}变化趋势。${series.points.map((p) => `${p.date}：${p.rawValue} ${series.unit}，参考范围 ${p.reference || '未提供'}`).join('；')}`}
      >
        {chart.commonRange && (
          <Rect
            testID="metric-reference-band"
            x={left}
            y={y(chart.commonRange.upper)}
            width={right - left}
            height={y(chart.commonRange.lower) - y(chart.commonRange.upper)}
            fill={color.mint}
          />
        )}
        {chart.ticks.map((tick) => (
          <Line
            key={`grid-${tick}`}
            x1={left}
            x2={right}
            y1={y(tick)}
            y2={y(tick)}
            stroke={color.line}
            strokeDasharray="4 5"
          />
        ))}
        {chart.ticks.map((tick) => (
          <SvgText
            key={`label-${tick}`}
            x={left - 7}
            y={y(tick) + 3}
            textAnchor="end"
            fill={color.muted}
            fontSize={10}
          >
            {tickText(tick)}
          </SvgText>
        ))}
        {chart.commonRange &&
          [chart.commonRange.lower, chart.commonRange.upper].map((bound) => (
            <Line
              key={`bound-${bound}`}
              x1={left}
              x2={right}
              y1={y(bound)}
              y2={y(bound)}
              stroke="#A5C7B5"
              strokeDasharray="4 4"
            />
          ))}
        {chart.distinctDates && (
          <Path d={path} stroke={color.green} strokeWidth={2.3} fill="none" />
        )}
        {points.map((p) => (
          <Circle
            key={`${p.reportId}:${p.observationId}`}
            cx={p.cx}
            cy={p.cy}
            r={4}
            fill={p.state === 'within' || p.state === 'unknown' ? color.green : metricTone(p.state)}
            stroke={color.paper}
            strokeWidth={2}
          />
        ))}
        {dateLabels.map((label) => (
          <SvgText
            key={label.date}
            testID={`metric-date-${label.date}`}
            x={label.x}
            y={159}
            fill={color.muted}
            fontSize={dateLabelFontSize}
            textAnchor={label.anchor}
          >
            {label.text}
          </SvgText>
        ))}
      </Svg>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}
      >
        {chart.commonRange && (
          <Ionicons name="square" size={11} color="#A5C7B5" accessible={false} />
        )}
        <Text style={[styles.small, { fontSize: 11, textAlign: 'center', flexShrink: 1 }]}>
          {chart.commonRange
            ? `报告参考范围 ${latest.reference} ${series.unit}`
            : !sameReferenceText
              ? '各次报告的参考范围不同，分别列在下方。'
              : !latest.reference.trim()
                ? '报告未提供参考范围，暂不判断。'
                : `参考范围 ${latest.reference}，详见各次报告。`}
        </Text>
      </View>
      {!chart.distinctDates && <Text style={styles.small}>同日多次结果按点展示，不推断先后。</Text>}
    </View>
  );
}
