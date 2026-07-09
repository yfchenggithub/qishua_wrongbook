import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Animated, LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BrandHeader,
  CardContainer,
  ProgressDots,
  ScreenContainer,
  SectionTitle,
  StatusPill,
} from '@/src/components';
import { formatElapsedSeconds, useTodayWorksheetExport } from '@/src/hooks/useTodayWorksheetExport';
import type { MistakeListItem, MistakeListStatus } from '@/src/models/MistakeListItem';
import { todayMock } from '@/src/mocks/today';
import * as ExportImageModeService from '@/src/services/ExportImageModeService';
import type { HomeStatus, HomeTaskSummary, UpcomingReviewPlanDay } from '@/src/services/MistakeListService';
import * as MistakeListService from '@/src/services/MistakeListService';
import { Logger } from '@/src/services/Logger';
import * as BackupHistoryService from '@/src/services/backup/BackupHistoryService';
import * as TodayWorksheetExportService from '@/src/services/TodayWorksheetExportService';
import { colors, layout, radius, shadows, spacing, typography } from '@/src/styles/tokens';
import type { PrintEnhanceMode } from '@/src/utils/image/printEnhanceConfig';

const PAGE_SCOPE = 'TodayScreen';
const UPCOMING_DAYS = 3;
const TODAY_QUEUE_PREVIEW_COUNT = 5;
const TOAST_DURATION_DEFAULT = 2200;
const TOAST_DURATION_LONG = 3200;
const BACKUP_STALE_DAYS = 7;

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

