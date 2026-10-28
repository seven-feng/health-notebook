import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { getSetting, setSetting } from '../db';
import { Button, color, styles } from '../ui';
import { ZoomableSourceImage } from './ZoomableSourceImage';

const seenKey = 'onboarding-seen-v1';
const card = require('../../assets/onboarding/native-metric-card.png');
const sampleDescription =
  '实际 App 指标界面，示例数据：丙氨酸氨基转移酶从 100 变为 80 U/L，包含折线图和两次历史记录。';
const Context = createContext<(() => void) | null>(null);

export function useOnboarding() {
  const open = useContext(Context);
  if (!open) throw new Error('OnboardingProvider missing');
  return open;
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<'loading' | 'first' | 'replay' | 'closed'>('loading');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    void getSetting(seenKey)
      .then((seen) => {
        if (active) setMode(seen === '1' ? 'closed' : 'first');
      })
      // A preference read must not block access to records or their error screen.
      .catch(() => {
        if (active) setMode('closed');
      });
    return () => {
      active = false;
    };
  }, []);
  async function finish() {
    if (saving.current) return;
    if (mode === 'replay') {
      setMode('closed');
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      await setSetting(seenKey, '1');
    } catch {
      Alert.alert('引导偏好未保存', '你可以继续使用，下次打开可能会再次显示引导。');
    } finally {
      saving.current = false;
      setBusy(false);
      setMode('closed');
    }
  }
  return (
    <Context.Provider
      value={() => {
        setExpanded(false);
        setMode('replay');
      }}
    >
      {children}
      <Modal
        testID="onboarding-modal"
        visible={mode !== 'closed'}
        animationType="none"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          if (expanded) setExpanded(false);
          else if (mode !== 'loading') void finish();
        }}
      >
        <GestureHandlerRootView style={styles.page}>
          {/* Modal has its own native view tree and must measure its own safe area. */}
          <SafeAreaProvider style={styles.page}>
            {mode === 'loading' ? (
              <View style={intro.loading}>
                <ActivityIndicator color={color.green} />
              </View>
            ) : (
              <Onboarding
                busy={busy}
                expanded={expanded}
                setExpanded={setExpanded}
                onFinish={() => void finish()}
              />
            )}
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </Modal>
    </Context.Provider>
  );
}

function Onboarding({
  busy,
  expanded,
  setExpanded,
  onFinish,
}: {
  busy: boolean;
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  onFinish: () => void;
}) {
  const [imageError, setImageError] = useState(false);
  const [previewHeight, setPreviewHeight] = useState(500);
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(310, width - 48);
  if (expanded) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={intro.previewHeader} testID="onboarding-preview-header">
          <Button
            title="返回引导"
            testID="onboarding-preview-back"
            secondary
            onPress={() => setExpanded(false)}
          />
          <Text style={styles.small}>实际界面 · 示例数据</Text>
        </View>
        <View
          style={{ flex: 1 }}
          onLayout={({ nativeEvent }) => setPreviewHeight(nativeEvent.layout.height)}
        >
          {imageError ? (
            <Text style={styles.body}>示例图片暂时无法显示。</Text>
          ) : (
            <ZoomableSourceImage
              image={Image.resolveAssetSource(card)}
              name="示例指标"
              accessibilityLabel={sampleDescription}
              index={0}
              viewportHeight={previewHeight}
              backgroundColor={color.bg}
              onError={() => setImageError(true)}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.page} testID="onboarding-screen">
      <View style={intro.header} testID="onboarding-header">
        <View style={[styles.row, { gap: 7 }]}>
          <Image
            source={require('../../assets/brand/icon.png')}
            style={{ width: 28, height: 28, borderRadius: 6 }}
            accessible={false}
          />
          <Text style={intro.brand}>健康小本</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          testID="onboarding-skip"
          disabled={busy}
          onPress={onFinish}
          style={intro.skip}
        >
          <Text style={styles.subtitle}>跳过</Text>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={intro.content}>
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>看清每一次变化</Text>
          <View style={[styles.row, { gap: 6 }]}>
            <Ionicons name="checkmark-circle-outline" size={17} color={color.green} />
            <Text style={[styles.subtitle, { color: color.green, flexShrink: 1 }]}>
              报告识别与指标对比，免费使用
            </Text>
          </View>
        </View>
        <View style={intro.methods}>
          {(
            [
              ['document-text-outline', 'PDF 导入'],
              ['camera-outline', '拍照识别'],
              ['images-outline', '相册识别'],
            ] as const
          ).map(([icon, title], index) => (
            <View key={title} style={[intro.method, index > 0 && intro.methodDivider]}>
              <Ionicons name={icon} size={24} color={color.green} />
              <Text style={intro.methodText}>{title}</Text>
            </View>
          ))}
        </View>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="放大查看实际指标界面示例"
            testID="onboarding-preview"
            onPress={() => {
              setImageError(false);
              setExpanded(true);
            }}
          >
            <Image
              source={card}
              accessible
              accessibilityLabel={sampleDescription}
              resizeMode="contain"
              style={{ width: cardWidth, height: (cardWidth * 1284) / 1062 }}
            />
          </Pressable>
          <View style={[styles.row, { gap: 5 }]}>
            <Text style={styles.small}>实际界面 · 示例数据</Text>
            <Ionicons name="expand-outline" size={13} color={color.muted} />
          </View>
        </View>
      </ScrollView>
      <View style={intro.footer} testID="onboarding-footer">
        <View style={[styles.row, { justifyContent: 'center', gap: 5 }]}>
          <Ionicons name="lock-closed-outline" size={13} color={color.muted} />
          <Text style={styles.small}>无需注册 · 报告保存在本机</Text>
        </View>
        <Button
          title="开始记录"
          testID="onboarding-start"
          busy={busy}
          disabled={busy}
          onPress={onFinish}
        />
      </View>
    </SafeAreaView>
  );
}

const intro = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  brand: { fontSize: 13, fontWeight: '600', color: color.green },
  skip: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' },
  content: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16, gap: 18 },
  methods: { flexDirection: 'row' },
  method: { flex: 1, alignItems: 'center', gap: 7 },
  methodDivider: { borderLeftWidth: 1, borderLeftColor: color.line },
  methodText: { fontSize: 13, lineHeight: 19, color: color.ink },
  footer: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16, gap: 12 },
  previewHeader: { paddingHorizontal: 24, paddingVertical: 12, gap: 12 },
});
