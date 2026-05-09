import type { TextStyle, ViewStyle } from 'react-native';

type ShadowToken = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOpacity' | 'shadowRadius' | 'shadowOffset' | 'elevation'
>;

export const colors = {
  background: '#F7F7F8',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F4F6',
  textPrimary: '#111111',
  textSecondary: '#5D6168',
  textMuted: '#9AA0A6',
  border: '#E6E8EB',
  black: '#0A0A0A',
  white: '#FFFFFF',
  success: '#2EBB61',
  successBg: '#EAF8EE',
  danger: '#D84A4A',
  shadow: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  screenPadding: 20,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  card: 20,
  pill: 999,
} as const;

export const typography: Record<
  'titleLarge' | 'titleMedium' | 'sectionTitle' | 'body' | 'bodySmall' | 'caption' | 'numberHero',
  TextStyle
> = {
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
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  bodySmall: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: colors.textMuted,
  },
  numberHero: {
    fontSize: 58,
    lineHeight: 66,
    fontWeight: '800',
    color: colors.textPrimary,
  },
};

export const shadows: Record<'card' | 'floating', ShadowToken> = {
  card: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  floating: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
};

export const layout = {
  bottomTabHeight: 84,
  cardMinHeight: 120,
  headerTopPadding: 24,
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
