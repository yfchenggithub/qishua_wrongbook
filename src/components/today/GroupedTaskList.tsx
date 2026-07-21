import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MistakeListItem } from '@/src/models/MistakeListItem';
import type { UpcomingReviewPlanDay } from '@/src/services/MistakeListService';
import { SurfaceCard } from '@/src/components/ui';
import { colors, layout, spacing, typography } from '@/src/styles/tokens';

function getNextReviewIndex(reviewCount: number, maxReviewCount: number): number {
  return Math.max(1, Math.min(maxReviewCount, Math.floor(reviewCount) + 1));
}

interface TodayQueueListProps {
  items: readonly MistakeListItem[];
  isLoading: boolean;
  onOpenItem: (id: string) => void;
}

export function TodayQueueList({ items, isLoading, onOpenItem }: TodayQueueListProps) {
  const visibleItems = items.slice(0, 3);
  const remainingCount = Math.max(0, items.length - visibleItems.length);

  return (
    <SurfaceCard padding={0} style={styles.card}>
      {visibleItems.length > 0 ? (
        visibleItems.map((item, index) => (
          <View key={item.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <Pressable
              accessibilityLabel={`${item.title}，第 ${getNextReviewIndex(item.reviewCount, item.maxReviewCount)} / ${item.maxReviewCount} 刷`}
              accessibilityRole="button"
              onPress={() => onOpenItem(item.id)}
              style={({ pressed }) => [styles.queueRow, pressed ? styles.rowPressed : null]}>
              <Text numberOfLines={1} style={styles.queueTitle}>{item.title}</Text>
              <Text numberOfLines={1} style={styles.queueMeta}>
                第 {getNextReviewIndex(item.reviewCount, item.maxReviewCount)} / {item.maxReviewCount} 刷
              </Text>
              <MaterialIcons name="chevron-right" size={layout.chevronSize} color={colors.textTertiary} />
            </Pressable>
          </View>
        ))
      ) : (
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>{isLoading ? '正在读取今日队列…' : '今天没有待复做题目'}</Text>
        </View>
      )}

      {remainingCount > 0 ? (
        <>
          <View style={styles.divider} />
          <View style={styles.footer}>
            <Text style={styles.footerText}>还有 {remainingCount} 道</Text>
          </View>
        </>
      ) : null}
    </SurfaceCard>
  );
}

interface UpcomingTaskListProps {
  days: readonly UpcomingReviewPlanDay[];
  isLoading: boolean;
  onOpenDay: (date: string) => void;
}

export function UpcomingTaskList({ days, isLoading, onOpenDay }: UpcomingTaskListProps) {
  return (
    <SurfaceCard padding={0} style={styles.card}>
      {days.length > 0 ? (
        days.map((day, index) => {
          const firstItem = day.items[0] ?? null;
          return (
            <View key={`${day.date}-${day.dayOffset}`}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <Pressable
                accessibilityLabel={`${day.dayLabel}，${day.totalCount} 道复做题`}
                accessibilityRole="button"
                onPress={() => onOpenDay(day.date)}
                style={({ pressed }) => [styles.upcomingRow, pressed ? styles.rowPressed : null]}>
                <View style={styles.upcomingTextColumn}>
                  <Text numberOfLines={1} style={styles.upcomingHeading}>
                    {day.dayLabel} · {day.totalCount} 道
                  </Text>
                  <Text numberOfLines={1} style={styles.upcomingPreview}>
                    {firstItem?.title ?? '暂无安排'}
                  </Text>
                </View>
                {firstItem ? (
                  <Text numberOfLines={1} style={styles.queueMeta}>
                    第 {firstItem.nextReviewIndex} / 7 刷
                  </Text>
                ) : null}
                <MaterialIcons name="chevron-right" size={layout.chevronSize} color={colors.textTertiary} />
              </Pressable>
            </View>
          );
        })
      ) : (
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>{isLoading ? '正在读取未来计划…' : '未来 3 天暂无复做安排'}</Text>
        </View>
      )}
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.card,
    backgroundColor: colors.separator,
  },
  queueRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: spacing.card,
    paddingRight: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  queueTitle: {
    flex: 1,
    minWidth: 0,
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  queueMeta: {
    flexShrink: 0,
    ...typography.meta,
  },
  footer: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: spacing.card,
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  emptyRow: {
    minHeight: 70,
    justifyContent: 'center',
    paddingHorizontal: spacing.card,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  upcomingRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: spacing.card,
    paddingRight: spacing.md,
  },
  upcomingTextColumn: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  upcomingHeading: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  upcomingPreview: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
});
