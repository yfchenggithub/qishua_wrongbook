import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, typography } from '@/src/styles/tokens';

export interface OfflineBadgeProps {
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function OfflineBadge({ label = '离线', style }: OfflineBadgeProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.dot} />
      <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.text}>
        {label}
      </Text>
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
    backgroundColor: '#EAF7ED',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: '#34C759',
  },
  text: {
    ...typography.bodySmall,
    color: '#34C759',
    fontWeight: '600',
  },
});
