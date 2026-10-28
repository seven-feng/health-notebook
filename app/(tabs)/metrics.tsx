import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { color, Screen, styles } from '../../src/ui';
import { MemberHeader } from '../../src/components/MemberHeader';
import { MetricsOverview } from '../../src/components/MetricsOverview';
import { MissingDateNotice } from '../../src/components/MissingDateNotice';
import { useRecords } from '../../src/state';
import { UntrendedResults } from '../../src/components/UntrendedResults';
import { buildMetricData } from '../../src/domain/metrics';

export default function Metrics() {
  const { reports, activeMember, loading, error } = useRecords();
  const { groups, untrended } = useMemo(() => buildMetricData(reports), [reports]);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [activeMember.id]);
  return (
    <Screen
      scrollRef={scrollRef}
      fixedHeader={
        <View style={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 2 }}>
          <MemberHeader title="指标变化" subtitle="查看最近结果，回顾历次检查。" />
        </View>
      }
    >
      {loading ? (
        <ActivityIndicator color={color.green} accessibilityLabel="正在读取指标" />
      ) : error ? (
        <Text accessibilityRole="alert" style={[styles.body, { color: color.red }]}>
          {error}
        </Text>
      ) : (
        <>
          <MissingDateNotice reports={reports} />
          <UntrendedResults key={`untrended:${activeMember.id}`} results={untrended} />
          <MetricsOverview
            key={activeMember.id}
            groups={groups}
            hasUntrended={untrended.length > 0}
          />
        </>
      )}
    </Screen>
  );
}
