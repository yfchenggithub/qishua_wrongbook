import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  BrandHeader,
  CardContainer,
  ProgressDots,
  ScreenContainer,
  SectionTitle,
  StatusPill,
} from '@/src/components';
import type { MistakeListItem, MistakeListStatus } from '@/src/models/MistakeListItem';
import { todayMock } from '@/src/mocks/today';
import * as MistakeListService from '@/src/services/MistakeListService';
import { Logger } from '@/src/services/Logger';
import { colors, radius, shadows, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'TodayScreen';
const QUEUE_LIMIT = 3;

function normalizeMistakeId(id: string): string | null {
  const normalized = typeof id === 'string' ? id.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

type HomeStats = {
  total: number;
  due: number;
  mastered: number;
};

function mapStatusToTone(status: MistakeListStatus): 'dark' | 'light' | 'success' {
  if (status === 'mastered') {
    return 'success';
  }
  if (status === 'due_today') {
    return 'dark';
  }
  return 'light';
}

function ThumbnailPlaceholder() {
  return (
    <View style={styles.thumb}>
      <View style={styles.thumbAxisX} />
      <View style={styles.thumbAxisY} />
      <View style={styles.thumbCurve} />
    </View>
  );
}

function MistakeCard({
  item,
  pressable,
}: {
  item: MistakeListItem;
  pressable?: () => void;
}) {
  const content = (
    <CardContainer padding={spacing.lg} style={styles.mistakeCard}>
      <View style={styles.mistakeRow}>
        <ThumbnailPlaceholder />

        <View style={styles.mistakeMain}>
          <View style={styles.mistakeTopLine}>
            <Text style={styles.mistakeMeta}>{item.module}</Text>
            <Text style={styles.arrow}>{'>'}</Text>
          </View>

          <Text style={styles.mistakeTitle}>{item.title}</Text>
          <Text style={styles.mistakeSource}>{item.subtitle}</Text>

          <View style={styles.progressRow}>
            <ProgressDots
              total={item.maxReviewCount}
              current={item.reviewCount}
              completed={item.reviewCount}
            />
            <StatusPill label={item.statusLabel} tone={mapStatusToTone(item.displayStatus)} />
          </View>
        </View>
      </View>
    </CardContainer>
  );

  if (!pressable) {
    return content;
  }

  return <Pressable onPress={pressable}>{content}</Pressable>;
}

function SectionStateCard({
  message,
  actionLabel,
  onActionPress,
}: {
  message: string;
  actionLabel?: string;
  onActionPress?: () => void;
}) {
  return (
    <CardContainer padding={spacing.lg} style={styles.stateCard}>
      <Text style={styles.stateText}>{message}</Text>
      {actionLabel && onActionPress ? (
        <Pressable onPress={onActionPress} style={styles.stateActionButton}>
          <Text style={styles.stateActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </CardContainer>
  );
}

export default function TodayScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<HomeStats>({
    total: 0,
    due: 0,
    mastered: 0,
  });
  const [priorityItem, setPriorityItem] = useState<MistakeListItem | null>(null);
  const [queueItems, setQueueItems] = useState<MistakeListItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const requestIdRef = useRef(0);
  const hasFocusedRef = useRef(false);
  const hasSuccessfulLoadRef = useRef(false);

  const loadHomeData = useCallback(async (mode: 'initial' | 'refresh') => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (mode === 'initial') {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const [statsResult, dueItems, allItems] = await Promise.all([
        MistakeListService.getMistakeListStats(),
        MistakeListService.getMistakeListItems({ segment: 'due', keyword: '' }),
        MistakeListService.getMistakeListItems({ segment: 'all', keyword: '' }),
      ]);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setStats({
        total: statsResult.total,
        due: statsResult.due,
        mastered: statsResult.mastered,
      });
      setPriorityItem(dueItems[0] ?? null);
      setQueueItems(allItems.slice(0, QUEUE_LIMIT));
      setErrorMessage(null);
      hasSuccessfulLoadRef.current = true;
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to load home data.', error);
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (!hasSuccessfulLoadRef.current) {
        setStats({
          total: 0,
          due: 0,
          mastered: 0,
        });
        setPriorityItem(null);
        setQueueItems([]);
      }

      setErrorMessage('首页数据读取失败，请稍后重试');
    } finally {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const handleRetry = useCallback(() => {
    void loadHomeData('refresh');
  }, [loadHomeData]);

  useFocusEffect(
    useCallback(() => {
      const mode: 'initial' | 'refresh' = hasFocusedRef.current ? 'refresh' : 'initial';
      hasFocusedRef.current = true;
      void loadHomeData(mode);
      return undefined;
    }, [loadHomeData])
  );

  const completionRate = useMemo(() => {
    if (stats.total <= 0) {
      return 0;
    }
    return Math.round((stats.mastered / stats.total) * 100);
  }, [stats.mastered, stats.total]);

  const summaryStats = useMemo(
    () => [
      { label: '总错题', value: String(stats.total) },
      { label: '已七刷', value: String(stats.mastered) },
      { label: '完成率', value: `${completionRate}%` },
    ],
    [completionRate, stats.mastered, stats.total]
  );

  const handleOpenDetail = useCallback(
    (id: string) => {
      const routeId = normalizeMistakeId(id);
      if (!routeId) {
        Logger.warn(PAGE_SCOPE, 'Skip opening detail because mistake id is empty.', { id });
        return;
      }
      router.push(`/mistake/${routeId}` as never);
    },
    [router]
  );

  return (
    <ScreenContainer scroll contentStyle={styles.screenContent}>
      <BrandHeader title={todayMock.brand.title} subtitle={todayMock.brand.subtitle} />

      <CardContainer style={styles.taskSummaryCard} padding={spacing.xl}>
        <Text style={styles.taskCaption}>今日任务</Text>
        <View style={styles.taskDueRow}>
          <Text style={styles.taskDueCount}>{stats.due}</Text>
          <Text style={styles.taskDueLabel}>道待复做</Text>
        </View>

        <View style={styles.taskStatsRow}>
          {summaryStats.map((stat) => (
            <View key={stat.label} style={styles.taskStatCell}>
              <Text style={styles.taskStatLabel}>{stat.label}</Text>
              <Text style={styles.taskStatValue}>{stat.value}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.statsHint, errorMessage ? styles.statsHintError : null]}>
          {errorMessage
            ? errorMessage
            : isLoading
              ? '正在读取本地统计...'
              : isRefreshing
                ? '统计更新中...'
                : '统计来自本地 SQLite'}
        </Text>
      </CardContainer>

      <View style={styles.sectionBlock}>
        <SectionTitle title="优先复做" />
        <View style={styles.sectionContent}>
          {priorityItem ? (
            <MistakeCard
              item={priorityItem}
              pressable={() => handleOpenDetail(priorityItem.id)}
            />
          ) : errorMessage && !isLoading ? (
            <SectionStateCard message={errorMessage} actionLabel="重试" onActionPress={handleRetry} />
          ) : (
            <SectionStateCard
              message={isLoading ? '正在加载今日待复做...' : '今天没有待复做错题'}
              actionLabel={isLoading ? undefined : '去新增错题'}
              onActionPress={isLoading ? undefined : () => router.push('/add' as never)}
            />
          )}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="错题队列" />
        <View style={styles.queueList}>
          {queueItems.length > 0 ? (
            queueItems.map((item) => (
              <MistakeCard
                key={item.id}
                item={item}
                pressable={() => handleOpenDetail(item.id)}
              />
            ))
          ) : errorMessage && !isLoading ? (
            <SectionStateCard message={errorMessage} actionLabel="重试" onActionPress={handleRetry} />
          ) : (
            <SectionStateCard
              message={isLoading ? '正在加载错题队列...' : '错题队列为空，去新增页录入第一题'}
              actionLabel={isLoading ? undefined : '去新增错题'}
              onActionPress={isLoading ? undefined : () => router.push('/add' as never)}
            />
          )}
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    gap: spacing.xl,
  },
  taskSummaryCard: {
    backgroundColor: '#0B0B0D',
    borderColor: '#1B1B1F',
    borderRadius: radius.xl,
    ...shadows.floating,
  },
  taskCaption: {
    ...typography.bodySmall,
    color: '#C9CBD2',
    fontWeight: '600',
  },
  taskDueRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  taskDueCount: {
    ...typography.numberHero,
    color: colors.white,
    lineHeight: 72,
  },
  taskDueLabel: {
    ...typography.sectionTitle,
    color: colors.white,
    marginBottom: spacing.sm,
  },
  taskStatsRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  taskStatCell: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#2A2B31',
    backgroundColor: '#141519',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: 96,
    justifyContent: 'space-between',
  },
  taskStatLabel: {
    ...typography.caption,
    color: '#C1C4CC',
    fontWeight: '600',
  },
  taskStatValue: {
    ...typography.sectionTitle,
    color: colors.white,
    fontSize: 34,
    lineHeight: 40,
  },
  statsHint: {
    marginTop: spacing.md,
    ...typography.caption,
    color: '#C1C4CC',
  },
  statsHintError: {
    color: '#F8B4B4',
  },
  sectionBlock: {
    gap: spacing.md,
  },
  sectionContent: {
    marginTop: spacing.xs,
  },
  queueList: {
    gap: spacing.md,
  },
  stateCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  stateActionButton: {
    alignSelf: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.black,
    backgroundColor: colors.black,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stateActionText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  mistakeCard: {
    borderRadius: radius.xl,
  },
  mistakeRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  mistakeMain: {
    flex: 1,
    gap: spacing.sm,
  },
  mistakeTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mistakeMeta: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  arrow: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 24,
    lineHeight: 24,
  },
  mistakeTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  mistakeSource: {
    ...typography.body,
    color: colors.textSecondary,
  },
  progressRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  thumb: {
    width: 112,
    height: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbAxisX: {
    position: 'absolute',
    width: 76,
    height: 1.5,
    backgroundColor: '#8E949D',
  },
  thumbAxisY: {
    position: 'absolute',
    width: 1.5,
    height: 76,
    backgroundColor: '#8E949D',
  },
  thumbCurve: {
    width: 54,
    height: 40,
    borderWidth: 1.5,
    borderColor: '#8E949D',
    borderRadius: radius.pill,
    transform: [{ rotate: '-18deg' }],
  },
});
