import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { spacing, typography } from '@/src/styles/tokens';

import { OfflineBadge } from './OfflineBadge';

export interface BrandHeaderProps {
  title: string;
  subtitle: string;
  showOffline?: boolean;
  offlineLabel?: string;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
}

export function BrandHeader({
  title,
  subtitle,
  showOffline = true,
  offlineLabel = '离线',
  style,
  titleStyle,
  subtitleStyle,
}: BrandHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, titleStyle]}>{title}</Text>
        {showOffline ? <OfflineBadge label={offlineLabel} /> : null}
      </View>
      <Text style={[styles.subtitle, subtitleStyle]}>{subtitle}</Text>
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
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  title: {
    ...typography.titleMedium,
  },
  subtitle: {
    ...typography.body,
  },
});

