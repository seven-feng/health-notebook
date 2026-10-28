import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, styles } from '../ui';

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      {title && (
        <Text accessibilityRole="header" style={[styles.small, { paddingLeft: 4 }]}>
          {title}
        </Text>
      )}
      <View style={local.group}>{children}</View>
    </View>
  );
}

export function SettingsRow({
  title,
  detail,
  icon,
  onPress,
  testID,
  last = false,
  disabled = false,
}: {
  title: string;
  detail?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  testID?: string;
  last?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}，${detail}` : title}
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        local.row,
        !last && local.border,
        pressed && { backgroundColor: color.mint },
        disabled && { opacity: 0.5 },
      ]}
    >
      {icon && (
        <View style={local.icon}>
          <Ionicons name={icon} color={color.green} size={21} accessible={false} />
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.body}>{title}</Text>
        {detail && <Text style={styles.small}>{detail}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color={color.muted} accessible={false} />
    </Pressable>
  );
}

export function HelpParagraph({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={styles.h2}>
        {title}
      </Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const local = StyleSheet.create({
  group: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.paper,
    overflow: 'hidden',
  },
  row: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  icon: { height: 32, width: 32, justifyContent: 'center', alignItems: 'center' },
});
