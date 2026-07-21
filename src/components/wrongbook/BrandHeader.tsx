import type { ReactNode } from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

import { PageHeader } from '@/src/components/ui/PageHeader';

export interface BrandHeaderProps {
  title: string;
  subtitle: string;
  showOffline?: boolean;
  offlineLabel?: string;
  offlineBadgeStyle?: StyleProp<ViewStyle>;
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
  offlineBadgeStyle,
  rightAccessory,
  style,
  titleStyle,
  subtitleStyle,
}: BrandHeaderProps) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      showOffline={showOffline}
      offlineLabel={offlineLabel}
      rightAccessory={rightAccessory}
      style={style}
      titleStyle={titleStyle}
      subtitleStyle={subtitleStyle}
      offlineBadgeStyle={offlineBadgeStyle}
    />
  );
}
