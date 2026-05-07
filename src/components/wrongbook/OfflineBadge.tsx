import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '@/src/styles/tokens';

export interface OfflineBadgeProps {
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function OfflineBadge({ label = '离线', style }: OfflineBadgeProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.dot} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: '#BFEACD',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
  },
  text: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '600',
  },
});

