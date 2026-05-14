import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandHeader, CardContainer, ScreenContainer, SectionTitle } from '@/src/components';
import { MistakeImageRepository, ReviewRecordRepository } from '@/src/repositories';
import * as MistakeListService from '@/src/services/MistakeListService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

type InfoRow = {
  label: string;
  value: string;
};

type DevRoute = '/dev/db' | '/dev/images' | '/dev/logs';

type DevEntry = {
  title: string;
  description: string;
  href: DevRoute;
};

type DataOverviewStats = {
  totalMistakes: number;
  dueMistakes: number;
  masteredMistakes: number;
  reviewRecordCount: number;
  imageRecordCount: number;
};

type ToastType = 'success' | 'info' | 'warning' | 'error';

const DEV_UNLOCK_TAP_TARGET = 7;
const DEV_TAP_WINDOW_MS = 3000;
const DEV_TAP_HINT_THRESHOLD = 2;
const TOAST_DURATION_DEFAULT = 1800;
const VERSION_LABEL = '版本';
const VERSION_VALUE = '0.1.0 MVP';

const DEFAULT_DATA_OVERVIEW_STATS: DataOverviewStats = {
  totalMistakes: 0,
  dueMistakes: 0,
  masteredMistakes: 0,
  reviewRecordCount: 0,
  imageRecordCount: 0,
};

const APP_INFO_ROWS: InfoRow[] = [
  { label: '模式', value: '离线本地版' },
  { label: '数据位置', value: '本机存储' },
  { label: '当前状态', value: '开发测试中' },
];

const CORE_FLOW_ITEMS = [
  '拍照录入错题',
  '每题复做 7 次',
  '做满 7 次后标记已掌握',
  '所有数据仅保存在本机',
];

const LOCAL_DATA_ITEMS = [
  '错题信息保存到 SQLite',
  '图片保存到 App 本地目录',
  '当前版本不支持云同步',
  '卸载 App 可能会删除本地数据',
];

const ROADMAP_ITEMS = ['数据备份与恢复', '本地通知提醒', '学习统计', 'OCR / AI 识别'];

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

