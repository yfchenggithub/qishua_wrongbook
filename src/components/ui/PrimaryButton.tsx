import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, layout, radius, spacing } from '@/src/styles/tokens';

export interface PrimaryButtonProps {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function PrimaryButton({
  title,
  onPress,
  disabled = false,
  style,
  textStyle,
}: PrimaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        style,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
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
