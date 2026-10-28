import { Image, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { BackLink } from '../../src/components/BackLink';
import { SettingsGroup, SettingsRow } from '../../src/components/SettingsList';
import { Header, Screen, styles } from '../../src/ui';

export default function AboutSettings() {
  return (
    <Screen>
      <BackLink />
      <Header title="关于健康小本" />
      <View style={{ alignItems: 'center', gap: 12, paddingVertical: 22 }}>
        <Image
          source={require('../../assets/brand/icon.png')}
          style={{ width: 72, height: 72, borderRadius: 17 }}
          accessible={false}
        />
        <Text style={styles.h2}>健康小本</Text>
        <Text style={styles.subtitle}>版本 {Constants.expoConfig?.version ?? '—'}</Text>
        <Text style={styles.subtitle}>把自己和家人的健康记录整理在一起。</Text>
      </View>
      <SettingsGroup>
        <SettingsRow
          title="数据与隐私说明"
          icon="shield-checkmark-outline"
          onPress={() => router.push('/settings/privacy')}
          last
        />
      </SettingsGroup>
      <Text style={styles.small}>核心记录功能免费使用。报告在本机识别和保存，无需注册账号。</Text>
      <Text style={styles.small}>帮助整理记录与查看变化，不提供诊断或治疗建议。</Text>
    </Screen>
  );
}
