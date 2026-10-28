import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteWholeDocument, getDocumentDeletionScope, type DocumentDeletionScope } from '../db';
import { color, styles } from '../ui';

export function DocumentDelete({
  documentId,
  memberId,
  hasVisits,
  disabled,
  onDeleted,
}: {
  documentId: string;
  memberId: string;
  hasVisits: boolean;
  disabled: boolean;
  onDeleted: (result: { cleanupPending: boolean; label: string }) => void;
}) {
  const [scope, setScope] = useState<DocumentDeletionScope | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [presented, setPresented] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const operation = useRef(false);
  const closing = useRef(false);
  const alive = useRef(true);
  const cancel = useRef<View>(null);
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const label = (scope ? scope.visitCount > 0 : hasVisits) ? '整份资料' : '整份报告';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      progress.stopAnimation();
    };
  }, [progress]);
  useEffect(() => {
    if (!scope || !presented || !sheetHeight || closing.current) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 0 : 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (!finished || !alive.current) return;
      const tag = findNodeHandle(cancel.current);
      if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
    });
  }, [scope, presented, sheetHeight, progress, reduceMotion]);

  async function open() {
    if (operation.current || scope || disabled) return;
    operation.current = true;
    setLoading(true);
    try {
      const current = await getDocumentDeletionScope(documentId, memberId);
      if (!alive.current) return;
      setError('');
      setPresented(false);
      setSheetHeight(0);
      progress.setValue(0);
      setScope(current);
    } catch (e) {
      if (alive.current)
        Alert.alert('暂时无法删除', e instanceof Error ? e.message : '请稍后重试。');
    } finally {
      operation.current = false;
      if (alive.current) setLoading(false);
    }
  }
  function dismiss(after?: () => void) {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, {
      toValue: 0,
      duration: reduceMotion ? 0 : 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || !alive.current) return;
      setScope(null);
      setPresented(false);
      setSaving(false);
      closing.current = false;
      operation.current = false;
      after?.();
    });
  }
  function close() {
    if (!operation.current) dismiss();
  }
  async function confirm() {
    if (!scope || operation.current || closing.current) return;
    operation.current = true; // Guard rapid taps before the next render.
    setSaving(true);
    setError('');
    try {
      const result = await deleteWholeDocument(scope);
      if (!alive.current) return;
      if (result.status === 'changed') {
        setScope(result.scope);
        setError('资料有更新，删除范围已重新列出。请核对后再次确认。');
      } else {
        dismiss(() => onDeleted({ cleanupPending: result.cleanupPending, label }));
        return;
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '删除未完成，请稍后重试。');
    }
    operation.current = false;
    if (alive.current) setSaving(false);
  }
  return (
    <>
      <Pressable
        testID="delete-document"
        accessibilityRole="button"
        accessibilityLabel={`删除${label}`}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        disabled={disabled || loading}
        onPress={() => void open()}
        style={({ pressed }) => [local.entry, (disabled || loading || pressed) && { opacity: 0.5 }]}
      >
        {loading ? (
          <ActivityIndicator color={color.red} />
        ) : (
          <Ionicons name="trash-outline" size={18} color={color.red} />
        )}
        <Text style={local.entryText}>删除{label}</Text>
      </Pressable>
      <Modal
        testID="delete-document-modal"
        visible={scope !== null}
        transparent
        animationType="none"
        onShow={() => setPresented(true)}
        onRequestClose={close}
      >
        <View style={local.overlay}>
          <Animated.View style={[StyleSheet.absoluteFill, local.backdrop, { opacity: progress }]}>
            <Pressable
              testID="delete-document-backdrop"
              accessible={false}
              disabled={saving}
              onPress={close}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            testID="delete-document-sheet"
            accessibilityViewIsModal
            onAccessibilityEscape={close}
            onLayout={({ nativeEvent }) => setSheetHeight(nativeEvent.layout.height)}
            style={[
              local.sheet,
              {
                maxHeight: height - insets.top - 20,
                paddingBottom: Math.max(insets.bottom, 20),
                paddingLeft: Math.max(insets.left, 24),
                paddingRight: Math.max(insets.right, 24),
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
            <View style={local.handle} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 18 }}
            >
              <Text accessibilityRole="header" style={[styles.h2, { fontSize: 23 }]}>
                删除{label}？
              </Text>
              {scope && (
                <>
                  <View style={local.file}>
                    <Ionicons
                      name={
                        scope.sourceType === 'image' ? 'image-outline' : 'document-text-outline'
                      }
                      size={25}
                      color={color.muted}
                    />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[styles.body, { fontWeight: '600' }]}>{scope.fileName}</Text>
                      <Text style={styles.small}>{scope.memberLabel}的资料</Text>
                    </View>
                  </View>
                  <View style={{ gap: 12 }}>
                    <ScopeRow
                      title={scope.sourceType === 'image' ? '照片原件' : 'PDF 原件'}
                      value="1 份"
                    />
                    {scope.reportCount > 0 && (
                      <ScopeRow
                        title="检验记录"
                        value={`${scope.reportCount} 份 · ${scope.observationCount} 项结果`}
                      />
                    )}
                    {scope.visitCount > 0 && (
                      <ScopeRow title="就诊记录" value={`${scope.visitCount} 次`} />
                    )}
                  </View>
                  {scope.observationCount > 0 && (
                    <Text style={styles.subtitle}>这些结果将从指标历史中移除。</Text>
                  )}
                  {(scope.retainedVisitCount > 0 || scope.retainedReportCount > 0) && (
                    <View style={local.keep}>
                      {scope.retainedVisitCount > 0 && (
                        <Text style={[styles.body, { color: color.green }]}>
                          {scope.retainedVisitCount} 次独立就诊记录保留，仅解除关联。
                        </Text>
                      )}
                      {scope.retainedReportCount > 0 && (
                        <Text style={[styles.body, { color: color.green }]}>
                          {scope.retainedReportCount} 份其他文件的检验记录保留，仅解除关联。
                        </Text>
                      )}
                    </View>
                  )}
                </>
              )}
              {error ? (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={[styles.body, { color: color.red }]}
                >
                  {error}
                </Text>
              ) : null}
              <Text style={styles.small}>仅删除本 App 中的资料，删除后无法恢复。</Text>
            </ScrollView>
            <View style={[styles.row, { marginTop: 22 }]}>
              <Pressable
                ref={cancel}
                testID="cancel-delete-document"
                accessibilityRole="button"
                accessibilityLabel="取消"
                accessibilityState={{ disabled: saving }}
                disabled={saving}
                onPress={close}
                style={[styles.button, local.cancel, saving && { opacity: 0.5 }]}
              >
                <Text style={[styles.buttonText, { color: color.ink }]}>取消</Text>
              </Pressable>
              <Pressable
                testID="confirm-delete-document"
                accessibilityRole="button"
                accessibilityLabel={saving ? '正在删除' : '确认删除'}
                accessibilityState={{ disabled: saving, busy: saving }}
                disabled={saving}
                onPress={() => void confirm()}
                style={[styles.button, local.confirm, saving && { opacity: 0.5 }]}
              >
                {saving && <ActivityIndicator color="white" />}
                <Text style={styles.buttonText}>{saving ? '正在删除…' : '确认删除'}</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}
function ScopeRow({ title, value }: { title: string; value: string }) {
  return (
    <View style={[styles.between, { alignItems: 'flex-start' }]}>
      <Text style={[styles.body, { flex: 1 }]}>{title}</Text>
      <Text style={[styles.body, { flex: 1, textAlign: 'right', fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}
const local = StyleSheet.create({
  entry: {
    borderTopWidth: 1,
    borderColor: color.line,
    marginTop: 4,
    paddingVertical: 22,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  entryText: { color: color.red, fontSize: 14, fontWeight: '500' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(23,61,53,0.3)' },
  sheet: {
    backgroundColor: color.paper,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
  },
  handle: {
    height: 4,
    width: 36,
    borderRadius: 2,
    backgroundColor: color.line,
    alignSelf: 'center',
    marginBottom: 22,
  },
  file: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 16,
    backgroundColor: color.bg,
    borderRadius: 16,
  },
  keep: { padding: 14, borderRadius: 14, backgroundColor: color.mint, gap: 8 },
  cancel: { flex: 1, backgroundColor: color.bg, borderWidth: 1, borderColor: color.line },
  confirm: { flex: 1.35, backgroundColor: color.red },
});
