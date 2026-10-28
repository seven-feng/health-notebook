import { useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { BackLink } from '../../src/components/BackLink';
import { HelpParagraph } from '../../src/components/SettingsList';
import { analyticsConfigured, setUsageConsent, usageEnabled } from '../../src/services/analytics';
import { Button, Card, color, Header, Screen, styles } from '../../src/ui';

export default function UsageSettings() {
  if (!analyticsConfigured) return <Redirect href="/settings/privacy" />;
  return <UsagePreferences />;
}

function UsagePreferences() {
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function load() {
    setLoading(true);
    setError('');
    try {
      setConsent(await usageEnabled());
    } catch {
      setError('暂时无法读取偏好，请重试。');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function change(value: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await setUsageConsent(value);
      setConsent(value);
    } catch {
      setConsent(false);
      setError('未能保存偏好，使用统计保持关闭。请重新读取后再试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen>
      <BackLink disabled={busy} />
      <Header title="使用统计" />
      <Card>
        <View style={styles.between}>
          <Text style={[styles.body, { flex: 1 }]}>帮助改进使用体验</Text>
          <Switch
            testID="usage-consent"
            accessibilityLabel="允许使用统计"
            value={consent}
            disabled={loading || busy || !!error}
            onValueChange={(value) => void change(value)}
            trackColor={{ true: color.green }}
          />
        </View>
      </Card>
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={{ color: color.red }}>
            {error}
          </Text>
          <Button title="重新读取" secondary disabled={busy} onPress={() => void load()} />
        </>
      )}
      <HelpParagraph title="仅统计功能使用情况">
        默认关闭，不影响导入和查看记录。启用后会发送随机安装标识、App
        打开、页面访问、导入是否完成和报告是否确认等事件。
      </HelpParagraph>
      <HelpParagraph title="不包含健康资料">
        不发送姓名、病历、报告文件、文件名、指标数值或就诊日期。关闭后停止发送，并清除本机待发送事件和安装标识；已经发送的事件不会因此自动撤回。
      </HelpParagraph>
    </Screen>
  );
}
