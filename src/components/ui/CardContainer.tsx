import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadows, spacing } from '@/src/styles/tokens';

type PaddingSize = keyof typeof spacing;

export interface CardContainerProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padding?: PaddingSize | number;
}

export function CardContainer({ children, style, padding = 'lg' }: CardContainerProps) {
  const resolvedPadding = typeof padding === 'number' ? padding : spacing[padding];

  return <View style={[styles.card, { padding: resolvedPadding }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
});

