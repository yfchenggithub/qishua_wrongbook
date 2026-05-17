import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandHeader, CardContainer, ScreenContainer } from '@/src/components';
import { loadDeveloperModeEnabled, saveDeveloperModeEnabled } from '@/src/services/DeveloperModeService';
import { Logger } from '@/src/services/Logger';
import { loadSettingsStats, type SettingsStats } from '@/src/services/SettingsStatsService';
import { cleanupOrphanImageFiles, scanOrphanImageFiles } from '@/src/services/StorageMaintenanceService';
import * as TodayWorksheetExportService from '@/src/services/TodayWorksheetExportService';
import { colors, layout, radius, shadows, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'SettingsScreen';
const VERSION_VALUE = '0.1.0';
const TOAST_DURATION_DEFAULT = 1800;
const TOAST_DURATION_LONG = 2800;
const DEV_UNLOCK_TAP_TARGET = 7;
const DEV_TAP_WINDOW_MS = 3000;
const DEV_UNLOCK_HINT_FIRST = DEV_UNLOCK_TAP_TARGET - 2;
const DEV_UNLOCK_HINT_SECOND = DEV_UNLOCK_TAP_TARGET - 1;
const STATS_PLACEHOLDER = '--';

type ToastType = 'success' | 'info' | 'warning' | 'error';

type DevRoute = '/dev/db' | '/dev/images' | '/dev/logs';

type DevEntry = {
  title: string;
  description: string;
  href: DevRoute;
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

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [isDevModeUnlocked, setIsDevModeUnlocked] = useState(false);
  const [dataOverview, setDataOverview] = useState<SettingsStats>(DEFAULT_DATA_OVERVIEW_STATS);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);
  const [isOverviewRefreshing, setIsOverviewRefreshing] = useState(false);
  const [overviewErrorMessage, setOverviewErrorMessage] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isExportingWorksheet, setIsExportingWorksheet] = useState(false);
  const [isScanningOrphanImages, setIsScanningOrphanImages] = useState(false);
  const [isCleaningOrphanImages, setIsCleaningOrphanImages] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
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
      void loadDataOverview(mode);
      return undefined;
    }, [loadDataOverview]),
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
    if (!isDevModeUnlocked) {
      return;
    }

    skipNextVersionPressRef.current = true;
    disableDeveloperMode({ showDisabledToast: true, source: 'long_press' });
  }, [disableDeveloperMode, isDevModeUnlocked]);

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

  const handleStartBackup = useCallback(() => {
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
  }, [showToast]);

  const handleRestoreFromBackup = useCallback(() => {
    Alert.alert(
      '从备份恢复？',
      '恢复会用备份内容覆盖当前本机数据，请确认后继续。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '继续恢复',
          style: 'destructive',
          onPress: () => {
            Logger.info(PAGE_SCOPE, 'Start restore from backup in settings.', {
              supported: false,
            });
            try {
              showToast('恢复功能即将支持', 'info');
              Logger.info(PAGE_SCOPE, 'Restore action finished with placeholder notice.', {
                supported: false,
              });
              Logger.warn(PAGE_SCOPE, 'Restore from backup is not supported in current version.', {
                reason: 'not_implemented',
              });
            } catch (error) {
              Logger.error(PAGE_SCOPE, 'Restore action failed unexpectedly.', { error });
              showToast('恢复功能暂不可用，请稍后重试', 'warning');
            }
          },
        },
      ],
    );
  }, [showToast]);

  const handleExportTodayWorksheet = useCallback(async () => {
    if (isExportingWorksheet) {
      return;
    }

    setIsExportingWorksheet(true);
    Logger.info(PAGE_SCOPE, 'Start exporting today worksheet from settings.', {
      dueToday: dataOverview.dueToday,
    });
    try {
      const result = await TodayWorksheetExportService.exportTodayWorksheet();
      if (result.outcome === 'success') {
        Logger.info(PAGE_SCOPE, 'Exported today worksheet successfully from settings.', {
          outcome: result.outcome,
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
        });
        showToast(result.message, 'info');
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
    }
  }, [dataOverview.dueToday, isExportingWorksheet, showToast]);

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

  const statsItems = useMemo(
    () => [
      { label: '已录入错题', value: displayNumber(dataOverview.totalMistakes) },
      { label: '今天待复做', value: displayNumber(dataOverview.dueToday) },
      { label: '已经掌握', value: displayNumber(dataOverview.mastered) },
      { label: '累计复做(次)', value: displayNumber(dataOverview.totalReviews) },
      { label: '本机图片(张)', value: displayNumber(dataOverview.imageCount) },
    ],
    [dataOverview, displayNumber],
  );

  const isStorageBusy = isScanningOrphanImages || isCleaningOrphanImages;

  return (
    <View style={styles.pageRoot}>
      <ScreenContainer scroll safeAreaEdges={['top']} contentStyle={styles.screenContent}>
        <BrandHeader
          title="设置"
          subtitle="离线运行，所有数据仅保存在本机"
          offlineLabel="离线"
        />

        <CardContainer style={styles.card} padding={spacing.md}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, styles.iconGreen]}>
              <MaterialIcons color="#2A9D50" name="security" size={30} />
            </View>
            <View style={styles.cardMain}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle}>数据备份与恢复</Text>
                <View style={styles.recommendBadge}>
                  <Text style={styles.recommendText}>推荐</Text>
                </View>
              </View>
              <Text style={styles.cardDescription}>
                保护错题、复做记录和图片，换手机或重装 App 后可恢复数据。
              </Text>
              <Text style={styles.metaText}>
                上次备份：<Text style={styles.metaStrong}>未备份</Text>
              </Text>
              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleStartBackup}
                  style={[styles.actionButton, styles.actionButtonGreen]}>
                  <Text numberOfLines={1} style={[styles.actionButtonText, styles.actionButtonTextGreen]}>
                    立即备份
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleRestoreFromBackup}
                  style={[styles.actionButton, styles.actionButtonGreen]}>
                  <Text numberOfLines={1} style={[styles.actionButtonText, styles.actionButtonTextGreen]}>
                    从备份恢复
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </CardContainer>

        <CardContainer style={styles.card} padding={spacing.md}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, styles.iconBlue]}>
              <MaterialIcons color="#2D74D6" name="bar-chart" size={30} />
            </View>
            <View style={styles.cardMain}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle}>学习数据</Text>
                <View style={styles.refreshWrap}>
                  <Text style={styles.refreshText}>{statsUpdatedText}</Text>
                  <Pressable
                    accessibilityLabel="刷新学习数据"
                    accessibilityRole="button"
                    disabled={isStatsBusy}
                    onPress={() => {
                      void loadDataOverview('refresh');
                    }}
                    style={[styles.refreshButton, isStatsBusy ? styles.disabledButton : null]}>
                    {isStatsBusy ? (
                      <ActivityIndicator color="#6A717A" size="small" />
                    ) : (
                      <MaterialIcons color="#6A717A" name="refresh" size={19} />
                    )}
                  </Pressable>
                </View>
              </View>
              <View style={styles.statsRow}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.statsRowContent}>
                  {statsItems.map((item, index) => (
                    <View
                      key={item.label}
                      style={[styles.statItem, index > 0 ? styles.statItemDivider : null]}>
                      <Text style={styles.statValue}>{item.value}</Text>
                      <Text numberOfLines={2} style={styles.statLabel}>
                        {item.label}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
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
              <Pressable
                disabled={isExportingWorksheet}
                onPress={() => {
                  void handleExportTodayWorksheet();
                }}
                style={[
                  styles.actionButton,
                  styles.actionButtonOrange,
                  isExportingWorksheet ? styles.disabledButton : null,
                ]}>
                <Text numberOfLines={1} style={[styles.actionButtonText, styles.actionButtonTextOrange]}>
                  {isExportingWorksheet ? '正在生成…' : '导出今日练习卷'}
                </Text>
              </Pressable>
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
                  onValueChange={(nextValue) => {
                    setReminderEnabled(nextValue);
                    showToast('提醒功能即将支持', 'info');
                  }}
                  thumbColor={colors.white}
                  trackColor={{ false: '#D5D8DE', true: '#9ED9B3' }}
                  value={reminderEnabled}
                />
              </View>
              <Text style={styles.cardDescription}>
                每天提醒我完成今日复做，养成坚持的好习惯。
              </Text>
              <Text style={styles.metaText}>提醒时间：20:00</Text>
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
              <Text style={styles.metaText}>图片数量：{displayNumber(dataOverview.imageCount)} 张</Text>
              <Text style={styles.metaText}>占用空间：{displayStorageText}</Text>
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

        <CardContainer style={styles.card} padding={spacing.md}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBadge, styles.iconGray]}>
              <MaterialIcons color="#717982" name="info-outline" size={30} />
            </View>
            <View style={styles.cardMain}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle}>关于七刷错题本</Text>
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
                <Text style={styles.metaText}>版本：{VERSION_VALUE}</Text>
              </Pressable>
              <Text style={styles.metaText}>数据模式：离线本地版</Text>
            </View>
          </View>
        </CardContainer>

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
  cardRow: {
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  cardDescription: {
    ...typography.body,
    color: colors.textSecondary,
  },
  metaText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  metaStrong: {
    color: '#2A9D50',
    fontWeight: '700',
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
  refreshWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  refreshText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  refreshButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D6DAE0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  statsRow: {
    marginTop: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  statsRowContent: {
    flexDirection: 'row',
  },
  statItem: {
    width: 92,
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  statItemDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  statValue: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
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
