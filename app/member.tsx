import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useRecords } from '../src/state';
import { saveMember } from '../src/db';
import { SELF_ID } from '../src/domain/members';
import type { Member } from '../src/domain/types';
import { Button, color, Field, Header, Screen, styles } from '../src/ui';

export default function MemberPage() {
  const { id, from } = useLocalSearchParams<{ id?: string; from?: string }>();
  const { members, loading } = useRecords();
  const existing = members.find((m) => m.id === id);
  if (loading || (id && !existing))
    return (
      <Screen>
        <Button title="返回" secondary onPress={() => router.back()} />
        <Text style={styles.body}>{loading ? '正在读取档案…' : '成员档案不存在。'}</Text>
      </Screen>
    );
  return <MemberForm key={id ?? 'new'} existing={existing} managing={from === 'settings'} />;
}
function MemberForm({ existing, managing = false }: { existing?: Member; managing?: boolean }) {
  const { refresh, selectMember, members } = useRecords();
  const [label, setLabel] = useState(existing?.label ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [birth, setBirth] = useState(existing?.birth ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const member: Member = {
        id: existing?.id ?? Crypto.randomUUID(),
        label,
        name,
        birth,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        tone: existing?.tone ?? ['green', 'rose', 'blue', 'ochre'][members.length % 4]!,
      };
      await saveMember(member);
      await refresh();
      if (!managing) selectMember(member.id);
      if (existing || managing) router.back();
      else router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存未完成，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Button title="返回" secondary disabled={busy} onPress={() => router.back()} />
      <Header
        title={existing ? '成员资料' : '为家人建一份档案'}
        subtitle="起一个熟悉的称呼，方便下次找到。"
      />
      <Field
        label="怎么称呼（必填）"
        testID="member-label"
        value={label}
        onChangeText={setLabel}
        editable={existing?.id !== SELF_ID && !busy}
        placeholder="例如：妈妈"
        maxLength={12}
      />
      <Field
        label="报告上的姓名（选填）"
        testID="member-name"
        value={name}
        onChangeText={setName}
        editable={!busy}
        placeholder="用于核对报告姓名"
        maxLength={30}
      />
      <Text style={styles.small}>姓名不一致时提醒核对，不会自动改变报告归属。</Text>
      <Field
        label="出生日期（选填）"
        testID="member-birth"
        value={birth}
        onChangeText={setBirth}
        editable={!busy}
        placeholder="YYYY-MM-DD"
        maxLength={10}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={[styles.body, { color: color.red }]}>
          {error}
        </Text>
      )}
      <View style={{ paddingBottom: 24 }}>
        <Button
          title={existing ? '保存成员资料' : '创建档案'}
          testID="save-member"
          busy={busy}
          onPress={() => void save()}
        />
      </View>
    </Screen>
  );
}
