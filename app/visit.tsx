import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Button, Card, color, Field, Header, Screen, styles } from '../src/ui';
import { useRecords } from '../src/state';
import { removeVisit, saveVisit, setSetting } from '../src/db';
import { validDate } from '../src/domain/metrics';
import { hasNameMismatch, needsIdentityReview } from '../src/domain/members';
import { formatExaminationText } from '../src/domain/visit-text';
import type { Visit as VisitRecord, VisitSectionKey } from '../src/domain/types';
import { visitLabels } from '../src/parser/visit';
import { SourcePreview } from '../src/components/SourcePreview';
import { VisitReader, type VisitDetailsPatch } from '../src/components/VisitReader';

export default function Visit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { visits, activeMember, loading } = useRecords();
  const existing = visits.find((v) => v.id === id);
  if (id && !existing)
    return (
      <Screen>
        <Button title="返回记录" secondary onPress={() => router.replace('/')} />
        <Text style={styles.body}>{loading ? '正在读取记录…' : '当前成员没有这条就诊记录。'}</Text>
      </Screen>
    );
  return <VisitContent key={`${activeMember.id}:${id ?? 'new'}`} existing={existing} />;
}
function VisitContent({ existing }: { existing?: VisitRecord }) {
  const { reports, documents, refresh, activeMember } = useRecords();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<VisitRecord>(
    existing ?? {
      id: Crypto.randomUUID(),
      memberId: activeMember.id,
      title: '',
      date: '',
      note: '',
      reportIds: [],
    },
  );
  const [savedDraft, setSavedDraft] = useState(existing);
  const [editing, setEditing] = useState(!existing || existing.status === 'review');
  const [metadata, setMetadata] = useState(!draft.date || !existing);
  const [field, setField] = useState<VisitSectionKey>();
  const [more, setMore] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [showOriginalText, setShowOriginalText] = useState(false);
  const [identityAccepted, setIdentityAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const document = documents.find((d) => d.id === draft.documentId);
  const mismatch = needsIdentityReview(activeMember, { ...draft, patient: draft.patient ?? '' });
  const update = (value: Partial<VisitRecord>) => setDraft((current) => ({ ...current, ...value }));
  async function save(status: 'review' | 'confirmed') {
    if (draft.date && !validDate(draft.date)) {
      setMetadata(true);
      Alert.alert('检查就诊日期', '请填写有效日期，例如 2026-10-23；无法确定时可留空并暂存。');
      return;
    }
    if (status === 'confirmed' && (!draft.date || !draft.title.trim())) {
      setMetadata(true);
      Alert.alert('请补全记录', '需要就诊名称和有效日期；也可以暂存，稍后补充。');
      return;
    }
    if (status === 'confirmed' && mismatch && !identityAccepted) {
      Alert.alert('请确认资料归属', '病历姓名与成员姓名不同，请对照原件确认。');
      return;
    }
    setBusy(true);
    try {
      const next: VisitRecord = {
        ...draft,
        title: draft.title.trim() || '门诊记录',
        patient: draft.patient?.trim(),
        status,
        createdAt: draft.createdAt || new Date().toISOString(),
        identityConfirmation:
          status === 'confirmed' &&
          identityAccepted &&
          hasNameMismatch(activeMember, draft.patient ?? '')
            ? { memberName: activeMember.name, patient: draft.patient!.trim() }
            : draft.identityConfirmation,
      };
      await saveVisit(next);
      setSavedDraft(next);
      await setSetting(`record-view:${next.memberId}`, 'visits');
      await refresh();
      setDraft(next);
      if (status === 'confirmed') {
        setEditing(false);
        setMore(false);
        setShowLinks(false);
        if (!existing) router.replace(`/visit?id=${next.id}`);
      } else router.replace('/');
    } catch (e) {
      Alert.alert('保存未完成', e instanceof Error ? e.message : '请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function saveDetails(patch: VisitDetailsPatch) {
    const next = { ...draft, ...patch };
    await saveVisit(next);
    setSavedDraft(next);
    setDraft(next);
    await refresh();
  }
  function back() {
    Alert.alert('离开编辑？', '本次尚未保存的修改会放弃，已保存的记录和原件仍会保留。', [
      { text: '继续编辑', style: 'cancel' },
      {
        text: '放弃修改',
        onPress: () => {
          if (savedDraft && savedDraft.status !== 'review') {
            setDraft(savedDraft);
            setEditing(false);
            setField(undefined);
          } else router.back();
        },
      },
    ]);
  }
  function paragraph(key: VisitSectionKey, index: number) {
    const value = draft.sections?.[key] ?? '';
    const source = draft.original?.sections[key];
    return (
      <View
        key={key}
        style={{
          gap: 8,
          paddingVertical: 16,
          paddingHorizontal: 18,
          borderTopWidth: index ? 1 : 0,
          borderColor: color.line,
        }}
      >
        <View style={styles.between}>
          <View style={[styles.row, { gap: 6 }]}>
            <Text style={[styles.body, { fontWeight: '600' }]}>{visitLabels[key]}</Text>
            {(key === 'diagnosis' || key === 'plan') && <Text style={styles.small}>原文</Text>}
          </View>
          <Pressable
            testID={`edit-${key}`}
            accessibilityRole="button"
            accessibilityLabel={`修改${visitLabels[key]}`}
            onPress={() => setField(field === key ? undefined : key)}
            hitSlop={10}
          >
            <Ionicons name="create-outline" size={20} color={color.muted} />
          </Pressable>
        </View>
        {field === key ? (
          <Field
            label={visitLabels[key]}
            testID={`visit-${key}`}
            value={value}
            multiline
            style={{ minHeight: 90 }}
            onChangeText={(text) => update({ sections: { ...draft.sections, [key]: text } })}
          />
        ) : (
          <Text style={value ? styles.body : styles.subtitle} testID={`visit-reading-${key}`}>
            {(key === 'exam' ? formatExaminationText(value) : value) || '未提取，可对照原件补充'}
          </Text>
        )}
        {document && source && (
          <SourcePreview
            document={document}
            page={draft.sourcePage ?? 0}
            rect={source.rect}
            name={visitLabels[key]}
            initiallyExpanded={false}
            index={index}
            openPage={() => router.push(`/pdf/${document.id}?page=${draft.sourcePage ?? 0}`)}
          />
        )}
      </View>
    );
  }
  if (!editing)
    return (
      <VisitReader
        visit={draft}
        document={document}
        member={activeMember}
        reports={reports}
        onEdit={() => {
          setField(undefined);
          setMore(false);
          setShowOriginalText(false);
          setShowLinks(false);
          setIdentityAccepted(false);
          setEditing(true);
        }}
        onSave={saveDetails}
      />
    );
  return (
    <Screen
      fixedFooter={
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 16),
            borderTopWidth: 1,
            borderColor: color.line,
            backgroundColor: color.bg,
          }}
        >
          <Button
            title="保存就诊记录"
            testID="save-visit"
            busy={busy}
            onPress={() => void save('confirmed')}
          />
        </View>
      }
    >
      <View style={styles.between}>
        <Pressable
          accessibilityRole="button"
          onPress={back}
          style={{ minHeight: 36, justifyContent: 'center' }}
        >
          <Text style={{ color: color.green, fontSize: 15 }}>‹ 返回</Text>
        </Pressable>
        {draft.status === 'review' && <Badge warning>待核对</Badge>}
      </View>
      <Header
        title={existing ? '核对就诊记录' : '记一次就诊'}
        subtitle={document ? '已整理病历原文，内容可直接修改。' : '把就诊经过和相关检查留在一起。'}
      />
      <Card style={{ gap: 10 }}>
        {metadata ? (
          <>
            <Field
              label="就诊名称"
              testID="visit-title"
              value={draft.title}
              onChangeText={(title) => update({ title })}
              placeholder="例如：门诊复查"
            />
            <Field
              label="就诊日期"
              testID="visit-date"
              value={draft.date}
              onChangeText={(date) => update({ date })}
              placeholder="YYYY-MM-DD"
            />
            <Field
              label="医院"
              value={draft.hospital ?? ''}
              onChangeText={(hospital) => update({ hospital })}
            />
            <Field
              label="科室"
              value={draft.department ?? ''}
              onChangeText={(department) => update({ department })}
            />
            {document && (
              <Field
                label="病历中的患者姓名"
                value={draft.patient ?? ''}
                onChangeText={(patient) => {
                  update({ patient, identityConfirmation: undefined });
                  setIdentityAccepted(false);
                }}
              />
            )}
            <Pressable
              onPress={() => setMetadata(false)}
              accessibilityRole="button"
              style={{ minHeight: 40, justifyContent: 'center' }}
            >
              <Text style={{ color: color.green }}>收起基本信息</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.h2}>{draft.hospital || draft.title || '门诊记录'}</Text>
            {!!draft.department && <Text style={styles.subtitle}>{draft.department}</Text>}
            <View style={styles.between}>
              <Text style={styles.small}>{draft.date || '日期待补充'}</Text>
              <Pressable
                accessibilityRole="button"
                testID="visit-metadata"
                onPress={() => setMetadata(true)}
                hitSlop={8}
              >
                <Text style={{ color: color.green }}>修改</Text>
              </Pressable>
            </View>
          </>
        )}
      </Card>
      {mismatch && (
        <Card style={{ backgroundColor: color.amberBg }}>
          <Text style={styles.body}>
            病历为“{draft.patient}”，当前是{activeMember.label}的档案（{activeMember.name}）。
          </Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: identityAccepted }}
            testID="visit-identity"
            onPress={() => setIdentityAccepted(!identityAccepted)}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={styles.body}>
              {identityAccepted ? '☑' : '□'} 已对照原件，确认属于当前成员
            </Text>
          </Pressable>
        </Card>
      )}
      {document && (
        <View style={{ gap: 8 }}>
          <Text style={styles.small}>病历原件 · 第 {(draft.sourcePage ?? 0) + 1} 页</Text>
          <SourcePreview
            document={document}
            page={draft.sourcePage ?? 0}
            rect={{ x: 0, y: 0, width: 1, height: 1 }}
            name="病历原件"
            initiallyExpanded={false}
            index={99}
            openPage={() => router.push(`/pdf/${document.id}?page=${draft.sourcePage ?? 0}`)}
          />
        </View>
      )}
      <Card style={{ padding: 0, gap: 0 }}>
        {(['chief', 'diagnosis', 'plan'] as const).map((key, index) => paragraph(key, index))}
      </Card>
      <Card style={{ padding: 0, gap: 0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: more }}
          testID="visit-more"
          onPress={() => setMore(!more)}
          style={[styles.between, { padding: 18 }]}
        >
          <Text style={styles.body}>更多病历内容</Text>
          <Ionicons name={more ? 'chevron-up' : 'chevron-down'} color={color.muted} size={18} />
        </Pressable>
        {more && (
          <>
            {(['present', 'past', 'exam'] as const).map((key, index) => paragraph(key, index + 3))}
            {!!draft.original && (
              <View style={{ padding: 18, gap: 10 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowOriginalText(!showOriginalText)}
                >
                  <Text style={{ color: color.green }}>
                    {showOriginalText ? '收起识别原文' : '查看识别原文'}
                  </Text>
                </Pressable>
                {showOriginalText && (
                  <Text selectable style={styles.small}>
                    {draft.original.lines.map((line) => line.text).join('\n')}
                  </Text>
                )}
              </View>
            )}
          </>
        )}
      </Card>
      <Card>
        <Field
          label="我的备注（可选）"
          value={draft.note}
          onChangeText={(note) => update({ note })}
          multiline
          placeholder="补充想留下的事项"
        />
      </Card>
      <Card>
        <View style={styles.between}>
          <Text style={styles.h2}>关联检验 · {draft.reportIds?.length ?? 0} 份</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowLinks(!showLinks)}
            testID="visit-links"
            hitSlop={10}
          >
            <Text style={{ color: color.green }}>{showLinks ? '完成' : '选择'}</Text>
          </Pressable>
        </View>
        {showLinks && <Text style={styles.small}>按实际就诊选择，同一天的报告不会自动关联。</Text>}
        {reports
          .filter((r) => showLinks || draft.reportIds?.includes(r.id))
          .map((r) => (
            <Pressable
              key={r.id}
              testID={`visit-link-${r.id}`}
              accessibilityRole={showLinks ? 'checkbox' : 'button'}
              accessibilityState={
                showLinks ? { checked: draft.reportIds?.includes(r.id) } : undefined
              }
              onPress={() =>
                showLinks
                  ? update({
                      reportIds: draft.reportIds?.includes(r.id)
                        ? draft.reportIds.filter((id) => id !== r.id)
                        : [...(draft.reportIds ?? []), r.id],
                    })
                  : router.push(`/report/${r.id}`)
              }
              style={[styles.between, { paddingVertical: 10 }]}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.body}>{r.title}</Text>
                <Text style={styles.small}>{r.date || '日期待补充'}</Text>
              </View>
              {showLinks ? (
                <Text style={{ color: color.green }}>
                  {draft.reportIds?.includes(r.id) ? '☑' : '□'}
                </Text>
              ) : (
                <Ionicons name="chevron-forward" color={color.muted} size={18} />
              )}
            </Pressable>
          ))}
        {!draft.reportIds?.length && !showLinks && (
          <Text style={styles.small}>可选，之后也能添加。</Text>
        )}
        {showLinks && !reports.length && <Text style={styles.small}>当前成员还没有检验报告。</Text>}
      </Card>
      <Button
        title="暂存，稍后补充"
        secondary
        disabled={busy}
        onPress={() => void save('review')}
      />
      {existing && (
        <Button
          title="删除就诊记录"
          secondary
          disabled={busy}
          onPress={() =>
            Alert.alert(
              '删除这次就诊记录？',
              '将移除此记录及其独占的单页病历原件；关联的检验报告仍会保留。',
              [
                { text: '取消', style: 'cancel' },
                {
                  text: '删除',
                  style: 'destructive',
                  onPress: () =>
                    void removeVisit(draft.id)
                      .then(refresh)
                      .then(() => router.replace('/'))
                      .catch(() => Alert.alert('删除未完成', '请重试。')),
                },
              ],
            )
          }
        />
      )}
      {document && document.pageCount > 1 && (
        <Button
          title="查看整份资料"
          secondary
          onPress={() => router.push(`/document/${document.id}`)}
        />
      )}
    </Screen>
  );
}
