import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { MistakeStatus } from '@/src/models/Mistake';
import { radius, spacing } from '@/src/styles/tokens';

const palette = {
  background: '#F5F5F7',
  surface: '#FFFFFF',
  text: '#1D1D1F',
  secondaryText: '#6E6E73',
  green: '#248A3D',
  greenFill: '#34C759',
  greenSoft: '#EAF8EE',
  border: '#D9D9DE',
  segment: '#E9E9ED',
  pending: '#D8D8DC',
} as const;

export type MistakeDetailSectionId = 'overview' | 'images' | 'reviews';

export type MistakeDetailSectionItem = {
  id: MistakeDetailSectionId;
  label: string;
  count?: number;
};

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
    <View style={styles.progressCard}>
      <View style={styles.progressCountWrap}>
        <View style={styles.progressFractionRow}>
          <Text maxFontSizeMultiplier={1.15} style={styles.progressNumber}>{completed}</Text>
          <Text maxFontSizeMultiplier={1.15} style={styles.progressTotal}> / {total}</Text>
        </View>
        <Text style={[styles.progressCaption, mastered && styles.progressCaptionMastered]}>
          {mastered ? '已掌握' : `已完成 ${completed} 次`}
        </Text>
      </View>

      <View style={styles.progressDivider} />

      <View style={styles.progressScheduleWrap}>
        <Text numberOfLines={1} style={styles.nextReviewText}>
          {mastered ? '七刷已完成' : `下一次：${nextReviewText}`}
        </Text>
        <View accessibilityLabel={`已完成 ${completed} / ${total} 次`} style={styles.dotRow}>
          {Array.from({ length: total }, (_, index) => (
            <View
              key={index}
              style={[styles.progressDot, index < completed && styles.progressDotCompleted]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

export function DetailSectionNavigator({
  items,
  activeId,
  floating = false,
  onPress,
  style,
}: {
  items: readonly MistakeDetailSectionItem[];
  activeId: MistakeDetailSectionId;
  floating?: boolean;
  onPress: (id: MistakeDetailSectionId) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segmentOuter, floating && styles.segmentOuterFloating, style]}>
      {items.map((item) => {
        const active = item.id === activeId;
        const text = typeof item.count === 'number' ? `${item.label} ${item.count}` : item.label;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`跳转到${text}`}
            onPress={() => onPress(item.id)}
            style={({ pressed }) => [
              styles.segmentItem,
              active && styles.segmentItemActive,
              pressed && styles.segmentItemPressed,
            ]}>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
              style={[styles.segmentText, active && styles.segmentTextActive]}>
              {text}
            </Text>
          </Pressable>
        );
      })}
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
  progressCard: {
    minHeight: 152,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  progressCountWrap: {
    width: 96,
    minWidth: 84,
    gap: 3,
  },
  progressFractionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  progressNumber: {
    color: palette.green,
    fontSize: 50,
    lineHeight: 56,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressTotal: {
    color: palette.secondaryText,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  progressCaption: {
    color: palette.secondaryText,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  progressCaptionMastered: {
    color: palette.green,
    fontWeight: '700',
  },
  progressDivider: {
    width: StyleSheet.hairlineWidth,
    height: 72,
    marginHorizontal: 12,
    backgroundColor: palette.border,
  },
  progressScheduleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 20,
  },
  nextReviewText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
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
  segmentOuter: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: palette.segment,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    gap: 4,
  },
  segmentOuterFloating: {
    borderRadius: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: 6,
    backgroundColor: 'rgba(245, 245, 247, 0.98)',
  },
  segmentItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  segmentItemActive: {
    backgroundColor: palette.surface,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentItemPressed: {
    opacity: 0.7,
  },
  segmentText: {
    color: palette.secondaryText,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: palette.text,
    fontWeight: '700',
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
    borderColor: '#A9DEB5',
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