function buildExportModeHintText(mode: PrintEnhanceMode | null): string {
  if (mode === null) {
    return '当前导出模式：读取中...';
  }
  if (mode === 'clear_print') {
    return '当前导出模式：清晰打印';
  }
  return '当前导出模式：快速导出';
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

function formatBackupCreatedAt(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) {
    return isoDateTime;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

function getBackupAgeDays(lastBackupAt: string | null): number | null {
  if (!lastBackupAt) {
    return null;
  }

  const parsed = new Date(lastBackupAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / (24 * 60 * 60 * 1000)));
}

function buildBackupSafetyCopy(lastBackupAt: string | null): {
  title: string;
  description: string;
  meta: string;
  isWarning: boolean;
} {
  const backupAgeDays = getBackupAgeDays(lastBackupAt);
  if (!lastBackupAt || backupAgeDays === null) {
    return {
      title: '本机数据还没有备份',
      description: '错题、复做记录和图片只保存在本机，换手机或卸载前请先备份。',
      meta: '上次备份：未备份',
      isWarning: true,
    };
  }

  const formattedBackupAt = formatBackupCreatedAt(lastBackupAt);
  if (backupAgeDays >= BACKUP_STALE_DAYS) {
    return {
      title: '建议更新备份',
      description: `离上次备份已 ${backupAgeDays} 天，新增错题后建议导出一份备份文件。`,
      meta: `上次备份：${formattedBackupAt}`,
      isWarning: true,
    };
  }

  return {
    title: '本机数据已备份',
    description: '错题数据仍只保存在本机，重要内容建议定期备份到安全位置。',
    meta: `上次备份：${formattedBackupAt}`,
    isWarning: false,
  };
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

function getNextReviewIndex(reviewCount: number, maxReviewCount: number): number {
  return Math.max(1, Math.min(maxReviewCount, reviewCount + 1));
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

function TodayQueueListCard({
  items,
  onOpenDetail,
}: {
  items: MistakeListItem[];
  onOpenDetail: (id: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canToggle = items.length > TODAY_QUEUE_PREVIEW_COUNT;
  const visibleItems = isExpanded ? items : items.slice(0, TODAY_QUEUE_PREVIEW_COUNT);
  const remainingCount = Math.max(0, items.length - visibleItems.length);
  
  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const handleToggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <CardContainer padding={spacing.md} style={styles.upcomingCard}>
      <Text style={styles.upcomingDayTitle}>今天 · {items.length} 道</Text>
      <View style={styles.upcomingItemList}>
        {visibleItems.map((item) => (
          <Pressable key={item.id} onPress={() => onOpenDetail(item.id)}>
            <View style={styles.upcomingItemRow}>
              <Text numberOfLines={1} style={styles.upcomingItemTitle}>
                {item.title}
              </Text>
              <Text style={styles.upcomingItemMeta}>
                第 {getNextReviewIndex(item.reviewCount, item.maxReviewCount)} / {item.maxReviewCount} 刷
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      {canToggle ? (
        <View style={styles.todayQueueFooter}>
          {remainingCount > 0 ? <Text style={styles.upcomingRemainText}>还有 {remainingCount} 道未展示</Text> : null}
          <Pressable
            onPress={handleToggleExpanded}
            style={styles.todayQueueToggleButton}
            accessibilityRole="button"
            accessibilityLabel={isExpanded ? '收起今日复做队列' : '展开全部今日复做队列'}>
            <Text style={styles.todayQueueToggleText}>{isExpanded ? '收起' : '展开全部'}</Text>
          </Pressable>
        </View>
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
  const [exportMode, setExportMode] = useState<PrintEnhanceMode | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [isBackupSafetyExpanded, setIsBackupSafetyExpanded] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);

  const requestIdRef = useRef(0);
  const hasFocusedRef = useRef(false);
  const hasSuccessfulLoadRef = useRef(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

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

  const loadExportMode = useCallback(async () => {
    try {
      const settings = await ExportImageModeService.loadExportImageSettings();
      setExportMode(settings.mode);
    } catch (error) {
      Logger.warn(PAGE_SCOPE, 'Failed to load export image mode on home screen.', { error });
      setExportMode(null);
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

  const handleRetry = useCallback(() => {
    void loadHomeData('refresh');
  }, [loadHomeData]);

  useFocusEffect(
    useCallback(() => {
      const mode: 'initial' | 'refresh' = hasFocusedRef.current ? 'refresh' : 'initial';
      hasFocusedRef.current = true;
      void loadHomeData(mode);
      void loadExportMode();
      void loadBackupHistory();
      return undefined;
    }, [loadBackupHistory, loadExportMode, loadHomeData]),
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

  const todayQueueList = useMemo(() => summary.todayQueue, [summary.todayQueue]);

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

  const backupSafetyCopy = useMemo(() => buildBackupSafetyCopy(lastBackupAt), [lastBackupAt]);
  const shouldShowBackupSafetyCard = summary.hasAnyMistake;

  const handleOpenBackupSettings = useCallback(() => {
    router.push('/settings' as never);
  }, [router]);

  const handleToggleBackupSafetyExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsBackupSafetyExpanded((prev) => !prev);
  }, []);

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

  const dueTodayCount = Number.isFinite(summary.todayDueCount)
    ? Math.max(0, Math.floor(summary.todayDueCount))
    : 0;

  const {
    isExporting: isExportingPdf,
    exportStage,
    progress: exportPdfProgress,
    progressPercent: exportPdfProgressPercent,
    exportTodayWorksheet: handleExportTodayWorksheet,
  } = useTodayWorksheetExport({
    scope: PAGE_SCOPE,
    dueToday: dueTodayCount,
    longToastDurationMs: TOAST_DURATION_LONG,
    showToast,
    onSuccess: (pdfUri: string, pdfUris: string[]) => {
      Logger.info(PAGE_SCOPE, 'navigate_to_pdf_preview', {
        pdfUri,
        pdfFileCount: pdfUris.length,
      });
      router.push({
        pathname: '/pdf-preview',
        params: {
          pdfUri,
          pdfUris: JSON.stringify(pdfUris),
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

  /* const handleExportTodayWorksheet = useCallback(async () => {
    if (Number.isFinite(summary.todayDueCount)) {
      const dueToday = Math.max(0, Math.floor(summary.todayDueCount));
      if (isExportingPdf) {
        return;
      }

      if (dueToday <= 0) {
        Logger.info(PAGE_SCOPE, 'export_today_practice_pdf_empty', {
          dueToday,
        });
        showToast('今天暂无需要复做的错题', 'info');
        return;
      }

      const startedAt = Date.now();
      Logger.info(PAGE_SCOPE, 'export_today_practice_pdf_start', {
        dueToday,
      });

      setIsExportingPdf(true);
      setExportStage('preparing');
      try {
        const result = await TodayWorksheetExportService.exportTodayWorksheet({
          expectedPendingCount: dueToday,
          onProgress: (progress) => {
            setExportStage(progress.stage);
          },
        });

        if (result.outcome === 'success') {
          const pdfUri = typeof result.fileUri === 'string' ? result.fileUri.trim() : '';
          if (!pdfUri) {
            Logger.warn(PAGE_SCOPE, 'Worksheet export succeeded but PDF URI is empty.', {
              exportedCount: result.exportedCount,
            });
            showToast('导出成功但未找到 PDF 文件，请重试', 'error', TOAST_DURATION_LONG);
            return;
          }

          Logger.info(PAGE_SCOPE, 'export_today_practice_pdf_success', {
            pdfUri,
            questionCount: result.exportedCount,
            elapsedMs: Date.now() - startedAt,
          });
          Logger.info(PAGE_SCOPE, 'navigate_to_pdf_preview', {
            pdfUri,
          });
          router.push({
            pathname: '/pdf-preview',
            params: {
              pdfUri,
            },
          } as never);
          return;
        }

        if (result.outcome === 'empty') {
          Logger.info(PAGE_SCOPE, 'export_today_practice_pdf_empty', {
            dueToday,
          });
          showToast('今天暂无需要复做的错题', 'info');
          void loadHomeData('refresh');
          return;
        }

        if (result.outcome === 'busy') {
          showToast(result.message, 'info', TOAST_DURATION_LONG);
          return;
        }

        showToast(result.message, 'error', TOAST_DURATION_LONG);
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to export today worksheet.', { error });
        showToast('导出失败，请稍后重试', 'error', TOAST_DURATION_LONG);
      } finally {
        setIsExportingPdf(false);
        setExportStage(null);
      }
      return;
    }

    if (isExportingPdf) {
      return;
    }

    if (summary.todayDueCount <= 0) {
      showToast('今天没有待复做错题可导出', 'info');
      return;
    }

    setIsExportingPdf(true);
    setExportStage('preparing');
    try {
      const result = await TodayWorksheetExportService.exportTodayWorksheet({
        expectedPendingCount: summary.todayDueCount,
        onProgress: (progress) => {
          setExportStage(progress.stage);
        },
      });
      if (result.outcome === 'success') {
        showToast(result.message, 'success');
        return;
      }

      if (result.outcome === 'empty') {
        showToast(result.message, 'info');
        void loadHomeData('refresh');
        return;
      }

      if (result.outcome === 'share_unavailable') {
        showToast(result.message, 'info', TOAST_DURATION_LONG);
        return;
      }

      if (result.outcome === 'busy') {
        showToast(result.message, 'info', TOAST_DURATION_LONG);
        return;
      }

      showToast(result.message, 'error', TOAST_DURATION_LONG);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to export today worksheet.', { error });
      showToast('导出失败，请稍后重试', 'error', TOAST_DURATION_LONG);
    } finally {
      setIsExportingPdf(false);
      setExportStage(null);
    }
  }, [isExportingPdf, loadHomeData, router, showToast, summary.todayDueCount]); */

  const canExportTodayWorksheet = dueTodayCount > 0;
  const exportButtonText = isExportingPdf
    ? (exportStage === 'preparing' ? '正在生成练习卷 PDF...' : '正在生成练习卷 PDF...')
    : TodayWorksheetExportService.buildTodayWorksheetExportButtonLabel(dueTodayCount);
  const exportHintText = isExportingPdf
    ? exportButtonText
    : canExportTodayWorksheet
      ? `将导出今日待复做的 ${summary.todayDueCount} 题，便于打印练习。`
      : '今日没有待复做错题，暂不可导出。';
  const startTodayReviewButtonText = isStartingSession ? '正在进入今日复做…' : '开始今日复做';
  const exportProgressHeadline = isExportingPdf
    ? (exportPdfProgress.message || '正在生成练习卷 PDF...')
    : exportHintText;
  const exportProgressDetailText =
    isExportingPdf && exportPdfProgress.total > 0
      ? `已处理 ${exportPdfProgress.current} / ${exportPdfProgress.total} 题 · 用时 ${formatElapsedSeconds(exportPdfProgress.elapsedSeconds)}`
      : '';
  const exportModeHintText = buildExportModeHintText(exportMode);
  const canShowExportButton =
    summary.homeStatus === 'dueToday' || summary.homeStatus === 'completedToday';
  const toastBottomOffset = Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg);

  const homePrimaryMessage = useMemo(() => buildHomePrimaryMessage(summary), [summary]);

  return (
    <View style={styles.pageRoot}>
      <ScreenContainer scroll safeAreaEdges={['top']} contentStyle={styles.screenContent}>
      <BrandHeader title={todayMock.brand.title} subtitle={todayMock.brand.subtitle} />

      {shouldShowBackupSafetyCard ? (
        <CardContainer
          style={[
            styles.backupSafetyCard,
            backupSafetyCopy.isWarning ? styles.backupSafetyCardWarning : styles.backupSafetyCardOk,
          ]}
          padding={spacing.sm}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${isBackupSafetyExpanded ? '收起' : '展开'}本机数据安全，${backupSafetyCopy.meta}`}
            onPress={handleToggleBackupSafetyExpanded}
            style={({ pressed }) => [
              styles.backupSafetyToggle,
              pressed ? styles.backupSafetyPressablePressed : null,
            ]}>
              <View
                style={[
                  styles.backupSafetyCompactIcon,
                  backupSafetyCopy.isWarning ? styles.backupSafetyIconWarning : styles.backupSafetyIconOk,
                ]}>
                <MaterialIcons
                  name={backupSafetyCopy.isWarning ? 'security' : 'verified-user'}
                  size={20}
                  color={backupSafetyCopy.isWarning ? '#B7791F' : colors.success}
                />
              </View>
              <View style={styles.backupSafetyCompactText}>
                <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.backupSafetyEyebrow}>
                  本机数据安全
                </Text>
                <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.backupSafetyMetaText}>
                  {backupSafetyCopy.meta}
                </Text>
              </View>
              <View style={styles.backupSafetyChevronButton}>
                <MaterialIcons
                  name={isBackupSafetyExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={24}
                  color={backupSafetyCopy.isWarning ? '#9A5B00' : colors.success}
                />
              </View>
          </Pressable>
          {isBackupSafetyExpanded ? (
            <View style={styles.backupSafetyExpandedBody}>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.backupSafetyTitle}>
                {backupSafetyCopy.title}
              </Text>
              <Text numberOfLines={2} maxFontSizeMultiplier={1.1} style={styles.backupSafetyDescription}>
                {backupSafetyCopy.description}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="去设置页备份"
                onPress={handleOpenBackupSettings}
                style={({ pressed }) => [
                  styles.backupSafetyActionPill,
                  backupSafetyCopy.isWarning
                    ? styles.backupSafetyActionPillWarning
                    : styles.backupSafetyActionPillOk,
                  pressed ? styles.backupSafetyPressablePressed : null,
                ]}>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.1}
                  style={[
                    styles.backupSafetyActionText,
                    backupSafetyCopy.isWarning
                      ? styles.backupSafetyActionTextWarning
                      : styles.backupSafetyActionTextOk,
                  ]}>
                  去备份
                </Text>
                <MaterialIcons
                  name="chevron-right"
                  size={16}
                  color={backupSafetyCopy.isWarning ? '#9A5B00' : colors.success}
                />
              </Pressable>
            </View>
          ) : null}
        </CardContainer>
      ) : null}

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
        <View style={styles.sectionContent}>
          {summary.homeStatus === 'dueToday' ? (
            <View style={styles.todayEntryWrap}>
              <Pressable
                onPress={() => void handleStartTodayReview()}
                disabled={isStartingSession}
                style={[
                  styles.primaryActionButton,
                  isStartingSession ? styles.primaryActionButtonDisabled : null,
                ]}>
                <View style={styles.actionButtonContent}>
                  <MaterialIcons name="task-alt" size={20} color={colors.success} />
                  <Text style={styles.primaryActionButtonText}>{startTodayReviewButtonText}</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => void handleExportTodayWorksheet()}
                disabled={isExportingPdf || !canExportTodayWorksheet}
                style={[
                  styles.secondaryActionButton,
                  isExportingPdf || !canExportTodayWorksheet ? styles.secondaryActionButtonDisabled : null,
                ]}>
                <View style={styles.actionButtonContent}>
                  <MaterialIcons name="fact-check" size={20} color={colors.success} />
                  <Text style={styles.secondaryActionButtonText}>{exportButtonText}</Text>
                </View>
              </Pressable>
              <View style={styles.exportHintWrap}>
                <Text style={styles.exportHintText}>{exportProgressHeadline}</Text>
                {exportProgressDetailText ? (
                  <Text style={styles.exportProgressMetaText}>{exportProgressDetailText}</Text>
                ) : null}
                <Text style={styles.exportModeHintText}>{exportModeHintText}</Text>
                {isExportingPdf && exportPdfProgress.total > 0 ? (
                  <View style={styles.exportProgressTrack}>
                    <View
                      style={[
                        styles.exportProgressFill,
                        { width: `${Math.round(exportPdfProgressPercent * 100)}%` },
                      ]}
                    />
                  </View>
                ) : null}
              </View>
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
                <>
                  <Pressable
                    onPress={() => void handleExportTodayWorksheet()}
                    disabled={isExportingPdf || !canExportTodayWorksheet}
                    style={[
                      styles.secondaryActionButton,
                      isExportingPdf || !canExportTodayWorksheet
                        ? styles.secondaryActionButtonDisabled
                        : null,
                    ]}>
                    <View style={styles.actionButtonContent}>
                      <MaterialIcons name="fact-check" size={20} color={colors.success} />
                      <Text style={styles.secondaryActionButtonText}>{exportButtonText}</Text>
                    </View>
                  </Pressable>
                  <View style={styles.exportHintWrap}>
                    <Text style={styles.exportHintText}>{exportProgressHeadline}</Text>
                    {exportProgressDetailText ? (
                      <Text style={styles.exportProgressMetaText}>{exportProgressDetailText}</Text>
                    ) : null}
                    <Text style={styles.exportModeHintText}>{exportModeHintText}</Text>
                    {isExportingPdf && exportPdfProgress.total > 0 ? (
                      <View style={styles.exportProgressTrack}>
                        <View
                          style={[
                            styles.exportProgressFill,
                            { width: `${Math.round(exportPdfProgressPercent * 100)}%` },
                          ]}
                        />
                      </View>
                    ) : null}
                  </View>
                </>
              ) : null}
            </View>
          )}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="今日复做队列" />
        <View style={styles.queueList}>
          {summary.homeStatus === 'dueToday' && todayQueueList.length > 0 ? (
            <TodayQueueListCard items={todayQueueList} onOpenDetail={handleOpenDetail} />
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
  backupSafetyPressablePressed: {
    opacity: 0.9,
  },
  backupSafetyCard: {
    borderRadius: radius.lg,
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  backupSafetyCardWarning: {
    borderColor: '#F3DAA2',
    backgroundColor: '#FFFDF8',
  },
  backupSafetyCardOk: {
    borderColor: colors.successBorder,
    backgroundColor: '#FBFFFC',
  },
  backupSafetyToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backupSafetyCompactIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  backupSafetyIconWarning: {
    borderColor: '#E7C36A',
    backgroundColor: '#FFF4D6',
  },
  backupSafetyIconOk: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
  },
  backupSafetyCompactText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  backupSafetyChevronButton: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  backupSafetyExpandedBody: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#DDEFE2',
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  backupSafetyEyebrow: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  backupSafetyTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  backupSafetyActionPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    minHeight: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    flexShrink: 0,
  },
  backupSafetyActionPillWarning: {
    borderColor: '#E7C36A',
    backgroundColor: '#FFF4D6',
  },
  backupSafetyActionPillOk: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
  },
  backupSafetyActionText: {
    ...typography.caption,
    fontWeight: '800',
  },
  backupSafetyActionTextWarning: {
    color: '#9A5B00',
  },
  backupSafetyActionTextOk: {
    color: colors.success,
  },
  backupSafetyDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  backupSafetyMetaText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  taskSummaryCard: {
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
    borderRadius: radius.xl,
    ...shadows.card,
  },
  taskCaption: {
    ...typography.bodySmall,
    color: colors.success,
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
    color: colors.success,
    lineHeight: 58,
  },
  taskDueLabel: {
    ...typography.sectionTitle,
    color: colors.success,
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
    borderColor: '#D7ECDF',
    backgroundColor: '#FEFFFE',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 84,
    justifyContent: 'space-between',
  },
  taskStatLabel: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '600',
  },
  taskStatValue: {
    ...typography.sectionTitle,
    color: colors.success,
    fontSize: 26,
    lineHeight: 32,
    flexShrink: 1,
    includeFontPadding: false,
  },
  statsHint: {
    marginTop: spacing.md,
    ...typography.caption,
    color: colors.success,
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
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stateActionText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryActionButton: {
    width: '100%',
    minHeight: 56,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.card,
  },
  primaryActionButtonDisabled: {
    opacity: 0.6,
  },
  primaryActionButtonText: {
    ...typography.sectionTitle,
    color: colors.success,
    fontWeight: '700',
  },
  secondaryActionButton: {
    width: '100%',
    minHeight: 56,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D7E6DC',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.card,
  },
  secondaryActionButtonDisabled: {
    opacity: 0.6,
  },
  secondaryActionButtonText: {
    ...typography.sectionTitle,
    color: colors.success,
    fontWeight: '700',
  },
  exportHintText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  exportHintWrap: {
    marginTop: -spacing.xs,
    gap: spacing.xs,
  },
  exportProgressMetaText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  exportModeHintText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  exportProgressTrack: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  exportProgressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.success,
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
  todayQueueFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  todayQueueToggleButton: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  todayQueueToggleText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
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
