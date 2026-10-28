import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { Badge, Button, Card, color, Field, Header, Screen, styles } from '../../src/ui';
import { useRecords } from '../../src/state';
import { deleteReport, saveReport, setSetting } from '../../src/db';
import { track } from '../../src/services/analytics';
import { hasNameMismatch, needsIdentityReview } from '../../src/domain/members';
import { validDate } from '../../src/domain/metrics';
import { reparseReport, organizeAsVisit } from '../../src/services/import';
import { zheyiCode } from '../../src/parser/zheyi';
import { resultKind } from '../../src/parser/sections';
import type { Observation, Report } from '../../src/domain/types';
import { ReportObservation } from '../../src/components/ReportObservation';
import { reviewCopy, reviewMessages } from '../../src/domain/review-messages';
import { isReviewed, needsIndividualReview, reviewGroups } from '../../src/domain/review-groups';
import { SourcePreview } from '../../src/components/SourcePreview';
import { useReviewGroupNavigation } from '../../src/components/useReviewGroupNavigation';
import { useReviewPreviews } from '../../src/components/useReviewPreviews';
import type { SourceImage } from '../../src/services/source-preview';
import { DocumentPatientFill } from '../../src/components/DocumentPatientFill';
import { BackLink } from '../../src/components/BackLink';

