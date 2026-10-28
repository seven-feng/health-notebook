import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { Observation } from '../domain/types';
import { referencePosition } from '../domain/reference-range';
import { color, styles } from '../ui';

export function ObservationRange({
  observation: o,
  index,
  confirmed,
}: {
  observation: Observation;
  index: number;
  confirmed: boolean;
}) {
  const [width, setWidth] = useState(280);
  const [valueWidth, setValueWidth] = useState(80);
  const { fontScale } = useWindowDimensions();
  const range = !o.needsReview && confirmed ? referencePosition(o.rawValue, o.reference) : null;
  if (!range)
    return (
      <View style={{ gap: 8, marginTop: 12 }}>
        <Text testID={`observation-value-${index}`} style={local.fallbackValue}>
          {o.rawValue || '未填写'}
        </Text>
        <Text style={styles.small}>参考范围：{o.reference || '未记录'}</Text>
        {(!confirmed || o.needsReview) && (
          <Text style={[styles.small, { color: color.amber }]}>待核对</Text>
        )}
        {o.reportFlag && (
          <Text style={styles.small}>
            原报告标记：{o.reportFlag === 'high' ? '↑ 高于参考范围' : '↓ 低于参考范围'}
          </Text>
        )}
      </View>
    );
  const tone = range.state === 'within' ? color.green : color.red;
  const extension =
    range.state === 'low'
      ? { left: range.position, width: 0.25 - range.position }
      : range.state === 'high'
        ? { left: 0.75, width: range.position - 0.75 }
        : null;
  const marker = width * range.position;
  const labelLeft = Math.max(0, Math.min(width - valueWidth, marker - valueWidth / 2));
  const separateStatus =
    fontScale > 1.1 || width < 280 || range.lower.length > 7 || range.upper.length > 7;
  return (
    <View
      testID={`reference-range-${index}`}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={{ marginTop: 8 }}
    >
      <View style={{ minHeight: 28, alignItems: 'flex-start' }}>
        <View
          onLayout={({ nativeEvent }) => setValueWidth(nativeEvent.layout.width)}
          style={{
            left: labelLeft,
            maxWidth: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <Text
            testID={`observation-value-${index}`}
            style={[local.value, { color: tone, flexShrink: 1 }]}
          >
            {o.rawValue}
          </Text>
        </View>
      </View>
      <View style={local.track}>
        {extension && (
          <View
            testID={`reference-extension-${index}`}
            style={[
              local.extension,
              { left: `${extension.left * 100}%`, width: `${extension.width * 100}%` },
            ]}
          />
        )}
        <View
          style={[
            local.interval,
            range.state === 'low' && { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
            range.state === 'high' && { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
          ]}
        />
        <View
          testID={`reference-marker-${index}`}
          style={[local.marker, { left: `${range.position * 100}%`, borderColor: tone }]}
        />
      </View>
      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: separateStatus ? 0 : '12.5%',
          marginTop: 9,
          alignItems: 'flex-start',
        }}
      >
        <Text style={local.bound}>{range.lower}</Text>
        {!separateStatus && (
          <Text
            testID={`reference-status-${index}`}
            style={[local.status, { color: tone, flex: 1 }]}
          >
            {range.label}
          </Text>
        )}
        <Text style={local.bound}>{range.upper}</Text>
      </View>
      {separateStatus && (
        <Text
          testID={`reference-status-${index}`}
          style={[local.status, { color: tone, marginTop: 4 }]}
        >
          {range.label}
        </Text>
      )}
      {range.clipped && (
        <Text style={[local.status, { color: tone, marginTop: 4 }]}>结果超出图示范围</Text>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  value: { fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  fallbackValue: { fontSize: 21, fontWeight: '600', color: color.ink },
  track: { height: 4, borderRadius: 2, backgroundColor: '#EEF1EE', marginVertical: 4 },
  interval: {
    position: 'absolute',
    left: '25%',
    width: '50%',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#77B9AB',
  },
  extension: {
    position: 'absolute',
    height: 4,
    backgroundColor: color.red,
  },
  marker: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    backgroundColor: color.paper,
    top: -4,
    marginLeft: -6,
  },
  bound: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: color.muted,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  status: { fontSize: 11, lineHeight: 18, textAlign: 'center' },
});
