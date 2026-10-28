import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { color } from '../../src/ui';
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.green,
        tabBarInactiveTintColor: color.muted,
        tabBarStyle: { backgroundColor: color.bg, borderTopColor: color.line },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '记录',
          tabBarButtonTestID: 'tab-records',
          tabBarIcon: ({ color: ink, size }) => (
            <Ionicons name="albums-outline" color={ink} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="metrics"
        options={{
          title: '指标',
          tabBarButtonTestID: 'tab-metrics',
          tabBarIcon: ({ color: ink, size }) => (
            <Ionicons name="analytics-outline" color={ink} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarButtonTestID: 'tab-settings',
          tabBarIcon: ({ color: ink, size }) => (
            <Ionicons name="options-outline" color={ink} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