export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { reports, documents, visits = [], refresh, activeMember, loading } = useRecords();
  const saved = reports.find((r) => r.id === id);
  const [draft, setDraft] = useState<Report | undefined>(saved),
    [busy, setBusy] = useState(false),
    [candidate, setCandidate] = useState(false),
    [editing, setEditing] = useState(saved?.status !== 'confirmed');
  const [identityAccepted, setIdentityAccepted] = useState(false);
  useEffect(() => {
    setIdentityAccepted(false);
  }, [id, draft?.patient, activeMember.name]);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [groupAnchor, setGroupAnchor] = useState<string | null>(null);
  const [metadataExpanded, setMetadataExpanded] = useState(!saved?.patient);
  const scrollRef = useRef<ScrollView>(null);
  const navigation = useReviewGroupNavigation(scrollRef, `${activeMember.id}:${id}`);
  const [groupWidth, setGroupWidth] = useState(0);
  const [preparedGroup, setPreparedGroup] = useState<{ key: string; image?: SourceImage }>();
  const persisting = useRef(false);
  const groupOffset = useRef<number | undefined>(undefined);
  const listOffset = useRef(0);
  const rowOffsets = useRef(new Map<string, number>());
  const jumpTarget = useRef<{ kind: 'group' } | { kind: 'row'; id: string } | null>(null);
  const alignJumpTarget = useCallback(() => {
    const target = jumpTarget.current;
    if (!target) return;
    const rowY = target.kind === 'row' ? rowOffsets.current.get(target.id) : undefined;
    const y =
      target.kind === 'group'
        ? groupOffset.current
        : rowY === undefined
          ? undefined
          : listOffset.current + rowY;
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, []);
  // Equal-height groups may not fire another layout event when switching.
  useLayoutEffect(alignJumpTarget, [groupAnchor, alignJumpTarget]);
  function resetRows() {
    navigation.cancel();
    setPreparedGroup(undefined);
    setExpandedRows({});
    jumpTarget.current = null;
    setGroupAnchor(null);
    rowOffsets.current.clear();
  }
  function jumpToRow(observationId: string) {
    Keyboard.dismiss();
    jumpTarget.current = { kind: 'row', id: observationId };
    setGroupAnchor(observationId);
    setExpandedRows((current) => ({ ...current, [observationId]: true }));
    alignJumpTarget();
  }
  useEffect(() => {
    if (saved && !draft) {
      setDraft(saved);
      setEditing(saved.status !== 'confirmed');
    }
  }, [saved, draft]);
  const savedId = saved?.id;
  const savedPatient = saved?.patient;
  useEffect(() => {
    if (candidate || !savedPatient?.trim()) return;
    setDraft((current) =>
      current && current.id === savedId && !current.patient.trim()
        ? {
            ...current,
            patient: savedPatient,
            identityConfirmation: undefined,
            warnings: current.warnings.filter(
              (w) => !reviewMessages([w]).includes(reviewCopy.patient),
            ),
          }
        : current,
    );
  }, [savedId, savedPatient, candidate]);
  const groups = useMemo(() => (draft ? reviewGroups(draft) : []), [draft]);
  const pending = draft?.observations.filter(needsIndividualReview) ?? [];
  const firstPending = groups.findIndex((group) =>
    group.indices.some((i) => needsIndividualReview(draft!.observations[i]!)),
  );
  const anchored = groups.findIndex((group) =>
    group.indices.some((i) => draft!.observations[i]!.id === groupAnchor),
  );
  const groupIndex = Math.max(0, anchored >= 0 ? anchored : firstPending);
  const group = groups[groupIndex];
  const document = documents.find((d) => d.id === draft?.documentId);
  const preparePreview = useReviewPreviews(document, groups, groupIndex, editing);
  const previewKey = JSON.stringify([document?.uri, group?.page, group?.rect]);
  if (!draft || !saved || draft.id !== id || draft.memberId !== activeMember.id)
    return (
      <Screen>
        <Button title="返回记录" onPress={() => router.replace('/')} secondary />
        <Text style={styles.body}>{loading ? '正在读取记录…' : '当前成员没有这份报告。'}</Text>
      </Screen>
    );
  const r = draft;
  const narrative = r.reportType === 'imaging';
  const resultUnit = narrative ? '段' : '项';
  const visibleIndices = editing ? (group?.indices ?? []) : r.observations.map((_, i) => i);
  const individual = visibleIndices.filter((i) => needsIndividualReview(r.observations[i]!));
  function navigateGroup(index: number) {
    const next = groups[index];
    if (!next) return;
    jumpTarget.current = null;
    let image: SourceImage | undefined;
    navigation.navigate(
      groupOffset.current,
      () => {
        rowOffsets.current.clear();
        setExpandedRows({});
        setPreparedGroup({ key: JSON.stringify([document?.uri, next.page, next.rect]), image });
        setGroupAnchor(r.observations[next.indices[0]!]!.id);
      },
      document && next.rect
        ? async () => {
            image = await preparePreview(next);
          }
        : undefined,
    );
  }
  function update(values: Partial<Report>) {
    setDraft({ ...r, ...values });
  }
  function updateObservation(index: number, values: Partial<Observation>) {
    update({
      observations: r.observations.map((o, i) => {
        if (i !== index) return o;
        const changed = ['name', 'rawValue', 'unit', 'reference'].some(
          (key) =>
            key in values && values[key as keyof Observation] !== o[key as keyof Observation],
        );
        const next = {
          ...o,
          ...values,
          ...('rawValue' in values
            ? { resultKind: narrative ? ('text' as const) : resultKind(values.rawValue ?? '') }
            : {}),
          ...(changed
            ? {
                reviewed: false,
                needsReview: true,
                warnings: o.warnings?.length
                  ? o.warnings
                  : [narrative ? reviewCopy.text : reviewCopy.item],
              }
            : {}),
        };
        if (r.template?.startsWith('fahzu-yh:') || r.template?.startsWith('fahzu-yh-'))
          next.code = zheyiCode(next.name, next.unit);
        return next;
      }),
    });
  }
  function reviewItem(index: number) {
    if (busy) return;
    const item = r.observations[index]!;
    if (!item.name.trim() || !item.rawValue.trim()) {
      Alert.alert(narrative ? '检查文字' : '检查指标', '请填写名称和内容，或移除空行。');
      return;
    }
    Keyboard.dismiss();
    jumpTarget.current = null;
    // Inline acknowledgement must not advance to the next group of issues.
    setGroupAnchor(r.observations[group!.indices[0]!]!.id);
    updateObservation(index, { needsReview: false, reviewed: true });
    setExpandedRows((current) => ({ ...current, [item.id]: false }));
  }
  function undoReviewItem(index: number) {
    if (busy) return;
    Keyboard.dismiss();
    jumpTarget.current = null;
    setGroupAnchor(r.observations[group!.indices[0]!]!.id);
    updateObservation(index, { needsReview: true, reviewed: false });
  }
  function finishReview() {
    if (busy || persisting.current) return;
    // This action takes priority over a group still waiting for its preview or scroll.
    navigation.cancel();
    if (pending[0]) {
      jumpToRow(pending[0].id);
    } else {
      void persist('confirmed');
    }
  }
  function recognizeAgain() {
    Alert.alert(
      '重新识别原报告？',
      '会生成一份新结果供你核对，当前未保存的输入将被替换。已保存的记录在你确认保存前保持不变。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '开始识别',
          onPress: () => {
            setBusy(true);
            void reparseReport(r.id)
              .then((next) => {
                resetRows();
                setDraft(next);
                setCandidate(true);
                setEditing(true);
                scrollRef.current?.scrollTo({ y: 0, animated: false });
              })
              .catch((e: unknown) =>
                Alert.alert('识别未完成', e instanceof Error ? e.message : '请稍后重试。'),
              )
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }
  function showMetadata() {
    Keyboard.dismiss();
    jumpTarget.current = null;
    setMetadataExpanded(true);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }
  async function persist(status: Report['status'], current = r) {
    if (busy || persisting.current) return;
    if (current.date && !validDate(current.date)) {
      showMetadata();
      Alert.alert('检查日期', '请使用有效日期，例如 2026-10-18。');
      return;
    }
    if (status === 'confirmed') {
      if (current.observations.some(needsIndividualReview)) {
        Alert.alert('还有项目需要核对', '请先处理标记为待核对的项目。');
        return;
      }
      if (!current.patient.trim()) {
        showMetadata();
        Alert.alert('确认归属', '请填写报告上的患者名称。');
        return;
      }
      if (current.observations.some((o) => !o.name.trim() || !o.rawValue.trim())) {
        Alert.alert(narrative ? '检查文字' : '检查指标', '请填写每项的名称和内容，或删除空行。');
        return;
      }
      if (needsIdentityReview(activeMember, current) && !identityAccepted) {
        showMetadata();
        Alert.alert('患者不一致', '请对照原件确认这份报告属于当前成员，或暂存后稍后核对。');
        return;
      }
    }
    persisting.current = true;
    setBusy(true);
    let leaving = false;
    try {
      const next = {
        ...current,
        patient: current.patient.trim(),
        status,
        identityConfirmation:
          status === 'confirmed' &&
          identityAccepted &&
          hasNameMismatch(activeMember, current.patient)
            ? { memberName: activeMember.name, patient: current.patient.trim() }
            : current.identityConfirmation,
        observations:
          status === 'confirmed'
            ? current.observations.map((o) => ({ ...o, needsReview: false, reviewed: true }))
            : current.observations,
        confirmedAt: status === 'confirmed' ? new Date().toISOString() : current.confirmedAt,
      };
      await saveReport(next);
      await setSetting(`record-view:${next.memberId}`, 'reports');
      // Confirmation leaves this screen: keep its review layout through refresh
      // and the native return animation instead of briefly rendering details.
      if (status !== 'confirmed') {
        resetRows();
        setDraft(next);
        setCandidate(false);
        setEditing(false);
      }
      await refresh();
      if (status === 'confirmed') {
        track('report_confirmed');
        if (document && document.pageCount > 1) router.dismissTo(`/document/${document.id}`);
        else router.replace('/');
        leaving = true;
      }
    } catch {
      Alert.alert('保存失败', '资料仍在本机，请稍后重试。');
    } finally {
      if (!leaving) {
        persisting.current = false;
        setBusy(false);
      }
    }
  }
  function remove() {
    Alert.alert('删除这份记录？', '这份记录的整理结果也会移除。已导出的备份不会被删除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () =>
          void deleteReport(r.id)
            .then(refresh)
            .then(() => router.replace('/'))
            .catch(() => Alert.alert('删除未完成', '请重试。')),
      },
    ]);
  }
  return (
    <Screen
      backgroundColor={editing ? color.paper : undefined}
      scrollRef={scrollRef}
      onContentSizeChange={alignJumpTarget}
      onScroll={navigation.onScroll}
      onMomentumScrollEnd={navigation.onMomentumScrollEnd}
      onScrollBeginDrag={() => {
        jumpTarget.current = null;
        navigation.cancel();
      }}
      fixedHeader={
        editing && r.observations.length > 0 ? (
          <View
            style={[
              styles.between,
              {
                paddingHorizontal: 24,
                paddingVertical: 8,
                backgroundColor: color.paper,
                borderBottomWidth: 1,
                borderBottomColor: color.line,
                flexWrap: 'wrap',
              },
            ]}
          >
            <View style={{ flex: 1, minWidth: 120 }}>
              <Text
                testID="review-count"
                accessibilityLiveRegion="polite"
                style={[styles.body, { fontWeight: '500', color: color.ink }]}
              >
                待核对 {pending.length} {resultUnit}
              </Text>
              <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
                <Text style={styles.small}>
                  共 {r.observations.length} {resultUnit}
                </Text>
                <Text testID="review-group-count" style={styles.small}>
                  第 {groupIndex + 1} / {groups.length} 组
                </Text>
              </View>
            </View>
          </View>
        ) : undefined
      }
      fixedFooter={
        editing && r.observations.length > 0 ? (
          <View
            testID="review-footer"
            style={[
              styles.between,
              {
                paddingHorizontal: 24,
                paddingTop: 12,
                paddingBottom: Math.max(insets.bottom, 16),
                borderTopWidth: 1,
                borderTopColor: color.line,
                backgroundColor: color.paper,
                flexWrap: 'wrap',
              },
            ]}
          >
            <Text
              testID="review-action-hint"
              accessibilityLiveRegion="polite"
              style={[styles.small, { flex: 1, minWidth: 120 }]}
            >
              {pending.length
                ? `还有 ${pending.length} ${resultUnit}需要核对`
                : `将保存全部 ${r.observations.length} ${narrative ? '段文字' : '项结果'}`}
            </Text>
            <Button
              testID="review-action"
              title={pending.length ? '去核对' : '完成核对'}
              busy={busy}
              onPress={finishReview}
            />
          </View>
        ) : undefined
      }
    >
      <View style={styles.between}>
        <BackLink disabled={busy} />
        <Badge warning={r.status === 'review'}>
          {r.status === 'confirmed' ? '已核对' : r.status === 'archived' ? '已归档' : '待核对'}
        </Badge>
      </View>
      <Header
        title={editing ? '核对报告' : '报告详情'}
        subtitle={
          editing && r.observations.length
            ? `已提取 ${r.observations.length} ${resultUnit}，请对照原件核对后保存。`
            : narrative
              ? '整理报告原文，可随时对照原件。'
              : '每个数值，都可以回到原报告核对。'
        }
      />
      {visits
        .filter((v) => v.reportIds?.includes(r.id))
        .map((v) => (
          <Pressable
            key={v.id}
            accessibilityRole="button"
            onPress={() => router.push(`/visit?id=${v.id}`)}
            style={{ paddingVertical: 10 }}
          >
            <Text style={{ color: color.green }}>
              关联就诊 · {v.date || '日期待补充'} · {v.department || v.title} ›
            </Text>
          </Pressable>
        ))}
      {document && document.pageCount > 1 && (
        <Button
          title="查看整份报告"
          secondary
          testID="open-document"
          onPress={() => router.push(`/document/${document.id}`)}
        />
      )}
      {r.observations.some((o) => o.markerStatus === 'unavailable') && (
        <Text style={styles.small}>原报告中的图形箭头可能未被读取，请结合原件核对。</Text>
      )}
      {candidate && (
        <Card>
          <Text style={styles.body}>这是新识别的结果，尚未保存。</Text>
          <Button
            title="放弃新结果，恢复原记录"
            secondary
            disabled={busy}
            testID="discard-reparse"
            onPress={() => {
              resetRows();
              setDraft(saved);
              setCandidate(false);
              setEditing(saved?.status !== 'confirmed');
              scrollRef.current?.scrollTo({ y: 0, animated: false });
            }}
          />
        </Card>
      )}
      {editing && !r.observations.length && (
        <Card>
          <Text style={styles.body}>尚未提取出结果。你可以重新识别，或查看原件后手动整理。</Text>
          {document && (
            <>
              <Text style={styles.small}>
                如果这是门诊病历，可另建就诊记录；当前检验记录会保留。
              </Text>
              <Button
                title="按就诊病历整理"
                secondary
                busy={busy}
                onPress={() => {
                  setBusy(true);
                  void organizeAsVisit(document.id, r.sourcePage ?? 0)
                    .then(async (visitId) => {
                      await refresh();
                      router.push(`/visit?id=${visitId}`);
                    })
                    .catch(() => Alert.alert('整理未完成', '原件已保留，请重试。'))
                    .finally(() => setBusy(false));
                }}
              />
            </>
          )}
        </Card>
      )}
      <Card style={{ padding: 14 }}>
        <View style={styles.between}>
          <View style={{ flex: 1 }}>
            <Text style={styles.body}>{r.title}</Text>
            <Text style={styles.small}>
              {r.patient || '姓名未填写'} · {r.date || '日期未填写'}
            </Text>
          </View>
          {editing && (
            <Pressable
              accessibilityRole="button"
              testID="edit-metadata"
              onPress={() => setMetadataExpanded(!metadataExpanded)}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ color: color.green }}>{metadataExpanded ? '收起' : '修改信息'}</Text>
            </Pressable>
          )}
        </View>
        {editing && metadataExpanded && (
          <>
            <Field label="报告名称" value={r.title} onChangeText={(title) => update({ title })} />
            <Field
              label="报告中的患者名称"
              testID="patient-input"
              value={r.patient}
              onChangeText={(patient) => update({ patient })}
              placeholder="填写原报告上的姓名"
            />
            {document && document.pageCount > 1 && !candidate && (
              <DocumentPatientFill
                key={`${document.id}:${activeMember.id}`}
                documentId={document.id}
                suggestedName={r.patient}
                disabled={busy}
                onBusyChange={setBusy}
                onFilled={(patient, ids) => {
                  if (!ids.includes(r.id)) return;
                  setDraft((current) =>
                    current?.id === r.id && current.patient === r.patient
                      ? {
                          ...current,
                          patient,
                          identityConfirmation: undefined,
                          warnings: current.warnings.filter(
                            (w) => !reviewMessages([w]).includes(reviewCopy.patient),
                          ),
                        }
                      : current,
                  );
                }}
              />
            )}
            <Field
              label={
                narrative && r.dateKind === 'report'
                  ? '报告日期（不确定时留空）'
                  : '检查日期（不确定时留空）'
              }
              testID="date-input"
              value={r.date}
              onChangeText={(date) => update({ date, dateSource: undefined, dateKind: 'unknown' })}
              placeholder="YYYY-MM-DD"
            />
            {r.dateKind !== 'unknown' && (
              <Text style={styles.small}>
                日期来源：
                {r.dateSource === 'header'
                  ? '报告页眉'
                  : r.dateKind === 'sample'
                    ? '采样日期'
                    : r.dateKind === 'exam'
                      ? '体检／检查日期'
                      : '报告日期'}
              </Text>
            )}
            {reviewMessages(r.warnings).map((w, i) => (
              <Text key={i} style={styles.small}>
                {w}
              </Text>
            ))}
          </>
        )}
      </Card>
      {editing && needsIdentityReview(activeMember, r) && (
        <Card style={{ backgroundColor: color.amberBg, borderColor: color.amberBg }}>
          <Text style={[styles.body, { color: color.amber, fontWeight: '600' }]}>
            报告姓名与成员姓名不同
          </Text>
          <Text style={styles.small}>
            报告为“{r.patient}”，当前是{activeMember.label}的档案（{activeMember.name}
            ）。请对照原件确认。
          </Text>
          <Pressable
            testID="confirm-member-identity"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: identityAccepted }}
            onPress={() => setIdentityAccepted(!identityAccepted)}
            style={[styles.row, { minHeight: 44 }]}
          >
            <Text style={{ color: color.amber, fontSize: 20 }}>
              {identityAccepted ? '☑' : '□'}
            </Text>
            <Text style={[styles.body, { flex: 1 }]}>我已核对，确实属于{activeMember.label}</Text>
          </Pressable>
        </Card>
      )}
      <View
        testID="review-group-start"
        style={{ gap: 18 }}
        onLayout={({ nativeEvent }) => {
          groupOffset.current = nativeEvent.layout.y;
          setGroupWidth(nativeEvent.layout.width);
          alignJumpTarget();
        }}
      >
        {editing && group && document && (
          <View style={{ gap: 8 }}>
            <View style={styles.between}>
              <Text style={styles.body}>
                原报告 · 第 {group.indices[0]! + 1}–{group.indices.at(-1)! + 1} {resultUnit}
              </Text>
              <Text style={styles.small}>第 {group.page + 1} 页 · 点图放大</Text>
            </View>
            {group.rect ? (
              <SourcePreview
                key={group.indices.map((i) => r.observations[i]!.id).join(':')}
                document={document}
                page={group.page}
                rect={group.rect}
                fitContent
                initialWidth={groupWidth}
                initialImage={preparedGroup?.key === previewKey ? preparedGroup.image : undefined}
                name={`第 ${group.indices[0]! + 1}–${group.indices.at(-1)! + 1} ${resultUnit}`}
                initiallyExpanded
                index={-groupIndex - 1}
                openPage={() => router.push(`/pdf/${document.id}?page=${group.page}`)}
              />
            ) : (
              <Button
                title="查看原件核对本组"
                secondary
                onPress={() => router.push(`/pdf/${document.id}?page=${group.page}`)}
              />
            )}
          </View>
        )}
        <View style={styles.between}>
          <Text style={editing ? [styles.body, { fontWeight: '500' }] : styles.h2}>
            {narrative ? '报告原文' : editing ? '提取结果' : '检验结果'}
          </Text>
          <Text style={styles.small}>
            {editing
              ? narrative
                ? '可对照原件修改'
                : '点数值可修改'
              : `${r.observations.length} ${resultUnit}`}
          </Text>
        </View>
      </View>
      {!editing && !narrative && r.observations.length > 0 && (
        <Text style={styles.small}>横条标出原报告参考范围，圆点表示本次结果。</Text>
      )}
      <View
        testID="observation-list"
        onLayout={({ nativeEvent }) => {
          listOffset.current = nativeEvent.layout.y;
          alignJumpTarget();
        }}
        style={{ backgroundColor: color.paper, borderRadius: editing ? 0 : 18, overflow: 'hidden' }}
      >
        {visibleIndices.map((i) => {
          const o = r.observations[i]!;
          const expanded = expandedRows[o.id] ?? false;
          function toggle() {
            Keyboard.dismiss();
            jumpTarget.current = null;
            if (editing && !expanded) setGroupAnchor(o.id);
            setExpandedRows((current) => ({ ...current, [o.id]: !expanded }));
          }
          return (
            <ReportObservation
              key={o.id}
              report={r}
              observation={o}
              document={document}
              index={i}
              expanded={expanded}
              editing={editing}
              reviewed={isReviewed(r, o)}
              individualReview={needsIndividualReview(o)}
              disabled={busy}
              onToggle={toggle}
              onLayout={(y) => {
                rowOffsets.current.set(o.id, y);
                if (jumpTarget.current?.kind === 'row' && jumpTarget.current.id === o.id)
                  alignJumpTarget();
              }}
              onChange={(values) => {
                jumpTarget.current = null;
                updateObservation(i, values);
              }}
              onReview={() => reviewItem(i)}
              onUndoReview={() => undoReviewItem(i)}
              onRemove={() => {
                jumpTarget.current = null;
                rowOffsets.current.delete(o.id);
                update({ observations: r.observations.filter((item) => item.id !== o.id) });
              }}
              onEdit={() => {
                setEditing(true);
                setGroupAnchor(o.id);
                setExpandedRows((current) => ({ ...current, [o.id]: true }));
              }}
              openPage={() => {
                if (document) router.push(`/pdf/${document.id}?page=${o.page}`);
              }}
            />
          );
        })}
      </View>
      {editing ? (
        <>
          {group && (
            <View style={{ gap: 10 }}>
              {individual.length > 0 && (
                <Text testID="review-group-hint" style={[styles.small, { textAlign: 'center' }]}>
                  还有 {individual.length} {resultUnit}需要勾选确认
                </Text>
              )}
              <View style={styles.between}>
                <Pressable
                  testID="previous-group"
                  accessibilityRole="button"
                  accessibilityLabel="上一组"
                  accessibilityState={{
                    disabled: busy || navigation.transitioning || groupIndex === 0,
                  }}
                  disabled={busy || navigation.transitioning || groupIndex === 0}
                  onPress={() => navigateGroup(groupIndex - 1)}
                  style={{
                    minHeight: 44,
                    justifyContent: 'center',
                    opacity: groupIndex === 0 ? 0.4 : 1,
                  }}
                >
                  <Text style={[styles.small, { color: color.green }]}>上一组</Text>
                </Pressable>
                <Text style={styles.small}>
                  {groupIndex + 1} / {groups.length}
                </Text>
                <Pressable
                  testID="next-group"
                  accessibilityRole="button"
                  accessibilityLabel="下一组"
                  accessibilityState={{
                    disabled: busy || navigation.transitioning || groupIndex === groups.length - 1,
                  }}
                  disabled={busy || navigation.transitioning || groupIndex === groups.length - 1}
                  onPress={() => navigateGroup(groupIndex + 1)}
                  style={{
                    minHeight: 44,
                    justifyContent: 'center',
                    opacity: groupIndex === groups.length - 1 ? 0.4 : 1,
                  }}
                >
                  <Text style={[styles.small, { color: color.green }]}>下一组</Text>
                </Pressable>
              </View>
            </View>
          )}

          <Button
            title={narrative ? '＋ 补充文字' : '＋ 手动补充指标'}
            secondary
            testID="add-observation"
            onPress={() => {
              const observationId = Crypto.randomUUID();
              update({
                observations: [
                  ...r.observations,
                  {
                    id: observationId,
                    name: '',
                    ...(narrative ? { resultKind: 'text' as const } : {}),
                    code: '',
                    rawValue: '',
                    originalValue: '',
                    unit: '',
                    reference: '',
                    specimen: '',
                    method: '',
                    page: r.sourcePage ?? 0,
                    needsReview: true,
                    reviewed: false,
                    warnings: [narrative ? reviewCopy.text : reviewCopy.item],
                  },
                ],
              });
              jumpToRow(observationId);
            }}
          />
          <Text style={styles.small}>
            {narrative
              ? '确认表示你已对照原件核对文字并确认资料归属。超声图像和手写标注请查看原件。'
              : '确认表示你已对照原件核对并确认资料归属。缺少日期的结果不会进入趋势。'}
          </Text>
          {!group && (
            <Button
              title="核对完成，保存"
              testID="confirm-report"
              onPress={() => void persist('confirmed')}
              busy={busy}
            />
          )}
          <Button
            title="暂存，稍后核对"
            testID="save-draft"
            secondary
            onPress={() => void persist('review')}
            disabled={busy}
          />
          {r.observations.length === 0 && (
            <Button title="仅归档原件" secondary onPress={() => void persist('archived')} />
          )}
        </>
      ) : null}
      {!editing && (
        <Button
          title="修改记录"
          secondary
          disabled={busy}
          testID="edit-report"
          onPress={() => {
            setEditing(true);
            scrollRef.current?.scrollTo({ y: 0, animated: true });
          }}
        />
      )}
      {document && (
        <Button
          title={document.sourceType === 'image' ? '查看报告图片' : '查看 PDF 原件'}
          secondary
          icon="document-text-outline"
          testID="view-original"
          onPress={() => router.push(`/pdf/${document.id}?page=${r.sourcePage ?? 0}`)}
        />
      )}
      {document && (
        <Button
          title={busy ? '正在本机识别…' : '重新识别原报告'}
          secondary
          busy={busy}
          onPress={recognizeAgain}
          testID="reparse-report"
        />
      )}
      {document && (
        <Button
          title={document.sourceType === 'image' ? '导出图片报告（PDF）' : '导出 PDF 原件'}
          secondary
          onPress={() =>
            void Sharing.shareAsync(document.uri, {
              mimeType: 'application/pdf',
              UTI: 'com.adobe.pdf',
            }).catch(() => Alert.alert('导出未完成', '请重试。'))
          }
        />
      )}
      <Pressable
        testID="delete-report"
        onPress={remove}
        style={{ padding: 12, alignItems: 'center' }}
      >
        <Text style={{ color: color.red, fontSize: 14 }}>删除记录</Text>
      </Pressable>
    </Screen>
  );
}
