import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MistakeListItem } from '@/src/models/MistakeListItem';
import type { UpcomingReviewPlanDay } from '@/src/services/MistakeListService';

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
    <View style={styles.card}>
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
              <MaterialIcons name="chevron-right" size={21} color="#8E8E93" />
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
    </View>
  );
}

interface UpcomingTaskListProps {
  days: readonly UpcomingReviewPlanDay[];
  isLoading: boolean;
  onOpenDay: (date: string) => void;
}

export function UpcomingTaskList({ days, isLoading, onOpenDay }: UpcomingTaskListProps) {
  return (
    <View style={styles.card}>
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
                <MaterialIcons name="chevron-right" size={21} color="#8E8E93" />
              </Pressable>
            </View>
          );
        })
      ) : (
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>{isLoading ? '正在读取未来计划…' : '未来 3 天暂无复做安排'}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.035,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
    backgroundColor: '#E5E5EA',
  },
  queueRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 12,
  },
  rowPressed: {
    backgroundColor: '#F2F2F7',
  },
  queueTitle: {
    flex: 1,
    minWidth: 0,
    color: '#1D1D1F',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  queueMeta: {
    flexShrink: 0,
    color: '#6E6E73',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  footer: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  footerText: {
    color: '#6E6E73',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  emptyRow: {
    minHeight: 70,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  emptyText: {
    color: '#6E6E73',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  upcomingRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 12,
  },
  upcomingTextColumn: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  upcomingHeading: {
    color: '#1D1D1F',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  upcomingPreview: {
    color: '#6E6E73',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
});
