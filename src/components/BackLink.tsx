import { Keyboard, Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { color } from '../ui';

export function BackLink({ disabled = false }: { disabled?: boolean }) {
  return (
    <Pressable
      testID="record-back"
      accessibilityRole="button"
      accessibilityLabel="返回"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        Keyboard.dismiss();
        if (router.canGoBack()) router.back();
        else router.replace('/');
      }}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        minHeight: 44,
        minWidth: 44,
        justifyContent: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: color.green, fontSize: 15 }}>‹ 返回</Text>
    </Pressable>
  );
}