let isDevModeUnlockedInSession = false;

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

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [isDevModeUnlocked, setIsDevModeUnlocked] = useState(isDevModeUnlockedInSession);
  const [dataOverview, setDataOverview] = useState<DataOverviewStats>(DEFAULT_DATA_OVERVIEW_STATS);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);
  const [isOverviewRefreshing, setIsOverviewRefreshing] = useState(false);
  const [overviewErrorMessage, setOverviewErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);

  const lastTapAtRef = useRef<number | null>(null);
  const tapCountRef = useRef(0);
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

  const handleVersionTap = useCallback(() => {
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
      isDevModeUnlockedInSession = true;
      setIsDevModeUnlocked(true);
      showToast('开发调试入口已开启', 'success');
      return;
    }

    const remaining = DEV_UNLOCK_TAP_TARGET - nextCount;
    if (remaining > 0 && remaining <= DEV_TAP_HINT_THRESHOLD) {
      showToast(`再点 ${remaining} 次开启开发调试入口`, 'info');
    }
  }, [isDevModeUnlocked, showToast]);

  const loadDataOverview = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setIsOverviewLoading(true);
    } else {
      setIsOverviewRefreshing(true);
    }

    try {
      const [mistakeStats, reviewRecordCount, imageRecordCount] = await Promise.all([
        MistakeListService.getMistakeListStats(),
        ReviewRecordRepository.countReviewRecords(),
        MistakeImageRepository.countMistakeImages(),
      ]);

      setDataOverview({
        totalMistakes: mistakeStats.total,
        dueMistakes: mistakeStats.due,
        masteredMistakes: mistakeStats.mastered,
        reviewRecordCount,
        imageRecordCount,
      });
      setOverviewErrorMessage(null);
    } catch {
      setDataOverview(DEFAULT_DATA_OVERVIEW_STATS);
      setOverviewErrorMessage('本地数据概况读取失败');
    } finally {
      setIsOverviewLoading(false);
      setIsOverviewRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDataOverview('initial');
  }, [loadDataOverview]);

  return (
    <ScreenContainer scroll safeAreaEdges={['top']} contentStyle={styles.screenContent}>
      <BrandHeader
        title="设置"
        subtitle="离线运行，本地保存错题和复做记录"
        offlineLabel="离线"
      />

      <View style={styles.sectionBlock}>
        <SectionTitle title="App 信息" />
        <CardContainer style={styles.card} padding={spacing.md}>
          <Text style={styles.appName}>七刷错题本</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="版本号"
            hitSlop={8}
            onPress={handleVersionTap}
            style={styles.versionRowPressable}>
            <Text style={styles.infoLabel}>{VERSION_LABEL}</Text>
            <Text style={styles.infoValue}>{VERSION_VALUE}</Text>
          </Pressable>
          {APP_INFO_ROWS.map((row) => (
            <View key={row.label} style={styles.infoRow}>
              <Text style={styles.infoLabel}>{row.label}</Text>
              <Text style={styles.infoValue}>{row.value}</Text>
            </View>
          ))}
        </CardContainer>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="数据概况" />
        <CardContainer style={styles.card} padding={spacing.md}>
          <View style={styles.dataRow}>
            <Text style={styles.infoLabel}>总错题数</Text>
            <Text style={styles.infoValue}>{dataOverview.totalMistakes}</Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={styles.infoLabel}>待复做数</Text>
            <Text style={styles.infoValue}>{dataOverview.dueMistakes}</Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={styles.infoLabel}>已七刷数</Text>
            <Text style={styles.infoValue}>{dataOverview.masteredMistakes}</Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={styles.infoLabel}>复做记录数</Text>
            <Text style={styles.infoValue}>{dataOverview.reviewRecordCount}</Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={styles.infoLabel}>图片记录数</Text>
            <Text style={styles.infoValue}>{dataOverview.imageRecordCount}</Text>
          </View>

          {isOverviewLoading ? (
            <Text style={styles.dataHintText}>正在读取本地数据...</Text>
          ) : isOverviewRefreshing ? (
            <Text style={styles.dataHintText}>正在读取本地数据...</Text>
          ) : null}

          {overviewErrorMessage ? (
            <View style={styles.dataErrorWrap}>
              <Text style={styles.dataErrorText}>{overviewErrorMessage}</Text>
              <Pressable
                accessibilityRole="button"
                disabled={isOverviewLoading || isOverviewRefreshing}
                onPress={() => {
                  void loadDataOverview('refresh');
                }}
                style={[
                  styles.dataRetryButton,
                  (isOverviewLoading || isOverviewRefreshing) && styles.disabledButton,
                ]}>
                <Text style={styles.dataRetryButtonText}>重试</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={isOverviewLoading || isOverviewRefreshing}
            onPress={() => {
              void loadDataOverview('refresh');
            }}
            style={[
              styles.dataRefreshButton,
              (isOverviewLoading || isOverviewRefreshing) && styles.disabledButton,
            ]}>
            <Text style={styles.dataRefreshButtonText}>刷新数据概况</Text>
          </Pressable>
        </CardContainer>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="核心流程" />
        <CardContainer style={styles.card} padding={spacing.md}>
          {CORE_FLOW_ITEMS.map((item) => (
            <Text key={item} style={styles.listText}>
              - {item}
            </Text>
          ))}
        </CardContainer>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="本地数据" />
        <CardContainer style={styles.card} padding={spacing.md}>
          {LOCAL_DATA_ITEMS.map((item) => (
            <Text key={item} style={styles.listText}>
              - {item}
            </Text>
          ))}
        </CardContainer>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="后续计划" />
        <CardContainer style={styles.card} padding={spacing.md}>
          {ROADMAP_ITEMS.map((item) => (
            <Text key={item} style={styles.listText}>
              - {item}
            </Text>
          ))}
        </CardContainer>
      </View>

      {isDevModeUnlocked ? (
        <View style={styles.sectionBlock}>
          <SectionTitle title="开发调试" />
          <CardContainer style={[styles.card, styles.devCard]} padding={spacing.md}>
            <Text style={styles.devNoticeText}>
              调试入口默认隐藏，仅用于排查问题，请谨慎使用。
            </Text>

            {DEV_ENTRIES.map((entry) => (
              <View key={entry.href} style={styles.devEntryBlock}>
                <Text style={styles.devEntryTitle}>{entry.title}</Text>
                <Text style={styles.devEntryDescription}>{entry.description}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(entry.href as never)}
                  style={styles.devEntryButton}>
                  <Text style={styles.devEntryButtonText}>{entry.title}</Text>
                </Pressable>
              </View>
            ))}
          </CardContainer>
        </View>
      ) : null}

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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    paddingBottom: layout.bottomTabHeight,
    gap: spacing.lg,
  },
  sectionBlock: {
    gap: spacing.sm,
  },
  card: {
    borderRadius: radius.xl,
    gap: spacing.xs,
  },
  appName: {
    ...typography.sectionTitle,
    fontSize: 19,
    lineHeight: 24,
    marginBottom: spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  infoLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  infoValue: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
  },
  versionRowPressable: {
    minHeight: 38,
    paddingVertical: 2,
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  devCard: {
    borderColor: '#f2dec0',
    backgroundColor: '#fffdf8',
  },
  devNoticeText: {
    ...typography.caption,
    color: '#8a5a22',
    fontWeight: '700',
  },
  devEntryBlock: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#eddac0',
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  devEntryTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  devEntryDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  devEntryButton: {
    minHeight: 38,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#c48f4d',
    backgroundColor: '#fff6e8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  devEntryButtonText: {
    ...typography.caption,
    color: '#8a5a22',
    fontWeight: '700',
  },
  dataHintText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  dataErrorWrap: {
    gap: spacing.sm,
  },
  dataErrorText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  dataRetryButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#f0c3c3',
    backgroundColor: '#ffecec',
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  dataRetryButtonText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  dataRefreshButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  dataRefreshButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.5,
  },
  listText: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
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
  },
  toastText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '700',
    textAlign: 'center',
  },
});
