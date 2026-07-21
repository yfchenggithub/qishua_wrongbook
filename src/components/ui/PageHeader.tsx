import type { ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { OfflineBadge } from '@/src/components/wrongbook/OfflineBadge';
import { spacing, typography } from '@/src/styles/tokens';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  showOffline?: boolean;
  offlineLabel?: string;
  rightAccessory?: ReactNode;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  offlineBadgeStyle?: StyleProp<ViewStyle>;
}

export function PageHeader({
  title,
  subtitle,
  showOffline = false,
  offlineLabel = '离线',
  rightAccessory,
  style,
  titleStyle,
  subtitleStyle,
  offlineBadgeStyle,
}: PageHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.titleRow}>
        <View style={styles.titleCluster}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, titleStyle]}>
            {title}
          </Text>
          {showOffline ? <OfflineBadge label={offlineLabel} style={offlineBadgeStyle} /> : null}
        </View>
        {rightAccessory ? <View style={styles.rightAccessory}>{rightAccessory}</View> : null}
      </View>
      {subtitle ? <Text style={[styles.subtitle, subtitleStyle]}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
    marginBottom: spacing.xl,
  },
  titleRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    ...typography.pageTitle,
    flexShrink: 1,
  },
  subtitle: {
    ...typography.pageSubtitle,
  },
  rightAccessory: {
    flexShrink: 0,
  },
});
