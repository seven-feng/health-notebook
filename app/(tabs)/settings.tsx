import { Text } from 'react-native';
import { router } from 'expo-router';
import { SettingsGroup, SettingsRow } from '../../src/components/SettingsList';
import { Header, Screen, styles } from '../../src/ui';
import { useRecords } from '../../src/state';

export default function Settings() {
  const { members, loading } = useRecords();
  return (
    <Screen>
      <Header title="设置" subtitle="你的记录，由你掌握。" />
      <SettingsGroup title="档案与资料">
        <SettingsRow
          title="家庭成员"
          detail={loading ? '正在读取…' : `${members.length} 份独立档案`}
          icon="people-outline"
          testID="settings-members"
          onPress={() => router.push('/settings/members')}
        />
        <SettingsRow
          title="数据与隐私"
          icon="shield-checkmark-outline"
          testID="settings-data"
          onPress={() => router.push('/settings/privacy')}
          last
        />
      </SettingsGroup>
      <SettingsGroup title="帮助与关于">
        <SettingsRow
          title="使用帮助"
          icon="help-circle-outline"
          testID="settings-help"
          onPress={() => router.push('/settings/help')}
        />
        <SettingsRow
          title="关于健康小本"
          icon="information-circle-outline"
          testID="settings-about"
          onPress={() => router.push('/settings/about')}
          last
        />
      </SettingsGroup>
      <Text style={[styles.small, { textAlign: 'center', marginTop: 4 }]}>本机保存 · 无需注册</Text>
    </Screen>
  );
}
