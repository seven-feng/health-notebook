import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Button, Card, color, Empty, Screen, styles } from '../../src/ui';
import { MemberHeader } from '../../src/components/MemberHeader';
import { useRecords } from '../../src/state';
import {
  archiveUnreadable,
  importPickedPdf,
  importedDestination,
  organizeAsVisit,
  retryImport,
} from '../../src/services/import';
import { deleteUnlinkedDocument, getSetting, setSetting } from '../../src/db';
import { withPickerSession } from '../../src/services/picker-cache';

type RecordView = 'visits' | 'reports';
export default function Records() {
  const { reports, documents, visits, refresh, loading, importing, error, activeMember } =
    useRecords();
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{ memberId: string; view: RecordView }>();
  const preferenceVersion = useRef(0);
  const activeId = useRef(activeMember.id);
  activeId.current = activeMember.id;
  const view =
    selection?.memberId === activeMember.id
      ? selection.view
      : reports.length && !visits.length
        ? 'reports'
        : 'visits';
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const version = ++preferenceVersion.current;
      void getSetting(`record-view:${activeMember.id}`)
        .then((value) => {
          if (active && version === preferenceVersion.current)
            setSelection(
              value === 'visits' || value === 'reports'
                ? { memberId: activeMember.id, view: value }
                : undefined,
            );
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [activeMember.id]),
  );
  function selectView(next: RecordView) {
    preferenceVersion.current++;
    setSelection({ memberId: activeMember.id, view: next });
    void setSetting(`record-view:${activeMember.id}`, next).catch(() => {});
  }
  async function openImported(ids: string[], owner = activeMember.id) {
    await refresh();
    if (ids[0] && activeId.current === owner) router.push(await importedDestination(ids));
  }
  async function run() {
    return withPickerSession(async () => {
      try {
        setBusy(true);
        const result = await DocumentPicker.getDocumentAsync({
          type: 'application/pdf',
          copyToCacheDirectory: true,
        });
        if (result.canceled || !result.assets[0]) return;
        const file = result.assets[0];
        const { ids, duplicate } = await importPickedPdf(file.uri, file.name, activeMember.id);
        if (duplicate) Alert.alert('这份资料已导入', '已打开已有记录。');
        await openImported(ids);
      } catch (e) {
        Alert.alert('导入提示', e instanceof Error ? e.message : '导入失败，请重试。');
        await refresh();
      } finally {
        setBusy(false);
      }
    });
  }
  async function recover(action: () => Promise<string[]>) {
    setBusy(true);
    try {
      await openImported(await action());
    } catch (e) {
      Alert.alert('整理未完成', e instanceof Error ? e.message : '原件已保留，请重试。');
    } finally {
      setBusy(false);
    }
  }
  const groupedDocuments = documents.filter(
    (d) => d.pageCount > 1 && d.state === 'ready' && reports.some((r) => r.documentId === d.id),
  );
  const groupedIds = new Set(groupedDocuments.map((d) => d.id));
  const reportCount =
    groupedDocuments.length + reports.filter((r) => !groupedIds.has(r.documentId)).length;
  const reportItems = [
    ...groupedDocuments.map((d) => ({
      id: d.id,
      date: reports.find((r) => r.documentId === d.id)?.date || d.createdAt,
      kind: 'document' as const,
      document: d,
    })),
    ...reports
      .filter((r) => !groupedIds.has(r.documentId))
      .map((r) => ({ id: r.id, date: r.date || r.createdAt, kind: 'report' as const, report: r })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const pendingFiles = documents.filter(
    (d) =>
      d.state === 'failed' ||
      (d.state === 'ready' &&
        !reports.some((r) => r.documentId === d.id) &&
        !visits.some((v) => v.documentId === d.id)),
  );
  return (
    <Screen>
      <MemberHeader
        title={`${activeMember.label}的健康记录`}
        subtitle="把每一次就诊和检查，慢慢整理好。"
      />
      <Card style={{ backgroundColor: color.ink, borderColor: color.ink, padding: 22 }}>
        <View style={styles.between}>
          <Text style={{ color: '#C5D7CB', fontSize: 12 }}>{activeMember.label}的资料库</Text>
          <Ionicons name="lock-closed-outline" color="#C5D7CB" size={15} />
        </View>
        <View style={[styles.row, { gap: 24 }]}>
          <View style={[styles.row, { alignItems: 'baseline', gap: 6 }]}>
            <Text testID="visit-count" style={{ color: 'white', fontSize: 36, fontWeight: '600' }}>
              {visits.length}
            </Text>
            <Text style={{ color: '#C5D7CB', fontSize: 12 }}>次就诊</Text>
          </View>
          <View style={{ width: 1, height: 30, backgroundColor: '#49665D' }} />
          <View style={[styles.row, { alignItems: 'baseline', gap: 6 }]}>
            <Text testID="report-count" style={{ color: 'white', fontSize: 36, fontWeight: '600' }}>
              {reportCount}
            </Text>
            <Text style={{ color: '#C5D7CB', fontSize: 12 }}>份报告</Text>
          </View>
        </View>
        <Text style={{ color: '#C5D7CB', fontSize: 12 }}>资料保存在这台设备，可随时查看原件。</Text>
      </Card>
      <Button
        title={busy || importing ? '正在整理资料…' : '导入 PDF'}
        icon="add-outline"
        busy={busy || importing}
        disabled={loading}
        onPress={() => void run()}
        testID="import-pdf"
      />
      <View style={styles.row}>
        {(['camera', 'library'] as const).map((source) => (
          <View key={source} style={{ flex: 1 }}>
            <Button
              title={source === 'camera' ? '拍照识别' : '从相册选择'}
              icon={source === 'camera' ? 'camera-outline' : 'images-outline'}
              secondary
              disabled={busy || importing || loading}
              testID={source === 'camera' ? 'import-camera' : 'import-image'}
              onPress={() =>
                router.push({ pathname: '/photo', params: { source, memberId: activeMember.id } })
              }
            />
          </View>
        ))}
      </View>
      <View
        style={{ flexDirection: 'row', padding: 4, borderRadius: 13, backgroundColor: '#EAEDE6' }}
      >
        {(['visits', 'reports'] as const).map((item) => (
          <Pressable
            key={item}
            testID={`view-${item}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === item }}
            onPress={() => selectView(item)}
            style={{
              flex: 1,
              minHeight: 42,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 10,
              backgroundColor: view === item ? color.paper : 'transparent',
            }}
          >
            <Text
              style={{
                color: view === item ? color.ink : color.muted,
                fontWeight: view === item ? '600' : '400',
                fontSize: 14,
              }}
            >
              {item === 'visits' ? '就诊记录' : '检查报告'}
              {(
                item === 'visits'
                  ? visits.some((v) => v.status === 'review')
                  : reports.some((r) => r.status === 'review')
              )
                ? ' ·'
                : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading && <ActivityIndicator color={color.green} />}
      {!!error && (
        <Card>
          <Text style={styles.body}>{error}</Text>
          <Button title="重新读取" onPress={() => void refresh()} secondary />
        </Card>
      )}
      {!loading && view === 'visits' && !visits.length && (
        <Empty
          title="留下一次就诊"
          detail="拍下门诊病历，就诊原因和医嘱会整理在这里。也可以手动记录。"
        />
      )}
      {!loading && view === 'reports' && !reportItems.length && (
        <Empty
          title="从第一份检查报告开始"
          detail="导入 PDF 或拍下报告，整理检查原文和检验指标。"
        />
      )}
      {view === 'visits' &&
        [...visits]
          .sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''))
          .map((v) => (
            <View key={v.id} style={{ gap: 8 }}>
              <Text style={styles.small}>{v.date || '日期待补充'}</Text>
              <Pressable
                accessibilityRole="button"
                testID={`visit-${v.id}`}
                onPress={() => router.push(`/visit?id=${v.id}`)}
              >
                <Card style={{ gap: 10 }}>
                  <View style={styles.between}>
                    <Text style={[styles.h2, { flex: 1 }]}>{v.department || v.title}</Text>
                    {v.status === 'review' ? (
                      <Badge warning>待核对</Badge>
                    ) : (
                      <Ionicons name="chevron-forward" color={color.muted} size={18} />
                    )}
                  </View>
                  {!!v.hospital && <Text style={styles.small}>{v.hospital}</Text>}
                  {!!(v.sections?.chief || v.note) && (
                    <Text numberOfLines={2} style={styles.body}>
                      {v.sections?.chief || v.note}
                    </Text>
                  )}
                  <View style={styles.divider} />
                  <Text style={styles.small}>
                    {v.documentId ? '病历 1 份' : '手动记录'} · 检验 {v.reportIds?.length ?? 0} 份
                  </Text>
                </Card>
              </Pressable>
            </View>
          ))}
      {view === 'visits' && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/visit')}
          style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ color: color.green, fontSize: 13 }}>＋ 记一次就诊</Text>
        </Pressable>
      )}
      {view === 'reports' &&
        reportItems.map((item) => {
          const sections =
            item.kind === 'document'
              ? reports.filter((r) => r.documentId === item.id)
              : [item.report];
          const linked = visits.some((v) =>
            v.reportIds?.some((id) => sections.some((r) => r.id === id)),
          );
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              testID={
                item.kind === 'document'
                  ? `document-${item.id}`
                  : `report-${item.report.date || item.id}`
              }
              onPress={() =>
                router.push(
                  item.kind === 'document' ? `/document/${item.id}` : `/report/${item.id}`,
                )
              }
            >
              <Card>
                <View style={styles.between}>
                  <Text style={styles.small}>
                    {sections.find((r) => r.date)?.date || '日期待补充'}
                  </Text>
                  <Badge warning={sections.some((r) => r.status === 'review')}>
                    {sections.some((r) => r.status === 'review') ? '待核对' : '已整理'}
                  </Badge>
                </View>
                <View style={styles.between}>
                  <Text style={[styles.h2, { flex: 1 }]}>
                    {item.kind === 'document' ? item.document.fileName : item.report.title}
                  </Text>
                  <Ionicons name="chevron-forward" color={color.muted} size={18} />
                </View>
                <Text style={styles.small}>
                  {item.kind === 'document' ? `${sections.length} 类检查 · ` : ''}
                  {sections.reduce((n, r) => n + r.observations.length, 0)}{' '}
                  {sections.every((r) => r.reportType === 'imaging') ? '段文字' : '项结果'}
                  {linked ? ' · 已关联就诊' : ''}
                </Text>
              </Card>
            </Pressable>
          );
        })}
      {pendingFiles.map((d) => (
        <Card key={d.id}>
          <Badge warning>待整理资料</Badge>
          <Text style={styles.body}>{d.fileName}</Text>
          <Text style={styles.subtitle}>{d.error || '暂未确定资料类型，原件已保留。'}</Text>
          <Button title="查看原件" secondary onPress={() => router.push(`/pdf/${d.id}?page=0`)} />
          {d.state === 'ready' && (
            <Button
              title="重新识别资料"
              secondary
              disabled={busy}
              onPress={() => router.push(`/document/${d.id}`)}
            />
          )}
          <Button
            title="按就诊病历整理"
            secondary
            busy={busy}
            onPress={() => void recover(async () => [await organizeAsVisit(d.id)])}
          />
          <Button
            title="按检验报告整理"
            secondary
            disabled={busy}
            onPress={() => void recover(async () => [await archiveUnreadable(d)])}
          />
          {d.state === 'failed' && (
            <Button
              title="重试读取"
              secondary
              busy={busy}
              onPress={() => void recover(() => retryImport(d))}
            />
          )}
          <Button
            title="删除文件"
            secondary
            disabled={busy}
            onPress={() =>
              Alert.alert('删除这份原件？', '将删除 App 中的本地副本。', [
                { text: '取消', style: 'cancel' },
                {
                  text: '删除',
                  style: 'destructive',
                  onPress: () =>
                    void deleteUnlinkedDocument(d.id)
                      .then(refresh)
                      .catch(() => Alert.alert('删除未完成', '请重试。')),
                },
              ])
            }
          />
        </Card>
      ))}
    </Screen>
  );
}
