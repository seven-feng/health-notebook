import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
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
import { useRecords } from '../state';
import { Button, color, styles } from '../ui';
import type { Member } from '../domain/types';

const tones: Record<string, [string, string]> = {
  green: [color.mint, color.green],
  rose: ['#F3E8E5', '#946358'],
  blue: ['#E7EDF2', '#4F7184'],
  ochre: ['#F3EDDD', '#927841'],
};
function Avatar({ member, small = false }: { member: Member; small?: boolean }) {
  const [backgroundColor, tint] = tones[member.tone] ?? tones.green!;
  return (
    <View
      style={{
        width: small ? 28 : 44,
        height: small ? 28 : 44,
        borderRadius: small ? 14 : 15,
        backgroundColor,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="person-outline" size={small ? 16 : 22} color={tint} />
    </View>
  );
}
export function MemberHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const {
    members,
    activeMember,
    reportCounts,
    visitCounts = {},
    selectMember,
    loading,
  } = useRecords();
  const [open, setOpen] = useState(false);
  const [presented, setPresented] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const inset = useSafeAreaInsets();
  const finishClose = useCallback(() => {
    closing.current = false;
    const action = afterClose.current;
    afterClose.current = undefined;
    action?.();
  }, []);
  useEffect(() => {
    // Wait for both the native modal and its measured panel before animating.
    if (!open || !presented || !sheetHeight || closing.current) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 0 : 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [open, presented, sheetHeight, progress, reduceMotion]);
  useEffect(() => {
    // iOS supplies onDismiss; Android removes the modal when visible becomes false.
    if (!open && Platform.OS !== 'ios') finishClose();
  }, [open, finishClose]);
  function openSheet() {
    if (open || closing.current) return;
    Keyboard.dismiss();
    progress.setValue(0);
    setPresented(false);
    setSheetHeight(0);
    setOpen(true);
  }
  function closeSheet(action?: () => void) {
    if (closing.current) return;
    closing.current = true;
    afterClose.current = action;
    Animated.timing(progress, {
      toValue: 0,
      duration: reduceMotion ? 0 : 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setPresented(false);
        setOpen(false);
      }
    });
  }
  return (
    <>
      <View style={[styles.between, { alignItems: 'flex-start', gap: 8 }]}>
        <View style={{ flex: 1, gap: 7 }}>
          <Text numberOfLines={2} style={[styles.title, { fontSize: 24 }]}>
            {title}
          </Text>
          <Text style={[styles.subtitle, { fontSize: 12 }]}>{subtitle}</Text>
        </View>
        <Pressable
          testID="member-switch"
          accessibilityRole="button"
          accessibilityLabel={`切换成员，当前${activeMember.label}`}
          disabled={loading}
          onPress={openSheet}
          style={local.trigger}
        >
          <Avatar member={activeMember} small />
          <Text
            numberOfLines={1}
            style={{ color: color.ink, fontWeight: '600', maxWidth: 58, fontSize: 13 }}
          >
            {activeMember.label}
          </Text>
          <Ionicons name="chevron-down" size={12} color={color.ink} />
        </Pressable>
      </View>
      <Modal
        testID="member-picker-modal"
        visible={open}
        transparent
        animationType="none"
        onShow={() => setPresented(true)}
        onDismiss={finishClose}
        onRequestClose={() => closeSheet()}
      >
        <View style={local.overlay}>
          <Animated.View
            testID="member-picker-backdrop"
            style={[StyleSheet.absoluteFill, local.backdrop, { opacity: progress }]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityRole="button"
              accessibilityLabel="关闭成员选择"
              onPress={() => closeSheet()}
            />
          </Animated.View>
          <Animated.View
            testID="member-picker-sheet"
            accessibilityViewIsModal
            onAccessibilityEscape={() => closeSheet()}
            onLayout={({ nativeEvent }) => setSheetHeight(nativeEvent.layout.height)}
            style={[
              local.sheet,
              {
                paddingBottom: Math.max(inset.bottom, 16),
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
            <Text style={styles.h2}>切换成员</Text>
            <Text style={styles.small}>切换后，查看和导入的都是该成员的记录。</Text>
            <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
              {members.map((m) => (
                <Pressable
                  key={m.id}
                  testID={`member-${m.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`选择${m.label}`}
                  accessibilityState={{ selected: activeMember.id === m.id }}
                  onPress={() => {
                    if (closing.current) return;
                    selectMember(m.id);
                    closeSheet();
                  }}
                  style={[
                    local.member,
                    activeMember.id === m.id && { backgroundColor: color.mint },
                  ]}
                >
                  <Avatar member={m} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.body, { fontWeight: '600' }]}>{m.label}</Text>
                    <Text style={styles.small}>
                      {m.name || '姓名未填写'} ·{' '}
                      {(reportCounts[m.id] ?? 0) + (visitCounts[m.id] ?? 0)} 条记录
                    </Text>
                  </View>
                  {activeMember.id === m.id && (
                    <Ionicons name="checkmark" color={color.green} size={22} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
            <Button
              title="添加家庭成员"
              testID="add-member"
              icon="add-outline"
              secondary
              onPress={() => closeSheet(() => router.push('/member'))}
            />
            <Pressable
              testID="member-picker-cancel"
              accessibilityRole="button"
              onPress={() => closeSheet()}
              style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
            >
              <Text style={styles.body}>取消</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}
const local = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 24,
    padding: 5,
    paddingRight: 10,
    minHeight: 44,
  },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: '#00000055' },
  sheet: {
    maxHeight: '80%',
    padding: 24,
    paddingTop: 12,
    gap: 14,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: color.bg,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C6CDC5',
    marginBottom: 4,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: color.paper,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    minHeight: 76,
  },
});
