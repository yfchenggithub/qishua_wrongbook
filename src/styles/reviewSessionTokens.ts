import { colors, layout, radius } from '@/src/styles/tokens';

export const reviewSessionColors = {
  background: colors.pageBackground,
  surface: colors.surface,
  textPrimary: colors.textPrimary,
  textSecondary: colors.textSecondary,
  textMuted: colors.textTertiary,
  separator: colors.separator,
  green: colors.accent,
  greenSoft: colors.accentSoft,
  greenBorder: colors.accentBorder,
  red: colors.danger,
  redSoft: colors.dangerSoft,
  orange: colors.warning,
  orangeSoft: colors.warningSoft,
  backdrop: 'rgba(28, 28, 30, 0.32)',
} as const;

export const reviewSessionLayout = {
  horizontalPadding: layout.pageHorizontalPadding,
  contentRadius: radius.card,
  controlRadius: radius.lg,
  minimumTouchSize: layout.minimumTouchSize,
  minimumButtonHeight: layout.primaryButtonHeight,
} as const;
