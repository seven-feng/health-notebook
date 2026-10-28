import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { UntrendedResult } from '../domain/types';
import { color, styles } from '../ui';

export function UntrendedResults({ results }: { results: UntrendedResult[] }) {
  const [open, setOpen] = useState(false);
  if (!results.length) return null;
  return (
    <View
      style={{
        backgroundColor: color.paper,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: color.line,
        overflow: 'hidden',
      }}
    >
      <Pressable
        testID="untrended-results-toggle"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`暂未进入趋势，${results.length} 项结果，查看原因`}
        onPress={() => setOpen(!open)}
        style={{ padding: 17, gap: 6 }}
      >
        <View style={styles.between}>
          <Text style={[styles.body, { fontWeight: '600', flex: 1 }]}>
            暂未进入趋势 · {results.length} 项
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={color.muted} />
        </View>
        <Text style={styles.small}>结果都已保留，展开查看原结果和原因。</Text>
      </Pressable>
      {open &&
        results.map((result) => (
          <Pressable
            key={result.key}
            testID={`untrended-result-${result.key}`}
            accessibilityRole="button"
            accessibilityHint="打开来源报告"
            onPress={() => router.push(`/report/${result.reportId}`)}
            style={{ padding: 17, gap: 6, borderTopWidth: 1, borderColor: color.line }}
          >
            <View style={[styles.between, { flexWrap: 'wrap' }]}>
              <Text style={[styles.body, { flexShrink: 1 }]}>{result.name}</Text>
              <Text style={[styles.body, { fontWeight: '600', flexShrink: 1 }]}>
                {result.rawValue || '未填写'}
                {result.unit ? ` ${result.unit}` : ''}
              </Text>
            </View>
            <Text style={styles.small}>
              {result.date || '日期待补充'} · {result.reportTitle}
            </Text>
            <Text style={styles.small}>
              {result.reference ? `参考范围 ${result.reference}` : '参考范围未提供'}
            </Text>
            <Text style={[styles.small, { color: color.amber }]}>{result.reasons.join('；')}</Text>
          </Pressable>
        ))}
    </View>
  );
}
