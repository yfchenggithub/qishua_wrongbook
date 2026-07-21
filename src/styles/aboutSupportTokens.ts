import type { TextStyle, ViewStyle } from 'react-native';

import { colors, radius } from '@/src/styles/tokens';

export const aboutSupportColors = {
  page: colors.pageBackground,
  card: colors.surface,
  text: colors.textPrimary,
  secondaryText: colors.textSecondary,
  tertiaryText: colors.textTertiary,
  separator: colors.separator,
  blue: colors.action,
  blueSoft: colors.actionSoft,
  privacy: '#34C759',
  privacySoft: '#EAF8EE',
  wechat: '#20A447',
  image: colors.action,
  mail: '#FF7A1A',
  neutralNotice: '#7A8493',
  neutralNoticeBackground: '#F7F7F9',
  modalBackdrop: 'rgba(0, 0, 0, 0.88)',
} as const;

export const aboutSupportLayout = {
  horizontalPadding: 20,
  headerHeight: 56,
  cardRadius: 18,
  buttonHeight: 56,
  buttonRadius: 14,
  rowMinHeight: 72,
  touchSize: 44,
  iconSize: 28,
  cardPadding: 20,
} as const;

export const aboutSupportTypography: Record<
  'navigationTitle' | 'pageTitle' | 'rowTitle' | 'body' | 'supporting' | 'sectionLabel',
  TextStyle
> = {
  navigationTitle: {
    color: aboutSupportColors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  pageTitle: {
    color: aboutSupportColors.text,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '700',
  },
  rowTitle: {
    color: aboutSupportColors.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
  },
  body: {
    color: aboutSupportColors.secondaryText,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '400',
  },
  supporting: {
    color: aboutSupportColors.secondaryText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  sectionLabel: {
    color: aboutSupportColors.secondaryText,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
};

export const aboutSupportCardShadow: ViewStyle = {
  borderRadius: radius.lg,
  shadowColor: '#000000',
  shadowOpacity: 0.04,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 1,
};
