import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadows, spacing, typography } from '@/src/styles/tokens';

export interface FloatingBottomCtaProps {
  bottom: number;
  hintText: string;
  hintActive?: boolean;
  children: ReactNode;
  onHeightChange?: (height: number) => void;
  style?: StyleProp<ViewStyle>;
}

export function FloatingBottomCta({
  bottom,
  hintText,
  hintActive = false,
  children,
  onHeightChange,
  style,
}: FloatingBottomCtaProps) {
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View
        onLayout={(event) => {
          if (!onHeightChange) {
            return;
          }

          const nextHeight = Math.ceil(event.nativeEvent.layout.height);
          onHeightChange(nextHeight);
        }}
        style={[styles.wrap, { bottom }, style]}>
        <View style={styles.shell}>
          <BlurView
            tint="light"
            intensity={Platform.OS === 'ios' ? 58 : 28}
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={styles.blur}>
            <View style={styles.content}>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.1}
                style={[styles.hint, hintActive ? styles.hintActive : null]}>
                {hintText}
              </Text>
              {children}
            </View>
          </BlurView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  wrap: {
    position: 'absolute',
    left: spacing.screenPadding,
    right: spacing.screenPadding,
  },
  shell: {
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(220, 225, 232, 0.92)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    ...shadows.floating,
  },
  blur: {
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  hintActive: {
    color: colors.success,
  },
});
