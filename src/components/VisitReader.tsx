import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DocumentRecord, Member, Report, Visit, VisitSectionKey } from '../domain/types';
import { visitLabels } from '../parser/visit';
import { formatExaminationText } from '../domain/visit-text';
import { Button, Card, color, Field, Screen, styles } from '../ui';

export type VisitDetailsPatch = { note: string } | { reportIds: string[] };

export function VisitReader({
  visit,
  document,
  member,
  reports,
  onEdit,
  onSave,
}: {
  visit: Visit;
  document?: DocumentRecord;
  member: Member;
  reports: Report[];
  onEdit: () => void;
  onSave: (patch: VisitDetailsPatch) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [sheet, setSheet] = useState<'note' | 'reports' | null>(null);
  const [presented, setPresented] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [note, setNote] = useState('');
  const [links, setLinks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const available = reports.filter((report) => report.memberId === visit.memberId);
  const linked = available.filter((report) => visit.reportIds?.includes(report.id));
  const title = visit.title || (visit.department ? `${visit.department}就诊` : '就诊记录');
  const metadata = [
    visit.hospital,
    visit.department && !title.includes(visit.department) ? visit.department : undefined,
    member.label,
  ]
    .filter(Boolean)
    .join(' · ');
  const sourcePage = Math.min(
    Math.max(visit.sourcePage ?? 0, 0),
    Math.max(0, (document?.pageCount ?? 1) - 1),
  );
  const date = visit.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  useEffect(() => {
    // Present and measure first; only the panel moves, never the full-screen backdrop.
    if (!sheet || !presented || !sheetHeight || closing.current) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 0 : 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
  }, [sheet, presented, sheetHeight, progress, reduceMotion]);
  useEffect(() => () => progress.stopAnimation(), [progress]);

  function openSheet(next: 'note' | 'reports') {
    if (sheet || closing.current) return;
    Keyboard.dismiss();
    progress.setValue(0);
    setPresented(false);
    setSheetHeight(0);
    setNote(visit.note);
    setLinks(visit.reportIds ?? []);
    setError('');
    setSheet(next);
  }
  function closeSheet() {
    if (saving) return;
    dismissSheet();
  }
  function dismissSheet() {
    if (closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    Animated.timing(progress, {
      toValue: 0,
      duration: reduceMotion ? 0 : 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setPresented(false);
      setSheet(null);
      closing.current = false;
    });
  }
  async function saveDetails() {
    if (!sheet || saving || closing.current) return;
    setSaving(true);
    setError('');
    try {
      await onSave(sheet === 'note' ? { note: note.trim() } : { reportIds: links });
      dismissSheet();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存未完成，请重试。');
    } finally {
      setSaving(false);
    }
  }
  function paragraph(key: VisitSectionKey) {
    const value = visit.sections?.[key]?.trim();
    return (
      <View key={key} style={[local.paragraph, key === 'chief' && local.chief]}>
        <Text style={local.label}>{key === 'plan' ? '处理与医嘱' : visitLabels[key]}</Text>
        <Text
          selectable
          style={[
            local.body,
            key === 'chief' && local.chiefText,
            key === 'diagnosis' && value ? local.diagnosis : undefined,
            !value && styles.subtitle,
          ]}
        >
          {value || '未记录'}
        </Text>
      </View>
    );
  }
  return (
    <Screen
      fixedHeader={
        <View style={local.nav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={() => router.back()}
            style={local.navAction}
          >
            <Ionicons name="chevron-back" color={color.green} size={18} accessible={false} />
            <Text style={local.actionText}>返回</Text>
          </Pressable>
          <Text accessibilityRole="header" style={local.navTitle}>
            就诊详情
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="编辑就诊记录"
            testID="edit-visit"
            onPress={onEdit}
            style={[local.navAction, { justifyContent: 'flex-end' }]}
          >
            <Text style={local.actionText}>编辑</Text>
          </Pressable>
        </View>
      }
    >
      <View style={{ gap: 7 }}>
        <View style={[styles.between, { flexWrap: 'wrap' }]}>
          <Text style={styles.subtitle}>
            {date
              ? `${date[1]} 年 ${Number(date[2])} 月 ${Number(date[3])} 日`
              : visit.date || '日期未记录'}
          </Text>
          {visit.status === 'confirmed' && (
            <View style={[styles.row, { gap: 4 }]}>
              <Ionicons
                name="checkmark-circle-outline"
                size={15}
                color={color.green}
                accessible={false}
              />
              <Text style={[styles.small, { color: color.green }]}>已确认</Text>
            </View>
          )}
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.subtitle}>{metadata}</Text>
        {document && (
          <Pressable
            testID="visit-original"
            accessibilityRole="button"
            accessibilityLabel={`查看病历原件，第 ${sourcePage + 1} 页`}
            onPress={() => router.push(`/pdf/${document.id}?page=${sourcePage}`)}
            style={[styles.row, { minHeight: 44, gap: 6, flexWrap: 'wrap' }]}
          >
            <Ionicons
              name="document-text-outline"
              size={18}
              color={color.green}
              accessible={false}
            />
            <Text style={[styles.small, { color: color.green }]}>病历原件</Text>
            <Text style={styles.small}>
              {document.pageCount > 1
                ? `第 ${sourcePage + 1} 页 · 共 ${document.pageCount} 页`
                : '1 页'}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={color.green} accessible={false} />
          </Pressable>
        )}
      </View>

      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
        {(['chief', 'diagnosis', 'plan'] as const).map(paragraph)}
        <Pressable
          testID="visit-more"
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          style={local.expand}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.body}>{expanded ? '收起其余病历' : '其余病历内容'}</Text>
            <Text style={styles.small}>现病史、既往史、体格检查</Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={color.muted}
            accessible={false}
          />
        </Pressable>
        {expanded && (
          <View style={local.history}>
            {(['present', 'past', 'exam'] as const).map((key) => (
              <View key={key} style={{ gap: 6 }}>
                <Text style={local.label}>{visitLabels[key]}</Text>
                <Text selectable style={styles.body} testID={`visit-reading-${key}`}>
                  {(key === 'exam'
                    ? formatExaminationText(visit.sections?.[key] ?? '')
                    : visit.sections?.[key]?.trim()) || '未记录'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <View style={{ gap: 2 }}>
        <View style={styles.between}>
          <Text accessibilityRole="header" style={local.sectionTitle}>
            相关检验 <Text style={styles.small}>{linked.length} 份</Text>
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="管理相关检验"
            testID="manage-visit-reports"
            onPress={() => openSheet('reports')}
            style={local.smallAction}
          >
            <Text style={local.actionText}>管理</Text>
          </Pressable>
        </View>
        <Card style={{ padding: 0, gap: 0, borderRadius: 14 }}>
          {linked.length ? (
            linked.map((report, index) => (
              <Pressable
                key={report.id}
                testID={`visit-link-${report.id}`}
                accessibilityRole="button"
                onPress={() => router.push(`/report/${report.id}`)}
                style={[local.reportRow, index > 0 && local.separator]}
              >
                <Ionicons
                  name="document-text-outline"
                  color={color.green}
                  size={24}
                  accessible={false}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.body}>{report.title}</Text>
                  <Text style={styles.small}>
                    {report.date || '日期待补充'} · {report.observations.length} 项
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={color.muted} accessible={false} />
              </Pressable>
            ))
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => openSheet('reports')}
              style={local.reportRow}
            >
              <Ionicons name="add" size={20} color={color.green} accessible={false} />
              <Text style={[styles.subtitle, { flex: 1 }]}>关联这次就诊的检验报告</Text>
            </Pressable>
          )}
        </Card>
      </View>

      <View style={{ gap: 4 }}>
        <View style={styles.between}>
          <Text accessibilityRole="header" style={local.sectionTitle}>
            我的备注
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="编辑我的备注"
            testID="edit-visit-note"
            onPress={() => openSheet('note')}
            style={local.smallAction}
          >
            <Ionicons name="create-outline" size={21} color={color.green} accessible={false} />
          </Pressable>
        </View>
        <Text selectable style={styles.subtitle}>
          {visit.note || '添加想记住的事'}
        </Text>
      </View>

      <Modal
        testID="visit-details-modal"
        visible={sheet !== null}
        transparent
        animationType="none"
        onShow={() => setPresented(true)}
        onRequestClose={closeSheet}
      >
        <View style={local.overlay}>
          <Animated.View
            testID="visit-details-backdrop"
            style={[StyleSheet.absoluteFill, local.backdrop, { opacity: progress }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消修改"
              disabled={saving}
              onPress={closeSheet}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={local.overlay}
            pointerEvents="box-none"
          >
            <Animated.View
              testID="visit-details-sheet"
              accessibilityViewIsModal
              onAccessibilityEscape={closeSheet}
              onLayout={({ nativeEvent }) => setSheetHeight(nativeEvent.layout.height)}
              style={[
                local.sheet,
                {
                  paddingBottom: Math.max(insets.bottom, 20),
                  marginTop: insets.top + 20,
                  transform: [
                    {
                      translateY: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [sheetHeight || height, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.between}>
                <Text accessibilityRole="header" style={styles.h2}>
                  {sheet === 'note' ? '我的备注' : '相关检验'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="关闭编辑"
                  disabled={saving}
                  onPress={closeSheet}
                  style={local.smallAction}
                >
                  <Ionicons name="close" size={24} color={color.muted} />
                </Pressable>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                style={{ flexGrow: 0 }}
                contentContainerStyle={{ gap: 12 }}
              >
                {sheet === 'note' ? (
                  <Field
                    label="我的备注"
                    testID="visit-note-input"
                    value={note}
                    onChangeText={setNote}
                    editable={!saving}
                    multiline
                    style={{ minHeight: 120 }}
                    placeholder="补充想留下的事项"
                  />
                ) : (
                  <>
                    <Text style={styles.subtitle}>选择与这次就诊有关的报告。</Text>
                    {!available.length && <Text style={styles.body}>当前成员还没有检验报告。</Text>}
                    {available.map((report) => (
                      <Pressable
                        key={report.id}
                        testID={`visit-associate-${report.id}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{
                          checked: links.includes(report.id),
                          disabled: saving,
                        }}
                        disabled={saving}
                        onPress={() =>
                          setLinks((ids) =>
                            ids.includes(report.id)
                              ? ids.filter((id) => id !== report.id)
                              : [...ids, report.id],
                          )
                        }
                        style={[local.reportRow, local.separator]}
                      >
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={styles.body}>{report.title}</Text>
                          <Text style={styles.small}>{report.date || '日期待补充'}</Text>
                        </View>
                        <Ionicons
                          name={links.includes(report.id) ? 'checkbox' : 'square-outline'}
                          size={23}
                          color={color.green}
                          accessible={false}
                        />
                      </Pressable>
                    ))}
                  </>
                )}
              </ScrollView>
              {!!error && (
                <Text accessibilityRole="alert" style={{ color: color.red }}>
                  {error}
                </Text>
              )}
              <Button
                title={sheet === 'note' ? '保存备注' : '保存关联'}
                testID="save-visit-details"
                busy={saving}
                onPress={() => void saveDetails()}
              />
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </Screen>
  );
}

const local = StyleSheet.create({
  nav: {
    paddingHorizontal: 24,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  navAction: { minWidth: 56, minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  navTitle: { fontSize: 16, fontWeight: '600', color: color.ink, flexShrink: 1 },
  actionText: { color: color.green, fontSize: 14 },
  label: { fontSize: 12, color: '#65766D', lineHeight: 19 },
  paragraph: { marginHorizontal: 20, paddingTop: 20, paddingBottom: 2, gap: 8 },
  chief: { paddingBottom: 19, borderBottomWidth: 1, borderColor: color.line },
  body: { color: color.ink, fontSize: 16, lineHeight: 29 },
  chiefText: { fontSize: 17, fontWeight: '500' },
  diagnosis: { fontSize: 21, lineHeight: 32, fontWeight: '600', color: color.green },
  expand: {
    marginTop: 22,
    padding: 18,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FAFBF8',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  history: { padding: 20, paddingTop: 4, gap: 18, backgroundColor: '#FAFBF8' },
  sectionTitle: { color: color.ink, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  smallAction: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' },
  reportRow: {
    minHeight: 76,
    paddingHorizontal: 17,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  separator: { borderTopWidth: 1, borderColor: color.line },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(23,61,53,0.3)' },
  sheet: {
    backgroundColor: color.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 14,
    maxHeight: '90%',
  },
});
