import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  clearRuntimeLogs,
  getRuntimeLogs,
  Logger,
  subscribeRuntimeLogs,
  type RuntimeLogItem,
} from '@/src/services/Logger';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'DevLogsPage';
const TOAST_DURATION_DEFAULT = 1800;
const TOAST_DURATION_LONG = 2600;
const METADATA_PREVIEW_LIMIT = 1000;
const METADATA_COPY_LIMIT = 1000;

type ToastType = 'success' | 'info' | 'warning' | 'error';
type LogLevelFilter = 'all' | RuntimeLogItem['level'];
type LogTimeOrder = 'desc' | 'asc';

const LOG_LEVEL_FILTERS: { key: LogLevelFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'error', label: 'ERROR' },
  { key: 'warn', label: 'WARN' },
  { key: 'info', label: 'INFO' },
  { key: 'debug', label: 'DEBUG' },
];

const LOG_TIME_ORDERS: { key: LogTimeOrder; label: string }[] = [
  { key: 'desc', label: '时间倒序' },
  { key: 'asc', label: '时间正序' },
];

const LOG_COUNT_SCOPES: { key: 'all' | 'recent50'; label: string }[] = [
  { key: 'all', label: '全部日志' },
  { key: 'recent50', label: '仅看最近 50 条' },
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

function getLevelBadgeStyle(level: RuntimeLogItem['level']): {
  text: string;
  color: string;
  backgroundColor: string;
} {
  switch (level) {
    case 'debug':
      return { text: 'DEBUG', color: '#4f46e5', backgroundColor: '#eef2ff' };
    case 'info':
      return { text: 'INFO', color: '#0f766e', backgroundColor: '#ecfeff' };
    case 'warn':
      return { text: 'WARN', color: '#b45309', backgroundColor: '#fff7ed' };
    case 'error':
      return { text: 'ERROR', color: '#b42318', backgroundColor: '#fee2e2' };
    default:
      return { text: 'INFO', color: '#0f766e', backgroundColor: '#ecfeff' };
  }
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatRuntimeTimestamp(timestamp: string): string {
  if (typeof timestamp !== 'string') {
    return '';
  }

  const normalized = timestamp.trim();
  if (!normalized) {
    return '';
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  const year = parsed.getFullYear();
  const month = pad2(parsed.getMonth() + 1);
  const day = pad2(parsed.getDate());
  const hours = pad2(parsed.getHours());
  const minutes = pad2(parsed.getMinutes());
  const seconds = pad2(parsed.getSeconds());
  const milliseconds = String(parsed.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function stringifyMetadata(metadata: unknown, maxLength: number): string {
  if (metadata === undefined || metadata === null) {
    return '';
  }

  if (typeof metadata === 'string') {
    return truncateText(metadata, maxLength);
  }

  if (metadata instanceof Error) {
    return truncateText(`${metadata.name}: ${metadata.message}`, maxLength);
  }

  try {
    const seen = new WeakSet<object>();
    const stringified = JSON.stringify(metadata, (_key, value: unknown) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value as object)) {
          return '[Circular]';
        }
        seen.add(value as object);
      }

      if (typeof value === 'string') {
        return truncateText(value, maxLength);
      }

      return value;
    });

    if (typeof stringified !== 'string') {
      return truncateText(String(metadata), maxLength);
    }

    return truncateText(stringified, maxLength);
  } catch (error) {
    try {
      return truncateText(String(error instanceof Error ? error.message : metadata), maxLength);
    } catch {
      return '[Unserializable metadata]';
    }
  }
}

function formatCopyLine(log: RuntimeLogItem): string {
  const level = log.level.toUpperCase();
  const scopePart = log.scope ? ` ${log.scope}` : '';
  const metadataText = stringifyMetadata(log.metadata, METADATA_COPY_LIMIT);
  const metadataPart = metadataText ? ` ${metadataText}` : '';
  const displayTimestamp = formatRuntimeTimestamp(log.timestamp) || log.timestamp;
  return `[${displayTimestamp}] ${level}${scopePart} ${log.message}${metadataPart}`;
}

function stringifyCopyField(value: unknown): string {
  if (value === undefined) {
    return '';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    const errorPayload: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };
    if (value.stack) {
      errorPayload.stack = value.stack;
    }
    return JSON.stringify(errorPayload, null, 2);
  }

  try {
    const seen = new WeakSet<object>();
    const stringified = JSON.stringify(
      value,
      (_key, nextValue: unknown) => {
        if (nextValue instanceof Date) {
          return nextValue.toISOString();
        }

        if (nextValue instanceof Error) {
          const errorPayload: Record<string, unknown> = {
            name: nextValue.name,
            message: nextValue.message,
          };
          if (nextValue.stack) {
            errorPayload.stack = nextValue.stack;
          }
          return errorPayload;
        }

        if (typeof nextValue === 'object' && nextValue !== null) {
          if (seen.has(nextValue as object)) {
            return '[Circular]';
          }
          seen.add(nextValue as object);
        }
        return nextValue;
      },
      2,
    );

    if (typeof stringified === 'string') {
      return stringified;
    }
  } catch {
    // Fallback to String conversion below.
  }

  return String(value);
}

