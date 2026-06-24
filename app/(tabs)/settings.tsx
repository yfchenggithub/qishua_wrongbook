import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandHeader, CardContainer, ScreenContainer } from '@/src/components';
import { APP_NAME, APP_VERSION, DATA_MODE_LABEL } from '@/src/constants/app';
import { formatElapsedSeconds, useTodayWorksheetExport } from '@/src/hooks/useTodayWorksheetExport';
import { loadDeveloperModeEnabled, saveDeveloperModeEnabled } from '@/src/services/DeveloperModeService';
import * as ExportImageModeService from '@/src/services/ExportImageModeService';
import { Logger } from '@/src/services/Logger';
import * as BackupHistoryService from '@/src/services/backup/BackupHistoryService';
import * as BackupService from '@/src/services/backup/BackupService';
import { BackupRestoreError } from '@/src/services/backup/BackupRestoreError';
import type { BackupManifest, RestoreProgressEvent } from '@/src/services/backup/BackupTypes';
import { clearPrintEnhanceImageCache } from '@/src/services/export/PrintEnhanceCacheService';
import type { ReviewReminderSettings } from '@/src/services/ReviewReminderService';
import * as ReviewReminderService from '@/src/services/ReviewReminderService';
import { loadSettingsStats, type SettingsStats } from '@/src/services/SettingsStatsService';
import { cleanupOrphanImageFiles, scanOrphanImageFiles } from '@/src/services/StorageMaintenanceService';
import * as TodayWorksheetExportService from '@/src/services/TodayWorksheetExportService';
import { colors, layout, radius, shadows, spacing, typography } from '@/src/styles/tokens';
import {
  DEFAULT_PRINT_ENHANCE_CONCURRENCY,
  DEFAULT_PRINT_ENHANCE_PERFORMANCE_PROFILE,
  DEFAULT_CLEAR_PRINT_STRENGTH,
  toActivePrintEnhanceConcurrency,
  toActivePrintEnhancePerformanceProfile,
  type PrintEnhanceConcurrency,
  type PrintEnhancePerformanceProfile,
  type PrintEnhanceClearPrintStrength,
  type PrintEnhanceMode,
} from '@/src/utils/image/printEnhanceConfig';

const PAGE_SCOPE = 'SettingsScreen';
const TOAST_DURATION_DEFAULT = 1800;
const TOAST_DURATION_LONG = 2800;
const DEV_UNLOCK_TAP_TARGET = 7;
const DEV_TAP_WINDOW_MS = 3000;
const DEV_UNLOCK_HINT_FIRST = DEV_UNLOCK_TAP_TARGET - 2;
const DEV_UNLOCK_HINT_SECOND = DEV_UNLOCK_TAP_TARGET - 1;
const STATS_PLACEHOLDER = '--';
const EMPTY_BACKUP_COUNTS: BackupManifest['counts'] = {
  mistakes: 0,
  mistakeImages: 0,
  reviewRecords: 0,
  imageFiles: 0,
};

type ToastType = 'success' | 'info' | 'warning' | 'error';

type DevRoute = '/dev/db' | '/dev/images' | '/dev/logs';

type DevEntry = {
  title: string;
  description: string;
  href: DevRoute;
};

type ExportImageModeOption = {
  mode: PrintEnhanceMode;
  title: string;
  description: string;
  recommended?: boolean;
};

type ClearPrintStrengthOption = {
  value: PrintEnhanceClearPrintStrength;
  title: string;
  description: string;
};

type EnhanceConcurrencyOption = {
  value: PrintEnhanceConcurrency;
  title: string;
  description: string;
  recommended?: boolean;
};

type EnhancePerformanceOption = {
  value: PrintEnhancePerformanceProfile;
  title: string;
  description: string;
  recommended?: boolean;
};

const DEFAULT_DATA_OVERVIEW_STATS: SettingsStats = {
  totalMistakes: 0,
  dueToday: 0,
  mastered: 0,
  totalReviews: 0,
  imageCount: 0,
  storageBytes: null,
  updatedAt: 0,
};

const DEFAULT_REMINDER_SETTINGS: ReviewReminderSettings = {
  enabled: false,
  hour: 20,
  minute: 0,
  notificationId: null,
  scheduledDate: null,
  lastReminderDate: null,
  updatedAt: new Date(0).toISOString(),
};

const DEFAULT_EXPORT_IMAGE_MODE: PrintEnhanceMode = 'clear_print';
const DEFAULT_EXPORT_CLEAR_PRINT_STRENGTH: PrintEnhanceClearPrintStrength = DEFAULT_CLEAR_PRINT_STRENGTH;
const DEFAULT_EXPORT_ENHANCE_CONCURRENCY: PrintEnhanceConcurrency = DEFAULT_PRINT_ENHANCE_CONCURRENCY;
const DEFAULT_EXPORT_ENHANCE_PERFORMANCE_PROFILE: PrintEnhancePerformanceProfile =
  DEFAULT_PRINT_ENHANCE_PERFORMANCE_PROFILE;

const EXPORT_IMAGE_MODE_OPTIONS: ExportImageModeOption[] = [
  {
    mode: 'original',
    title: '原图',
    description: '不处理图片，保留拍摄效果。',
  },
  {
    mode: 'clear_print',
    title: '清晰打印，推荐',
    description: '增强白底和文字清晰度，尽量保留公式、细线和浅色笔迹。',
    recommended: true,
  },
];

const CLEAR_PRINT_STRENGTH_BASE_OPTIONS: ClearPrintStrengthOption[] = [
  {
    value: 'weak',
    title: '弱',
    description: '保留更多浅色细节，白底力度较柔和',
  },
  {
    value: 'medium',
    title: '中',
    description: '白底与细节平衡，适合大多数题目',
  },
  {
    value: 'strong',
    title: '强',
    description: '更接近扫描件白底黑字，浅色细节损失更多',
  },
];

const CLEAR_PRINT_STRENGTH_OPTIONS: ClearPrintStrengthOption[] = CLEAR_PRINT_STRENGTH_BASE_OPTIONS.map((option) => {
  if (option.value === 'weak') {
    return {
      ...option,
      title: '弱',
      description: '轻增强：更保留灰度细节，文字加深较温和',
    };
  }
  if (option.value === 'strong') {
    return {
      ...option,
      title: '强',
      description: '强增强：优先让文字更黑更锐利，浅色笔迹可能变淡',
    };
  }
  return {
    ...option,
    title: '中',
    description: '平衡增强：白底与文字清晰度兼顾，适合大多数题目',
  };
});

const ENHANCE_CONCURRENCY_OPTIONS: EnhanceConcurrencyOption[] = [
  {
    value: 1,
    title: '1（稳定）',
    description: '最稳，内存压力最低。',
  },
  {
    value: 2,
    title: '2（推荐）',
    description: '通常更快，稳定性与速度平衡。',
    recommended: true,
  },
  {
    value: 3,
    title: '3（更快）',
    description: '速度更快，但更占内存与性能。',
  },
];

const ENHANCE_PERFORMANCE_OPTIONS: EnhancePerformanceOption[] = [
  {
    value: 'balanced',
    title: '平衡',
    description: '优先保持清晰度，耗时相对更高。',
  },
  {
    value: 'speed_first',
    title: '速度优先',
    description: '降低增强参数，通常能明显缩短导出时间。',
    recommended: true,
  },
];

const DEV_ENTRIES: DevEntry[] = [
  {
    title: '数据库调试',
    description: '查看 SQLite 状态、最近错题、复做记录和数据一致性。',
    href: '/dev/db',
  },
  {
    title: '图片调试',
    description: '测试拍照、图片持久化、图片删除和文件存在性。',
    href: '/dev/images',
  },
  {
    title: '运行日志',
    description: '查看 App 运行时日志，便于问题排查。',
    href: '/dev/logs',
  },
];

function getToastBackgroundColor(type: ToastType): string {
  if (type === 'success') {
    return '#138a3f';
  }
  if (type === 'warning') {
    return '#b45309';
  }
  if (type === 'error') {
    return '#b42318';
  }
  return '#222222';
}

