import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/src/styles/tokens';

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
    gap: 6,
    minHeight: 20,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  text: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
