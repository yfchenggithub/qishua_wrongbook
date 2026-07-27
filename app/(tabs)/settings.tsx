import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { type ComponentProps, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast, PageHeader, PageShell, SectionHeader, SurfaceCard } from '@/src/components';
import { useAppToast } from '@/src/hooks/useAppToast';
import { APP_BUILD_DATE, APP_NAME } from '@/src/constants/app';
import { formatElapsedSeconds, useTodayWorksheetExport } from '@/src/hooks/useTodayWorksheetExport';
import {
  getSessionDeveloperModeEnabled,
  setSessionDeveloperModeEnabled,
} from '@/src/services/DeveloperModeService';
import * as ExportImageModeService from '@/src/services/ExportImageModeService';
import { Logger } from '@/src/services/Logger';
import {
  getTodayAutomaticBackup,
  subscribeAutomaticBackup,
  type AutomaticBackupRecord,
} from '@/src/services/backup/AutomaticBackupService';
import * as BackupService from '@/src/services/backup/BackupService';
import { BackupRestoreError } from '@/src/services/backup/BackupRestoreError';
import type { BackupManifest, RestoreProgressEvent } from '@/src/services/backup/BackupTypes';
import { clearPrintEnhanceImageCache } from '@/src/services/export/PrintEnhanceCacheService';
import type { ReviewReminderSettings } from '@/src/services/ReviewReminderService';
import * as ReviewReminderService from '@/src/services/ReviewReminderService';
import { loadSettingsStats, type SettingsStats } from '@/src/services/SettingsStatsService';
import {
  cleanupOrphanImageFiles,
  scanOrphanImageFiles,
  scanStorageUsage,
  type StorageUsageScanResult,
} from '@/src/services/StorageMaintenanceService';
import {
  cleanupHistoricalWorksheetPdfFiles,
  scanHistoricalWorksheetPdfFiles,
} from '@/src/services/TodayWorksheetPdfCacheService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';
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
  pendingReview: 0,
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

  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(
    2,
    '0',
  )}:${String(date.getMinutes()).padStart(2, '0')}`;
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

type SettingsIconName = ComponentProps<typeof MaterialIcons>['name'];

function SettingsIcon({ name }: { name: SettingsIconName }) {
  return (
    <View style={styles.settingsIcon}>
      <MaterialIcons color={colors.accent} name={name} size={layout.iconSize} />
    </View>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {title ? <SectionHeader title={title} variant="group" /> : null}
      <SurfaceCard padding={0} style={styles.settingsGroup}>{children}</SurfaceCard>
    </View>
  );
}

function SettingsDivider() {
  return <View style={styles.settingsDivider} />;
}

function SettingsRow({
  accessibilityLabel,
  disabled = false,
  icon,
  onPress,
  right,
  showChevron = false,
  subtitle,
  title,
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  icon: SettingsIconName;
  onPress: () => void;
  right?: ReactNode;
  showChevron?: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        subtitle ? styles.settingsRowMultiline : null,
        pressed && !disabled ? styles.settingsRowPressed : null,
        disabled ? styles.disabledButton : null,
      ]}>
      <SettingsIcon name={icon} />
      <View style={styles.settingsRowText}>
        <Text numberOfLines={1} style={styles.settingsRowTitle}>{title}</Text>
        {subtitle ? <Text numberOfLines={2} style={styles.settingsRowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.settingsRowRight}>{right}</View> : null}
      {showChevron ? (
        <MaterialIcons color={colors.textTertiary} name="chevron-right" size={layout.chevronSize} />
      ) : null}
    </Pressable>
  );
}

function OverviewStats({ items }: { items: readonly { label: string; value: string }[] }) {
  return (
    <View style={styles.overviewStats}>
      {items.map((item, index) => (
        <View key={item.label} style={styles.overviewStatSlot}>
          {index > 0 ? <View style={styles.overviewDivider} /> : null}
          <View style={styles.overviewStatContent}>
            <Text numberOfLines={1} style={styles.overviewLabel}>{item.label}</Text>
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.68}
              numberOfLines={1}
              style={styles.overviewValue}>
              {item.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [isDevModeUnlocked, setIsDevModeUnlocked] = useState(getSessionDeveloperModeEnabled);
  const [dataOverview, setDataOverview] = useState<SettingsStats>(DEFAULT_DATA_OVERVIEW_STATS);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);
  const [, setIsOverviewRefreshing] = useState(false);
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
  const [automaticBackup, setAutomaticBackup] = useState<AutomaticBackupRecord | null>(null);
  const [isAutomaticBackupLoading, setIsAutomaticBackupLoading] = useState(true);
  const [isSharingBackup, setIsSharingBackup] = useState(false);
  const [isInspectingBackup, setIsInspectingBackup] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isScanningOrphanImages, setIsScanningOrphanImages] = useState(false);
  const [isCleaningOrphanImages, setIsCleaningOrphanImages] = useState(false);
  const [isClearingPrintEnhanceCache, setIsClearingPrintEnhanceCache] = useState(false);
  const [storageUsageScan, setStorageUsageScan] = useState<StorageUsageScanResult | null>(null);
  const [isStorageUsageScanning, setIsStorageUsageScanning] = useState(false);
  const [storageUsageErrorMessage, setStorageUsageErrorMessage] = useState<string | null>(null);
  const [isScanningHistoricalPdfs, setIsScanningHistoricalPdfs] = useState(false);
  const [isCleaningHistoricalPdfs, setIsCleaningHistoricalPdfs] = useState(false);
  const [reminderSettings, setReminderSettings] =
    useState<ReviewReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [isReminderLoading, setIsReminderLoading] = useState(true);
  const [isReminderSwitchBusy, setIsReminderSwitchBusy] = useState(false);
  const [isReminderTimeBusy, setIsReminderTimeBusy] = useState(false);
  const [isReminderPermissionGranted, setIsReminderPermissionGranted] = useState(false);
  const [showReminderPermissionHint, setShowReminderPermissionHint] = useState(false);
  const [activeSheet, setActiveSheet] = useState<'print' | 'storage' | null>(null);

  const hasFocusedRef = useRef(false);
  const lastTapAtRef = useRef<number | null>(null);
  const tapCountRef = useRef(0);
  const skipNextVersionPressRef = useRef(false);
  const { props: toastProps, showToast } = useAppToast({
    defaultDuration: TOAST_DURATION_DEFAULT,
    enterDuration: 160,
    exitDuration: 140,
  });
  const toastBottomOffset = Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg);

  const worksheetPendingCount = Math.max(0, Math.floor(dataOverview.dueToday));
  const {
    isExporting: isExportingWorksheet,
    isRegenerating: isRegeneratingWorksheet,
    hasCachedWorksheet,
    cachedWorksheet,
    progress: worksheetExportProgress,
    progressPercent: worksheetExportProgressPercent,
    exportTodayWorksheet: exportTodayWorksheetShared,
    regenerateTodayWorksheet: regenerateTodayWorksheetShared,
  } = useTodayWorksheetExport({
    scope: PAGE_SCOPE,
    dueToday: worksheetPendingCount,
    longToastDurationMs: TOAST_DURATION_LONG,
    printEnhanceMode: exportImageMode,
    printEnhanceClearPrintStrength: exportClearPrintStrength,
    printEnhanceConcurrency: exportEnhanceConcurrency,
    printEnhancePerformanceProfile: exportEnhancePerformanceProfile,
    showToast,
    onSuccess: (pdfUri: string, pdfUris: string[], pdfPageCounts: number[]) => {
      Logger.info(PAGE_SCOPE, 'navigate_to_pdf_preview', {
        pdfUri,
        pdfFileCount: pdfUris.length,
      });
      router.push({
        pathname: '/pdf-preview',
        params: {
          pdfUri,
          pdfUris: JSON.stringify(pdfUris),
          pdfPageCounts: JSON.stringify(pdfPageCounts),
        },
      } as never);
    },
  });

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

  const loadAutomaticBackupState = useCallback(async () => {
    setIsAutomaticBackupLoading(true);
    try {
      setAutomaticBackup(await getTodayAutomaticBackup());
    } catch (error) {
      setAutomaticBackup(null);
      Logger.warn(PAGE_SCOPE, 'Failed to read today automatic backup in settings.', { error });
      showToast('今日自动备份状态读取失败', 'warning', TOAST_DURATION_LONG);
    } finally {
      setIsAutomaticBackupLoading(false);
    }
  }, [showToast]);

  useEffect(
    () => subscribeAutomaticBackup((backup) => {
      setAutomaticBackup(backup);
    }),
    [],
  );

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

  const loadCategorizedStorageUsage = useCallback(async (showFailureToast = false) => {
    if (isStorageUsageScanning) {
      return;
    }

    const startedAt = Date.now();
    setIsStorageUsageScanning(true);
    setStorageUsageErrorMessage(null);
    Logger.info(PAGE_SCOPE, 'Start loading categorized storage usage.');
    try {
      const result = await scanStorageUsage();
      setStorageUsageScan(result);
      Logger.info(PAGE_SCOPE, 'Loaded categorized storage usage successfully.', {
        elapsedMs: Date.now() - startedAt,
        persistentFileCount: result.persistentFileCount,
        persistentBytes: result.persistentBytes,
        cacheFileCount: result.cacheFileCount,
        cacheBytes: result.cacheBytes,
        unreadableEntryCount: result.unreadableEntryCount,
      });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to load categorized storage usage.', {
        elapsedMs: Date.now() - startedAt,
        error,
      });
      setStorageUsageErrorMessage('分类存储读取失败，请稍后重试');
      if (showFailureToast) {
        showToast('分类存储读取失败，请稍后重试', 'warning', TOAST_DURATION_LONG);
      }
    } finally {
      setIsStorageUsageScanning(false);
    }
  }, [isStorageUsageScanning, showToast]);

  const handleOpenStorageSheet = useCallback(() => {
    setActiveSheet('storage');
    if (!storageUsageScan && !isStorageUsageScanning) {
      void loadCategorizedStorageUsage();
    }
  }, [isStorageUsageScanning, loadCategorizedStorageUsage, storageUsageScan]);

  useFocusEffect(
    useCallback(() => {
      const mode: 'initial' | 'refresh' = hasFocusedRef.current ? 'refresh' : 'initial';
      hasFocusedRef.current = true;
      setIsPrintEnhanceAdvancedVisible(false);
      void loadDataOverview(mode);
      void loadReminderState();
      void loadAutomaticBackupState();
      void loadExportImageMode();
      return undefined;
    }, [loadAutomaticBackupState, loadDataOverview, loadExportImageMode, loadReminderState]),
  );

  const disableDeveloperMode = useCallback(
    (options?: { showDisabledToast?: boolean; source?: 'confirm' | 'long_press' }) => {
      const showDisabledToast = options?.showDisabledToast ?? false;
      const source = options?.source ?? 'confirm';

      Logger.info(PAGE_SCOPE, 'Start disabling developer mode.', { source });
      tapCountRef.current = 0;
      lastTapAtRef.current = null;
      setIsDevModeUnlocked(false);

      setSessionDeveloperModeEnabled(false);

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
      setSessionDeveloperModeEnabled(true);
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
    setSessionDeveloperModeEnabled(true);
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

  const handleShareAutomaticBackup = useCallback(async () => {
    if (
      !automaticBackup
      || isAutomaticBackupLoading
      || isInspectingBackup
      || isRestoring
      || isSharingBackup
    ) {
      return;
    }

    setIsSharingBackup(true);
    try {
      showToast('正在打开分享与导出面板…', 'info', TOAST_DURATION_LONG);
      await BackupService.shareBackup(automaticBackup.fileUri);
      showToast('请选择分享对象或保存位置', 'success', TOAST_DURATION_LONG);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to share today automatic backup.', {
        fileName: automaticBackup.fileName,
        error,
      });
      setAutomaticBackup(null);
      Alert.alert('分享或导出失败', '今天的备份文件暂时不可用，App 运行时会自动重新生成。');
      void loadAutomaticBackupState();
    } finally {
      setIsSharingBackup(false);
    }
  }, [
    automaticBackup,
    isAutomaticBackupLoading,
    isInspectingBackup,
    isRestoring,
    isSharingBackup,
    loadAutomaticBackupState,
    showToast,
  ]);

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
    if (isAutomaticBackupLoading || isInspectingBackup || isRestoring || isSharingBackup) {
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
  }, [
    handleConfirmRestore,
    isAutomaticBackupLoading,
    isInspectingBackup,
    isRestoring,
    isSharingBackup,
    showToast,
  ]);

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


  const handleExportTodayWorksheet = useCallback(async () => {
    await exportTodayWorksheetShared();
  }, [exportTodayWorksheetShared]);

  const handleRegenerateTodayWorksheet = useCallback(() => {
    if (
      isExportingWorksheet
      || !hasCachedWorksheet
      || worksheetPendingCount <= 0
    ) {
      return;
    }

    const generatedAtText = cachedWorksheet?.generatedAt
      ? formatBackupCreatedAt(cachedWorksheet.generatedAt)
      : '时间未知';
    const cachedCount = cachedWorksheet?.exportedCount ?? 0;
    Alert.alert(
      '重新生成今日练习卷？',
      `当前缓存：${generatedAtText} · ${cachedCount} 题。\n\n将根据当前 ${worksheetPendingCount} 道待复做题和当前打印设置重新生成。生成期间原练习卷仍可打开，全部完成后才会自动替换。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '重新生成',
          onPress: () => {
            void regenerateTodayWorksheetShared();
          },
        },
      ],
    );
  }, [
    cachedWorksheet?.exportedCount,
    cachedWorksheet?.generatedAt,
    hasCachedWorksheet,
    isExportingWorksheet,
    regenerateTodayWorksheetShared,
    worksheetPendingCount,
  ]);

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

  const shouldMaskStats = isOverviewLoading && lastUpdatedAt === null;
  const displayNumber = useCallback(
    (value: number) => (shouldMaskStats ? STATS_PLACEHOLDER : String(value)),
    [shouldMaskStats],
  );
  const displayStorageText = shouldMaskStats
    ? STATS_PLACEHOLDER
    : formatStorageSize(dataOverview.storageBytes);
  const storageRowSummary = storageUsageScan
    ? `数据 ${formatStorageSize(storageUsageScan.persistentBytes)}`
    : `图片 ${displayStorageText}`;
  const canExportTodayWorksheet = worksheetPendingCount > 0 || hasCachedWorksheet;
  const canRegenerateTodayWorksheet =
    hasCachedWorksheet && worksheetPendingCount > 0 && !isExportingWorksheet;
  const worksheetExportButtonText = hasCachedWorksheet
    ? '打开今日练习卷'
    : isExportingWorksheet
      ? '练习卷准备中'
      : '准备今日练习卷';
  const worksheetExportHintText = isExportingWorksheet
    ? isRegeneratingWorksheet
      ? '正在后台重新生成，当前练习卷仍可正常打开。'
      : '系统正在后台准备，完成后点击即可直接打开。'
    : hasCachedWorksheet
      ? '今日练习卷已缓存，点击后将快速读取并打开。'
      : canExportTodayWorksheet
      ? `系统将自动准备今日待复做的 ${worksheetPendingCount} 题。`
      : '今日没有待复做错题，暂不可导出。';
  const worksheetExportProgressHeadline = isExportingWorksheet
    ? (worksheetExportProgress.message || worksheetExportButtonText)
    : hasCachedWorksheet
      ? (worksheetExportProgress.message || worksheetExportHintText)
      : worksheetExportHintText;
  const worksheetExportProgressDetailText =
    isExportingWorksheet && worksheetExportProgress.total > 0
      ? `已处理 ${worksheetExportProgress.current} / ${worksheetExportProgress.total} 题 · 用时 ${formatElapsedSeconds(worksheetExportProgress.elapsedSeconds)}`
      : '';
  const backupButtonText = isSharingBackup ? '正在打开…' : '分享/导出';
  const automaticBackupSubtitle = automaticBackup
    ? `生成于 ${formatBackupCreatedAt(automaticBackup.createdAt)} · ${formatStorageSize(automaticBackup.fileSizeBytes)}`
    : isAutomaticBackupLoading
      ? '正在读取今天的备份状态…'
      : '今日备份正在自动生成，完成后可分享/导出';
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
  const shouldShowPrintEnhanceAdvancedSettings =
    exportImageMode === 'clear_print' && isPrintEnhanceAdvancedVisible;

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

  const cleanupHistoricalPdfs = useCallback(
    async (candidateUris: string[]) => {
      if (isCleaningHistoricalPdfs) {
        return;
      }

      Logger.info(PAGE_SCOPE, 'Start cleaning historical worksheet PDFs from settings.', {
        targetCount: candidateUris.length,
      });
      setIsCleaningHistoricalPdfs(true);
      try {
        const result = await cleanupHistoricalWorksheetPdfFiles(candidateUris);
        if (result.deletedCount <= 0 && result.failedCount <= 0) {
          showToast(
            result.skippedCount > 0 ? '文件状态已变化，未清理任何 PDF' : '没有可清理的历史 PDF',
            'info',
          );
        } else if (result.failedCount > 0) {
          showToast(
            `已清理 ${result.deletedCount} 个历史文件，部分文件清理失败`,
            'warning',
            TOAST_DURATION_LONG,
          );
        } else {
          showToast(
            `已清理 ${result.deletedCount} 个历史文件，释放 ${formatStorageSize(result.releasedBytes)}`,
            'success',
            TOAST_DURATION_LONG,
          );
        }

        Logger.info(PAGE_SCOPE, 'Finished cleaning historical worksheet PDFs from settings.', {
          ...result,
        });
        await loadCategorizedStorageUsage();
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to clean historical worksheet PDFs.', { error });
        showToast('历史 PDF 清理失败，请稍后重试', 'error', TOAST_DURATION_LONG);
      } finally {
        setIsCleaningHistoricalPdfs(false);
      }
    },
    [isCleaningHistoricalPdfs, loadCategorizedStorageUsage, showToast],
  );

  const handleCleanHistoricalPdfs = useCallback(async () => {
    if (isScanningHistoricalPdfs || isCleaningHistoricalPdfs) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'Start scanning historical worksheet PDFs from settings.');
    setIsScanningHistoricalPdfs(true);
    try {
      const scanResult = await scanHistoricalWorksheetPdfFiles();
      Logger.info(PAGE_SCOPE, 'Finished scanning historical worksheet PDFs from settings.', {
        candidatePdfCount: scanResult.candidatePdfCount,
        candidateIndexCount: scanResult.candidateIndexCount,
        candidateBytes: scanResult.candidateBytes,
        protectedFileCount: scanResult.protectedFileCount,
        unreadableFileCount: scanResult.unreadableFileCount,
      });

      if (scanResult.candidates.length <= 0) {
        showToast('没有可清理的历史 PDF', 'info');
        return;
      }

      const unreadableHint = scanResult.unreadableFileCount > 0
        ? `\n另有 ${scanResult.unreadableFileCount} 个文件无法读取，本次不会处理。`
        : '';
      Alert.alert(
        '清理历史 PDF？',
        `发现 ${scanResult.candidatePdfCount} 个历史 PDF 和 ${scanResult.candidateIndexCount} 个旧索引文件，预计释放 ${formatStorageSize(scanResult.candidateBytes)}。\n\n将保留今天仍有效的练习卷和最近 10 分钟生成的文件。${unreadableHint}`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '清理',
            style: 'destructive',
            onPress: () => {
              void cleanupHistoricalPdfs(
                scanResult.candidates.map((candidate) => candidate.uri),
              );
            },
          },
        ],
      );
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to scan historical worksheet PDFs.', { error });
      showToast('历史 PDF 扫描失败，请稍后重试', 'error', TOAST_DURATION_LONG);
    } finally {
      setIsScanningHistoricalPdfs(false);
    }
  }, [
    cleanupHistoricalPdfs,
    isCleaningHistoricalPdfs,
    isScanningHistoricalPdfs,
    showToast,
  ]);

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
      { label: '待复做', value: displayNumber(dataOverview.pendingReview) },
      { label: '已掌握', value: displayNumber(dataOverview.mastered) },
      { label: '累计复做', value: displayNumber(dataOverview.totalReviews) },
    ],
    [dataOverview, displayNumber],
  );
  const isStorageBusy =
    isScanningOrphanImages
    || isCleaningOrphanImages
    || isClearingPrintEnhanceCache
    || isStorageUsageScanning
    || isScanningHistoricalPdfs
    || isCleaningHistoricalPdfs;
  const isRestoreBusy = isInspectingBackup || isRestoring;
  const isBackupBusy = isAutomaticBackupLoading || isSharingBackup || isRestoreBusy;
  const canShareAutomaticBackup = automaticBackup !== null && !isBackupBusy;
  const isExportImageModeBusy =
    isExportingWorksheet || isExportImageModeLoading || isExportImageModeSaving;
  const isReminderBusy = isReminderLoading || isReminderSwitchBusy || isReminderTimeBusy;
  const reminderTimeText = formatReminderTime(reminderSettings.hour, reminderSettings.minute);
  const canEditReminderTime = !isReminderLoading && !isReminderTimeBusy && !isReminderSwitchBusy;
  const shouldShowReminderPermissionNotice =
    !isReminderPermissionGranted && (showReminderPermissionHint || reminderSettings.enabled);

  return (
    <View style={styles.pageRoot}>
      <PageShell
        scroll
        hasBottomTab
        safeAreaEdges={['top']}
        style={styles.screen}
        contentStyle={styles.screenContent}>
        <PageHeader showOffline subtitle="数据仅保存在本机" title="设置" />

        <SettingsSection>
          <View style={styles.backupPrimaryRow}>
            <SettingsIcon name="verified-user" />
            <View style={styles.backupPrimaryText}>
              <Text numberOfLines={1} style={styles.backupPrimaryTitle}>
                {automaticBackup ? '今日已自动备份' : '自动备份'}
              </Text>
              <Text numberOfLines={2} style={styles.settingsRowSubtitle}>
                {automaticBackupSubtitle}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={backupButtonText}
              accessibilityRole="button"
              accessibilityState={{ busy: isSharingBackup, disabled: !canShareAutomaticBackup }}
              disabled={!canShareAutomaticBackup}
              onPress={() => {
                void handleShareAutomaticBackup();
              }}
              style={({ pressed }) => [
                styles.backupButton,
                pressed && canShareAutomaticBackup ? styles.primaryButtonPressed : null,
                !canShareAutomaticBackup ? styles.disabledButton : null,
              ]}>
              {isSharingBackup ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
              <Text numberOfLines={1} style={styles.backupButtonText}>{backupButtonText}</Text>
            </Pressable>
          </View>
          <SettingsDivider />
          <SettingsRow
            disabled={isBackupBusy}
            icon="restore"
            onPress={handleRestoreFromBackup}
            right={isRestoreBusy ? <ActivityIndicator color={colors.accent} size="small" /> : undefined}
            showChevron={!isRestoreBusy}
            subtitle={isRestoring ? '正在恢复数据…' : isInspectingBackup ? '正在检查备份文件…' : undefined}
            title="从备份文件恢复"
          />
        </SettingsSection>

        <SettingsSection title="学习概览">
          <OverviewStats items={statsItems} />
          {overviewErrorMessage ? <Text style={styles.compactErrorText}>{overviewErrorMessage}</Text> : null}
        </SettingsSection>

        <SettingsSection title="学习与复做">
          <SettingsRow
            disabled={!canEditReminderTime}
            icon="notifications-none"
            onPress={handleOpenReminderTimePicker}
            right={
              <Switch
                accessibilityLabel="复做提醒开关"
                disabled={isReminderBusy}
                onValueChange={(nextValue) => {
                  void handleToggleReminder(nextValue);
                }}
                thumbColor="#FFFFFF"
                trackColor={{ false: '#D1D1D6', true: colors.accent }}
                onTouchStart={(event) => event.stopPropagation()}
                value={reminderSettings.enabled}
              />
            }
            subtitle={'每天 ' + reminderTimeText}
            title="复做提醒"
          />
          <SettingsDivider />
          <SettingsRow
            icon="print"
            onPress={() => setActiveSheet('print')}
            right={<Text numberOfLines={1} style={styles.rowValueText}>
              {isExportImageModeLoading
                ? '读取中…'
                : exportImageMode === 'original'
                  ? '原图'
                  : '清晰打印'}
            </Text>}
            showChevron
            title="打印与导出"
          />
          {shouldShowReminderPermissionNotice ? (
            <View style={styles.permissionNotice}>
              <MaterialIcons color={colors.accent} name="notifications-off" size={18} />
              <Text style={styles.permissionNoticeText}>通知权限未开启，暂时无法收到提醒</Text>
              <Pressable
                accessibilityRole="button"
                onPress={handleOpenNotificationSettings}
                style={styles.permissionAction}>
                <Text style={styles.permissionActionText}>去设置</Text>
              </Pressable>
            </View>
          ) : null}
        </SettingsSection>

        <SettingsSection title="存储">
          <SettingsRow
            icon="storage"
            onPress={handleOpenStorageSheet}
            right={<Text numberOfLines={1} style={styles.rowValueText}>
              {storageRowSummary}
            </Text>}
            showChevron
            title="本机存储"
          />
          <SettingsDivider />
          <SettingsRow
            disabled={isStorageBusy}
            icon="delete-outline"
            onPress={() => {
              void handleCleanInvalidImages();
            }}
            right={isScanningOrphanImages || isCleaningOrphanImages
              ? <ActivityIndicator color={colors.accent} size="small" />
              : undefined}
            showChevron={!isScanningOrphanImages && !isCleaningOrphanImages}
            title="清理无效图片"
          />
        </SettingsSection>

        <SettingsSection title="支持">
          <SettingsRow
            icon="menu-book"
            onPress={() =>
              showToast('拍照录入错题 → 每天复做 → 做会后进入下一刷 → 七刷后标记掌握', 'info', 3400)
            }
            showChevron
            title="使用说明"
          />
          <SettingsDivider />
          <SettingsRow
            icon="info-outline"
            onPress={handleOpenAboutSupport}
            right={
              <Pressable
                accessibilityLabel="版本信息"
                accessibilityRole="button"
                delayLongPress={650}
                hitSlop={10}
                onLongPress={handleVersionLongPress}
                onPress={handleVersionTap}
                style={styles.versionTapTarget}>
                <Text style={styles.rowValueText}>{APP_BUILD_DATE}</Text>
              </Pressable>
            }
            showChevron
            title={'关于' + APP_NAME}
          />
        </SettingsSection>

        {isDevModeUnlocked ? (
          <SettingsSection title="开发者工具">
            {DEV_ENTRIES.map((entry, index) => (
              <View key={entry.href}>
                {index > 0 ? <SettingsDivider /> : null}
                <SettingsRow
                  icon={index === 0 ? 'storage' : index === 1 ? 'image-search' : 'description'}
                  onPress={() => router.push(entry.href as never)}
                  subtitle={entry.description}
                  showChevron
                  title={entry.title}
                />
              </View>
            ))}
            <SettingsDivider />
            <SettingsRow
              icon="visibility-off"
              onPress={handleDisableDeveloperMode}
              title="关闭开发者模式"
            />
          </SettingsSection>
        ) : null}

        <View style={styles.localDataNotice}>
          <MaterialIcons color="#8E8E93" name="lock-outline" size={17} />
          <Text style={styles.localDataNoticeText}>数据仅保存在本机，卸载 App 会删除本地数据</Text>
        </View>
      </PageShell>

      <Modal
        animationType="slide"
        onRequestClose={() => setActiveSheet(null)}
        transparent
        visible={activeSheet !== null}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="关闭设置面板"
            accessibilityRole="button"
            onPress={() => setActiveSheet(null)}
            style={styles.modalBackdrop}
          />
          <View style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.sheetHeader}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>
                {activeSheet === 'print' ? '打印与导出' : '存储详情'}
              </Text>
              <Pressable
                accessibilityLabel="关闭"
                accessibilityRole="button"
                onPress={() => setActiveSheet(null)}
                style={({ pressed }) => [
                  styles.sheetCloseButton,
                  pressed ? styles.settingsRowPressed : null,
                ]}>
                <MaterialIcons color="#3A3A3C" name="close" size={22} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}>
              {activeSheet === 'print' ? (
                <>
                  <View style={styles.sheetSection}>
                    <Text style={styles.sheetSectionTitle}>图片模式</Text>
                    <View style={styles.optionGroup}>
                      {EXPORT_IMAGE_MODE_OPTIONS.map((option) => {
                        const isSelected = option.mode === exportImageMode;
                        return (
                          <Pressable
                            key={option.mode}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: isSelected, disabled: isExportImageModeBusy }}
                            disabled={isExportImageModeBusy}
                            onPress={() => {
                              void handleSelectExportImageMode(option.mode);
                            }}
                            style={({ pressed }) => [
                              styles.modeOption,
                              isSelected ? styles.modeOptionSelected : null,
                              pressed && !isExportImageModeBusy ? styles.settingsRowPressed : null,
                              isExportImageModeBusy ? styles.disabledButton : null,
                            ]}>
                            <View style={styles.modeOptionText}>
                              <Text style={styles.modeOptionTitle}>{option.title}</Text>
                              <Text style={styles.modeOptionDescription}>{option.description}</Text>
                            </View>
                            <MaterialIcons
                              color={isSelected ? colors.accent : '#C7C7CC'}
                              name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
                              size={22}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={styles.modeExplanation}>
                      <Text style={styles.modeExplanationTitle}>当前模式说明</Text>
                      <Text style={styles.modeExplanationText}>
                        {selectedExportImageModeOption.description}
                      </Text>
                    </View>
                  </View>

                  {exportImageMode === 'clear_print' ? (
                    <View style={styles.sheetSection}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={handleTogglePrintEnhanceAdvancedSettings}
                        style={({ pressed }) => [
                          styles.advancedDisclosure,
                          pressed ? styles.settingsRowPressed : null,
                        ]}>
                        <Text style={styles.sheetSectionTitle}>高级打印设置</Text>
                        <MaterialIcons
                          color="#8E8E93"
                          name={shouldShowPrintEnhanceAdvancedSettings ? 'expand-less' : 'expand-more'}
                          size={24}
                        />
                      </Pressable>

                      {shouldShowPrintEnhanceAdvancedSettings ? (
                        <View style={styles.advancedContent}>
                          <Text style={styles.controlLabel}>清晰打印强度</Text>
                          <View style={styles.segmentedControl}>
                            {CLEAR_PRINT_STRENGTH_OPTIONS.map((option) => {
                              const isSelected = option.value === exportClearPrintStrength;
                              return (
                                <Pressable
                                  key={option.value}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: isSelected }}
                                  disabled={isExportImageModeBusy}
                                  onPress={() => {
                                    void handleSelectClearPrintStrength(option.value);
                                  }}
                                  style={[
                                    styles.segmentButton,
                                    isSelected ? styles.segmentButtonSelected : null,
                                  ]}>
                                  <Text style={[
                                    styles.segmentButtonText,
                                    isSelected ? styles.segmentButtonTextSelected : null,
                                  ]}>{option.title}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          <Text style={styles.controlDescription}>
                            {selectedClearPrintStrengthOption.description}
                          </Text>

                          <Text style={styles.controlLabel}>增强策略</Text>
                          <View style={styles.segmentedControl}>
                            {ENHANCE_PERFORMANCE_OPTIONS.map((option) => {
                              const isSelected = option.value === exportEnhancePerformanceProfile;
                              return (
                                <Pressable
                                  key={option.value}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: isSelected }}
                                  disabled={isExportImageModeBusy}
                                  onPress={() => {
                                    void handleSelectEnhancePerformanceProfile(option.value);
                                  }}
                                  style={[
                                    styles.segmentButton,
                                    isSelected ? styles.segmentButtonSelected : null,
                                  ]}>
                                  <Text style={[
                                    styles.segmentButtonText,
                                    isSelected ? styles.segmentButtonTextSelected : null,
                                  ]}>{option.title}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          <Text style={styles.controlDescription}>
                            {selectedEnhancePerformanceOption.description}
                          </Text>

                          <Text style={styles.controlLabel}>并发数量</Text>
                          <View style={styles.segmentedControl}>
                            {ENHANCE_CONCURRENCY_OPTIONS.map((option) => {
                              const isSelected = option.value === exportEnhanceConcurrency;
                              return (
                                <Pressable
                                  key={option.value}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: isSelected }}
                                  disabled={isExportImageModeBusy}
                                  onPress={() => {
                                    void handleSelectEnhanceConcurrency(option.value);
                                  }}
                                  style={[
                                    styles.segmentButton,
                                    isSelected ? styles.segmentButtonSelected : null,
                                  ]}>
                                  <Text style={[
                                    styles.segmentButtonText,
                                    isSelected ? styles.segmentButtonTextSelected : null,
                                  ]}>{option.title}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          <Text style={styles.controlDescription}>
                            {selectedEnhanceConcurrencyOption.description}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={styles.sheetSection}>
                    <View style={styles.exportSummary}>
                      <View>
                        <Text style={styles.sheetSectionTitle}>今日练习卷</Text>
                        <Text style={styles.exportPendingText}>
                          实际待复做 {worksheetPendingCount} 题
                        </Text>
                      </View>
                      <MaterialIcons color={colors.accent} name="picture-as-pdf" size={26} />
                    </View>
                    <Pressable
                      accessibilityLabel={worksheetExportButtonText}
                      accessibilityRole="button"
                      accessibilityState={{
                        disabled: !canExportTodayWorksheet,
                      }}
                      disabled={!canExportTodayWorksheet}
                      onPress={() => {
                        void handleExportTodayWorksheet();
                      }}
                      style={({ pressed }) => [
                        styles.primarySheetButton,
                        pressed && canExportTodayWorksheet
                          ? styles.primaryButtonPressed
                          : null,
                        !canExportTodayWorksheet
                          ? styles.disabledButton
                          : null,
                      ]}>
                      <Text numberOfLines={2} style={styles.primarySheetButtonText}>
                        {worksheetExportButtonText}
                      </Text>
                    </Pressable>
                    {hasCachedWorksheet ? (
                      <Pressable
                        accessibilityLabel={
                          isRegeneratingWorksheet
                            ? '正在重新生成今日练习卷'
                            : '重新生成今日练习卷'
                        }
                        accessibilityRole="button"
                        accessibilityState={{
                          busy: isRegeneratingWorksheet,
                          disabled: !canRegenerateTodayWorksheet,
                        }}
                        disabled={!canRegenerateTodayWorksheet}
                        onPress={handleRegenerateTodayWorksheet}
                        style={({ pressed }) => [
                          styles.secondarySheetButton,
                          pressed && canRegenerateTodayWorksheet
                            ? styles.settingsRowPressed
                            : null,
                          !canRegenerateTodayWorksheet
                            ? styles.disabledButton
                            : null,
                        ]}>
                        {isRegeneratingWorksheet
                          ? <ActivityIndicator color={colors.accent} size="small" />
                          : <MaterialIcons color={colors.accent} name="refresh" size={20} />}
                        <Text style={styles.secondarySheetButtonText}>
                          {isRegeneratingWorksheet
                            ? '正在重新生成…'
                            : worksheetPendingCount > 0
                              ? '重新生成今日练习卷'
                              : '当前无待复做题'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Text style={styles.exportHint}>{worksheetExportProgressHeadline}</Text>
                    {worksheetExportProgressDetailText ? (
                      <Text style={styles.exportProgressMeta}>{worksheetExportProgressDetailText}</Text>
                    ) : null}
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { flex: worksheetExportProgressPercent }]} />
                      <View style={{ flex: Math.max(0, 1 - worksheetExportProgressPercent) }} />
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.sheetSection}>
                    <Text style={styles.sheetSectionTitle}>本机占用</Text>
                    <View style={styles.storageMetrics}>
                      <View style={styles.storageMetricRow}>
                        <Text style={styles.storageMetricLabel}>错题数量</Text>
                        <Text style={styles.storageMetricValue}>
                          {displayNumber(dataOverview.totalMistakes)} 道
                        </Text>
                      </View>
                      <View style={styles.metricDivider} />
                      <View style={styles.storageMetricRow}>
                        <Text style={styles.storageMetricLabel}>图片数量</Text>
                        <Text style={styles.storageMetricValue}>
                          {displayNumber(dataOverview.imageCount)} 张
                        </Text>
                      </View>
                      <View style={styles.metricDivider} />
                      <View style={styles.storageMetricRow}>
                        <Text style={styles.storageMetricLabel}>复做记录</Text>
                        <Text style={styles.storageMetricValue}>
                          {displayNumber(dataOverview.totalReviews)} 条
                        </Text>
                      </View>
                      <View style={styles.metricDivider} />
                      <View style={styles.storageMetricRow}>
                        <Text style={styles.storageMetricLabel}>当前图片占用</Text>
                        <Text style={styles.storageMetricValue}>{displayStorageText}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.sheetSection}>
                    <View style={styles.storageScanTitleRow}>
                      <Text style={styles.sheetSectionTitle}>分类存储扫描</Text>
                      <Text style={styles.readOnlyBadge}>只读</Text>
                    </View>
                    <Text style={styles.sheetBodyText}>
                      读取 App 可访问的私有文件并按目录分类，不会修改或删除任何数据。持久数据可用于和系统“数据”占用对比。
                    </Text>

                    {isStorageUsageScanning && !storageUsageScan ? (
                      <View style={styles.storageScanLoadingRow}>
                        <ActivityIndicator color={colors.accent} size="small" />
                        <Text style={styles.storageScanStatusText}>正在扫描本机文件…</Text>
                      </View>
                    ) : null}

                    {storageUsageScan ? (
                      <>
                        <View style={styles.storageMetrics}>
                          <View style={styles.storageMetricRow}>
                            <Text style={styles.storageMetricLabel}>持久数据</Text>
                            <Text style={styles.storageMetricValue}>
                              {formatStorageSize(storageUsageScan.persistentBytes)}
                            </Text>
                          </View>
                          <View style={styles.metricDivider} />
                          <View style={styles.storageMetricRow}>
                            <Text style={styles.storageMetricLabel}>缓存数据</Text>
                            <Text style={styles.storageMetricValue}>
                              {formatStorageSize(storageUsageScan.cacheBytes)}
                            </Text>
                          </View>
                          <View style={styles.metricDivider} />
                          <View style={styles.storageMetricRow}>
                            <Text style={styles.storageMetricLabel}>扫描合计</Text>
                            <Text style={styles.storageMetricValue}>
                              {formatStorageSize(storageUsageScan.totalBytes)}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.storageCategoryHeading}>分类明细</Text>
                        <View style={styles.storageMetrics}>
                          {storageUsageScan.categories.map((category, index) => (
                            <View key={category.id}>
                              {index > 0 ? <View style={styles.metricDivider} /> : null}
                              <View style={styles.storageMetricRow}>
                                <Text style={styles.storageMetricLabel}>{category.label}</Text>
                                <Text numberOfLines={1} style={styles.storageCategoryValue}>
                                  {formatStorageSize(category.totalBytes)} · {category.fileCount} 个
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>

                        <Text style={styles.storageScanFootnote}>
                          共扫描 {storageUsageScan.totalFileCount} 个文件。不含安装包；系统内部元数据可能造成少量差异。
                        </Text>
                        {storageUsageScan.unreadableEntryCount > 0 ? (
                          <Text style={styles.storageScanWarning}>
                            有 {storageUsageScan.unreadableEntryCount} 个项目无法读取，当前结果可能偏小。
                          </Text>
                        ) : null}
                      </>
                    ) : null}

                    {storageUsageErrorMessage ? (
                      <Text style={styles.storageScanWarning}>{storageUsageErrorMessage}</Text>
                    ) : null}

                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ busy: isStorageUsageScanning, disabled: isStorageBusy }}
                      disabled={isStorageBusy}
                      onPress={() => {
                        void loadCategorizedStorageUsage(true);
                      }}
                      style={({ pressed }) => [
                        styles.secondarySheetButton,
                        pressed && !isStorageBusy ? styles.settingsRowPressed : null,
                        isStorageBusy ? styles.disabledButton : null,
                      ]}>
                      {isStorageUsageScanning
                        ? <ActivityIndicator color={colors.accent} size="small" />
                        : <MaterialIcons color={colors.accent} name="refresh" size={20} />}
                      <Text style={styles.secondarySheetButtonText}>
                        {isStorageUsageScanning
                          ? '正在扫描…'
                          : storageUsageScan
                            ? '重新扫描'
                            : '开始扫描'}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.sheetSection}>
                    <Text style={styles.sheetSectionTitle}>PDF 维护</Text>
                    <Text style={styles.sheetBodyText}>
                      扫描并清理以前日期的练习卷、旧索引和生成失败后遗留的 PDF。今天仍有效的练习卷不会删除，清理前会再次确认。
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        busy: isScanningHistoricalPdfs || isCleaningHistoricalPdfs,
                        disabled: isStorageBusy,
                      }}
                      disabled={isStorageBusy}
                      onPress={() => {
                        void handleCleanHistoricalPdfs();
                      }}
                      style={({ pressed }) => [
                        styles.secondarySheetButton,
                        pressed && !isStorageBusy ? styles.settingsRowPressed : null,
                        isStorageBusy ? styles.disabledButton : null,
                      ]}>
                      {isScanningHistoricalPdfs || isCleaningHistoricalPdfs
                        ? <ActivityIndicator color={colors.accent} size="small" />
                        : <MaterialIcons color={colors.accent} name="delete-sweep" size={20} />}
                      <Text style={styles.secondarySheetButtonText}>
                        {isScanningHistoricalPdfs
                          ? '正在扫描历史 PDF…'
                          : isCleaningHistoricalPdfs
                            ? '正在清理历史 PDF…'
                            : '清理历史 PDF'}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.sheetSection}>
                    <Text style={styles.sheetSectionTitle}>缓存维护</Text>
                    <Text style={styles.sheetBodyText}>
                      清理打印增强过程中产生的临时图片，不会删除错题正在使用的原图。
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ busy: isClearingPrintEnhanceCache, disabled: isStorageBusy }}
                      disabled={isStorageBusy}
                      onPress={() => {
                        void handleClearPrintEnhanceCache();
                      }}
                      style={({ pressed }) => [
                        styles.secondarySheetButton,
                        pressed && !isStorageBusy ? styles.settingsRowPressed : null,
                        isStorageBusy ? styles.disabledButton : null,
                      ]}>
                      {isClearingPrintEnhanceCache
                        ? <ActivityIndicator color={colors.accent} size="small" />
                        : <MaterialIcons color={colors.accent} name="cleaning-services" size={20} />}
                      <Text style={styles.secondarySheetButtonText}>
                        {isClearingPrintEnhanceCache ? '正在清理…' : '清理图片缓存'}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
          <AppToast {...toastProps} bottomOffset={Math.max(insets.bottom + 24, 32)} />
        </View>
      </Modal>

      <AppToast {...toastProps} bottomOffset={toastBottomOffset} />
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: colors.pageBackground,
  },
  screen: {
    backgroundColor: colors.pageBackground,
  },
  screenContent: {
    backgroundColor: colors.pageBackground,
    paddingTop: layout.headerTopPadding,
  },
  section: {
    gap: spacing.sm,
    marginBottom: spacing.xxl,
  },
  settingsGroup: {
    overflow: 'hidden',
  },
  settingsIcon: {
    width: layout.featureIconSize,
    height: layout.featureIconSize,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  settingsRow: {
    minHeight: 64,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  settingsRowMultiline: {
    minHeight: 72,
  },
  settingsRowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  settingsRowText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  settingsRowTitle: {
    ...typography.cardTitle,
    fontSize: 16,
    lineHeight: 22,
  },
  settingsRowSubtitle: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  settingsRowRight: {
    flexShrink: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  settingsDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 76,
    backgroundColor: colors.separator,
  },
  rowValueText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    textAlign: 'right',
  },
  backupPrimaryRow: {
    minHeight: 88,
    paddingHorizontal: spacing.card,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backupPrimaryText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  backupPrimaryTitle: {
    ...typography.cardTitle,
    fontWeight: '700',
  },
  backupButton: {
    minWidth: 98,
    minHeight: 44,
    height: layout.minimumTouchSize,
    borderRadius: radius.md,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    flexShrink: 0,
  },
  backupButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  primaryButtonPressed: {
    opacity: 0.82,
  },
  inlineStatus: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    paddingHorizontal: spacing.card,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: '#FBFBFC',
  },
  inlineStatusHeader: {
    gap: 2,
  },
  inlineStatusTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  inlineStatusMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.separator,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  progressFill: {
    backgroundColor: colors.accent,
  },
  inlineLinkButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineLinkText: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  overviewStats: {
    minHeight: 104,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  overviewStatSlot: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  overviewDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: 5,
    backgroundColor: colors.separator,
  },
  overviewStatContent: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  overviewLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    textAlign: 'center',
  },
  overviewValue: {
    color: colors.accent,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '800',
    textAlign: 'center',
    maxWidth: '100%',
  },
  compactErrorText: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
    color: '#D84A4A',
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  permissionNotice: {
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    paddingHorizontal: spacing.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  permissionNoticeText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  permissionAction: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionActionText: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  versionTapTarget: {
    minHeight: 44,
    minWidth: 54,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  localDataNotice: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  localDataNoticeText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
    flexShrink: 1,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  bottomSheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#F2F2F7',
    overflow: 'hidden',
  },
  sheetHeader: {
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D1D6',
    paddingLeft: 20,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
  },
  sheetTitle: {
    color: '#1C1C1E',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  sheetCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetContent: {
    padding: 16,
    paddingBottom: 28,
    gap: 16,
  },
  sheetSection: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    padding: 14,
    gap: 12,
  },
  sheetSectionTitle: {
    color: '#1C1C1E',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  storageScanTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  readOnlyBadge: {
    borderRadius: 10,
    backgroundColor: '#EAF7EE',
    color: colors.accent,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sheetBodyText: {
    color: '#6E6E73',
    fontSize: 13,
    lineHeight: 19,
  },
  storageScanLoadingRow: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#F7F7F9',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  storageScanStatusText: {
    color: '#6E6E73',
    fontSize: 13,
    lineHeight: 19,
  },
  optionGroup: {
    gap: 8,
  },
  modeOption: {
    minHeight: 68,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeOptionSelected: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  modeOptionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  modeOptionTitle: {
    color: '#1C1C1E',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  modeOptionDescription: {
    color: colors.textTertiary,
    fontSize: 12,
    lineHeight: 17,
  },
  modeExplanation: {
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
    padding: 12,
    gap: 3,
  },
  modeExplanationTitle: {
    color: '#3A3A3C',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  modeExplanationText: {
    color: '#6E6E73',
    fontSize: 12,
    lineHeight: 18,
  },
  advancedDisclosure: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  advancedContent: {
    gap: 9,
  },
  controlLabel: {
    color: '#3A3A3C',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 3,
  },
  segmentedControl: {
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#F2F2F7',
    padding: 3,
    flexDirection: 'row',
    gap: 3,
  },
  segmentButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segmentButtonSelected: {
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: '#FFFFFF',
  },
  segmentButtonText: {
    color: '#6E6E73',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  segmentButtonTextSelected: {
    color: colors.accent,
  },
  controlDescription: {
    color: '#8E8E93',
    fontSize: 12,
    lineHeight: 17,
  },
  exportSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  exportPendingText: {
    color: '#6E6E73',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  primarySheetButton: {
    minHeight: 48,
    borderRadius: 13,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primarySheetButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  exportHint: {
    color: '#6E6E73',
    fontSize: 12,
    lineHeight: 18,
  },
  exportProgressMeta: {
    color: '#8E8E93',
    fontSize: 12,
    lineHeight: 17,
  },
  storageMetrics: {
    borderRadius: 12,
    backgroundColor: '#F7F7F9',
    overflow: 'hidden',
  },
  storageMetricRow: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  storageMetricLabel: {
    color: '#3A3A3C',
    fontSize: 14,
    lineHeight: 20,
  },
  storageMetricValue: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'right',
  },
  storageCategoryHeading: {
    color: '#3A3A3C',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  storageCategoryValue: {
    flexShrink: 1,
    color: colors.accent,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'right',
  },
  storageScanFootnote: {
    color: '#8E8E93',
    fontSize: 12,
    lineHeight: 18,
  },
  storageScanWarning: {
    color: '#B36B00',
    fontSize: 12,
    lineHeight: 18,
  },
  metricDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 12,
    backgroundColor: '#E5E5EA',
  },
  secondarySheetButton: {
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondarySheetButtonText: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.55,
  },
});
