import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RecordsProvider } from '../src/state';
import { color } from '../src/ui';
import { track } from '../src/services/analytics';
import { OnboardingProvider } from '../src/components/Onboarding';
export default function RootLayout() {
  const pathname = usePathname();
  useEffect(() => {
    track('app_open');
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') track('app_open');
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    const screen =
      pathname === '/'
        ? 'records'
        : pathname === '/metrics'
          ? 'metrics'
          : pathname === '/settings'
            ? 'settings'
            : undefined;
    if (screen) track('screen_view', { screen });
  }, [pathname]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RecordsProvider>
        <StatusBar style="dark" />
        <OnboardingProvider>
          <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}
          />
        </OnboardingProvider>
      </RecordsProvider>
    </GestureHandlerRootView>
  );
}
