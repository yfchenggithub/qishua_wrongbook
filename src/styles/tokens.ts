import type { TextStyle, ViewStyle } from 'react-native';

type ShadowStyleToken = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOpacity' | 'shadowRadius' | 'shadowOffset' | 'elevation'
>;

export const BRAND_ACCENT = '#34C759';

/**
 * Product-wide visual tokens. Brand green is defined once as `accent`; the
 * legacy success aliases keep older screens compatible while they migrate.
 */
export const colors = {
  pageBackground: '#F5F5F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F2F7',
  textPrimary: '#1D1D1F',
  textSecondary: '#6E6E73',
  textTertiary: '#AEAEB2',
  separator: '#E5E5EA',
  accent: BRAND_ACCENT,
  accentSoft: '#EBF8EF',
  accentPressed: '#2FB350',
  accentDisabled: 'rgba(52, 199, 89, 0.33)',
  accentBorder: '#BFE8CA',
  action: '#007AFF',
  actionSoft: '#EAF3FF',
  actionPressed: '#0062CC',
  actionDisabled: 'rgba(0, 122, 255, 0.30)',
  danger: '#FF3B30',
  dangerSoft: '#FFF0F0',
  warning: '#FF9F0A',
  warningSoft: '#FFF6E7',
  shadow: '#000000',
  black: '#000000',
  white: '#FFFFFF',

  // Compatibility aliases. Do not introduce new brand-green literals.
  background: '#F5F5F7',
  textMuted: '#AEAEB2',
  border: '#E5E5EA',
  success: BRAND_ACCENT,
  successBg: '#EBF8EF',
  successBorder: '#BFE8CA',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  card: 20,
  xl: 24,
  xxl: 32,
  screenPadding: 20,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  control: 14,
  lg: 16,
  card: 20,
  xl: 24,
  pill: 999,
} as const;

export const typography: Record<
  | 'pageTitle'
  | 'pageSubtitle'
  | 'sectionMajor'
  | 'sectionGroup'
  | 'cardTitle'
  | 'body'
  | 'meta'
  | 'titleLarge'
  | 'titleMedium'
  | 'sectionTitle'
  | 'bodySmall'
  | 'caption'
  | 'numberHero',
  TextStyle
> = {
  pageTitle: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  pageSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  sectionMajor: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionGroup: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: colors.textSecondary,
  },

  // Existing names kept for screens outside this visual-unification task.
  titleLarge: {
    fontSize: 42,
    lineHeight: 50,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  titleMedium: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  bodySmall: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textTertiary,
  },
  numberHero: {
    fontSize: 58,
    lineHeight: 66,
    fontWeight: '800',
    color: colors.textPrimary,
  },
};

export const shadows: Record<'card' | 'floating', ShadowStyleToken> = {
  card: {
    shadowColor: colors.shadow,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  floating: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
};

export const layout = {
  pageHorizontalPadding: 20,
  cardPadding: 20,
  cardGap: 12,
  sectionGap: 32,
  bottomTabHeight: 64,
  primaryButtonHeight: 56,
  minimumTouchSize: 44,
  iconSize: 24,
  featureIconSize: 44,
  chevronSize: 20,
  headerTopPadding: 20,
} as const;

export const tokens = {
  colors,
  spacing,
  radius,
  typography,
  shadows,
  layout,
} as const;

export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radius;
export type TypographyToken = keyof typeof typography;
export type ShadowTokenName = keyof typeof shadows;
