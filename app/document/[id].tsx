import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Button, Card, color, Header, Screen, styles } from '../../src/ui';
import { useRecords } from '../../src/state';
import { saveReport } from '../../src/db';
import { DocumentDelete } from '../../src/components/DocumentDelete';
import { DocumentPatientFill } from '../../src/components/DocumentPatientFill';
import { BackLink } from '../../src/components/BackLink';
import {
  reparseDocument,
  organizeAsVisit,
  saveDocumentCandidate,
  type DocumentCandidate,
} from '../../src/services/import';

export default function DocumentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { documents, reports, visits = [], refresh, activeMember } = useRecords();
  const document = documents.find((d) => d.id === id);
  const sections = reports
    .filter((r) => r.documentId === id)
    .sort(
      (a, b) => (a.sourcePage ?? 0) - (b.sourcePage ?? 0) || a.createdAt.localeCompare(b.createdAt),
    );
  const visitRecords = visits.filter((v) => v.documentId === id);
  const scrollRef = useRef<ScrollView>(null);
  const [showOther, setShowOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<DocumentCandidate | null>(null);
  if (!document)
    return (
      <Screen>
        <Button title="返回记录" secondary onPress={() => router.replace('/')} />
        <Text style={styles.body}>当前成员没有这份报告。</Text>
      </Screen>
    );
  const doc = document;
  const count = sections.reduce((n, r) => n + r.observations.length, 0);
  const pending = sections
    .filter((r) => r.status === 'review')
    .reduce((n, r) => n + r.observations.length, 0);
  const extractedPages = new Set([
    ...sections.flatMap((r) => r.observations.map((o) => o.page)),
    ...visitRecords.map((v) => v.sourcePage ?? 0),
  ]);
  const pages = [
    ...new Set(
      doc.parsing?.unprocessed.map((r) => r.page) ??
        Array.from({ length: doc.pageCount }, (_, i) => i),
    ),
  ];
  async function parseAgain() {
    setBusy(true);
    try {
      setCandidate(await reparseDocument(doc.id));
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } catch (e) {
      Alert.alert('整理未完成', e instanceof Error ? e.message : '原记录已保留，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  async function keepCandidate() {
    if (!candidate) return;
    setBusy(true);
    try {
      await saveDocumentCandidate(candidate);
      setCandidate(null);
      await refresh();
    } catch (e) {
      Alert.alert('保存未完成', e instanceof Error ? e.message : '请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function manual(page: number) {
    setBusy(true);
    try {
      const reportId = Crypto.randomUUID();
      await saveReport({
        id: reportId,
        memberId: activeMember.id,
        documentId: doc.id,
        title: `手动整理 · 第 ${page + 1} 页`,
        patient: '',
        date: '',
        dateKind: 'unknown',
        status: 'review',
        template: null,
        warnings: [],
        observations: [],
        sourcePage: page,
        sourcePages: [page],
        createdAt: new Date().toISOString(),
      });
      await refresh();
      router.push(`/report/${reportId}`);
    } catch {
      Alert.alert('保存未完成', '请稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  async function manualVisit(page: number) {
    setBusy(true);
    try {
      const visitId = await organizeAsVisit(doc.id, page);
      await refresh();
      router.push(`/visit?id=${visitId}`);
    } catch (e) {
      Alert.alert('整理未完成', e instanceof Error ? e.message : '请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen scrollRef={scrollRef}>
      <BackLink disabled={busy} />
      <Header
        title={
          doc.recordKind === 'unknown' ? '整理资料' : visitRecords.length ? '整份资料' : '整份报告'
        }
        subtitle={doc.fileName}
      />
      <Card>
        <Text style={styles.h2} testID="document-summary">
          {visitRecords.length ? `${visitRecords.length} 份病历 · ` : ''}
          已整理 {sections.length} 类检查 · {count} 项结果
        </Text>
        <Text style={styles.subtitle}>
          {doc.pageCount} 页原件 · {pending} 项待核对
        </Text>
        <Text style={styles.small}>点击检查名称，查看或核对结果。</Text>
        <DocumentPatientFill
          key={`${doc.id}:${activeMember.id}`}
          documentId={doc.id}
          disabled={busy}
          onBusyChange={setBusy}
        />
        <Button
          title="查看完整原件"
          secondary
          testID="document-original"
          onPress={() => router.push(`/pdf/${doc.id}?page=0`)}
        />
      </Card>
      {visitRecords.map((visit) => (
        <Pressable
          key={visit.id}
          accessibilityRole="button"
          onPress={() => router.push(`/visit?id=${visit.id}`)}
        >
          <Card>
            <View style={styles.between}>
              <Text style={[styles.h2, { flex: 1 }]}>{visit.department || visit.title}</Text>
              <Badge warning={visit.status === 'review'}>
                {visit.status === 'review' ? '待核对' : '已整理'}
              </Badge>
            </View>
            <Text style={styles.small}>
              {visit.date || '日期待补充'} · 病历第 {(visit.sourcePage ?? 0) + 1} 页
            </Text>
          </Card>
        </Pressable>
      ))}
      {doc.recordKind === 'unknown' && !sections.length && !visitRecords.length && (
        <Card>
          <Text style={styles.h2}>这是什么资料？</Text>
          <Text style={styles.body}>暂未确定类型，选择后可对照原件整理。</Text>
          <Button title="就诊病历" busy={busy} onPress={() => void manualVisit(0)} />
          <Button title="检验报告" secondary disabled={busy} onPress={() => void manual(0)} />
        </Card>
      )}
      {candidate && (
        <Card style={{ borderColor: color.green }}>
          <Text style={styles.h2}>新识别结果，尚未保存</Text>
          <Text style={styles.body}>
            {candidate.reports.length} 类检查 ·{' '}
            {candidate.reports.reduce((n, r) => n + r.observations.length, 0)} 项结果
          </Text>
          {candidate.reports.map((r) => (
            <Text key={r.id} style={styles.small}>
              {r.title} · {r.observations.length} {r.reportType === 'imaging' ? '段文字' : '项'}
            </Text>
          ))}
          <Text style={styles.body}>
            另存后会新增待核对记录，可能重复。已有记录、修改和就诊关联都会保留。
          </Text>
          <Button
            title="另存新识别结果"
            testID="save-document-candidate"
            busy={busy}
            onPress={() => void keepCandidate()}
          />
          <Button
            title="放弃新结果"
            testID="discard-document-candidate"
            secondary
            disabled={busy}
            onPress={() => setCandidate(null)}
          />
        </Card>
      )}
      <Text style={styles.h2}>检查结果</Text>
      {!sections.length && (
        <Text style={styles.body}>暂未提取到检查结果，可查看原件、重新识别或手动补录。</Text>
      )}
      {sections.map((r, i) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          testID={`document-section-${i}`}
          onPress={() => router.push(`/report/${r.id}`)}
        >
          <Card>
            <View style={styles.between}>
              <Text style={[styles.h2, { flex: 1 }]}>{r.title}</Text>
              <Badge warning={r.status === 'review'}>
                {r.status === 'confirmed'
                  ? '已核对'
                  : r.status === 'archived'
                    ? '已归档'
                    : '待核对'}
              </Badge>
            </View>
            <View style={styles.between}>
              <Text style={styles.small}>
                {r.observations.length} {r.reportType === 'imaging' ? '段文字' : '项'} · 第{' '}
                {(r.sourcePages ?? [r.sourcePage ?? 0]).map((p) => p + 1).join('、')} 页
              </Text>
              <Ionicons name="chevron-forward" color={color.muted} size={18} />
            </View>
          </Card>
        </Pressable>
      ))}
      <Card>
        <Text style={styles.h2}>未整理内容</Text>
        <Text style={styles.body}>
          未整理的文字、图像和旁注保留在原件中。已提取结果不代表整页内容都已整理。
        </Text>
        <Button
          title={showOther ? '收起页面' : '查看页面与补录'}
          secondary
          testID="document-unprocessed"
          onPress={() => setShowOther(!showOther)}
        />
        {showOther &&
          pages.map((page) => (
            <View key={page} style={{ gap: 8, paddingVertical: 8 }}>
              <Text style={styles.body}>
                第 {page + 1} 页 · {extractedPages.has(page) ? '部分内容已整理' : '尚未整理'}
              </Text>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="查看原页"
                    secondary
                    onPress={() => router.push(`/pdf/${doc.id}?page=${page}`)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="补录检验"
                    secondary
                    disabled={busy}
                    onPress={() => void manual(page)}
                  />
                </View>
              </View>
              <Button
                title="整理为就诊病历"
                secondary
                disabled={busy}
                onPress={() => void manualVisit(page)}
              />
            </View>
          ))}
      </Card>
      <Button
        title="重新整理整份报告"
        secondary
        testID="reparse-document"
        busy={busy}
        onPress={() =>
          Alert.alert('重新整理整份报告？', '新结果会先展示供你选择。保存前，已有记录保持不变。', [
            { text: '取消', style: 'cancel' },
            { text: '重新整理', onPress: () => void parseAgain() },
          ])
        }
      />
      <DocumentDelete
        key={`${doc.id}:${activeMember.id}`}
        documentId={doc.id}
        memberId={activeMember.id}
        hasVisits={visitRecords.length > 0}
        disabled={busy}
        onDeleted={({ cleanupPending, label }) => {
          setCandidate(null);
          void refresh().then(() => {
            router.replace('/');
            Alert.alert(
              `已删除${label}`,
              cleanupPending
                ? '记录已移除，部分本地文件尚未清理完成，下次打开 App 会继续清理。'
                : '相关记录和本地原件已移除。',
            );
          });
        }}
      />
    </Screen>
  );
}
