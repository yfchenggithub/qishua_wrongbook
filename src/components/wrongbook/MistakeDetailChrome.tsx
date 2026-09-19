import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MistakeStatus } from '@/src/models/Mistake';
import { colors, radius, spacing } from '@/src/styles/tokens';

const palette = {
  background: colors.pageBackground,
  surface: colors.surface,
  text: colors.textPrimary,
  secondaryText: colors.textSecondary,
  green: colors.accent,
  greenFill: colors.accent,
  greenSoft: colors.accentSoft,
  border: colors.separator,
  pending: '#D8D8DC',
} as const;

export function MistakeDetailHeader({
  topInset,
  onBack,
  onMore,
}: {
  topInset: number;
  onBack: () => void;
  onMore: () => void;
}) {
  return (
    <View style={[styles.navigationBar, { paddingTop: topInset }]}> 
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="返回今日任务"
        hitSlop={4}
        onPress={onBack}
        style={({ pressed }) => [styles.navigationSide, pressed && styles.pressed]}>
        <MaterialIcons name="arrow-back-ios-new" size={20} color={palette.text} />
        <Text numberOfLines={1} style={styles.navigationBackText}>今日任务</Text>
      </Pressable>

      <View pointerEvents="none" style={[styles.navigationTitleWrap, { top: topInset }]}> 
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.navigationTitle}>
          错题详情
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="更多操作"
        hitSlop={4}
        onPress={onMore}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
        <MaterialIcons name="more-horiz" size={26} color={palette.text} />
      </Pressable>
    </View>
  );
}

export function ReviewProgressCard({
  reviewCount,
  maxReviewCount,
  status,
  nextReviewText,
}: {
  reviewCount: number;
  maxReviewCount: number;
  status: MistakeStatus;
  nextReviewText: string;
}) {
  const total = Number.isFinite(maxReviewCount) && maxReviewCount > 0
    ? Math.floor(maxReviewCount)
    : 7;
  const completed = Number.isFinite(reviewCount)
    ? Math.max(0, Math.min(total, Math.floor(reviewCount)))
    : 0;
  const mastered = status === 'mastered' || completed >= total;

  return (
    <View style={styles.progressSummary}>
      <View style={styles.progressSummaryRow}>
        <View style={styles.progressFractionRow}>
          <Text maxFontSizeMultiplier={1.15} style={styles.progressNumber}>{completed}</Text>
          <Text maxFontSizeMultiplier={1.15} style={styles.progressTotal}> / {total}</Text>
        </View>
        <Text numberOfLines={1} style={[styles.nextReviewText, mastered && styles.nextReviewTextMastered]}>
          {mastered ? '七刷已完成' : `下一次：${nextReviewText}`}
        </Text>
      </View>

      <View accessibilityLabel={`已完成 ${completed} / ${total} 次`} style={styles.dotRow}>
        {Array.from({ length: total }, (_, index) => (
          <View
            key={index}
            style={[styles.progressDot, index < completed && styles.progressDotCompleted]}
          />
        ))}
      </View>
    </View>
  );
}

export function DetailSectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text maxFontSizeMultiplier={1.25} style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}>
          <Text maxFontSizeMultiplier={1.2} style={styles.sectionActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function DetailBottomActionBar({
  bottomInset,
  primaryLabel,
  primaryDisabled,
  primaryBusy,
  mastered,
  onEdit,
  onPrimary,
}: {
  bottomInset: number;
  primaryLabel: string;
  primaryDisabled: boolean;
  primaryBusy?: boolean;
  mastered?: boolean;
  onEdit: () => void;
  onPrimary: () => void;
}) {
  return (
    <View style={[styles.bottomBar, { paddingBottom: Math.max(bottomInset, spacing.sm) }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="编辑错题"
        onPress={onEdit}
        style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
        <MaterialIcons name="edit" size={24} color={palette.text} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        accessibilityState={{ disabled: primaryDisabled }}
        disabled={primaryDisabled}
        onPress={onPrimary}
        style={({ pressed }) => [
          styles.primaryButton,
          mastered && styles.primaryButtonMastered,
          primaryDisabled && !mastered && styles.primaryButtonDisabled,
          pressed && !primaryDisabled && styles.primaryButtonPressed,
        ]}>
        {mastered ? <MaterialIcons name="check-circle" size={21} color={palette.green} /> : null}
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
          style={[styles.primaryButtonText, mastered && styles.primaryButtonTextMastered]}>
          {primaryBusy ? '处理中...' : primaryLabel}
        </Text>
      </Pressable>
    </View>
  );
}

export const mistakeDetailPalette = palette;

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.62,
  },
  navigationBar: {
    minHeight: 56,
    paddingHorizontal: 12,
    backgroundColor: palette.background,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60, 60, 67, 0.12)',
    zIndex: 20,
  },
  navigationSide: {
    minWidth: 112,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
  },
  navigationBackText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
  },
  navigationTitleWrap: {
    position: 'absolute',
    left: 116,
    right: 116,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigationTitle: {
    color: palette.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
  },
  moreButton: {
    width: 52,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressSummary: {
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  progressSummaryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  progressFractionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  progressNumber: {
    color: palette.green,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressTotal: {
    color: palette.secondaryText,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  nextReviewText: {
    flex: 1,
    minWidth: 0,
    color: palette.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  nextReviewTextMastered: {
    color: palette.green,
    fontWeight: '700',
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: palette.pending,
  },
  progressDotCompleted: {
    backgroundColor: palette.greenFill,
  },
  sectionHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    flex: 1,
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  sectionAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingLeft: spacing.md,
  },
  sectionActionText: {
    color: palette.green,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  bottomBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60, 60, 67, 0.18)',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    paddingHorizontal: spacing.screenPadding,
    zIndex: 30,
  },
  editButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flex: 1,
    minWidth: 0,
    height: 52,
    borderRadius: 16,
    backgroundColor: palette.greenFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonPressed: {
    opacity: 0.78,
  },
  primaryButtonDisabled: {
    backgroundColor: '#B8B8BD',
  },
  primaryButtonMastered: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentBorder,
    backgroundColor: palette.greenSoft,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
  },
  primaryButtonTextMastered: {
    color: palette.green,
  },
});
