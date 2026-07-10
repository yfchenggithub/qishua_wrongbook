import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { spacing, typography } from '@/src/styles/tokens';

import { OfflineBadge } from './OfflineBadge';

export interface BrandHeaderProps {
  title: string;
  subtitle: string;
  showOffline?: boolean;
  offlineLabel?: string;
  rightAccessory?: ReactNode;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
}

export function BrandHeader({
  title,
  subtitle,
  showOffline = true,
  offlineLabel = '离线',
  rightAccessory,
  style,
  titleStyle,
  subtitleStyle,
}: BrandHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.titleRow}>
        <View style={styles.titleCluster}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={[styles.title, titleStyle]}>
            {title}
          </Text>
          {showOffline ? <OfflineBadge label={offlineLabel} /> : null}
        </View>
        {rightAccessory ? <View style={styles.rightAccessory}>{rightAccessory}</View> : null}
      </View>
      <Text maxFontSizeMultiplier={1.2} style={[styles.subtitle, subtitleStyle]}>
        {subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: spacing.sm,
  },
  title: {
    ...typography.titleMedium,
    flexShrink: 1,
  },
  rightAccessory: {
    flexShrink: 0,
  },
  subtitle: {
    ...typography.body,
  },
});