function formatClock(date: Date | null): string {
  if (!date) {
    return '--:--';
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatStorageSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '暂未统计';
  }

  if (bytes < 1024) {
    return `${Math.floor(bytes)} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatReminderTime(hour: number, minute: number): string {
  const safeHour = Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.floor(hour))) : 20;
  const safeMinute = Number.isFinite(minute) ? Math.max(0, Math.min(59, Math.floor(minute))) : 0;
  return `${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}`;
}

function formatReminderScheduleDateLabel(isoDateTime: string | null | undefined): string | null {
  if (typeof isoDateTime !== 'string' || !isoDateTime.trim()) {
    return null;
  }

  const scheduledDate = new Date(isoDateTime);
  if (Number.isNaN(scheduledDate.getTime())) {
    return null;
  }

  const timeText = formatReminderTime(scheduledDate.getHours(), scheduledDate.getMinutes());
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const startScheduled = new Date(
    scheduledDate.getFullYear(),
    scheduledDate.getMonth(),
    scheduledDate.getDate(),
    0,
    0,
    0,
    0,
  );
  const dayDiff = Math.floor((startScheduled.getTime() - startToday.getTime()) / (24 * 60 * 60 * 1000));

  if (dayDiff === 0) {
    return `今天 ${timeText}`;
  }
  if (dayDiff === 1) {
    return `明天 ${timeText}`;
  }

  const yearPrefix =
    scheduledDate.getFullYear() !== now.getFullYear() ? `${scheduledDate.getFullYear()}年` : '';
  return `${yearPrefix}${scheduledDate.getMonth() + 1}月${scheduledDate.getDate()}日 ${timeText}`;
}

function buildOperationSessionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0')}`;
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
  ).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function toBackupFileShortInfo(name: string | null | undefined): string {
  if (!name || !name.trim()) {
    return 'unknown.qsbk';
  }
  const trimmed = name.trim();
  return trimmed.length <= 48 ? trimmed : `${trimmed.slice(0, 24)}...${trimmed.slice(-18)}`;
}

type RestoreWarningLogItem = {
  code?: string;
  stage?: string;
  message?: string;
  shortTarget?: string;
  detail?: string;
};

type RestoreErrorLogItem = {
  code?: string;
  stage?: string;
  message?: string;
  shortTarget?: string;
  rootCauseMessage?: string;
};

function getUriScheme(uri: string | null | undefined): string {
  if (typeof uri !== 'string') {
    return 'unknown';
  }
  const matched = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  return matched ? matched[1].toLowerCase() : 'unknown';
}

function getFileExtension(fileName: string | null | undefined): string | null {
  if (typeof fileName !== 'string') {
    return null;
  }
  const matched = fileName.trim().match(/\.([a-zA-Z0-9]{1,16})$/);
  return matched ? matched[1].toLowerCase() : null;
}

function toBackupRestoreDetails(error: unknown): Record<string, unknown> {
  if (error instanceof BackupRestoreError && error.details && typeof error.details === 'object') {
    return error.details;
  }
  if (error && typeof error === 'object' && 'details' in error) {
    const candidate = (error as { details?: unknown }).details;
    if (candidate && typeof candidate === 'object') {
      return candidate as Record<string, unknown>;
    }
  }
  return {};
}

function toRestoreProgressToastMessage(event: RestoreProgressEvent): string {
  switch (event.stage) {
    case 'starting':
      return '正在准备恢复环境…';
    case 'temp_copy':
      return '正在复制备份文件…';
    case 'package_read':
      return '正在读取备份包…';
    case 'validate':
      return '正在校验备份数据…';
    case 'before_snapshot':
      return '正在创建安全备份…';
    case 'images_restore':
      return '正在恢复图片文件…';
    case 'db_import':
      return '正在写入数据库…';
    case 'verify':
      return '正在校验恢复结果…';
    case 'rollback':
      return event.message.trim().length > 0 ? event.message : '恢复失败，正在回滚…';
    case 'success':
      return '恢复完成';
    default:
      return '正在恢复数据…';
  }
}

function buildRestorePreviewMessage(manifest: BackupManifest, warnings: string[]): string {
  const lines = [
    `备份时间：${formatBackupCreatedAt(manifest.createdAt)}`,
    `App 版本：${manifest.appVersion}`,
    `错题数量：${manifest.counts.mistakes}`,
    `图片数量：${manifest.counts.mistakeImages}`,
    `复做记录数量：${manifest.counts.reviewRecords}`,
  ];

  if (warnings.length > 0) {
    lines.push('该备份存在部分图片缺失记录');
  }

  return lines.join('\n');
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [isDevModeUnlocked, setIsDevModeUnlocked] = useState(false);
  const [dataOverview, setDataOverview] = useState<SettingsStats>(DEFAULT_DATA_OVERVIEW_STATS);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);
  const [isOverviewRefreshing, setIsOverviewRefreshing] = useState(false);
  const [overviewErrorMessage, setOverviewErrorMessage] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [exportImageMode, setExportImageMode] = useState<PrintEnhanceMode>(DEFAULT_EXPORT_IMAGE_MODE);
  const [exportClearPrintStrength, setExportClearPrintStrength] =
    useState<PrintEnhanceClearPrintStrength>(DEFAULT_EXPORT_CLEAR_PRINT_STRENGTH);
  const [exportEnhanceConcurrency, setExportEnhanceConcurrency] =
    useState<PrintEnhanceConcurrency>(DEFAULT_EXPORT_ENHANCE_CONCURRENCY);
  const [exportEnhancePerformanceProfile, setExportEnhancePerformanceProfile] =
    useState<PrintEnhancePerformanceProfile>(DEFAULT_EXPORT_ENHANCE_PERFORMANCE_PROFILE);
  const [isPrintEnhanceAdvancedVisible, setIsPrintEnhanceAdvancedVisible] = useState(false);
  const [isExportImageModeLoading, setIsExportImageModeLoading] = useState(true);
  const [isExportImageModeSaving, setIsExportImageModeSaving] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [isInspectingBackup, setIsInspectingBackup] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isScanningOrphanImages, setIsScanningOrphanImages] = useState(false);
  const [isCleaningOrphanImages, setIsCleaningOrphanImages] = useState(false);
  const [isClearingPrintEnhanceCache, setIsClearingPrintEnhanceCache] = useState(false);
  const [reminderSettings, setReminderSettings] =
    useState<ReviewReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [isReminderLoading, setIsReminderLoading] = useState(true);
  const [isReminderSwitchBusy, setIsReminderSwitchBusy] = useState(false);
  const [isReminderTimeBusy, setIsReminderTimeBusy] = useState(false);
  const [isReminderPermissionGranted, setIsReminderPermissionGranted] = useState(false);
  const [showReminderPermissionHint, setShowReminderPermissionHint] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);

  const hasFocusedRef = useRef(false);
  const lastTapAtRef = useRef<number | null>(null);
  const tapCountRef = useRef(0);
  const skipNextVersionPressRef = useRef(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastBottomOffset = Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateY, {
        toValue: 8,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToastVisible(false);
    });
  }, [toastOpacity, toastTranslateY]);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration = TOAST_DURATION_DEFAULT) => {
      const normalized = message.trim();
      if (!normalized) {
        return;
      }

      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }

      setToastMessage(normalized);
      setToastType(type);
      setToastVisible(true);
      toastOpacity.setValue(0);
      toastTranslateY.setValue(8);

      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: 0,
          duration: 160,
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

  const worksheetPendingCount = Math.max(0, Math.floor(dataOverview.dueToday));
  const {
    isExporting: isExportingWorksheet,
    exportStage: worksheetExportStage,
    progress: worksheetExportProgress,
    progressPercent: worksheetExportProgressPercent,
    exportTodayWorksheet: exportTodayWorksheetShared,
  } = useTodayWorksheetExport({
    scope: PAGE_SCOPE,
    dueToday: worksheetPendingCount,
    longToastDurationMs: TOAST_DURATION_LONG,
    printEnhanceMode: exportImageMode,
    printEnhanceClearPrintStrength: exportClearPrintStrength,
    printEnhanceConcurrency: exportEnhanceConcurrency,
    printEnhancePerformanceProfile: exportEnhancePerformanceProfile,
    showToast,
    onSuccess: (pdfUri: string) => {
      Logger.info(PAGE_SCOPE, 'navigate_to_pdf_preview', {
        pdfUri,
      });
      router.push({
        pathname: '/pdf-preview',
        params: {
          pdfUri,
        },
      } as never);
    },
  });

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      const enabled = await loadDeveloperModeEnabled();
      if (isMounted) {
        setIsDevModeUnlocked(enabled);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const loadReminderState = useCallback(async () => {
    Logger.info(PAGE_SCOPE, 'Start loading reminder settings.');
    setIsReminderLoading(true);
    try {
      const [settings, hasPermission] = await Promise.all([
        ReviewReminderService.getSettings(),
        ReviewReminderService.checkPermission(),
      ]);
      setReminderSettings(settings);
      setIsReminderPermissionGranted(hasPermission);
      setShowReminderPermissionHint(settings.enabled && !hasPermission);
      Logger.info(PAGE_SCOPE, 'Loaded reminder settings successfully.', {
        enabled: settings.enabled,
        hour: settings.hour,
        minute: settings.minute,
        hasPermission,
      });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to load reminder settings.', { error });
      showToast('提醒设置读取失败，请稍后重试', 'warning');
    } finally {
      setIsReminderLoading(false);
    }
  }, [showToast]);

  const loadLastBackupState = useCallback(async () => {
    const history = await BackupHistoryService.loadBackupHistoryState();
    setLastBackupAt(history.lastBackupAt);
  }, []);

  const loadExportImageMode = useCallback(async () => {
    Logger.info(PAGE_SCOPE, 'Start loading export image mode.');
    setIsExportImageModeLoading(true);
    try {
      const settings = await ExportImageModeService.loadExportImageSettings();
      setExportImageMode(settings.mode);
      setExportClearPrintStrength(settings.clearPrintStrength);
      setExportEnhanceConcurrency(settings.enhanceConcurrency);
      setExportEnhancePerformanceProfile(settings.performanceProfile);
      Logger.info(PAGE_SCOPE, 'Loaded export image mode successfully.', {
        mode: settings.mode,
        clearPrintStrength: settings.clearPrintStrength,
        enhanceConcurrency: settings.enhanceConcurrency,
        performanceProfile: settings.performanceProfile,
      });
    } catch (error) {
      Logger.warn(PAGE_SCOPE, 'Failed to load export image mode, fallback to default.', { error });
      setExportImageMode(DEFAULT_EXPORT_IMAGE_MODE);
      setExportClearPrintStrength(DEFAULT_EXPORT_CLEAR_PRINT_STRENGTH);
      setExportEnhanceConcurrency(DEFAULT_EXPORT_ENHANCE_CONCURRENCY);
      setExportEnhancePerformanceProfile(DEFAULT_EXPORT_ENHANCE_PERFORMANCE_PROFILE);
    } finally {
      setIsExportImageModeLoading(false);
    }
  }, []);

  const loadDataOverview = useCallback(async (mode: 'initial' | 'refresh') => {
    const startedAt = Date.now();
    Logger.info(PAGE_SCOPE, 'Start loading settings statistics.', { mode });

    if (mode === 'initial') {
      setIsOverviewLoading(true);
    } else {
      setIsOverviewRefreshing(true);
    }

    try {
      const stats = await loadSettingsStats();
      setDataOverview(stats);
      setLastUpdatedAt(new Date(stats.updatedAt));
      setOverviewErrorMessage(null);
      Logger.info(PAGE_SCOPE, 'Loaded settings statistics successfully.', {
        mode,
        elapsedMs: Date.now() - startedAt,
        totalMistakes: stats.totalMistakes,
        dueToday: stats.dueToday,
        mastered: stats.mastered,
        totalReviews: stats.totalReviews,
        imageCount: stats.imageCount,
      });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to load settings data overview.', { error });
      setOverviewErrorMessage('本机学习数据读取失败');
      showToast('数据统计失败，请稍后重试', 'warning');
      Logger.warn(PAGE_SCOPE, 'Loading settings statistics failed.', {
        mode,
        elapsedMs: Date.now() - startedAt,
      });
    } finally {
      setIsOverviewLoading(false);
      setIsOverviewRefreshing(false);
    }
  }, [showToast]);

  useFocusEffect(
    useCallback(() => {
      const mode: 'initial' | 'refresh' = hasFocusedRef.current ? 'refresh' : 'initial';
      hasFocusedRef.current = true;
      setIsPrintEnhanceAdvancedVisible(false);
      void loadDataOverview(mode);
      void loadReminderState();
      void loadLastBackupState();
      void loadExportImageMode();
      return undefined;
    }, [loadDataOverview, loadExportImageMode, loadLastBackupState, loadReminderState]),
  );

  const disableDeveloperMode = useCallback(
    (options?: { showDisabledToast?: boolean; source?: 'confirm' | 'long_press' }) => {
      const showDisabledToast = options?.showDisabledToast ?? false;
      const source = options?.source ?? 'confirm';

      Logger.info(PAGE_SCOPE, 'Start disabling developer mode.', { source });
      tapCountRef.current = 0;
      lastTapAtRef.current = null;
      setIsDevModeUnlocked(false);

      void saveDeveloperModeEnabled(false).catch((error) => {
        Logger.error(PAGE_SCOPE, 'Failed to persist developer mode disabled state.', {
          error,
        });
        showToast('开发者模式状态保存失败，请稍后重试', 'warning');
      });

      Logger.info(PAGE_SCOPE, 'Developer mode disabled in settings page state.', { source });

      if (showDisabledToast) {
        showToast('开发者模式已关闭', 'info');
      }
    },
    [showToast],
  );

  const handleVersionTap = useCallback(() => {
    if (skipNextVersionPressRef.current) {
      skipNextVersionPressRef.current = false;
      return;
    }

    if (isDevModeUnlocked) {
      return;
    }

    const now = Date.now();
    const shouldReset =
      lastTapAtRef.current !== null && now - lastTapAtRef.current > DEV_TAP_WINDOW_MS;
    const baseCount = shouldReset ? 0 : tapCountRef.current;
    const nextCount = baseCount + 1;

    lastTapAtRef.current = now;
    tapCountRef.current = nextCount;

    if (nextCount >= DEV_UNLOCK_TAP_TARGET) {
      tapCountRef.current = 0;
      setIsDevModeUnlocked(true);
      Logger.info(PAGE_SCOPE, 'Developer mode unlocked from version taps.', {
        tapCount: nextCount,
      });
      void saveDeveloperModeEnabled(true).catch((error) => {
        Logger.error(PAGE_SCOPE, 'Failed to persist developer mode enabled state.', { error });
      });
      showToast('开发者模式已开启', 'success');
      return;
    }

    if (nextCount === DEV_UNLOCK_HINT_FIRST) {
      showToast('再点 2 次开启开发者模式', 'info');
      return;
    }

    if (nextCount === DEV_UNLOCK_HINT_SECOND) {
      showToast('再点 1 次开启开发者模式', 'info');
    }
  }, [isDevModeUnlocked, showToast]);

  const handleVersionLongPress = useCallback(() => {
    skipNextVersionPressRef.current = true;

    if (isDevModeUnlocked) {
      disableDeveloperMode({ showDisabledToast: true, source: 'long_press' });
      return;
    }

    tapCountRef.current = 0;
    lastTapAtRef.current = null;
    setIsDevModeUnlocked(true);
    Logger.info(PAGE_SCOPE, 'Developer mode unlocked from version long press.');
    void saveDeveloperModeEnabled(true).catch((error) => {
      Logger.error(PAGE_SCOPE, 'Failed to persist developer mode enabled state from long press.', { error });
    });
    showToast('开发者模式已开启', 'success');
  }, [disableDeveloperMode, isDevModeUnlocked, showToast]);

  const handleDisableDeveloperMode = useCallback(() => {
    Alert.alert(
      '关闭开发者模式？',
      '关闭后将隐藏数据库调试、图片调试和运行日志入口。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '关闭',
          style: 'destructive',
          onPress: () => {
            disableDeveloperMode({ showDisabledToast: false, source: 'confirm' });
          },
        },
      ],
    );
  }, [disableDeveloperMode]);

  const handleOpenAboutSupport = useCallback(() => {
    router.push('/about-support' as never);
  }, [router]);

  const startBackupToFile = useCallback(async () => {
    if (isBackingUp) {
      return;
    }

    setIsBackingUp(true);
    Logger.info(PAGE_SCOPE, 'Start backup flow from settings.', { reason: 'manual' });
    try {
      showToast('正在整理备份文件…', 'info', TOAST_DURATION_LONG);
      const result = await BackupService.createBackup({ reason: 'manual' });
      try {
        const persistedHistory = await BackupHistoryService.saveLastBackupAt(result.manifest.createdAt);
        setLastBackupAt(persistedHistory.lastBackupAt);
      } catch (error) {
        Logger.warn(PAGE_SCOPE, 'Failed to persist last backup time in settings.', {
          createdAt: result.manifest.createdAt,
          error,
        });
        setLastBackupAt(result.manifest.createdAt);
      }
      await BackupService.shareBackup(result.fileUri);
      showToast('备份文件已生成，请保存到安全位置。', 'success', TOAST_DURATION_LONG);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error(PAGE_SCOPE, 'Backup flow failed from settings.', {
        errorName,
        errorMessage,
      });
      Alert.alert('备份失败', '请稍后重试。如果仍然失败，请在设置页打开日志查看原因。');
    } finally {
      setIsBackingUp(false);
    }
  }, [isBackingUp, showToast]);

  const handleStartBackup = useCallback(() => {
    if (typeof BackupService.createBackup === 'function') {
      if (isBackingUp) {
        return;
      }

      Alert.alert(
        '备份当前数据？',
        '将导出所有错题、复做记录和图片。备份文件可以保存到微信、网盘或文件管理器中。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '开始备份',
            onPress: () => {
              void startBackupToFile();
            },
          },
        ],
      );
      return;
    }

    Logger.info(PAGE_SCOPE, 'Start backup from settings.', { supported: false });
    try {
      showToast('备份功能即将支持', 'info');
      Logger.info(PAGE_SCOPE, 'Backup action finished with placeholder notice.', {
        supported: false,
      });
      Logger.warn(PAGE_SCOPE, 'Backup is not supported in current version.', {
        reason: 'not_implemented',
      });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Backup action failed unexpectedly.', { error });
      showToast('备份功能暂不可用，请稍后重试', 'warning');
    }
  }, [isBackingUp, showToast, startBackupToFile]);

  const handleConfirmRestore = useCallback(
    async (params: {
      restoreSessionId: string;
      fileShortInfo: string;
      backupUri: string;
      previewWarningCount: number;
    }) => {
      if (isRestoring) {
        return;
      }

      setIsRestoring(true);
      const restoreStartedAt = Date.now();
      let lastProgressStage: RestoreProgressEvent['stage'] | null = null;
      let hasShownRestoreSuccessToast = false;
      showToast('正在恢复数据…', 'info', TOAST_DURATION_LONG);

      try {
        const restoreResult = await BackupService.restoreFromBackup(params.backupUri, {
          restoreSessionId: params.restoreSessionId,
          fileShortInfo: params.fileShortInfo,
          onProgress: (event) => {
            if (event.restoreSessionId !== params.restoreSessionId) {
              return;
            }
            if (event.stage === lastProgressStage) {
              return;
            }
            lastProgressStage = event.stage;
            if (event.stage === 'success') {
              if (hasShownRestoreSuccessToast) {
                return;
              }
              hasShownRestoreSuccessToast = true;
              showToast('恢复完成', 'success', TOAST_DURATION_LONG);
              return;
            }
            showToast(toRestoreProgressToastMessage(event), 'info', TOAST_DURATION_LONG);
          },
        });
        Logger.info(PAGE_SCOPE, 'restore_success', {
          restoreSessionId: params.restoreSessionId,
          fileShortInfo: params.fileShortInfo,
          durationMs: Date.now() - restoreStartedAt,
          counts: {
            mistakes: restoreResult.restoredMistakes,
            mistakeImages: restoreResult.restoredImages,
            reviewRecords: restoreResult.restoredReviewRecords,
            imageFiles: restoreResult.restoredImages,
          },
          voiceNoteCount: restoreResult.voiceNoteCount,
          voiceFileCount: restoreResult.voiceFileCount,
          voiceWarningCount: restoreResult.voiceWarningCount,
          warningCount: restoreResult.warningCount,
          errorCount: restoreResult.errorCount,
          hasBeforeRestoreBackup: restoreResult.hasBeforeRestoreBackup,
          errorName: null,
          errorMessage: null,
        });

        if (!hasShownRestoreSuccessToast) {
          showToast('恢复完成', 'success', TOAST_DURATION_LONG);
          hasShownRestoreSuccessToast = true;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 800);
        });
        void loadDataOverview('refresh');
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        const errorMessage = error instanceof Error ? error.message : String(error);
        const details = toBackupRestoreDetails(error);
        const errorCode =
          typeof details.errorCode === 'string'
            ? details.errorCode
            : error instanceof BackupRestoreError
              ? error.code
              : 'RESTORE_UNKNOWN_FAILED';
        const stage = typeof details.stage === 'string' ? details.stage : 'unknown';
        const step = typeof details.step === 'string' ? details.step : 'unknown';
        const rootCauseMessage =
          typeof details.rootCauseMessage === 'string' ? details.rootCauseMessage : errorMessage;
        const countsParsed =
          details.countsParsed && typeof details.countsParsed === 'object'
            ? (details.countsParsed as BackupManifest['counts'])
            : EMPTY_BACKUP_COUNTS;
        const warningCount =
          typeof details.warningCount === 'number' ? details.warningCount : params.previewWarningCount;
        const firstWarnings = Array.isArray(details.firstWarnings)
          ? (details.firstWarnings as RestoreWarningLogItem[]).slice(0, 5)
          : [];
        const errorCount = typeof details.errorCount === 'number' ? details.errorCount : 1;
        const firstErrors = Array.isArray(details.firstErrors)
          ? (details.firstErrors as RestoreErrorLogItem[]).slice(0, 5)
          : [];
        const rollbackAttempted = Boolean(details.rollbackAttempted);
        const rollbackSuccess = Boolean(details.rollbackSuccess);

        Logger.error(PAGE_SCOPE, 'restore_failed', {
          restoreSessionId: params.restoreSessionId,
          fileShortInfo: params.fileShortInfo,
          durationMs: Date.now() - restoreStartedAt,
          errorCode,
          stage,
          step,
          errorName,
          errorMessageForUser: '恢复失败',
          errorMessage,
          rootCauseMessage,
          countsParsed,
          warningCount,
          firstWarnings,
          errorCount,
          firstErrors,
          rollbackAttempted,
          rollbackSuccess,
        });

        Alert.alert(
          '恢复失败',
          '恢复没有完成。当前数据已尽量保持不变，恢复前的安全备份已保留。你可以稍后重试，或在设置页查看日志。',
        );
      } finally {
        setIsRestoring(false);
      }
    },
    [isRestoring, loadDataOverview, showToast],
  );

  const handleRestoreFromBackup = useCallback(() => {
    if (isInspectingBackup || isRestoring) {
      return;
    }

    const restoreSessionId = buildOperationSessionId('restore');

    const pickAndInspectBackupFile = async () => {
      setIsInspectingBackup(true);
      let fileShortInfo = 'unknown.qsbk';
      const inspectStartedAt = Date.now();

      try {
        const picked = await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          multiple: false,
          type: '*/*',
        });

        if (picked.canceled || !picked.assets || picked.assets.length <= 0) {
          Logger.info(PAGE_SCOPE, 'restore_pick_file', {
            restoreSessionId,
            fileShortInfo,
            durationMs: Date.now() - inspectStartedAt,
            counts: EMPTY_BACKUP_COUNTS,
            warningCount: 0,
            errorName: null,
            errorMessage: null,
          });
          showToast('已取消选择备份文件', 'info');
          return;
        }

        const selectedAsset = picked.assets[0];
        fileShortInfo = toBackupFileShortInfo(selectedAsset.name);
        Logger.info(PAGE_SCOPE, 'restore_file_selected', {
          restoreSessionId,
          fileShortInfo,
          uriScheme: getUriScheme(selectedAsset.uri),
          fileName: selectedAsset.name ?? 'unknown.qsbk',
          extension: getFileExtension(selectedAsset.name),
          mimeType: selectedAsset.mimeType ?? null,
          fileSizeBytes: typeof selectedAsset.size === 'number' ? selectedAsset.size : null,
          startedAt: formatBackupCreatedAt(new Date(inspectStartedAt).toISOString()),
        });
        Logger.info(PAGE_SCOPE, 'restore_pick_file', {
          restoreSessionId,
          fileShortInfo,
          durationMs: Date.now() - inspectStartedAt,
          counts: EMPTY_BACKUP_COUNTS,
          warningCount: 0,
          errorName: null,
          errorMessage: null,
        });

        Logger.info(PAGE_SCOPE, 'restore_inspect_start', {
          restoreSessionId,
          fileShortInfo,
          durationMs: Date.now() - inspectStartedAt,
          counts: EMPTY_BACKUP_COUNTS,
          warningCount: 0,
          errorName: null,
          errorMessage: null,
        });

        const inspected = await BackupService.inspectBackup(selectedAsset.uri, {
          restoreSessionId,
          fileShortInfo,
        });
        Logger.info(PAGE_SCOPE, 'restore_inspect_done', {
          restoreSessionId,
          fileShortInfo,
          durationMs: Date.now() - inspectStartedAt,
          counts: inspected.manifest.counts,
          warningCount: inspected.warnings.length,
          errorName: null,
          errorMessage: null,
        });

        Alert.alert(
          '确认恢复这个备份？',
          buildRestorePreviewMessage(inspected.manifest, inspected.warnings),
          [
            { text: '取消', style: 'cancel' },
            {
              text: '确认恢复',
              style: 'destructive',
              onPress: () => {
                void handleConfirmRestore({
                  restoreSessionId,
                  fileShortInfo,
                  backupUri: selectedAsset.uri,
                  previewWarningCount: inspected.warnings.length,
                });
              },
            },
          ],
        );
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        const errorMessage =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : '备份文件已损坏';

        Logger.error(PAGE_SCOPE, 'restore_inspect_failed', {
          restoreSessionId,
          fileShortInfo,
          durationMs: Date.now() - inspectStartedAt,
          counts: EMPTY_BACKUP_COUNTS,
          warningCount: 0,
          errorName,
          errorMessage,
        });

        Alert.alert('无法读取备份文件', errorMessage);
      } finally {
        setIsInspectingBackup(false);
      }
    };

    Alert.alert(
      '从备份恢复数据？',
      '恢复会先备份当前数据，再用备份文件中的数据替换当前数据。恢复过程中请不要关闭 App。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '选择备份文件',
          onPress: () => {
            void pickAndInspectBackupFile();
          },
        },
      ],
    );
  }, [handleConfirmRestore, isInspectingBackup, isRestoring, showToast]);

  const handleSelectExportImageMode = useCallback(
    async (nextMode: PrintEnhanceMode) => {
      if (isExportingWorksheet || isExportImageModeLoading || isExportImageModeSaving) {
        return;
      }

      if (nextMode === exportImageMode) {
        return;
      }

      setIsExportImageModeSaving(true);
      Logger.info(PAGE_SCOPE, 'Start saving export image mode.', {
        nextMode,
        previousMode: exportImageMode,
        clearPrintStrength: exportClearPrintStrength,
        enhanceConcurrency: exportEnhanceConcurrency,
        performanceProfile: exportEnhancePerformanceProfile,
      });
      try {
        const savedSettings = await ExportImageModeService.saveExportImageSettings(
          nextMode,
          exportClearPrintStrength,
          exportEnhanceConcurrency,
          exportEnhancePerformanceProfile,
        );
        setExportImageMode(savedSettings.mode);
        setExportClearPrintStrength(savedSettings.clearPrintStrength);
        setExportEnhanceConcurrency(savedSettings.enhanceConcurrency);
        setExportEnhancePerformanceProfile(savedSettings.performanceProfile);
        Logger.info(PAGE_SCOPE, 'Saved export image mode successfully.', {
          savedMode: savedSettings.mode,
          clearPrintStrength: savedSettings.clearPrintStrength,
          enhanceConcurrency: savedSettings.enhanceConcurrency,
          performanceProfile: savedSettings.performanceProfile,
        });
        showToast('导出图片模式已更新', 'success');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to save export image mode.', {
          nextMode,
          previousMode: exportImageMode,
          clearPrintStrength: exportClearPrintStrength,
          enhanceConcurrency: exportEnhanceConcurrency,
          performanceProfile: exportEnhancePerformanceProfile,
          error,
        });
        showToast('导出图片模式保存失败，请稍后重试', 'warning', TOAST_DURATION_LONG);
      } finally {
        setIsExportImageModeSaving(false);
      }
    },
    [
      exportClearPrintStrength,
      exportEnhanceConcurrency,
      exportEnhancePerformanceProfile,
      exportImageMode,
      isExportImageModeLoading,
      isExportImageModeSaving,
      isExportingWorksheet,
      showToast,
    ],
  );

  const handleTogglePrintEnhanceAdvancedSettings = useCallback(() => {
    setIsPrintEnhanceAdvancedVisible((previous) => {
      const next = !previous;
      Logger.info(PAGE_SCOPE, 'Toggle clear_print advanced settings from long press.', {
        nextVisible: next,
      });
      return next;
    });
  }, []);

  const handleSelectClearPrintStrength = useCallback(
    async (nextStrength: PrintEnhanceClearPrintStrength) => {
      if (isExportingWorksheet || isExportImageModeLoading || isExportImageModeSaving || exportImageMode !== 'clear_print') {
        return;
      }

      if (nextStrength === exportClearPrintStrength) {
        return;
      }

      setIsExportImageModeSaving(true);
      Logger.info(PAGE_SCOPE, 'Start saving clear_print strength.', {
        mode: exportImageMode,
        previousClearPrintStrength: exportClearPrintStrength,
        nextClearPrintStrength: nextStrength,
        enhanceConcurrency: exportEnhanceConcurrency,
        performanceProfile: exportEnhancePerformanceProfile,
      });
      try {
        const savedSettings = await ExportImageModeService.saveExportImageSettings(
          exportImageMode,
          nextStrength,
          exportEnhanceConcurrency,
          exportEnhancePerformanceProfile,
        );
        setExportImageMode(savedSettings.mode);
        setExportClearPrintStrength(savedSettings.clearPrintStrength);
        setExportEnhanceConcurrency(savedSettings.enhanceConcurrency);
        setExportEnhancePerformanceProfile(savedSettings.performanceProfile);
        Logger.info(PAGE_SCOPE, 'Saved clear_print strength successfully.', {
          mode: savedSettings.mode,
          clearPrintStrength: savedSettings.clearPrintStrength,
          enhanceConcurrency: savedSettings.enhanceConcurrency,
          performanceProfile: savedSettings.performanceProfile,
        });
        showToast('清晰打印强度已更新', 'success');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to save clear_print strength.', {
          mode: exportImageMode,
          previousClearPrintStrength: exportClearPrintStrength,
          nextClearPrintStrength: nextStrength,
          enhanceConcurrency: exportEnhanceConcurrency,
          performanceProfile: exportEnhancePerformanceProfile,
          error,
        });
        showToast('清晰打印强度保存失败，请稍后重试', 'warning', TOAST_DURATION_LONG);
      } finally {
        setIsExportImageModeSaving(false);
      }
    },
    [
      exportClearPrintStrength,
      exportEnhanceConcurrency,
      exportEnhancePerformanceProfile,
      exportImageMode,
      isExportImageModeLoading,
      isExportImageModeSaving,
      isExportingWorksheet,
      showToast,
    ],
  );

  const handleSelectEnhanceConcurrency = useCallback(
    async (nextConcurrency: PrintEnhanceConcurrency) => {
      if (isExportingWorksheet || isExportImageModeLoading || isExportImageModeSaving) {
        return;
      }

      const normalizedNext = toActivePrintEnhanceConcurrency(nextConcurrency);
      if (normalizedNext === exportEnhanceConcurrency) {
        return;
      }

      setIsExportImageModeSaving(true);
      Logger.info(PAGE_SCOPE, 'Start saving print enhance concurrency.', {
        mode: exportImageMode,
        clearPrintStrength: exportClearPrintStrength,
        performanceProfile: exportEnhancePerformanceProfile,
        previousEnhanceConcurrency: exportEnhanceConcurrency,
        nextEnhanceConcurrency: normalizedNext,
      });

      try {
        const savedSettings = await ExportImageModeService.saveExportImageSettings(
          exportImageMode,
          exportClearPrintStrength,
          normalizedNext,
          exportEnhancePerformanceProfile,
        );
        setExportImageMode(savedSettings.mode);
        setExportClearPrintStrength(savedSettings.clearPrintStrength);
        setExportEnhanceConcurrency(savedSettings.enhanceConcurrency);
        setExportEnhancePerformanceProfile(savedSettings.performanceProfile);
        Logger.info(PAGE_SCOPE, 'Saved print enhance concurrency successfully.', {
          mode: savedSettings.mode,
          clearPrintStrength: savedSettings.clearPrintStrength,
          enhanceConcurrency: savedSettings.enhanceConcurrency,
          performanceProfile: savedSettings.performanceProfile,
        });
        showToast('导出并发数量已更新', 'success');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to save print enhance concurrency.', {
          mode: exportImageMode,
          clearPrintStrength: exportClearPrintStrength,
          performanceProfile: exportEnhancePerformanceProfile,
          previousEnhanceConcurrency: exportEnhanceConcurrency,
          nextEnhanceConcurrency: normalizedNext,
          error,
        });
        showToast('导出并发数量保存失败，请稍后重试', 'warning', TOAST_DURATION_LONG);
      } finally {
        setIsExportImageModeSaving(false);
      }
    },
    [
      exportClearPrintStrength,
      exportEnhanceConcurrency,
      exportEnhancePerformanceProfile,
      exportImageMode,
      isExportImageModeLoading,
      isExportImageModeSaving,
      isExportingWorksheet,
      showToast,
    ],
  );

  const handleSelectEnhancePerformanceProfile = useCallback(
    async (nextProfile: PrintEnhancePerformanceProfile) => {
      if (isExportingWorksheet || isExportImageModeLoading || isExportImageModeSaving) {
        return;
      }

      const normalizedNext = toActivePrintEnhancePerformanceProfile(nextProfile);
      if (normalizedNext === exportEnhancePerformanceProfile) {
        return;
      }

      setIsExportImageModeSaving(true);
      Logger.info(PAGE_SCOPE, 'Start saving print enhance performance profile.', {
        mode: exportImageMode,
        clearPrintStrength: exportClearPrintStrength,
        enhanceConcurrency: exportEnhanceConcurrency,
        previousPerformanceProfile: exportEnhancePerformanceProfile,
        nextPerformanceProfile: normalizedNext,
      });

      try {
        const savedSettings = await ExportImageModeService.saveExportImageSettings(
          exportImageMode,
          exportClearPrintStrength,
          exportEnhanceConcurrency,
          normalizedNext,
        );
        setExportImageMode(savedSettings.mode);
        setExportClearPrintStrength(savedSettings.clearPrintStrength);
        setExportEnhanceConcurrency(savedSettings.enhanceConcurrency);
        setExportEnhancePerformanceProfile(savedSettings.performanceProfile);
        Logger.info(PAGE_SCOPE, 'Saved print enhance performance profile successfully.', {
          mode: savedSettings.mode,
          clearPrintStrength: savedSettings.clearPrintStrength,
          enhanceConcurrency: savedSettings.enhanceConcurrency,
          performanceProfile: savedSettings.performanceProfile,
        });
        showToast('增强策略已更新', 'success');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to save print enhance performance profile.', {
          mode: exportImageMode,
          clearPrintStrength: exportClearPrintStrength,
          enhanceConcurrency: exportEnhanceConcurrency,
          previousPerformanceProfile: exportEnhancePerformanceProfile,
          nextPerformanceProfile: normalizedNext,
          error,
        });
        showToast('增强策略保存失败，请稍后重试', 'warning', TOAST_DURATION_LONG);
      } finally {
        setIsExportImageModeSaving(false);
      }
    },
    [
      exportClearPrintStrength,
      exportEnhanceConcurrency,
      exportEnhancePerformanceProfile,
      exportImageMode,
      isExportImageModeLoading,
      isExportImageModeSaving,
      isExportingWorksheet,
      showToast,
    ],
  );

  /* const handleExportTodayWorksheet = useCallback(async () => {
    if (isExportingWorksheet) {
      return;
    }

    if (Number.isFinite(dataOverview.dueToday)) {
      const dueToday = Math.max(0, Math.floor(dataOverview.dueToday));
      if (dueToday <= 0) {
        Logger.info(PAGE_SCOPE, 'export_today_practice_pdf_empty', {
          dueToday,
        });
        showToast('今天暂无需要复做的错题', 'info');
        return;
      }

      const startedAt = Date.now();
      setIsExportingWorksheet(true);
      setWorksheetExportStage('preparing');
      Logger.info(PAGE_SCOPE, 'export_today_practice_pdf_start', {
        dueToday,
        printEnhanceMode: exportImageMode,
        printEnhanceClearPrintStrength: exportClearPrintStrength,
      });

      try {
        const result = await TodayWorksheetExportService.exportTodayWorksheet({
          expectedPendingCount: dueToday,
          printEnhanceMode: exportImageMode,
          printEnhanceClearPrintStrength: exportClearPrintStrength,
          onProgress: (progress) => {
            setWorksheetExportStage(progress.stage);
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
          return;
        }

        if (result.outcome === 'busy') {
          Logger.info(PAGE_SCOPE, 'Export skipped because another export flow is still in progress.', {
            dueToday,
          });
          showToast(result.message, 'info', TOAST_DURATION_LONG);
          return;
        }

        Logger.warn(PAGE_SCOPE, 'Today worksheet export failed from settings.', {
          outcome: result.outcome,
          dueToday,
        });
        showToast(result.message, 'error', TOAST_DURATION_LONG);
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to export worksheet from settings.', { error });
        showToast('导出失败，请稍后重试', 'error', TOAST_DURATION_LONG);
      } finally {
        setIsExportingWorksheet(false);
        setWorksheetExportStage(null);
      }
      return;
    }

    if (dataOverview.dueToday <= 0) {
      showToast('今天没有待复做错题可导出', 'info');
      return;
    }

    setIsExportingWorksheet(true);
    setWorksheetExportStage('preparing');
    Logger.info(PAGE_SCOPE, 'Start exporting today worksheet from settings.', {
      dueToday: dataOverview.dueToday,
      printEnhanceMode: exportImageMode,
      printEnhanceClearPrintStrength: exportClearPrintStrength,
    });
    try {
      const result = await TodayWorksheetExportService.exportTodayWorksheet({
        expectedPendingCount: dataOverview.dueToday,
        printEnhanceMode: exportImageMode,
        printEnhanceClearPrintStrength: exportClearPrintStrength,
        onProgress: (progress) => {
          setWorksheetExportStage(progress.stage);
        },
      });
      if (result.outcome === 'success') {
        Logger.info(PAGE_SCOPE, 'Exported today worksheet successfully from settings.', {
          outcome: result.outcome,
          exportedCount: result.exportedCount,
        });
        showToast(result.message, 'success');
        return;
      }

      if (result.outcome === 'empty') {
        Logger.info(PAGE_SCOPE, 'Export skipped because no due mistakes for today.', {
          outcome: result.outcome,
        });
        showToast(result.message, 'info');
        return;
      }

      if (result.outcome === 'share_unavailable') {
        Logger.warn(PAGE_SCOPE, 'Export finished but share capability is unavailable.', {
          outcome: result.outcome,
          exportedCount: result.exportedCount,
          hasFileUri: Boolean(result.fileUri),
        });
        showToast(result.message, 'info', TOAST_DURATION_LONG);
        return;
      }

      if (result.outcome === 'busy') {
        Logger.info(PAGE_SCOPE, 'Export skipped because another export/share flow is still in progress.', {
          outcome: result.outcome,
        });
        showToast(result.message, 'info', TOAST_DURATION_LONG);
        return;
      }

      Logger.warn(PAGE_SCOPE, 'Today worksheet export failed from settings.', {
        outcome: result.outcome,
      });
      showToast(result.message, 'error', TOAST_DURATION_LONG);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to export worksheet from settings.', { error });
      showToast('导出失败，请稍后重试', 'error', TOAST_DURATION_LONG);
    } finally {
      setIsExportingWorksheet(false);
      setWorksheetExportStage(null);
    }
  }, [dataOverview.dueToday, exportClearPrintStrength, exportImageMode, isExportingWorksheet, router, showToast]); */

  const handleExportTodayWorksheet = useCallback(async () => {
    await exportTodayWorksheetShared();
  }, [exportTodayWorksheetShared]);

  const handleToggleReminder = useCallback(
    async (nextValue: boolean) => {
      if (isReminderLoading || isReminderSwitchBusy) {
        return;
      }

      setIsReminderSwitchBusy(true);
      try {
        if (nextValue) {
          Logger.info(PAGE_SCOPE, 'Start enabling review reminder from settings.');
          const granted = await ReviewReminderService.requestPermissionIfNeeded();
          setIsReminderPermissionGranted(granted);
          if (!granted) {
            setShowReminderPermissionHint(true);
            showToast('未获得通知权限，暂时无法提醒。', 'warning');
            const disabled = await ReviewReminderService.setEnabled(false);
            setReminderSettings(disabled);
            return;
          }

          setShowReminderPermissionHint(false);
          const enabledSettings = await ReviewReminderService.setEnabled(true);
          setReminderSettings(enabledSettings);
          const refreshResult = await ReviewReminderService.refreshReminderSchedule({
            reason: 'settings_enable',
          });
          setReminderSettings(refreshResult.settings);

          if (refreshResult.pendingTodayCount <= 0) {
            showToast('今天暂无待复做题，不会提醒。', 'info');
          } else {
            showToast('已开启复做提醒，有待复做题时会提醒你。', 'success');
          }
          Logger.info(PAGE_SCOPE, 'Enabled review reminder from settings.', {
            pendingTodayCount: refreshResult.pendingTodayCount,
            scheduled: refreshResult.scheduled,
          });
          return;
        }

        Logger.info(PAGE_SCOPE, 'Start disabling review reminder from settings.');
        const disabledSettings = await ReviewReminderService.setEnabled(false);
        setReminderSettings(disabledSettings);
        setShowReminderPermissionHint(false);
        const refreshResult = await ReviewReminderService.refreshReminderSchedule({
          reason: 'settings_disable',
        });
        setReminderSettings(refreshResult.settings);
        showToast('已关闭复做提醒。', 'info');
        Logger.info(PAGE_SCOPE, 'Disabled review reminder from settings.');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed toggling review reminder in settings.', { error });
        showToast('提醒设置失败，请稍后重试', 'warning');
        void loadReminderState();
      } finally {
        setIsReminderSwitchBusy(false);
      }
    },
    [isReminderLoading, isReminderSwitchBusy, loadReminderState, showToast],
  );

  const handleSaveReminderTime = useCallback(
    async (nextHour: number, nextMinute: number) => {
      if (isReminderLoading || isReminderTimeBusy || isReminderSwitchBusy) {
        return;
      }

      const currentTimeText = formatReminderTime(reminderSettings.hour, reminderSettings.minute);
      const nextTimeText = formatReminderTime(nextHour, nextMinute);
      if (currentTimeText === nextTimeText) {
        return;
      }

      setIsReminderTimeBusy(true);
      try {
        const nextSettings = await ReviewReminderService.setTime(nextHour, nextMinute);
        setReminderSettings(nextSettings);

        if (nextSettings.enabled) {
          const refreshResult = await ReviewReminderService.refreshReminderSchedule({
            reason: 'settings_change_time',
          });
          setReminderSettings(refreshResult.settings);
        }

        showToast(`提醒时间已改为 ${nextTimeText}。`, 'success');
        Logger.info(PAGE_SCOPE, 'Updated reminder time from settings.', {
          hour: nextHour,
          minute: nextMinute,
          enabled: nextSettings.enabled,
        });
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed updating reminder time in settings.', { error });
        showToast('提醒时间更新失败，请稍后重试', 'warning');
        void loadReminderState();
      } finally {
        setIsReminderTimeBusy(false);
      }
    },
    [
      isReminderLoading,
      isReminderSwitchBusy,
      isReminderTimeBusy,
      loadReminderState,
      showToast,
      reminderSettings.hour,
      reminderSettings.minute,
    ],
  );

  const handleOpenReminderTimePicker = useCallback(() => {
    if (isReminderLoading || isReminderSwitchBusy || isReminderTimeBusy) {
      return;
    }

    if (Platform.OS !== 'android') {
      showToast('当前平台暂不支持系统时间选择器', 'info');
      return;
    }

    const currentValue = new Date();
    currentValue.setHours(reminderSettings.hour, reminderSettings.minute, 0, 0);

    DateTimePickerAndroid.open({
      mode: 'time',
      is24Hour: true,
      value: currentValue,
      onChange: (event, date) => {
        if (event.type !== 'set' || !date) {
          return;
        }

        void handleSaveReminderTime(date.getHours(), date.getMinutes());
      },
    });
  }, [
    handleSaveReminderTime,
    isReminderLoading,
    isReminderSwitchBusy,
    isReminderTimeBusy,
    reminderSettings.hour,
    reminderSettings.minute,
    showToast,
  ]);

  const handleOpenNotificationSettings = useCallback(() => {
    void ReviewReminderService.openSystemNotificationSettings().catch((error) => {
      Logger.warn(PAGE_SCOPE, 'Failed to open system notification settings.', { error });
      showToast('无法打开系统设置，请手动开启通知权限', 'warning');
    });
  }, [showToast]);

  const isStatsBusy = isOverviewLoading || isOverviewRefreshing;
  const shouldMaskStats = isOverviewLoading && lastUpdatedAt === null;
  const statsUpdatedText = isStatsBusy ? '更新中...' : `更新于 ${formatClock(lastUpdatedAt)}`;
  const displayNumber = useCallback(
    (value: number) => (shouldMaskStats ? STATS_PLACEHOLDER : String(value)),
    [shouldMaskStats],
  );
  const displayStorageText = shouldMaskStats
    ? STATS_PLACEHOLDER
    : formatStorageSize(dataOverview.storageBytes);
  const canExportTodayWorksheet = worksheetPendingCount > 0;
  const worksheetExportButtonText = isExportingWorksheet
    ? TodayWorksheetExportService.buildTodayWorksheetExportProgressMessage(
        worksheetExportStage ?? 'preparing',
        worksheetPendingCount,
      )
    : TodayWorksheetExportService.buildTodayWorksheetExportButtonLabel(worksheetPendingCount);
  const worksheetExportHintText = isExportingWorksheet
    ? worksheetExportButtonText
    : canExportTodayWorksheet
      ? `将导出今日待复做的 ${worksheetPendingCount} 题，便于打印。`
      : '今日没有待复做错题，暂不可导出。';
  const worksheetExportProgressHeadline = isExportingWorksheet
    ? (worksheetExportProgress.message || worksheetExportButtonText)
    : worksheetExportHintText;
  const worksheetExportProgressDetailText =
    isExportingWorksheet && worksheetExportProgress.total > 0
      ? `已处理 ${worksheetExportProgress.current} / ${worksheetExportProgress.total} 题 · 用时 ${formatElapsedSeconds(worksheetExportProgress.elapsedSeconds)}`
      : '';
  const selectedExportImageModeOption = useMemo(
    () =>
      EXPORT_IMAGE_MODE_OPTIONS.find((item) => item.mode === exportImageMode)
      ?? EXPORT_IMAGE_MODE_OPTIONS[1],
    [exportImageMode],
  );
  const selectedClearPrintStrengthOption = useMemo(
    () =>
      CLEAR_PRINT_STRENGTH_OPTIONS.find((item) => item.value === exportClearPrintStrength)
      ?? CLEAR_PRINT_STRENGTH_OPTIONS[1],
    [exportClearPrintStrength],
  );
  const selectedEnhanceConcurrencyOption = useMemo(
    () =>
      ENHANCE_CONCURRENCY_OPTIONS.find((item) => item.value === exportEnhanceConcurrency)
      ?? ENHANCE_CONCURRENCY_OPTIONS[0],
    [exportEnhanceConcurrency],
  );
  const selectedEnhancePerformanceOption = useMemo(
    () =>
      ENHANCE_PERFORMANCE_OPTIONS.find((item) => item.value === exportEnhancePerformanceProfile)
      ?? ENHANCE_PERFORMANCE_OPTIONS[0],
    [exportEnhancePerformanceProfile],
  );
  const exportImageModeStatusText = isExportImageModeLoading
    ? '正在读取导出图片模式...'
    : isExportImageModeSaving
      ? '正在保存导出图片模式...'
      : `当前模式：${selectedExportImageModeOption.title}`;

  const exportImageModeStatusWithStrengthText = exportImageMode === 'clear_print'
    ? `${exportImageModeStatusText} | 强度: ${selectedClearPrintStrengthOption.title}`
    : exportImageModeStatusText;
  const exportImageModeStatusWithEnhanceSettingsText = exportImageMode === 'clear_print'
    ? `${exportImageModeStatusWithStrengthText} | 策略: ${selectedEnhancePerformanceOption.title} | 并发: ${selectedEnhanceConcurrencyOption.title}`
    : exportImageModeStatusText;
  const shouldShowPrintEnhanceAdvancedSettings =
    exportImageMode === 'clear_print' && isPrintEnhanceAdvancedVisible;
  const exportImageModeStatusDisplayText = shouldShowPrintEnhanceAdvancedSettings
    ? exportImageModeStatusWithEnhanceSettingsText
    : exportImageModeStatusText;

  const handleShowStorageDetails = useCallback(() => {
    Alert.alert(
      '本机存储详情',
      `错题数量：${displayNumber(dataOverview.totalMistakes)}\n图片记录数：${displayNumber(dataOverview.imageCount)}\n复做记录数：${displayNumber(dataOverview.totalReviews)}\n占用空间：${displayStorageText}`,
      [{ text: '知道了' }],
    );
  }, [dataOverview.imageCount, dataOverview.totalMistakes, dataOverview.totalReviews, displayNumber, displayStorageText]);

  const cleanupStorageOrphans = useCallback(
    async (orphanFiles: string[]) => {
      if (isCleaningOrphanImages) {
        return;
      }

      Logger.info(PAGE_SCOPE, 'Start cleaning orphan images from settings.', {
        targetCount: orphanFiles.length,
      });
      setIsCleaningOrphanImages(true);
      try {
        const result = await cleanupOrphanImageFiles(orphanFiles);

        if (result.deletedCount <= 0 && result.failedCount <= 0) {
          showToast('没有发现无效图片', 'info');
          return;
        }

        if (result.deletedCount > 0) {
          const toastMessage =
            result.failedCount > 0
              ? `已清理 ${result.deletedCount} 张无效图片，部分图片清理失败`
              : `已清理 ${result.deletedCount} 张无效图片`;
          showToast(toastMessage, result.failedCount > 0 ? 'warning' : 'success', TOAST_DURATION_LONG);
        } else if (result.failedCount > 0) {
          showToast('存储清理失败，请稍后重试', 'warning', TOAST_DURATION_LONG);
        }

        if (result.failedCount > 0) {
          Logger.warn(PAGE_SCOPE, 'Some orphan images failed to delete.', {
            failedCount: result.failedCount,
            scannedOrphanCount: result.scannedOrphanCount,
          });
        } else {
          Logger.info(PAGE_SCOPE, 'Cleaned orphan images successfully from settings.', {
            deletedCount: result.deletedCount,
            releasedBytes: result.releasedBytes,
          });
        }

        void loadDataOverview('refresh');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to cleanup orphan images.', { error });
        showToast('存储清理失败，请稍后重试', 'error', TOAST_DURATION_LONG);
      } finally {
        setIsCleaningOrphanImages(false);
      }
    },
    [isCleaningOrphanImages, loadDataOverview, showToast],
  );

  const handleCleanInvalidImages = useCallback(async () => {
    if (isScanningOrphanImages || isCleaningOrphanImages) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'Start scanning orphan images from settings.');
    setIsScanningOrphanImages(true);
    try {
      const scanResult = await scanOrphanImageFiles();
      Logger.info(PAGE_SCOPE, 'Finished scanning orphan images from settings.', {
        orphanCount: scanResult.orphanCount,
        orphanBytes: scanResult.orphanBytes,
        scannedFileCount: scanResult.scannedFileCount,
      });

      if (scanResult.orphanCount <= 0) {
        showToast('没有发现无效图片', 'info');
        return;
      }

      const releaseText = formatStorageSize(scanResult.orphanBytes);
      Alert.alert(
        '清理无效图片？',
        `将清理 ${scanResult.orphanCount} 张不再使用的图片，预计释放 ${releaseText}。不会删除错题中正在使用的图片。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '清理',
            style: 'destructive',
            onPress: () => {
              void cleanupStorageOrphans(scanResult.orphanFiles);
            },
          },
        ],
      );
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to scan orphan images from settings.', { error });
      showToast('暂未发现可安全清理的图片', 'warning', TOAST_DURATION_LONG);
    } finally {
      setIsScanningOrphanImages(false);
    }
  }, [cleanupStorageOrphans, isCleaningOrphanImages, isScanningOrphanImages, showToast]);

  const handleClearPrintEnhanceCache = useCallback(async () => {
    if (isClearingPrintEnhanceCache) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'Start clearing print enhance image cache from settings.');
    setIsClearingPrintEnhanceCache(true);
    try {
      const result = await clearPrintEnhanceImageCache();
      if (result.scannedCount <= 0) {
        showToast('没有可清理的图片缓存', 'info');
        return;
      }

      const releasedText = formatStorageSize(result.releasedBytes);
      if (result.failedCount > 0) {
        showToast(
          `已清理 ${result.deletedCount} 张图片缓存，部分缓存清理失败`,
          'warning',
          TOAST_DURATION_LONG,
        );
        Logger.warn(PAGE_SCOPE, 'Some print enhance cache files failed to delete.', {
          scannedCount: result.scannedCount,
          deletedCount: result.deletedCount,
          failedCount: result.failedCount,
          releasedBytes: result.releasedBytes,
        });
        return;
      }

      showToast(`已清理 ${result.deletedCount} 张图片缓存，释放 ${releasedText}`, 'success', TOAST_DURATION_LONG);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to clear print enhance image cache from settings.', { error });
      showToast('图片缓存清理失败，请稍后重试', 'error', TOAST_DURATION_LONG);
    } finally {
      setIsClearingPrintEnhanceCache(false);
    }
  }, [isClearingPrintEnhanceCache, showToast]);

  const statsItems = useMemo(
    () => [
      { label: '已录入', value: displayNumber(dataOverview.totalMistakes) },
      { label: '待复做', value: displayNumber(dataOverview.dueToday) },
      { label: '已掌握', value: displayNumber(dataOverview.mastered) },
      { label: '累计复做', value: displayNumber(dataOverview.totalReviews) },
    ],
    [dataOverview, displayNumber],
  );
  const statIconNames = [
    'library-books',
    'event-note',
    'check-circle-outline',
    'whatshot',
    'donut-large',
    'history',
  ] as const;

  const isStorageBusy = isScanningOrphanImages || isCleaningOrphanImages || isClearingPrintEnhanceCache;
  const isRestoreBusy = isInspectingBackup || isRestoring;
  const isBackupBusy = isBackingUp || isRestoreBusy;
  const isExportImageModeBusy =
    isExportingWorksheet || isExportImageModeLoading || isExportImageModeSaving;
  const isReminderBusy = isReminderLoading || isReminderSwitchBusy || isReminderTimeBusy;
  const reminderTimeText = formatReminderTime(reminderSettings.hour, reminderSettings.minute);
  const canEditReminderTime = !isReminderLoading && !isReminderTimeBusy && !isReminderSwitchBusy;
  const shouldShowReminderPermissionNotice =
    !isReminderPermissionGranted && (showReminderPermissionHint || reminderSettings.enabled);
  const nextReminderText = useMemo(() => {
    if (isReminderLoading) {
      return '下次预计提醒：读取中...';
    }

    if (!reminderSettings.enabled) {
      return '下次预计提醒：未开启';
    }

    if (!isReminderPermissionGranted) {
      return '下次预计提醒：通知权限未开启';
    }

    const scheduledLabel = formatReminderScheduleDateLabel(reminderSettings.scheduledDate);
    if (scheduledLabel) {
      return `下次预计提醒：${scheduledLabel}`;
    }

    return '下次预计提醒：今天暂无待复做题，不会提醒';
  }, [
    isReminderLoading,
    isReminderPermissionGranted,
    reminderSettings.enabled,
    reminderSettings.scheduledDate,
  ]);
  const nextReminderTextParts = useMemo(() => {
    const separatorIndex = nextReminderText.indexOf('：');
    if (separatorIndex < 0) {
      return { prefix: nextReminderText, value: '' };
    }
    return {
      prefix: nextReminderText.slice(0, separatorIndex + 1),
      value: nextReminderText.slice(separatorIndex + 1).trimStart(),
    };
  }, [nextReminderText]);

  return (
    <View style={styles.pageRoot}>
      <ScreenContainer scroll safeAreaEdges={['top']} contentStyle={styles.screenContent}>
        <BrandHeader
          title="设置"
          subtitle="离线运行，所有数据仅保存在本机"
          offlineLabel="离线"
        />

        <CardContainer style={[styles.card, styles.backupCard]} padding={spacing.md}>
          <View style={styles.backupCardRow}>
            <View style={[styles.iconBadge, styles.iconGreen, styles.backupIconBadge]}>
              <MaterialIcons color="#2A9D50" name="security" size={38} />
            </View>
            <View style={styles.backupMain}>
              <View style={styles.backupHeaderRow}>
                <View style={styles.backupTitleWrap}>
                  <Text style={[styles.cardTitle, styles.backupTitle]}>数据备份与恢复</Text>
                  <View style={styles.recommendBadge}>
                    <Text style={styles.recommendText}>推荐</Text>
                  </View>
                </View>
                <MaterialIcons color="#A0A7B2" name="chevron-right" size={22} style={styles.backupChevron} />
              </View>
              <Text style={[styles.cardDescription, styles.backupDescription]}>
                保护错题、复做记录和图片，换手机或重装 App 后可恢复数据。
              </Text>
              <View style={styles.backupMetaRow}>
                <MaterialIcons color="#2A9D50" name="schedule" size={18} />
                <Text style={[styles.metaText, styles.backupMetaText]}>
                  上次备份：
                  <Text style={[styles.metaStrong, styles.backupMetaStrong]}>
                    {lastBackupAt ? formatBackupCreatedAt(lastBackupAt) : '未备份'}
                  </Text>
                </Text>
              </View>
              <View style={styles.backupActionRow}>
                <Pressable
                  accessibilityLabel={
                    isBackingUp ? '正在整理备份文件…' : isRestoreBusy ? '正在恢复数据…' : '备份到文件'
                  }
                  accessibilityRole="button"
                  disabled={isBackupBusy}
                  onPress={handleStartBackup}
                  style={[
                    styles.actionButton,
                    styles.actionButtonGreen,
                    styles.backupActionButton,
                    isBackupBusy ? styles.disabledButton : null,
                  ]}>
                  <View style={styles.backupActionContent}>
                    <MaterialIcons color="#238B49" name="backup" size={18} />
                    <Text
                      numberOfLines={2}
                      style={[styles.actionButtonText, styles.actionButtonTextGreen, styles.backupActionText]}>
                      {isBackingUp ? '正在整理备份文件…' : isRestoreBusy ? '正在恢复数据…' : '备份到文件'}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityLabel={
                    isRestoring ? '正在恢复数据…' : isInspectingBackup ? '正在检查备份文件…' : '从备份文件恢复'
                  }
                  accessibilityRole="button"
                  disabled={isRestoreBusy}
                  onPress={handleRestoreFromBackup}
                  style={[
                    styles.actionButton,
                    styles.actionButtonGreen,
                    styles.backupActionButton,
                    isRestoreBusy ? styles.disabledButton : null,
                  ]}>
                  <View style={styles.backupActionContent}>
                    <MaterialIcons color="#238B49" name="restore" size={18} />
                    <Text
                      numberOfLines={2}
                      style={[styles.actionButtonText, styles.actionButtonTextGreen, styles.backupActionText]}>
                      {isRestoring ? '正在恢复数据…' : isInspectingBackup ? '正在检查备份文件…' : '从备份文件恢复'}
                    </Text>
                  </View>
                </Pressable>
              </View>
              <View style={styles.backupHintRow}>
                <MaterialIcons color="#2A9D50" name="verified-user" size={16} />
                <Text style={styles.backupHintText}>选择之前导出的七刷备份文件，恢复到当前设备。</Text>
              </View>
            </View>
          </View>
        </CardContainer>

        <CardContainer style={[styles.card, styles.statsCard]} padding={spacing.md}>
          <View style={styles.statsCardRow}>
            <View style={styles.statsHeaderIconWrap}>
              <MaterialIcons color="#2D74D6" name="bar-chart" size={24} />
            </View>
            <View style={styles.statsMain}>
              <View style={styles.statsHeader}>
                <View style={styles.statsHeaderText}>
                  <Text style={[styles.cardTitle, styles.statsTitle]}>学习数据</Text>
                  <Text style={styles.statsUpdatedText}>{statsUpdatedText}</Text>
                </View>
                <Pressable
                  accessibilityLabel="刷新学习数据"
                  accessibilityRole="button"
                  disabled={isStatsBusy}
                  onPress={() => {
                    void loadDataOverview('refresh');
                  }}
                  style={[styles.statsRefreshButton, isStatsBusy ? styles.disabledButton : null]}>
                  {isStatsBusy ? (
                    <ActivityIndicator color="#2D74D6" size="small" />
                  ) : (
                    <MaterialIcons color="#2D74D6" name="refresh" size={18} />
                  )}
                </Pressable>
              </View>
              <View style={styles.statsGrid}>
                {statsItems.map((item, index) => {
                  const statIconName = statIconNames[index % statIconNames.length];
                  return (
                    <View key={item.label} style={styles.statItemCard}>
                      <View style={styles.statItemBody}>
                        <View style={styles.statItemIconWrap}>
                          <MaterialIcons color="#2D74D6" name={statIconName} size={17} />
                        </View>
                        <View style={styles.statTextWrap}>
                          <Text numberOfLines={2} style={styles.statLabel}>
                            {item.label}
                          </Text>
                          <Text
                            adjustsFontSizeToFit
                            minimumFontScale={0.86}
                            numberOfLines={1}
                            style={styles.statValue}>
                            {item.value}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
              {overviewErrorMessage ? <Text style={styles.errorText}>{overviewErrorMessage}</Text> : null}
            </View>
          </View>
        </CardContainer>

        <CardContainer style={styles.card} padding={spacing.md}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, styles.iconOrange]}>
              <MaterialIcons color="#ED8A09" name="print" size={30} />
            </View>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>打印与导出</Text>
              <Text style={styles.cardDescription}>
                导出今日到期错题，方便打印给学生做练习。
              </Text>
              <View style={styles.exportModeSection}>
                <Text style={styles.metaText}>导出图片模式</Text>
                <View style={styles.exportModeList}>
                  {EXPORT_IMAGE_MODE_OPTIONS.map((option) => {
                    const isSelected = option.mode === exportImageMode;
                    return (
                      <Pressable
                        key={option.mode}
                        accessibilityRole="button"
                        disabled={isExportImageModeBusy}
                        onLongPress={
                          option.mode === 'clear_print'
                            ? handleTogglePrintEnhanceAdvancedSettings
                            : undefined
                        }
                        onPress={() => {
                          void handleSelectExportImageMode(option.mode);
                        }}
                        style={[
                          styles.exportModeOption,
                          isSelected ? styles.exportModeOptionSelected : null,
                          isExportImageModeBusy ? styles.disabledButton : null,
                        ]}>
                        <View style={styles.exportModeOptionHeader}>
                          <View style={styles.exportModeTitleRow}>
                            <Text
                              style={[
                                styles.exportModeTitle,
                                isSelected ? styles.exportModeTitleSelected : null,
                              ]}>
                              {option.title}
                            </Text>
                            {option.recommended ? (
                              <View style={styles.recommendBadge}>
                                <Text style={styles.recommendText}>推荐</Text>
                              </View>
                            ) : null}
                          </View>
                          <MaterialIcons
                            color={isSelected ? '#A86A12' : '#A8AFB9'}
                            name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
                            size={18}
                          />
                        </View>
                        <Text
                          style={[
                            styles.exportModeDescription,
                            isSelected ? styles.exportModeDescriptionSelected : null,
                          ]}>
                          {option.description}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {shouldShowPrintEnhanceAdvancedSettings ? (
                  <>
                    <View style={styles.clearPrintStrengthSection}>
                      <Text style={styles.metaText}>清晰打印强度</Text>
                      <View style={[styles.clearPrintStrengthTrack, isExportImageModeBusy ? styles.disabledButton : null]}>
                        {CLEAR_PRINT_STRENGTH_OPTIONS.map((option) => {
                          const isSelected = option.value === exportClearPrintStrength;
                          return (
                            <Pressable
                              key={option.value}
                              accessibilityRole="button"
                              disabled={isExportImageModeBusy}
                              onPress={() => {
                                void handleSelectClearPrintStrength(option.value);
                              }}
                              style={[
                                styles.clearPrintStrengthStop,
                                isSelected ? styles.clearPrintStrengthStopSelected : null,
                              ]}>
                              <Text
                                style={[
                                  styles.clearPrintStrengthStopText,
                                  isSelected ? styles.clearPrintStrengthStopTextSelected : null,
                                ]}>
                                {option.title}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text style={styles.clearPrintStrengthDescription}>
                        {selectedClearPrintStrengthOption.description}
                      </Text>
                    </View>
                    <View style={styles.enhanceConcurrencySection}>
                      <Text style={styles.metaText}>增强策略（仅影响清晰打印）</Text>
                      <View style={[styles.enhanceConcurrencyTrack, isExportImageModeBusy ? styles.disabledButton : null]}>
                        {ENHANCE_PERFORMANCE_OPTIONS.map((option) => {
                          const isSelected = option.value === exportEnhancePerformanceProfile;
                          const isDisabled = isExportImageModeBusy || exportImageMode !== 'clear_print';
                          return (
                            <Pressable
                              key={option.value}
                              accessibilityRole="button"
                              disabled={isDisabled}
                              onPress={() => {
                                void handleSelectEnhancePerformanceProfile(option.value);
                              }}
                              style={[
                                styles.enhanceConcurrencyStop,
                                isSelected ? styles.enhanceConcurrencyStopSelected : null,
                                isDisabled ? styles.disabledButton : null,
                              ]}>
                              <View style={styles.enhanceConcurrencyStopInner}>
                                <Text
                                  style={[
                                    styles.enhanceConcurrencyStopText,
                                    isSelected ? styles.enhanceConcurrencyStopTextSelected : null,
                                  ]}>
                                  {option.title}
                                </Text>
                                {option.recommended ? (
                                  <Text
                                    style={[
                                      styles.enhanceConcurrencyStopHint,
                                      isSelected ? styles.enhanceConcurrencyStopHintSelected : null,
                                    ]}>
                                    推荐
                                  </Text>
                                ) : null}
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text style={styles.enhanceConcurrencyDescription}>
                        {selectedEnhancePerformanceOption.description}
                      </Text>
                      <Text style={styles.enhanceConcurrencyHint}>
                        “速度优先”会降低增强参数，通常可显著缩短 clear_print 导出耗时。
                      </Text>
                    </View>
                    <View style={styles.enhanceConcurrencySection}>
                      <Text style={styles.metaText}>并发数量（仅影响清晰打印）</Text>
                      <View style={[styles.enhanceConcurrencyTrack, isExportImageModeBusy ? styles.disabledButton : null]}>
                        {ENHANCE_CONCURRENCY_OPTIONS.map((option) => {
                          const isSelected = option.value === exportEnhanceConcurrency;
                          return (
                            <Pressable
                              key={option.value}
                              accessibilityRole="button"
                              disabled={isExportImageModeBusy}
                              onPress={() => {
                                void handleSelectEnhanceConcurrency(option.value);
                              }}
                              style={[
                                styles.enhanceConcurrencyStop,
                                isSelected ? styles.enhanceConcurrencyStopSelected : null,
                              ]}>
                              <View style={styles.enhanceConcurrencyStopInner}>
                                <Text
                                  style={[
                                    styles.enhanceConcurrencyStopText,
                                    isSelected ? styles.enhanceConcurrencyStopTextSelected : null,
                                  ]}>
                                  {option.title}
                                </Text>
                                {option.recommended ? (
                                  <Text
                                    style={[
                                      styles.enhanceConcurrencyStopHint,
                                      isSelected ? styles.enhanceConcurrencyStopHintSelected : null,
                                    ]}>
                                    推荐
                                  </Text>
                                ) : null}
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text style={styles.enhanceConcurrencyDescription}>
                        {selectedEnhanceConcurrencyOption.description}
                      </Text>
                      <Text style={styles.enhanceConcurrencyHint}>
                        并发越高通常越快，但会增加内存与发热；导出异常时建议先切回 1。
                      </Text>
                    </View>
                  </>
                ) : null}
                <Text style={styles.metaText}>{exportImageModeStatusDisplayText}</Text>
              </View>
              <Pressable
                disabled={isExportingWorksheet || !canExportTodayWorksheet}
                onPress={() => {
                  void handleExportTodayWorksheet();
                }}
                style={[
                  styles.actionButton,
                  styles.actionButtonOrange,
                  isExportingWorksheet || !canExportTodayWorksheet ? styles.disabledButton : null,
                ]}>
                <Text numberOfLines={1} style={[styles.actionButtonText, styles.actionButtonTextOrange]}>
                  {worksheetExportButtonText}
                </Text>
              </Pressable>
              <View style={styles.exportHintWrap}>
                <Text style={styles.metaText}>{worksheetExportProgressHeadline}</Text>
                {worksheetExportProgressDetailText ? (
                  <Text style={styles.exportProgressMetaText}>{worksheetExportProgressDetailText}</Text>
                ) : null}
                {isExportingWorksheet && worksheetExportProgress.total > 0 ? (
                  <View style={styles.exportProgressTrack}>
                    <View
                      style={[
                        styles.exportProgressFill,
                        { width: `${Math.round(worksheetExportProgressPercent * 100)}%` },
                      ]}
                    />
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </CardContainer>

        <CardContainer style={styles.card} padding={spacing.md}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, styles.iconPurple]}>
              <MaterialIcons color="#7B53CC" name="notifications-active" size={30} />
            </View>
            <View style={styles.cardMain}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle}>复做提醒</Text>
                <Switch
                  disabled={isReminderBusy}
                  onValueChange={(nextValue) => {
                    void handleToggleReminder(nextValue);
                  }}
                  thumbColor={colors.white}
                  trackColor={{ false: '#D5D8DE', true: '#9ED9B3' }}
                  value={reminderSettings.enabled}
                />
              </View>
              <Text style={styles.cardDescription}>
                有待复做错题时提醒我完成今日复做，避免遗漏。
              </Text>
              <View style={styles.reminderTimeWrap}>
                <View style={styles.reminderTimeRow}>
                  <Text style={styles.metaText}>
                    提醒时间：<Text style={styles.reminderValueText}>{reminderTimeText}</Text>
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!canEditReminderTime}
                    onPress={handleOpenReminderTimePicker}
                    style={[
                      styles.reminderTimeButton,
                      !canEditReminderTime ? styles.disabledButton : null,
                    ]}>
                    {isReminderTimeBusy ? (
                      <ActivityIndicator color="#505863" size="small" />
                    ) : (
                      <>
                        <MaterialIcons color="#505863" name="schedule" size={16} />
                        <Text numberOfLines={1} style={styles.reminderTimeButtonText}>
                          选择时间
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
                <Text style={styles.reminderScheduleText}>
                  {nextReminderTextParts.prefix}
                  {nextReminderTextParts.value ? (
                    <Text style={styles.reminderValueText}>{nextReminderTextParts.value}</Text>
                  ) : null}
                </Text>
              </View>
              {shouldShowReminderPermissionNotice ? (
                <View style={styles.reminderPermissionNotice}>
                  <Text style={styles.reminderPermissionText}>
                    通知权限未开启，无法收到复做提醒
                  </Text>
                  <Pressable onPress={handleOpenNotificationSettings} style={styles.reminderSettingLink}>
                    <Text style={styles.reminderSettingLinkText}>去设置</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </CardContainer>

        <CardContainer style={styles.card} padding={spacing.md}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, styles.iconGreen]}>
              <MaterialIcons color="#2A9D50" name="storage" size={30} />
            </View>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>本机存储</Text>
              <Text style={styles.cardDescription}>错题图片和复做记录都保存在本机。</Text>
              <Text style={styles.metaText}>
                图片数量：<Text style={styles.storageValueText}>{displayNumber(dataOverview.imageCount)} 张</Text>
              </Text>
              <Text style={styles.metaText}>
                占用空间：<Text style={styles.storageValueText}>{displayStorageText}</Text>
              </Text>
              <View style={styles.actionRow}>
                <Pressable
                  disabled={isStorageBusy}
                  onPress={() => {
                    void handleCleanInvalidImages();
                  }}
                  style={[
                    styles.actionButton,
                    styles.actionButtonGreen,
                    isStorageBusy ? styles.disabledButton : null,
                  ]}>
                  <Text numberOfLines={1} style={[styles.actionButtonText, styles.actionButtonTextGreen]}>
                    {isCleaningOrphanImages ? '清理中...' : isScanningOrphanImages ? '扫描中...' : '清理无效图片'}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={isStorageBusy}
                  onPress={() => {
                    void handleClearPrintEnhanceCache();
                  }}
                  style={[
                    styles.actionButton,
                    styles.actionButtonGreen,
                    isStorageBusy ? styles.disabledButton : null,
                  ]}>
                  <Text numberOfLines={1} style={[styles.actionButtonText, styles.actionButtonTextGreen]}>
                    {isClearingPrintEnhanceCache ? '清理中...' : '清理图片缓存'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleShowStorageDetails}
                  style={[styles.actionButton, styles.actionButtonGreen]}>
                  <Text numberOfLines={1} style={[styles.actionButtonText, styles.actionButtonTextGreen]}>
                    存储详情
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </CardContainer>

        <CardContainer style={styles.card} padding={spacing.md}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, styles.iconBlue]}>
              <MaterialIcons color="#2D74D6" name="menu-book" size={30} />
            </View>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>使用说明</Text>
              <Text style={styles.cardDescription}>
                了解七刷错题本的使用方法、备份恢复、打印练习卷等内容。
              </Text>
              <Pressable
                onPress={() =>
                  showToast('拍照录入错题 → 每天复做 → 做会后进入下一刷 → 七刷后标记掌握', 'info', 3400)
                }
                style={[styles.actionButton, styles.actionButtonBlue]}>
                <Text numberOfLines={1} style={[styles.actionButtonText, styles.actionButtonTextBlue]}>
                  查看使用说明
                </Text>
              </Pressable>
            </View>
          </View>
        </CardContainer>

        <Pressable
          accessibilityLabel="关于与支持"
          accessibilityRole="button"
          onPress={handleOpenAboutSupport}
          style={({ pressed }) => [
            styles.aboutSupportCardPressable,
            pressed ? styles.aboutSupportCardPressed : null,
          ]}>
          <CardContainer style={styles.card} padding={spacing.md}>
            <View style={styles.cardRow}>
              <View style={[styles.iconBadge, styles.iconGray]}>
                <MaterialIcons color="#717982" name="info-outline" size={30} />
              </View>
              <View style={styles.cardMain}>
                <View style={styles.titleRow}>
                  <Text style={styles.cardTitle}>关于与支持</Text>
                  <MaterialIcons color="#808791" name="chevron-right" size={22} />
                </View>
                <Pressable
                  accessibilityLabel="版本信息"
                  accessibilityRole="button"
                  delayLongPress={650}
                  hitSlop={10}
                  onLongPress={handleVersionLongPress}
                  onPress={handleVersionTap}
                  style={styles.versionPressable}>
                  <Text style={[styles.metaText, styles.aboutSupportPrimaryMeta]}>
                    {APP_NAME} · {APP_VERSION}
                  </Text>
                </Pressable>
                <Text style={styles.metaText}>{DATA_MODE_LABEL} · 数据仅保存在本机</Text>
              </View>
            </View>
          </CardContainer>
        </Pressable>

        {isDevModeUnlocked ? (
          <CardContainer style={styles.devCard} padding={spacing.md}>
            <Text style={styles.devTitle}>开发调试入口</Text>
            <Text style={styles.devNoticeText}>调试入口默认隐藏，仅用于排查问题，请谨慎使用。</Text>
            {DEV_ENTRIES.map((entry) => (
              <View key={entry.href} style={styles.devEntry}>
                <Text style={styles.devEntryTitle}>{entry.title}</Text>
                <Text style={styles.devEntryDesc}>{entry.description}</Text>
                <Pressable
                  onPress={() => router.push(entry.href as never)}
                  style={[styles.actionButton, styles.actionButtonOrange]}>
                  <Text numberOfLines={1} style={[styles.actionButtonText, styles.actionButtonTextOrange]}>
                    进入{entry.title}
                  </Text>
                </Pressable>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={handleDisableDeveloperMode}
              style={styles.devCloseButton}>
              <Text numberOfLines={1} style={styles.devCloseButtonText}>
                关闭开发者模式
              </Text>
            </Pressable>
          </CardContainer>
        ) : null}

        <View style={styles.safetyNotice}>
          <MaterialIcons color="#2A9D50" name="lock" size={18} />
          <Text style={styles.safetyText}>所有数据仅保存在本机，卸载 App 可能会删除本地数据</Text>
          <MaterialIcons color="#95A19A" name="help-outline" size={18} />
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
    paddingBottom: layout.bottomTabHeight + spacing.xl,
    gap: spacing.lg,
  },
  card: {
    borderRadius: radius.xl,
  },
  backupCard: {
    borderRadius: 22,
    borderColor: 'rgba(34, 197, 94, 0.18)',
    backgroundColor: '#F8FFFA',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  backupCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconGreen: {
    backgroundColor: '#EAF8EE',
    borderColor: '#C6EAD3',
  },
  backupIconBadge: {
    width: 76,
    height: 76,
    borderRadius: 22,
  },
  iconBlue: {
    backgroundColor: '#EAF2FF',
    borderColor: '#C8DAFA',
  },
  iconOrange: {
    backgroundColor: '#FFF4E5',
    borderColor: '#F2D8AF',
  },
  iconPurple: {
    backgroundColor: '#F1EBFF',
    borderColor: '#DCCEF9',
  },
  iconGray: {
    backgroundColor: '#F1F3F5',
    borderColor: '#DBDFE4',
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  backupMain: {
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  backupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  backupTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  cardTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  backupTitle: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: '800',
  },
  backupChevron: {
    flexShrink: 0,
    marginLeft: spacing.xs,
  },
  cardDescription: {
    ...typography.body,
    color: colors.textSecondary,
  },
  backupDescription: {
    color: '#4B5563',
    lineHeight: 22,
  },
  metaText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  exportHintWrap: {
    gap: spacing.xs,
  },
  exportProgressMetaText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
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
  backupMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  backupMetaText: {
    flex: 1,
    minWidth: 0,
    color: '#4B5563',
  },
  metaStrong: {
    color: '#2A9D50',
    fontWeight: '700',
  },
  backupMetaStrong: {
    color: '#16A34A',
    fontWeight: '800',
  },
  recommendBadge: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E6C88F',
    backgroundColor: '#FFF8E8',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  recommendText: {
    ...typography.caption,
    color: '#9C6B1A',
    fontWeight: '700',
  },
  actionRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  backupActionRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonText: {
    ...typography.bodySmall,
    fontWeight: '700',
  },
  backupActionButton: {
    minHeight: 46,
    borderRadius: 15,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 104,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backupActionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  backupActionText: {
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 20,
  },
  actionButtonGreen: {
    borderColor: '#72C490',
    backgroundColor: '#F1FAF4',
  },
  actionButtonTextGreen: {
    color: '#238B49',
  },
  actionButtonOrange: {
    borderColor: '#D1A15D',
    backgroundColor: '#FFF6E8',
  },
  actionButtonTextOrange: {
    color: '#A86A12',
  },
  actionButtonBlue: {
    borderColor: '#8CB9F5',
    backgroundColor: '#F1F7FF',
  },
  actionButtonTextBlue: {
    color: '#2D74D6',
  },
  exportModeSection: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  exportModeList: {
    gap: spacing.xs,
  },
  exportModeOption: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E9DAC3',
    backgroundColor: '#FFFDF9',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: 6,
  },
  exportModeOptionSelected: {
    borderColor: '#D1A15D',
    backgroundColor: '#FFF6E8',
  },
  exportModeOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  exportModeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flexShrink: 1,
    gap: spacing.xs,
  },
  exportModeTitle: {
    ...typography.bodySmall,
    color: '#564028',
    fontWeight: '700',
    flexShrink: 1,
  },
  exportModeTitleSelected: {
    color: '#A86A12',
  },
  exportModeDescription: {
    ...typography.caption,
    color: '#6D5A45',
    lineHeight: 18,
  },
  exportModeDescriptionSelected: {
    color: '#875321',
  },
  clearPrintStrengthSection: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  clearPrintStrengthTrack: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E9DAC3',
    backgroundColor: '#FFFDF9',
    padding: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clearPrintStrengthStop: {
    flex: 1,
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  clearPrintStrengthStopSelected: {
    borderColor: '#D1A15D',
    backgroundColor: '#FFF6E8',
  },
  clearPrintStrengthStopText: {
    ...typography.caption,
    color: '#6D5A45',
    fontWeight: '700',
  },
  clearPrintStrengthStopTextSelected: {
    color: '#A86A12',
  },
  clearPrintStrengthDescription: {
    ...typography.caption,
    color: '#6D5A45',
    lineHeight: 18,
  },
  enhanceConcurrencySection: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  enhanceConcurrencyTrack: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E9DAC3',
    backgroundColor: '#FFFDF9',
    padding: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  enhanceConcurrencyStop: {
    flex: 1,
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  enhanceConcurrencyStopSelected: {
    borderColor: '#D1A15D',
    backgroundColor: '#FFF6E8',
  },
  enhanceConcurrencyStopInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  enhanceConcurrencyStopText: {
    ...typography.caption,
    color: '#6D5A45',
    fontWeight: '700',
  },
  enhanceConcurrencyStopTextSelected: {
    color: '#A86A12',
  },
  enhanceConcurrencyStopHint: {
    ...typography.caption,
    color: '#9C6B1A',
    fontSize: 10,
    lineHeight: 12,
  },
  enhanceConcurrencyStopHintSelected: {
    color: '#A86A12',
  },
  enhanceConcurrencyDescription: {
    ...typography.caption,
    color: '#6D5A45',
    lineHeight: 18,
  },
  enhanceConcurrencyHint: {
    ...typography.caption,
    color: '#7A664C',
    lineHeight: 18,
  },
  backupHintRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  backupHintText: {
    ...typography.caption,
    flex: 1,
    color: '#6B7280',
    lineHeight: 18,
  },
  statsCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F3',
    backgroundColor: '#F8FAFD',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  statsCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  statsMain: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statsHeaderIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CCE0FC',
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  statsHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  statsTitle: {
    color: '#131722',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
  },
  statsUpdatedText: {
    ...typography.bodySmall,
    color: '#8691A2',
    fontSize: 14,
    lineHeight: 18,
  },
  statsRefreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DEE6F2',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
    alignItems: 'flex-start',
  },
  statItemCard: {
    width: '48.6%',
    minHeight: 74,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6ECF5',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 0,
    marginBottom: 0,
    shadowColor: '#0F172A',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  statItemBody: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  statItemIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    ...typography.sectionTitle,
    color: '#2D74D6',
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '800',
  },
  statLabel: {
    ...typography.caption,
    color: '#7A8496',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    textAlign: 'left',
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  reminderTimeWrap: {
    gap: spacing.xs,
  },
  reminderTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  reminderTimeButton: {
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D4D9E0',
    backgroundColor: '#F8F9FB',
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  reminderTimeButtonText: {
    ...typography.caption,
    color: '#505863',
    fontWeight: '700',
  },
  reminderScheduleText: {
    ...typography.caption,
    color: '#6A717A',
    fontWeight: '600',
  },
  reminderValueText: {
    color: '#7B53CC',
    fontWeight: '700',
  },
  storageValueText: {
    color: '#2A9D50',
    fontWeight: '700',
  },
  reminderPermissionNotice: {
    marginTop: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#F1D08F',
    backgroundColor: '#FFF8E9',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  reminderPermissionText: {
    ...typography.caption,
    color: '#9C6B1A',
    fontWeight: '700',
    flex: 1,
  },
  reminderSettingLink: {
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E2BF7B',
    backgroundColor: '#FFF2D8',
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reminderSettingLinkText: {
    ...typography.caption,
    color: '#8B5E16',
    fontWeight: '700',
  },
  aboutSupportCardPressable: {
    borderRadius: radius.xl,
  },
  aboutSupportCardPressed: {
    opacity: 0.92,
  },
  aboutSupportPrimaryMeta: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  versionPressable: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  devCard: {
    borderRadius: radius.xl,
    backgroundColor: '#FFFDF8',
    borderColor: '#F2DEC0',
    gap: spacing.sm,
  },
  devTitle: {
    ...typography.bodySmall,
    color: '#8A5A22',
    fontWeight: '700',
  },
  devNoticeText: {
    ...typography.caption,
    color: '#8A5A22',
    fontWeight: '600',
  },
  devEntry: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#EDDAC0',
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  devEntryTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  devEntryDesc: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  devCloseButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E0CDAE',
    backgroundColor: '#FFF7EA',
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  devCloseButtonText: {
    ...typography.caption,
    color: '#8A5A22',
    fontWeight: '700',
  },
  safetyNotice: {
    marginTop: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#BFEACD',
    backgroundColor: '#ECF8EF',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  safetyText: {
    ...typography.bodySmall,
    color: '#2A8E4A',
    fontWeight: '600',
    flex: 1,
  },
  toastContainer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    zIndex: 99,
  },
  toastBubble: {
    maxWidth: '100%',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    ...shadows.card,
  },
  toastText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabledButton: {
    opacity: 0.55,
  },
});
