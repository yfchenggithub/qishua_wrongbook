import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, type ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast, PageHeader, PageShell, SectionHeader } from '@/src/components';
import {
  SmartFilter,
  type SmartFilterOption,
  TodayQueueList,
  TodaySummaryCard,
  UpcomingTaskList,
} from '@/src/components/today';
import { useAppToast } from '@/src/hooks/useAppToast';
import { formatElapsedSeconds, useTodayWorksheetExport } from '@/src/hooks/useTodayWorksheetExport';
import * as BackupHistoryService from '@/src/services/backup/BackupHistoryService';
import { Logger } from '@/src/services/Logger';
import type { HomeStatus, HomeTaskSummary } from '@/src/services/MistakeListService';
import * as MistakeListService from '@/src/services/MistakeListService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'TodayScreen';
const TOAST_DURATION_DEFAULT = 2200;
const TOAST_DURATION_LONG = 3200;
const UPCOMING_DAYS = 3;

type TodayQuickFilter = 'today' | 'overdue' | 'recentViewed' | 'recentAdded';

const EMPTY_HOME_SUMMARY: HomeTaskSummary = {
  hasAnyMistake: false,
  todayDueCount: 0,
  overdueCount: 0,
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

function buildSummaryHint(status: HomeStatus): string {
  if (status === 'empty') {
    return '新增错题后，系统会自动安排七刷节奏';
  }
  if (status === 'dueToday') {
    return '优先完成今天到期题';
  }
  if (status === 'completedToday') {
    return '今天的复做已完成，保持节奏即可';
  }
  return '今天暂无到期题，未来题不会提前复做';
}

function formatBackupStatus(lastBackupAt: string | null): string {
  if (!lastBackupAt) {
    return '数据仅保存在本机 · 尚未备份';
  }

  const date = new Date(lastBackupAt);
  if (Number.isNaN(date.getTime())) {
    return '数据仅保存在本机 · 备份时间未知';
  }

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `数据仅保存在本机 · 已备份 ${date.getMonth() + 1} 月 ${date.getDate()} 日 ${hours}:${minutes}`;
}

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView | null>(null);
  const queueSectionYRef = useRef(0);
  const requestIdRef = useRef(0);
  const hasFocusedRef = useRef(false);
  const hasSuccessfulLoadRef = useRef(false);
  const [summary, setSummary] = useState<HomeTaskSummary>(EMPTY_HOME_SUMMARY);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { props: toastProps, showToast } = useAppToast({ defaultDuration: TOAST_DURATION_DEFAULT });

  const loadHomeData = useCallback(async (mode: 'initial' | 'refresh') => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (mode === 'initial') {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const nextSummary = await MistakeListService.getHomeTaskSummary();
      if (requestId !== requestIdRef.current) {
        return;
      }
      setSummary(nextSummary);
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
      setErrorMessage('首页数据读取失败，点此重试');
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  const loadBackupHistory = useCallback(async () => {
    try {
      const history = await BackupHistoryService.loadBackupHistoryState();
      setLastBackupAt(history.lastBackupAt);
    } catch (error) {
      Logger.warn(PAGE_SCOPE, 'Failed to load backup history on home screen.', { error });
      setLastBackupAt(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const mode: 'initial' | 'refresh' = hasFocusedRef.current ? 'refresh' : 'initial';
      hasFocusedRef.current = true;
      void loadHomeData(mode);
      void loadBackupHistory();
      return undefined;
    }, [loadBackupHistory, loadHomeData]),
  );

  const dueTodayCount = Number.isFinite(summary.todayDueCount)
    ? Math.max(0, Math.floor(summary.todayDueCount))
    : 0;
  const completedCount = Math.max(0, Math.floor(summary.todayCompletedStats.total));
  const totalTaskCount = dueTodayCount + completedCount;

  const {
    isExporting: isExportingPdf,
    hasCachedWorksheet,
    progress: exportPdfProgress,
    progressPercent: exportPdfProgressPercent,
    exportTodayWorksheet,
  } = useTodayWorksheetExport({
    scope: PAGE_SCOPE,
    dueToday: dueTodayCount,
    longToastDurationMs: TOAST_DURATION_LONG,
    showToast,
    onSuccess: (pdfUri: string, pdfUris: string[], pdfPageCounts: number[]) => {
      router.push({
        pathname: '/pdf-preview',
        params: {
          pdfUri,
          pdfUris: JSON.stringify(pdfUris),
          pdfPageCounts: JSON.stringify(pdfPageCounts),
        },
      } as never);
    },
    onEmpty: () => {
      void loadHomeData('refresh');
    },
  });

  const handleStartTodayReview = useCallback(async () => {
    if (isStartingSession) {
      return;
    }

    setIsStartingSession(true);
    try {
      const todayQueue = await MistakeListService.getTodayReviewQueue();
      if (todayQueue.length <= 0) {
        showToast('今天没有需要复做的错题', 'info');
        void loadHomeData('refresh');
        return;
      }
      router.push('/review/session' as never);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to start today review session.', { error });
      showToast('读取今日复做队列失败，请稍后重试', 'error', TOAST_DURATION_LONG);
    } finally {
      setIsStartingSession(false);
    }
  }, [isStartingSession, loadHomeData, router, showToast]);

  const handleOpenDetail = useCallback((id: string) => {
    const routeId = normalizeMistakeId(id);
    if (!routeId) {
      Logger.warn(PAGE_SCOPE, 'Skip opening detail because mistake id is empty.', { id });
      return;
    }
    router.push(`/mistake/${routeId}` as never);
  }, [router]);

  const openLibraryQuickFilter = useCallback((quickMode: TodayQuickFilter) => {
    router.push({
      pathname: '/library',
      params: { quickMode },
    } as never);
  }, [router]);

  const handleQuickFilterChange = useCallback((value: TodayQuickFilter) => {
    if (value === 'today') {
      scrollRef.current?.scrollTo({ y: Math.max(0, queueSectionYRef.current - 12), animated: true });
      return;
    }
    openLibraryQuickFilter(value);
  }, [openLibraryQuickFilter]);

  const handleQueueLayout = useCallback((event: LayoutChangeEvent) => {
    queueSectionYRef.current = Math.max(0, event.nativeEvent.layout.y);
  }, []);

  const handleOpenUpcomingDay = useCallback((date: string) => {
    router.push({
      pathname: '/library',
      params: { scheduledDate: date },
    } as never);
  }, [router]);

  const quickFilterOptions = useMemo<readonly SmartFilterOption<TodayQuickFilter>[]>(() => [
    { value: 'today', label: '今日应做', count: dueTodayCount },
    { value: 'overdue', label: '已逾期', count: Math.max(0, summary.overdueCount) },
    { value: 'recentViewed', label: '最近访问' },
    { value: 'recentAdded', label: '最近增加' },
  ], [dueTodayCount, summary.overdueCount]);

  const upcomingDays = useMemo(
    () => summary.upcomingPlan.slice(0, UPCOMING_DAYS),
    [summary.upcomingPlan],
  );
  const backupStatus = useMemo(() => formatBackupStatus(lastBackupAt), [lastBackupAt]);
  const summaryHint = errorMessage
    ?? (isLoading ? '正在读取今日任务…' : isRefreshing ? '正在刷新…' : buildSummaryHint(summary.homeStatus));
  const primaryDisabled = dueTodayCount <= 0 || isLoading || isStartingSession;
  const primaryLabel = isStartingSession
    ? '正在进入今日复做…'
    : isLoading
      ? '正在读取今日任务…'
      : dueTodayCount > 0
        ? '开始今日复做'
        : completedCount > 0
          ? '今日复做已完成'
          : '今日暂无复做';
  const exportDisabled = isExportingPdf || (dueTodayCount <= 0 && !hasCachedWorksheet);
  const exportProgressLabel = isExportingPdf
    ? `${exportPdfProgress.message || '正在生成练习卷…'}${
        exportPdfProgress.total > 0
          ? ` · ${exportPdfProgress.current} / ${exportPdfProgress.total} 题 · ${formatElapsedSeconds(exportPdfProgress.elapsedSeconds)}`
          : ''
      }`
    : undefined;
  const toastBottomOffset = Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg);

  return (
    <View style={styles.pageRoot}>
      <PageShell
        scroll
        hasBottomTab
        scrollRef={scrollRef}
        safeAreaEdges={['top']}
        style={styles.safeArea}
        contentStyle={styles.content}>
        <PageHeader
          title="七刷错题本"
          subtitle="巩固薄弱，把错题变成分数"
          showOffline
          rightAccessory={(
            <Pressable
              accessibilityLabel="扫描练习卷二维码"
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => router.push('/review-sheet/scan' as never)}
              style={({ pressed }) => [styles.scanButton, pressed ? styles.iconButtonPressed : null]}>
              <MaterialIcons name="qr-code-scanner" size={24} color={colors.accent} />
            </Pressable>
          )}
        />

        <SmartFilter
          onChange={handleQuickFilterChange}
          options={quickFilterOptions}
          style={styles.smartFilter}
          value="today"
        />

        <Pressable
          accessibilityLabel={`${backupStatus}，进入本地备份`}
          accessibilityRole="button"
          onPress={() => router.push('/settings' as never)}
          style={({ pressed }) => [styles.backupRow, pressed ? styles.backupRowPressed : null]}>
          <View style={styles.backupIcon}>
            <MaterialIcons name="verified-user" size={23} color={colors.accent} />
          </View>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            numberOfLines={1}
            style={styles.backupText}>
            {backupStatus}
          </Text>
          <MaterialIcons name="chevron-right" size={layout.chevronSize} color={colors.textTertiary} />
        </Pressable>

        <TodaySummaryCard
          completed={summary.todayCompletedStats}
          exportDisabled={exportDisabled}
          exportLabel={
            isExportingPdf
              ? '正在生成今日练习卷…'
              : hasCachedWorksheet
                ? '打开今日练习卷'
                : '导出今日练习卷'
          }
          exportProgress={exportPdfProgressPercent}
          exportProgressLabel={exportProgressLabel}
          hint={summaryHint}
          onExportPress={() => void exportTodayWorksheet()}
          onPrimaryPress={() => void handleStartTodayReview()}
          pendingCount={dueTodayCount}
          primaryDisabled={primaryDisabled}
          primaryLabel={primaryLabel}
          totalCount={totalTaskCount}
        />

        {errorMessage ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadHomeData('refresh')}
            style={({ pressed }) => [styles.retryButton, pressed ? styles.textButtonPressed : null]}>
            <Text style={styles.retryText}>重新读取首页数据</Text>
          </Pressable>
        ) : null}

        <View onLayout={handleQueueLayout} style={styles.section}>
          <SectionHeader
            actionLabel="查看全部"
            onActionPress={() => openLibraryQuickFilter('today')}
            title="今日队列"
          />
          <TodayQueueList
            isLoading={isLoading}
            items={summary.todayQueue}
            onOpenItem={handleOpenDetail}
          />
        </View>

        <View style={styles.section}>
          <SectionHeader title="接下来" />
          <UpcomingTaskList
            days={upcomingDays}
            isLoading={isLoading}
            onOpenDay={handleOpenUpcomingDay}
          />
        </View>
      </PageShell>

      <AppToast {...toastProps} bottomOffset={toastBottomOffset} />
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: colors.pageBackground,
  },
  safeArea: {
    backgroundColor: colors.pageBackground,
  },
  content: {
    paddingTop: layout.headerTopPadding,
    backgroundColor: colors.pageBackground,
  },
  smartFilter: {
    marginBottom: spacing.card,
  },
  scanButton: {
    width: 44,
    height: 44,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  backupRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: -4,
    borderRadius: 16,
    paddingHorizontal: 4,
    marginBottom: spacing.xl,
  },
  backupRowPressed: {
    backgroundColor: colors.separator,
  },
  backupIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  backupText: {
    flex: 1,
    minWidth: 0,
    ...typography.body,
  },
  section: {
    gap: spacing.md,
    marginTop: spacing.xxl,
  },
  textButtonPressed: {
    opacity: 0.5,
  },
  retryButton: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  retryText: {
    color: '#FF3B30',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
});
