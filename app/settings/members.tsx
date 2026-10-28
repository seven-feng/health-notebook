import { router } from 'expo-router';
import { Text } from 'react-native';
import { BackLink } from '../../src/components/BackLink';
import { SettingsGroup, SettingsRow } from '../../src/components/SettingsList';
import { useRecords } from '../../src/state';
import { Button, Header, Screen, styles } from '../../src/ui';

export default function MembersSettings() {
  const { members, loading, error, refresh } = useRecords();
  return (
    <Screen>
      <BackLink />
      <Header title="家庭成员" subtitle="每个人的报告和就诊记录分别保存。" />
      {loading ? (
        <Text style={styles.body}>正在读取档案…</Text>
      ) : (
        <SettingsGroup>
          {members.map((member, index) => (
            <SettingsRow
              key={member.id}
              title={member.label}
              detail={member.name || '未填写报告姓名'}
              icon="person-outline"
              testID={`manage-member-${member.id}`}
              last={index === members.length - 1}
              onPress={() =>
                router.push({ pathname: '/member', params: { id: member.id, from: 'settings' } })
              }
            />
          ))}
        </SettingsGroup>
      )}
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={styles.body}>
            {error}
          </Text>
          <Button title="重新读取" secondary onPress={() => void refresh()} />
        </>
      )}
      <Button
        title="添加家庭成员"
        icon="add-outline"
        testID="settings-add-member"
        disabled={loading}
        onPress={() => router.push({ pathname: '/member', params: { from: 'settings' } })}
      />
      <Text style={styles.small}>
        在这里编辑资料不会切换当前档案。查看记录时，可在首页右上角选择家人。
      </Text>
    </Screen>
  );
}