function getCopyTextField(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function formatSingleLogForCopy(log: RuntimeLogItem): string {
  const extendedLog = log as RuntimeLogItem & Record<string, unknown>;
  const level = getCopyTextField(extendedLog.level, 'info').toUpperCase();
  const rawTimestamp =
    getCopyTextField(extendedLog.timestamp, '') ||
    getCopyTextField(extendedLog.createdAt, '') ||
    getCopyTextField(extendedLog.time, 'unknown-time');
  const timestamp =
    rawTimestamp === 'unknown-time' ? rawTimestamp : formatRuntimeTimestamp(rawTimestamp) || rawTimestamp;
  const scope = getCopyTextField(extendedLog.scope, 'unknown');
  const message = getCopyTextField(extendedLog.message, '');
  const metadataCopyValue = extendedLog.metadata ?? {};

  const lines: string[] = [
    `[${level}] ${timestamp}`,
    `scope: ${scope}`,
    `message: ${message}`,
    `metadata: ${stringifyCopyField(metadataCopyValue)}`,
  ];

  if (extendedLog.error !== undefined) {
    lines.push(`error: ${stringifyCopyField(extendedLog.error)}`);
  }

  if (extendedLog.stack !== undefined) {
    lines.push(`stack: ${stringifyCopyField(extendedLog.stack)}`);
  }

  const knownKeys = new Set([
    'id',
    'timestamp',
    'createdAt',
    'time',
    'level',
    'scope',
    'message',
    'metadata',
    'error',
    'stack',
  ]);

  for (const [key, value] of Object.entries(extendedLog)) {
    if (knownKeys.has(key) || value === undefined) {
      continue;
    }
    lines.push(`${key}: ${stringifyCopyField(value)}`);
  }

  return lines.join('\n');
}

export default function RuntimeLogsPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [logs, setLogs] = useState<RuntimeLogItem[]>(() => getRuntimeLogs());
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('all');
  const [timeOrder, setTimeOrder] = useState<LogTimeOrder>('desc');
  const [countScope, setCountScope] = useState<'all' | 'recent50'>('all');
  const [keyword, setKeyword] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastBottomOffset = Math.max(insets.bottom + spacing.lg, layout.bottomTabHeight * 0.2);

  const refreshLogs = useCallback(() => {
    setLogs(getRuntimeLogs());
  }, []);

  const normalizedKeyword = keyword.trim().toLowerCase();
  const logsForRender = useMemo(() => {
    let orderedLogs = logs.slice();
    if (countScope === 'recent50' && orderedLogs.length > 50) {
      orderedLogs = orderedLogs.slice(-50);
    }

    if (timeOrder === 'desc') {
      orderedLogs.reverse();
    }

    return orderedLogs
      .map((item) => {
        const metadataText = stringifyMetadata(item.metadata, METADATA_PREVIEW_LIMIT);
        const formattedTimestamp = formatRuntimeTimestamp(item.timestamp) || item.timestamp;
        return {
          item,
          metadataText,
          formattedTimestamp,
        };
      })
      .filter(({ item, metadataText, formattedTimestamp }) => {
        if (levelFilter !== 'all' && item.level !== levelFilter) {
          return false;
        }

        if (!normalizedKeyword) {
          return true;
        }

        const haystack =
          `${item.timestamp} ${formattedTimestamp} ${item.level} ${item.scope ?? ''} ${item.message} ${metadataText}`.toLowerCase();
        return haystack.includes(normalizedKeyword);
      });
  }, [countScope, levelFilter, logs, normalizedKeyword, timeOrder]);

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
    refreshLogs();
    const unsubscribe = subscribeRuntimeLogs(() => {
      refreshLogs();
    });
    return unsubscribe;
  }, [refreshLogs]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  const handleRefreshPress = useCallback(() => {
    refreshLogs();
    showToast('日志已刷新', 'info');
  }, [refreshLogs, showToast]);

  const handleClearPress = useCallback(() => {
    clearRuntimeLogs();
    refreshLogs();
    showToast('日志已清空', 'success');
  }, [refreshLogs, showToast]);

  const handleCopyPress = useCallback(async () => {
    const snapshot = getRuntimeLogs();
    if (snapshot.length === 0) {
      showToast('暂无运行日志', 'info');
      return;
    }

    if (typeof Clipboard.setStringAsync !== 'function') {
      showToast('当前环境暂不支持复制，请截图反馈', 'warning', TOAST_DURATION_LONG);
      return;
    }

    const payload = snapshot.map((item) => formatCopyLine(item)).join('\n');

    try {
      await Clipboard.setStringAsync(payload);
      showToast('日志已复制', 'success');
    } catch (error) {
      Logger.warn(PAGE_SCOPE, 'Copy runtime logs failed.', { error });
      showToast('复制失败，请截图反馈', 'error', TOAST_DURATION_LONG);
    }
  }, [showToast]);

  const handleCopySingleLog = useCallback(
    async (log: RuntimeLogItem) => {
      if (typeof Clipboard.setStringAsync !== 'function') {
        showToast('当前环境暂不支持复制，请截图反馈', 'warning', TOAST_DURATION_LONG);
        return;
      }

      try {
        await Clipboard.setStringAsync(formatSingleLogForCopy(log));
        showToast('已复制该条日志', 'success');
      } catch (error) {
        Logger.warn(PAGE_SCOPE, 'Copy single runtime log failed.', {
          error,
          logId: log.id,
        });
        showToast('复制失败，请稍后重试', 'error', TOAST_DURATION_LONG);
      }
    },
    [showToast],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: '运行日志', headerShown: false }} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>返回</Text>
          </Pressable>
          <Text style={styles.pageTitle}>运行日志</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.descriptionText}>用于排查 App 运行问题，普通用户无需关注。</Text>
          <Text style={styles.summaryText}>
            当前日志条数：{logs.length}，筛选后：{logsForRender.length}
          </Text>
          <Text style={styles.summaryText}>长按单条日志可复制</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.filterTitle}>级别筛选</Text>
          <View style={styles.filterRow}>
            {LOG_LEVEL_FILTERS.map((filterItem) => {
              const selected = levelFilter === filterItem.key;
              return (
                <Pressable
                  key={filterItem.key}
                  accessibilityRole="button"
                  onPress={() => setLevelFilter(filterItem.key)}
                  style={[styles.filterChip, selected && styles.filterChipSelected]}>
                  <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                    {filterItem.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.filterTitle}>关键词搜索</Text>
          <Text style={styles.filterTitle}>时间顺序</Text>
          <View style={styles.filterRow}>
            {LOG_TIME_ORDERS.map((orderItem) => {
              const selected = timeOrder === orderItem.key;
              return (
                <Pressable
                  key={orderItem.key}
                  accessibilityRole="button"
                  onPress={() => setTimeOrder(orderItem.key)}
                  style={[styles.filterChip, selected && styles.filterChipSelected]}>
                  <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                    {orderItem.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.filterTitle}>显示范围</Text>
          <View style={styles.filterRow}>
            {LOG_COUNT_SCOPES.map((scopeItem) => {
              const selected = countScope === scopeItem.key;
              return (
                <Pressable
                  key={scopeItem.key}
                  accessibilityRole="button"
                  onPress={() => setCountScope(scopeItem.key)}
                  style={[styles.filterChip, selected && styles.filterChipSelected]}>
                  <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                    {scopeItem.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder="搜索 时间 / message / scope / metadata"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {keyword ? (
            <Pressable accessibilityRole="button" onPress={() => setKeyword('')} style={styles.clearSearchButton}>
              <Text style={styles.clearSearchButtonText}>清空搜索</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.buttonRow}>
          <Pressable style={styles.actionButton} onPress={handleRefreshPress}>
            <Text style={styles.actionButtonText}>刷新</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={handleClearPress}>
            <Text style={styles.actionButtonText}>清空日志</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => void handleCopyPress()}>
            <Text style={styles.actionButtonText}>复制全部日志</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          {logsForRender.length === 0 ? (
            <Text style={styles.emptyText}>暂无运行日志</Text>
          ) : (
            logsForRender.map(({ item, metadataText, formattedTimestamp }) => {
              const levelStyle = getLevelBadgeStyle(item.level);
              return (
                <Pressable
                  key={item.id}
                  delayLongPress={500}
                  onLongPress={() => {
                    void handleCopySingleLog(item);
                  }}
                  style={({ pressed }) => [styles.logCard, pressed ? styles.logCardPressed : null]}>
                  <View style={styles.logHeadRow}>
                    <Text style={styles.logTimestamp}>{formattedTimestamp}</Text>
                    <View
                      style={[
                        styles.levelBadge,
                        {
                          backgroundColor: levelStyle.backgroundColor,
                          borderColor: levelStyle.color,
                        },
                      ]}>
                      <Text style={[styles.levelBadgeText, { color: levelStyle.color }]}>
                        {levelStyle.text}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.logScopeText}>scope: {item.scope ?? 'unknown'}</Text>
                  <Text style={styles.logMessageText}>{item.message}</Text>
                  {metadataText ? <Text style={styles.logMetadataText}>{metadataText}</Text> : null}
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButtonText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  pageTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.xs,
  },
  descriptionText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  summaryText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  filterTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  filterChip: {
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipSelected: {
    borderColor: '#2a6ff1',
    backgroundColor: '#e9f1ff',
  },
  filterChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  filterChipTextSelected: {
    color: '#1f5ed0',
  },
  searchInput: {
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    ...typography.bodySmall,
    color: colors.textPrimary,
  },
  clearSearchButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  clearSearchButtonText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionButton: {
    minHeight: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  emptyText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  logCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  logCardPressed: {
    opacity: 0.88,
  },
  logHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  logTimestamp: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
  levelBadge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadgeText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 11,
    lineHeight: 14,
  },
  logScopeText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  logMessageText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  logMetadataText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: 'monospace',
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
