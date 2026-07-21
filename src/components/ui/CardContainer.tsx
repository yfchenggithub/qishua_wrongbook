import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout, radius, spacing } from '@/src/styles/tokens';

type PaddingSize = keyof typeof spacing;

export interface CardContainerProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padding?: PaddingSize | number;
}

export function SurfaceCard({ children, style, padding = layout.cardPadding }: CardContainerProps) {
  const resolvedPadding = typeof padding === 'number' ? padding : spacing[padding];

  return <View style={[styles.card, { padding: resolvedPadding }, style]}>{children}</View>;
}

/** @deprecated Prefer SurfaceCard for product surfaces. */
export const CardContainer = SurfaceCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
});
