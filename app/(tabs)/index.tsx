import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import type { HomeStatus, HomeTaskSummary, UpcomingReviewPlanDay } from '@/src/services/MistakeListService';
import * as MistakeListService from '@/src/services/MistakeListService';
import { Logger } from '@/src/services/Logger';
import * as TodayReviewPdfExportService from '@/src/services/TodayReviewPdfExportService';
import { colors, layout, radius, shadows, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'TodayScreen';
const QUEUE_LIMIT = 3;
const UPCOMING_DAYS = 3;
const TOAST_DURATION_DEFAULT = 2200;
const TOAST_DURATION_LONG = 3200;

type ToastType = 'success' | 'info' | 'error';

const EMPTY_HOME_SUMMARY: HomeTaskSummary = {
  hasAnyMistake: false,
  todayDueCount: 0,
  todayQueue: [],
  todayCompletedStats: {
    total: 0,
    mastered: 0,
    unsure: 0,
    wrong: 0,
  },
  homeStatus: 'empty',
  upcomingPlan: [],
};

function normalizeMistakeId(id: string): string | null {
  const normalized = typeof id === 'string' ? id.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function mapStatusToTone(status: MistakeListStatus): 'dark' | 'light' | 'success' {
  if (status === 'mastered') {
    return 'success';
  }
  if (status === 'due_today') {
    return 'dark';
  }
  return 'light';
}

function getToastBackgroundColor(type: ToastType): string {
  if (type === 'success') {
    return 'rgba(24, 38, 30, 0.95)';
  }
  if (type === 'error') {
    return 'rgba(88, 28, 28, 0.95)';
  }
  return 'rgba(38, 44, 53, 0.95)';
}

function buildHomePrimaryMessage(summary: HomeTaskSummary): string {
  if (summary.homeStatus === 'empty') {
    return '还没有错题\n先拍一道错题，开始七刷计划';
  }
  if (summary.homeStatus === 'dueToday') {
    return `今天该复做\n${summary.todayDueCount} 道`;
  }
  if (summary.homeStatus === 'completedToday') {
    const { total, mastered, unsure, wrong } = summary.todayCompletedStats;
    return `今天复做已完成\n今天完成 ${total} 道（会了 ${mastered} / 模糊 ${unsure} / 不会 ${wrong}）`;
  }
  return '今天没有到期复做';
}

function buildHomeHintText(status: HomeStatus): string {
  if (status === 'empty') {
    return '新增错题后，系统会自动安排七刷节奏';
  }
  if (status === 'dueToday') {
    return '优先完成今天到期题，不提前复做未来题';
  }
  if (status === 'completedToday') {
    return '今天任务已完成，保持节奏即可';
  }
  return '今天无需复做，按计划等待下一次到期';
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
    <CardContainer padding={spacing.md} style={styles.mistakeCard}>
      <View style={styles.mistakeRow}>
        <ThumbnailPlaceholder />

        <View style={styles.mistakeMain}>
          <View style={styles.mistakeTopLine}>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.mistakeMeta}>
              {item.module}
            </Text>
            <Text maxFontSizeMultiplier={1.1} style={styles.arrow}>
              {'>'}
            </Text>
          </View>

          <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={styles.mistakeTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.mistakeSource}>
            {item.subtitle}
          </Text>

          <View style={styles.progressRow}>
            <ProgressDots
              total={item.maxReviewCount}
              current={item.reviewCount}
              completed={item.reviewCount}
            />
          </View>
          <StatusPill
            label={item.statusLabel}
            tone={mapStatusToTone(item.displayStatus)}
            style={styles.statusPill}
          />
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
    <CardContainer padding={spacing.md} style={styles.stateCard}>
      <Text style={styles.stateText}>{message}</Text>
      {actionLabel && onActionPress ? (
        <Pressable onPress={onActionPress} style={styles.stateActionButton}>
          <Text style={styles.stateActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </CardContainer>
  );
}

function UpcomingPlanCard({
  day,
  onOpenDetail,
}: {
  day: UpcomingReviewPlanDay;
  onOpenDetail: (id: string) => void;
}) {
  return (
    <CardContainer padding={spacing.md} style={styles.upcomingCard}>
      <Text style={styles.upcomingDayTitle}>
        {day.dayLabel} · {day.totalCount} 道
      </Text>
      <View style={styles.upcomingItemList}>
        {day.items.map((item) => (
          <Pressable key={item.mistakeId} onPress={() => onOpenDetail(item.mistakeId)}>
            <View style={styles.upcomingItemRow}>
              <Text numberOfLines={1} style={styles.upcomingItemTitle}>
                {item.title}
              </Text>
              <Text style={styles.upcomingItemMeta}>第 {item.nextReviewIndex} / 7 刷</Text>
            </View>
          </Pressable>
        ))}
      </View>
      {day.remainingCount > 0 ? (
        <Text style={styles.upcomingRemainText}>还有 {day.remainingCount} 道未展示</Text>
      ) : null}
    </CardContainer>
  );
}

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<HomeTaskSummary>(EMPTY_HOME_SUMMARY);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);

  const requestIdRef = useRef(0);
  const hasFocusedRef = useRef(false);
  const hasSuccessfulLoadRef = useRef(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadHomeData = useCallback(async (mode: 'initial' | 'refresh') => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (mode === 'initial') {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const homeSummary = await MistakeListService.getHomeTaskSummary();
      if (requestId !== requestIdRef.current) {
        return;
      }

      setSummary(homeSummary);
      setErrorMessage(null);
      hasSuccessfulLoadRef.current = true;
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to load home data.', error);
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (!hasSuccessfulLoadRef.current) {
        setSummary(EMPTY_HOME_SUMMARY);
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
    }, [loadHomeData]),
  );

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateY, {
        toValue: 8,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToastVisible(false);
    });
  }, [toastOpacity, toastTranslateY]);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration = TOAST_DURATION_DEFAULT) => {
      const normalizedMessage = message.trim();
      if (!normalizedMessage) {
        return;
      }

      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }

      setToastMessage(normalizedMessage);
      setToastType(type);
      setToastVisible(true);
      toastOpacity.setValue(0);
      toastTranslateY.setValue(8);

      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();

      toastTimerRef.current = setTimeout(() => {
        hideToast();
        toastTimerRef.current = null;
      }, duration);
    },
    [hideToast, toastOpacity, toastTranslateY],
  );

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    },
    [],
  );

  const todayQueuePreview = useMemo(
    () => summary.todayQueue.slice(0, QUEUE_LIMIT),
    [summary.todayQueue],
  );

  const priorityItem = todayQueuePreview[0] ?? null;

  const upcomingDays = useMemo(
    () => summary.upcomingPlan.filter((day) => day.totalCount > 0).slice(0, UPCOMING_DAYS),
    [summary.upcomingPlan],
  );

  const rightNowHint = useMemo(() => {
    if (errorMessage) {
      return errorMessage;
    }
    if (isLoading) {
      return '正在读取首页任务...';
    }
    if (isRefreshing) {
      return '正在刷新...';
    }
    return buildHomeHintText(summary.homeStatus);
  }, [errorMessage, isLoading, isRefreshing, summary.homeStatus]);

  const summaryStats = useMemo(
    () => [
      { label: '今日完成', value: String(summary.todayCompletedStats.total) },
      { label: '会了', value: String(summary.todayCompletedStats.mastered) },
      {
        label: '模糊/不会',
        value: String(summary.todayCompletedStats.unsure + summary.todayCompletedStats.wrong),
      },
    ],
    [summary.todayCompletedStats.mastered, summary.todayCompletedStats.total, summary.todayCompletedStats.unsure, summary.todayCompletedStats.wrong],
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
    [router],
  );

  const handleStartTodayReview = useCallback(() => {
    const nextId = normalizeMistakeId(priorityItem?.id ?? '');
    if (!nextId) {
      return;
    }
    router.push(`/review/${nextId}` as never);
  }, [priorityItem?.id, router]);

  const handleExportTodayWorksheet = useCallback(async () => {
    if (isExportingPdf) {
      return;
    }

    setIsExportingPdf(true);
    try {
      const result = await TodayReviewPdfExportService.exportTodayReviewPdf();
      if (result.success) {
        showToast('今日练习卷已生成', 'success');
        return;
      }

      if (result.reason === 'empty') {
        showToast('今天暂无可导出的复做题', 'info');
        return;
      }

      Logger.warn(PAGE_SCOPE, 'Today worksheet export finished without success.', {
        reason: result.reason,
        message: result.message,
      });
      showToast('导出失败，请稍后重试', 'error', TOAST_DURATION_LONG);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to export today worksheet.', { error });
      showToast('导出失败，请稍后重试', 'error', TOAST_DURATION_LONG);
    } finally {
      setIsExportingPdf(false);
    }
  }, [isExportingPdf, showToast]);

  const exportButtonText = isExportingPdf ? '生成中…' : '导出今日练习卷';
  const canShowExportButton =
    summary.homeStatus === 'dueToday' || summary.homeStatus === 'completedToday';
  const toastBottomOffset = Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg);

  const homePrimaryMessage = useMemo(() => buildHomePrimaryMessage(summary), [summary]);

  return (
    <View style={styles.pageRoot}>
      <ScreenContainer scroll safeAreaEdges={['top']} contentStyle={styles.screenContent}>
      <BrandHeader title={todayMock.brand.title} subtitle={todayMock.brand.subtitle} />

      <CardContainer style={styles.taskSummaryCard} padding={spacing.lg}>
        <Text style={styles.taskCaption}>今日任务</Text>
        <View style={styles.taskDueRow}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.taskDueCount}>
            {summary.todayDueCount}
          </Text>
          <Text style={styles.taskDueLabel}>道待复做</Text>
        </View>

        <View style={styles.taskStatsRow}>
          {summaryStats.map((stat) => (
            <View key={stat.label} style={styles.taskStatCell}>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.taskStatLabel}>
                {stat.label}
              </Text>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.taskStatValue}>
                {stat.value}
              </Text>
            </View>
          ))}
        </View>

        <Text
          maxFontSizeMultiplier={1.1}
          style={[styles.statsHint, errorMessage ? styles.statsHintError : null]}>
          {rightNowHint}
        </Text>
      </CardContainer>

      <View style={styles.sectionBlock}>
        <SectionTitle title="今日入口" />
        <View style={styles.sectionContent}>
          {summary.homeStatus === 'dueToday' && priorityItem ? (
            <View style={styles.todayEntryWrap}>
              <MistakeCard item={priorityItem} pressable={() => handleOpenDetail(priorityItem.id)} />
              <Pressable onPress={handleStartTodayReview} style={styles.primaryActionButton}>
                <Text style={styles.primaryActionButtonText}>开始今日复做</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleExportTodayWorksheet()}
                disabled={isExportingPdf}
                style={[styles.secondaryActionButton, isExportingPdf ? styles.secondaryActionButtonDisabled : null]}>
                <Text style={styles.secondaryActionButtonText}>{exportButtonText}</Text>
              </Pressable>
            </View>
          ) : errorMessage && !isLoading ? (
            <SectionStateCard message={errorMessage} actionLabel="重试" onActionPress={handleRetry} />
          ) : (
            <View style={styles.todayEntryWrap}>
              <SectionStateCard
                message={homePrimaryMessage}
                actionLabel={summary.homeStatus === 'empty' ? '新增错题' : undefined}
                onActionPress={summary.homeStatus === 'empty' ? () => router.push('/add' as never) : undefined}
              />
              {canShowExportButton ? (
                <Pressable
                  onPress={() => void handleExportTodayWorksheet()}
                  disabled={isExportingPdf}
                  style={[
                    styles.secondaryActionButton,
                    isExportingPdf ? styles.secondaryActionButtonDisabled : null,
                  ]}>
                  <Text style={styles.secondaryActionButtonText}>{exportButtonText}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="今日复做队列" />
        <View style={styles.queueList}>
          {summary.homeStatus === 'dueToday' && todayQueuePreview.length > 0 ? (
            todayQueuePreview.map((item) => (
              <MistakeCard key={item.id} item={item} pressable={() => handleOpenDetail(item.id)} />
            ))
          ) : isLoading ? (
            <SectionStateCard message="正在加载今日复做队列..." />
          ) : (
            <SectionStateCard message="今天没有需要开始的复做题" />
          )}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="接下来" />
        <View style={styles.queueList}>
          {upcomingDays.length > 0 ? (
            upcomingDays.map((day) => (
              <UpcomingPlanCard key={`${day.date}-${day.dayOffset}`} day={day} onOpenDetail={handleOpenDetail} />
            ))
          ) : isLoading ? (
            <SectionStateCard message="正在加载未来计划..." />
          ) : (
            <SectionStateCard message="未来 3 天暂无复做安排" />
          )}
        </View>
      </View>
      </ScreenContainer>

      {toastVisible ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastContainer,
            {
              bottom: toastBottomOffset,
              opacity: toastOpacity,
              transform: [{ translateY: toastTranslateY }],
            },
          ]}>
          <View style={[styles.toastBubble, { backgroundColor: getToastBackgroundColor(toastType) }]}>
            <Text maxFontSizeMultiplier={1.1} style={styles.toastText}>
              {toastMessage}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
  },
  screenContent: {
    paddingTop: spacing.lg,
    paddingBottom: layout.bottomTabHeight,
    gap: spacing.lg,
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
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  taskDueCount: {
    ...typography.numberHero,
    color: colors.white,
    lineHeight: 58,
  },
  taskDueLabel: {
    ...typography.sectionTitle,
    color: colors.white,
    marginBottom: spacing.xs,
    fontSize: 18,
    lineHeight: 24,
  },
  taskStatsRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  taskStatCell: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#2A2B31',
    backgroundColor: '#141519',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 84,
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
    fontSize: 26,
    lineHeight: 32,
    flexShrink: 1,
    includeFontPadding: false,
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
  todayEntryWrap: {
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
  primaryActionButton: {
    alignSelf: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.black,
    backgroundColor: colors.black,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  primaryActionButtonText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  secondaryActionButton: {
    alignSelf: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#C9CBD2',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  secondaryActionButtonDisabled: {
    opacity: 0.6,
  },
  secondaryActionButtonText: {
    ...typography.caption,
    color: '#141519',
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
    minWidth: 0,
    gap: spacing.sm,
  },
  mistakeTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mistakeMeta: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
    flex: 1,
    minWidth: 0,
  },
  arrow: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 24,
    lineHeight: 24,
  },
  mistakeTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
  },
  mistakeSource: {
    ...typography.body,
    color: colors.textSecondary,
  },
  progressRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.sm,
  },
  statusPill: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  thumb: {
    width: 96,
    height: 96,
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
    width: 64,
    height: 1.5,
    backgroundColor: '#8E949D',
  },
  thumbAxisY: {
    position: 'absolute',
    width: 1.5,
    height: 64,
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
  upcomingCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  upcomingDayTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  upcomingItemList: {
    gap: spacing.xs,
  },
  upcomingItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  upcomingItemTitle: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    minWidth: 0,
  },
  upcomingItemMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  upcomingRemainText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  toastContainer: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
  toastBubble: {
    maxWidth: '86%',
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.black,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  toastText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '600',
    textAlign: 'center',
  },
});
