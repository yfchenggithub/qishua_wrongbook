import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing, typography } from '@/src/styles/tokens';

export type AppToastType = 'success' | 'info' | 'warning' | 'error' | 'anchor';

export interface AppToastProps {
  visible: boolean;
  message: string;
  type: AppToastType;
  bottomOffset?: number;
  opacity?: Animated.Value | number;
  translateY?: Animated.Value | number;
  containerStyle?: StyleProp<ViewStyle>;
  bubbleStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  maxFontSizeMultiplier?: number;
  actionLabel?: string;
  onAction?: () => void;
}

export function getAppToastBackgroundColor(type: AppToastType): string {
  if (type === 'anchor') {
    return colors.successBg;
  }
  if (type === 'success') {
    return 'rgba(24, 38, 30, 0.95)';
  }
  if (type === 'warning') {
    return 'rgba(92, 62, 18, 0.95)';
  }
  if (type === 'error') {
    return 'rgba(88, 28, 28, 0.95)';
  }
  return 'rgba(38, 44, 53, 0.95)';
}

export function getAppToastTextColor(type: AppToastType): string {
  return type === 'anchor' ? colors.success : colors.white;
}

export function AppToast({
  visible,
  message,
  type,
  bottomOffset,
  opacity,
  translateY,
  containerStyle,
  bubbleStyle,
  textStyle,
  maxFontSizeMultiplier = 1.1,
  actionLabel,
  onAction,
}: AppToastProps) {
  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents={actionLabel && onAction ? 'box-none' : 'none'}
      style={[
        styles.toastContainer,
        typeof bottomOffset === 'number' ? { bottom: bottomOffset } : null,
        containerStyle,
        opacity === undefined ? null : { opacity },
        translateY === undefined ? null : { transform: [{ translateY }] },
      ]}>
      <View
        style={[
          styles.toastBubble,
          { backgroundColor: getAppToastBackgroundColor(type) },
          bubbleStyle,
        ]}>
        <Text
          maxFontSizeMultiplier={maxFontSizeMultiplier}
          style={[styles.toastText, { color: getAppToastTextColor(type) }, textStyle]}>
          {message}
        </Text>
        {actionLabel && onAction ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={onAction}
            style={({ pressed }) => [styles.toastAction, pressed ? styles.toastActionPressed : null]}>
            <Text style={styles.toastActionText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
  toastBubble: {
    maxWidth: '86%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.black,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  toastText: {
    ...typography.bodySmall,
    flexShrink: 1,
    fontWeight: '600',
    textAlign: 'center',
  },
  toastAction: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  toastActionPressed: {
    opacity: 0.55,
  },
  toastActionText: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
});
