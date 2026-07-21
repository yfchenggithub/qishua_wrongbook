import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, layout, radius, spacing } from '@/src/styles/tokens';

export interface PrimaryButtonProps {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  tone?: 'brand' | 'blue';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function PrimaryButton({
  title,
  onPress,
  disabled = false,
  tone = 'brand',
  style,
  textStyle,
}: PrimaryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        tone === 'blue' ? styles.buttonBlue : null,
        style,
        disabled ? (tone === 'blue' ? styles.buttonBlueDisabled : styles.buttonDisabled) : null,
        pressed && !disabled
          ? (tone === 'blue' ? styles.buttonBluePressed : styles.buttonPressed)
          : null,
      ]}>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={[styles.text, textStyle]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: layout.primaryButtonHeight,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.card,
  },
  buttonDisabled: {
    backgroundColor: colors.accentDisabled,
  },
  buttonBlue: {
    backgroundColor: colors.action,
  },
  buttonBlueDisabled: {
    backgroundColor: colors.actionDisabled,
  },
  buttonBluePressed: {
    backgroundColor: colors.actionPressed,
  },
  buttonPressed: {
    backgroundColor: colors.accentPressed,
  },
  text: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.white,
  },
});
