import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '@/src/styles/tokens';

export interface TagChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function TagChip({
  label,
  selected = false,
  onPress,
  style,
  textStyle,
}: TagChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : styles.unselected,
        pressed && onPress ? styles.pressed : null,
        style,
      ]}>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.1}
        style={[styles.text, selected ? styles.selectedText : styles.unselectedText, textStyle]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
  },
  selected: {
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
  },
  unselected: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.85,
  },
  text: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
  selectedText: {
    color: colors.success,
  },
  unselectedText: {
    color: colors.textPrimary,
  },
});
