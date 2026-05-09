import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '@/src/styles/tokens';

type StatusPillTone = 'dark' | 'light' | 'success';

export interface StatusPillProps {
  label: string;
  tone?: StatusPillTone;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function StatusPill({ label, tone = 'dark', style, textStyle }: StatusPillProps) {
  return (
    <View style={[styles.base, toneStyles[tone], style]}>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.1}
        style={[styles.text, textToneStyles[tone], textStyle]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: {
    ...typography.bodySmall,
    fontWeight: '700',
  },
});

const toneStyles: Record<StatusPillTone, ViewStyle> = {
  dark: {
    backgroundColor: colors.black,
  },
  light: {
    backgroundColor: colors.surfaceMuted,
  },
  success: {
    backgroundColor: colors.successBg,
  },
};

const textToneStyles: Record<StatusPillTone, TextStyle> = {
  dark: {
    color: colors.white,
  },
  light: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
};
