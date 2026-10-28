import React, { createContext, useMemo } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ScrollViewProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';

export const color = {
  bg: '#F7F8F3',
  paper: '#FFFFFF',
  ink: '#173D35',
  muted: '#72817A',
  green: '#276B56',
  mint: '#E8F1E9',
  line: '#E5EAE2',
  amber: '#96651D',
  amberBg: '#FBF2DF',
  red: '#A63D39',
};
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { padding: 24, paddingBottom: 36, gap: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 29, fontWeight: '700', color: color.ink, letterSpacing: -0.7 },
  subtitle: { fontSize: 14, color: color.muted, lineHeight: 22 },
  h2: { fontSize: 19, fontWeight: '600', color: color.ink },
  body: { fontSize: 15, color: color.ink, lineHeight: 24 },
  small: { fontSize: 12, color: color.muted, lineHeight: 19 },
  card: {
    padding: 20,
    borderRadius: 20,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.line,
    gap: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: color.mint,
  },
  badgeText: { fontSize: 11, fontWeight: '600', color: color.green },
  input: {
    backgroundColor: color.paper,
    borderColor: color.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 13,
    fontSize: 16,
    color: color.ink,
    minHeight: 48,
  },
  label: { fontSize: 12, color: color.muted, marginBottom: 6 },
  button: {
    minHeight: 50,
    borderRadius: 13,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: color.green,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  divider: { height: 1, backgroundColor: color.line },
});
// Images arbitrate gestures with this scroll view; no persistent scrollEnabled lock.
export const PageScrollContext = createContext<ReturnType<typeof Gesture.Native> | null>(null);
export function Screen({
  children,
  scroll = true,
  fixedHeader,
  fixedFooter,
  scrollRef,
  onContentSizeChange,
  onScrollBeginDrag,
  onScroll,
  onMomentumScrollEnd,
  backgroundColor = color.bg,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  fixedHeader?: React.ReactNode;
  fixedFooter?: React.ReactNode;
  scrollRef?: React.Ref<ScrollView>;
  onContentSizeChange?: ScrollViewProps['onContentSizeChange'];
  onScrollBeginDrag?: ScrollViewProps['onScrollBeginDrag'];
  onScroll?: ScrollViewProps['onScroll'];
  onMomentumScrollEnd?: ScrollViewProps['onMomentumScrollEnd'];
  backgroundColor?: string;
}) {
  const scrollGesture = useMemo(() => Gesture.Native(), []);
  return (
    <PageScrollContext.Provider value={scrollGesture}>
      <SafeAreaView edges={['top', 'left', 'right']} style={[styles.page, { backgroundColor }]}>
        {fixedHeader}
        {scroll ? (
          <GestureDetector gesture={scrollGesture}>
            <ScrollView
              ref={scrollRef}
              testID="page-scroll"
              showsVerticalScrollIndicator={false}
              onContentSizeChange={onContentSizeChange}
              onScrollBeginDrag={onScrollBeginDrag}
              onScroll={onScroll}
              onMomentumScrollEnd={onMomentumScrollEnd}
              scrollEventThrottle={onScroll ? 16 : undefined}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.content}
            >
              {children}
            </ScrollView>
          </GestureDetector>
        ) : (
          children
        )}
        {fixedFooter}
      </SafeAreaView>
    </PageScrollContext.Provider>
  );
}
export function Header({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.between}>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export function Button({
  title,
  onPress,
  secondary = false,
  busy = false,
  disabled = false,
  testID,
  icon,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && { backgroundColor: color.mint },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? color.green : '#fff'} />
      ) : (
        icon && <Ionicons name={icon} size={18} color={secondary ? color.green : '#fff'} />
      )}
      <Text style={[styles.buttonText, secondary && { color: color.green }]}>{title}</Text>
    </Pressable>
  );
}
export function Badge({ children, warning = false }: { children: string; warning?: boolean }) {
  return (
    <View style={[styles.badge, warning && { backgroundColor: color.amberBg }]}>
      <Text style={[styles.badgeText, warning && { color: color.amber }]}>{children}</Text>
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        returnKeyType={props.multiline ? 'default' : 'done'}
        onSubmitEditing={props.multiline ? undefined : Keyboard.dismiss}
        {...props}
        style={[styles.input, props.style]}
        placeholderTextColor="#A4ADA7"
        autoCorrect={false}
      />
    </View>
  );
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <Card style={{ paddingVertical: 34, alignItems: 'center' }}>
      <View style={{ padding: 16, borderRadius: 22, backgroundColor: color.mint }}>
        <Ionicons name="documents-outline" size={30} color={color.green} />
      </View>
      <Text style={styles.h2}>{title}</Text>
      <Text style={[styles.subtitle, { textAlign: 'center' }]}>{detail}</Text>
    </Card>
  );
}
