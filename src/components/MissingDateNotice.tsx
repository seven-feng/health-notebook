import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Report } from '../domain/types';
import { validDate } from '../domain/metrics';
import { color, styles } from '../ui';

export function MissingDateNotice({ reports }: { reports: Report[] }) {
  const missing = reports.filter(
    (report) =>
      report.status === 'confirmed' && report.reportType !== 'imaging' && !validDate(report.date),
  );
  if (!missing.length) return null;
  return (
    <View style={{ gap: 6, padding: 14, borderRadius: 12, backgroundColor: color.amberBg }}>
      <Text style={styles.body}>{missing.length} 份报告缺少日期，暂未计入趋势</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="补全报告日期"
        onPress={() => router.push(`/report/${missing[0]!.id}`)}
        style={{ paddingVertical: 8 }}
      >
        <Text style={{ color: color.green, fontSize: 14, fontWeight: '600' }}>补全日期 →</Text>
      </Pressable>
    </View>
  );
}
