import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  aboutSupportColors,
  aboutSupportLayout,
  aboutSupportTypography,
} from '@/src/styles/aboutSupportTokens';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

export interface SettingRowProps {
  title: string;
  subtitle?: string;
  icon?: MaterialIconName;
  iconColor?: string;
  rightLabel?: string;
  rightAccessory?: ReactNode;
  showChevron?: boolean;
  onPress: () => void;
}

export function SettingRow({
  title,
  subtitle,
  icon,
  iconColor = aboutSupportColors.blue,
  rightLabel,
  rightAccessory,
  showChevron = true,
  onPress,
}: SettingRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      {icon ? (
        <View style={styles.iconBox}>
          <MaterialIcons color={iconColor} name={icon} size={aboutSupportLayout.iconSize} />
        </View>
      ) : null}
      <View style={styles.textArea}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        {subtitle ? <Text numberOfLines={2} style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {rightLabel ? <Text numberOfLines={1} style={styles.rightLabel}>{rightLabel}</Text> : null}
      {rightAccessory}
      {showChevron ? (
        <MaterialIcons color={aboutSupportColors.tertiaryText} name="chevron-right" size={24} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: aboutSupportLayout.rowMinHeight,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: aboutSupportColors.card,
  },
  pressed: {
    backgroundColor: '#F1F1F3',
  },
  iconBox: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textArea: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...aboutSupportTypography.rowTitle,
  },
  subtitle: {
    ...aboutSupportTypography.supporting,
  },
  rightLabel: {
    ...aboutSupportTypography.supporting,
    maxWidth: 92,
    color: aboutSupportColors.tertiaryText,
    fontWeight: '500',
    textAlign: 'right',
  },
});
