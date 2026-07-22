import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AppToast } from '@/src/components';
import { useAppToast } from '@/src/hooks/useAppToast';
import {
  clearRuntimeLogs,
  getRuntimeLogs,
  Logger,
  subscribeRuntimeLogs,
  type RuntimeLogItem,
} from '@/src/services/Logger';
import {
  exportRuntimeLogsTxt,
  formatRuntimeLogMetadata,
  formatRuntimeLogTimestamp,
} from '@/src/services/RuntimeLogExportService';
import {
  selectRuntimeLogs,
  type RuntimeLogCountScope,
  type RuntimeLogLevelFilter,
  type RuntimeLogTimeOrder,
} from '@/src/services/RuntimeLogQueryService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'DevLogsPage';
const TOAST_DURATION_DEFAULT = 1800;
const TOAST_DURATION_LONG = 2800;
const METADATA_COLLAPSE_CHARACTER_LIMIT = 180;
const METADATA_COLLAPSE_LINE_LIMIT = 4;

type SelectorMenu = 'timeOrder' | 'countScope' | null;

interface RuntimeLogsPalette {
  pageBackground: string;
  surface: string;
  surfaceMuted: string;
  control: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  separator: string;
  action: string;
  actionSoft: string;
  actionPressed: string;
  danger: string;
  dangerSoft: string;
  white: string;
  scrim: string;
}

interface MenuOption<T extends string> {
  key: T;
  label: string;
}

const LOG_LEVEL_FILTERS: readonly MenuOption<RuntimeLogLevelFilter>[] = [
  { key: 'all', label: '全部' },
  { key: 'error', label: '错误' },
  { key: 'warn', label: '警告' },
  { key: 'info', label: '信息' },
  { key: 'debug', label: '调试' },
];

const LOG_TIME_ORDERS: readonly MenuOption<RuntimeLogTimeOrder>[] = [
  { key: 'desc', label: '最新优先' },
  { key: 'asc', label: '最早优先' },
];

const LOG_COUNT_SCOPES: readonly MenuOption<RuntimeLogCountScope>[] = [
  { key: 'all', label: '全部日志' },
  { key: 'recent50', label: '最近 50 条' },
];

function createPalette(isDark: boolean): RuntimeLogsPalette {
  if (isDark) {
    return {
      pageBackground: '#000000',
      surface: '#1C1C1E',
      surfaceMuted: '#2C2C2E',
      control: '#2C2C2E',
      textPrimary: '#F5F5F7',
      textSecondary: '#AEAEB2',
      textTertiary: '#8E8E93',
      separator: '#38383A',
      action: '#0A84FF',
      actionSoft: '#0B3157',
      actionPressed: '#409CFF',
      danger: '#FF453A',
      dangerSoft: '#4A1917',
      white: colors.white,
      scrim: 'rgba(0, 0, 0, 0.55)',
    };
  }

  return {
    pageBackground: colors.pageBackground,
    surface: colors.surface,
    surfaceMuted: colors.surfaceMuted,
    control: colors.surfaceMuted,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    textTertiary: colors.textTertiary,
    separator: colors.separator,
    action: colors.action,
    actionSoft: colors.actionSoft,
    actionPressed: colors.actionPressed,
    danger: colors.danger,
    dangerSoft: colors.dangerSoft,
    white: colors.white,
    scrim: 'rgba(0, 0, 0, 0.28)',
  };
}

function getLevelBadgeStyle(
  level: RuntimeLogItem['level'],
  isDark: boolean,
): { text: string; color: string; backgroundColor: string } {
  switch (level) {
    case 'error':
      return {
        text: 'ERROR',
        color: isDark ? '#FF6961' : '#D92D20',
        backgroundColor: isDark ? '#4A1917' : '#FFF0F0',
      };
    case 'warn':
      return {
        text: 'WARN',
        color: isDark ? '#FFB340' : '#B45309',
        backgroundColor: isDark ? '#483015' : '#FFF6E7',
      };
    case 'info':
      return {
        text: 'INFO',
        color: isDark ? '#5EDACB' : '#0F8378',
        backgroundColor: isDark ? '#123C38' : '#E7F8F5',
      };
    case 'debug':
      return {
        text: 'DEBUG',
        color: isDark ? '#C7C7CC' : '#6E6E73',
        backgroundColor: isDark ? '#3A3A3C' : '#EEEEF0',
      };
    default:
      return {
        text: 'INFO',
        color: isDark ? '#5EDACB' : '#0F8378',
        backgroundColor: isDark ? '#123C38' : '#E7F8F5',
      };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatRuntimeTimeOnly(timestamp: string): string {
  const formatted = formatRuntimeLogTimestamp(timestamp);
  const separatorIndex = formatted.indexOf(' ');
  return separatorIndex >= 0 ? formatted.slice(separatorIndex + 1) : formatted;
}

interface HighlightedTextProps {
  text: string;
  keyword: string;
  style: StyleProp<TextStyle>;
  highlightColor: string;
  numberOfLines?: number;
}

function HighlightedText({
  text,
  keyword,
  style,
  highlightColor,
  numberOfLines,
}: HighlightedTextProps) {
  if (!keyword) {
    return <Text numberOfLines={numberOfLines} style={style}>{text}</Text>;
  }

  const pattern = new RegExp(`(${escapeRegExp(keyword)})`, 'ig');
  const parts = text.split(pattern);
  const normalizedKeyword = keyword.toLowerCase();

  return (
    <Text numberOfLines={numberOfLines} style={style}>
      {parts.map((part, index) => {
        if (!part) {
          return null;
        }
        const isMatch = part.toLowerCase() === normalizedKeyword;
        return (
          <Text
            key={`${index}-${part}`}
            style={isMatch ? { color: highlightColor, fontWeight: '700' } : undefined}>
            {part}
          </Text>
        );
      })}
    </Text>
  );
}

interface RuntimeLogCardProps {
  log: RuntimeLogItem;
  keyword: string;
  isDark: boolean;
  palette: RuntimeLogsPalette;
  styles: ReturnType<typeof createStyles>;
  onLongPress: (log: RuntimeLogItem) => void;
}

const RuntimeLogCard = memo(function RuntimeLogCard({
  log,
  keyword,
  isDark,
  palette,
  styles,
  onLongPress,
}: RuntimeLogCardProps) {
  const [metadataExpanded, setMetadataExpanded] = useState(false);
  const metadataText = useMemo(() => formatRuntimeLogMetadata(log.metadata, true), [log.metadata]);
  const metadataLines = metadataText ? metadataText.split('\n').length : 0;
  const metadataExpandable = metadataText.length > METADATA_COLLAPSE_CHARACTER_LIMIT
    || metadataLines > METADATA_COLLAPSE_LINE_LIMIT;
  const levelStyle = getLevelBadgeStyle(log.level, isDark);
  const displayedTime = formatRuntimeTimeOnly(log.timestamp) || log.timestamp;
  const scope = log.scope?.trim() || 'unknown';

  const handlePress = useCallback(() => {
    if (metadataExpandable) {
      setMetadataExpanded((current) => !current);
    }
  }, [metadataExpandable]);

  return (
    <Pressable
      accessibilityLabel={`${levelStyle.text} 日志，${scope}，${log.message}`}
      accessibilityHint={metadataExpandable ? '点击展开或收起 metadata，长按复制完整日志' : '长按复制完整日志'}
      accessibilityRole="button"
      delayLongPress={450}
      onLongPress={() => onLongPress(log)}
      onPress={handlePress}
      style={({ pressed }) => [styles.logCard, pressed && styles.logCardPressed]}>
      <View style={styles.logTopRow}>
        <View style={[styles.levelBadge, { backgroundColor: levelStyle.backgroundColor }]}>
          <Text style={[styles.levelBadgeText, { color: levelStyle.color }]}>{levelStyle.text}</Text>
        </View>
        <Text numberOfLines={1} style={styles.logTimestamp}>{displayedTime}</Text>
        <HighlightedText
          text={scope}
          keyword={keyword}
          style={styles.logScopeText}
          highlightColor={palette.danger}
          numberOfLines={1}
        />
      </View>

      <HighlightedText
        text={log.message}
        keyword={keyword}
        style={styles.logMessageText}
        highlightColor={palette.danger}
      />

      {metadataText ? (
        <View style={[styles.metadataContainer, metadataExpandable && styles.metadataContainerExpandable]}>
          <HighlightedText
            text={metadataText}
            keyword={keyword}
            style={styles.logMetadataText}
            highlightColor={palette.danger}
            numberOfLines={metadataExpanded || !metadataExpandable ? undefined : 3}
          />
          {metadataExpandable ? (
            <Ionicons
              name={metadataExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={palette.textSecondary}
              style={styles.metadataChevron}
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
});

interface CompactSelectorProps {
  label: string;
  accessibilityLabel: string;
  palette: RuntimeLogsPalette;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}

function CompactSelector({
  label,
  accessibilityLabel,
  palette,
  styles,
  onPress,
}: CompactSelectorProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.selectorButton, pressed && styles.controlPressed]}>
      <Text numberOfLines={1} style={styles.selectorText}>{label}</Text>
      <Ionicons name="chevron-down" size={17} color={palette.textSecondary} />
    </Pressable>
  );
}

interface SelectionMenuProps<T extends string> {
  visible: boolean;
  title: string;
  options: readonly MenuOption<T>[];
  selectedKey: T;
  bottomInset: number;
  palette: RuntimeLogsPalette;
  styles: ReturnType<typeof createStyles>;
  onSelect: (key: T) => void;
  onClose: () => void;
}

function SelectionMenu<T extends string>({
  visible,
  title,
  options,
  selectedKey,
  bottomInset,
  palette,
  styles,
  onSelect,
  onClose,
}: SelectionMenuProps<T>) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.menuScrim}>
        <View
          accessibilityViewIsModal
          onStartShouldSetResponder={() => true}
          style={[styles.selectionSheet, { marginBottom: Math.max(bottomInset, spacing.md) }]}>
          <Text style={styles.selectionTitle}>{title}</Text>
          {options.map((option) => {
            const selected = option.key === selectedKey;
            return (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={option.key}
                onPress={() => onSelect(option.key)}
                style={({ pressed }) => [styles.selectionOption, pressed && styles.controlPressed]}>
                <Text style={[styles.selectionOptionText, selected && { color: palette.action }]}>
                  {option.label}
                </Text>
                {selected ? <Ionicons name="checkmark" size={22} color={palette.action} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Pressable>
    </Modal>
  );
}

export default function RuntimeLogsPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const palette = useMemo(() => createPalette(isDark), [isDark]);
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [logs, setLogs] = useState<RuntimeLogItem[]>(() => getRuntimeLogs());
  const [levelFilter, setLevelFilter] = useState<RuntimeLogLevelFilter>('all');
  const [timeOrder, setTimeOrder] = useState<RuntimeLogTimeOrder>('desc');
  const [countScope, setCountScope] = useState<RuntimeLogCountScope>('all');
  const [keyword, setKeyword] = useState('');
  const [selectorMenu, setSelectorMenu] = useState<SelectorMenu>(null);
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { props: toastProps, showToast } = useAppToast({
    defaultDuration: TOAST_DURATION_DEFAULT,
    enterDuration: 160,
    exitDuration: 140,
  });

  const toastBottomOffset = Math.max(insets.bottom + spacing.lg, layout.minimumTouchSize);
  const normalizedKeyword = keyword.trim().toLowerCase();

  const exportableLogs = useMemo(
    () => selectRuntimeLogs(logs, {
      levelFilter,
      keyword,
      countScope,
      timeOrder,
    }),
    [countScope, keyword, levelFilter, logs, timeOrder],
  );

  const refreshLogs = useCallback(() => {
    setLogs(getRuntimeLogs());
  }, []);

  useEffect(() => {
    refreshLogs();
    return subscribeRuntimeLogs(refreshLogs);
  }, [refreshLogs]);

  const handleRefreshPress = useCallback(async () => {
    if (isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      refreshLogs();
      showToast('日志已刷新', 'info');
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, refreshLogs, showToast]);

  const handleClearRequest = useCallback(() => {
    setMoreMenuVisible(false);
    requestAnimationFrame(() => {
      Alert.alert(
        '清空运行日志？',
        '此操作会删除当前保存的全部运行日志，且无法撤销。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '清空',
            style: 'destructive',
            onPress: () => {
              clearRuntimeLogs();
              refreshLogs();
              showToast('日志已清空', 'success');
            },
          },
        ],
      );
    });
  }, [refreshLogs, showToast]);

  const handleCopySingleLog = useCallback(
    async (log: RuntimeLogItem) => {
      if (typeof Clipboard.setStringAsync !== 'function') {
        showToast('当前环境暂不支持复制，请截图反馈', 'warning', TOAST_DURATION_LONG);
        return;
      }

      const metadataText = formatRuntimeLogMetadata(log.metadata, true);
      const scope = log.scope?.trim() || 'unknown';
      const timestamp = formatRuntimeLogTimestamp(log.timestamp) || log.timestamp;
      const lines = [
        `[${timestamp}] [${log.level.toUpperCase()}] [${scope}]`,
        log.message,
      ];
      if (metadataText) {
        lines.push(`metadata: ${metadataText}`);
      }

      try {
        await Clipboard.setStringAsync(lines.join('\n'));
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

  const handleExportPress = useCallback(async () => {
    if (isExporting) {
      return;
    }
    if (exportableLogs.length === 0) {
      showToast('暂无可导出的日志', 'info');
      return;
    }

    setIsExporting(true);
    try {
      await exportRuntimeLogsTxt({
        logs: exportableLogs,
        totalLogCount: logs.length,
        filters: {
          levelLabel: levelFilter === 'all' ? '全部' : levelFilter.toUpperCase(),
          keyword: keyword.trim(),
          rangeLabel: countScope === 'all' ? '全部匹配结果' : '最近 50 条',
          timeOrderLabel: timeOrder === 'desc' ? '最新优先' : '最早优先',
        },
      });
      showToast('已打开系统分享面板', 'success');
    } catch (error) {
      Logger.warn(PAGE_SCOPE, 'Export runtime logs failed.', {
        error,
        exportCount: exportableLogs.length,
        totalLogCount: logs.length,
        levelFilter,
        countScope,
        timeOrder,
        hasKeyword: normalizedKeyword.length > 0,
      });
      showToast('导出失败，请稍后重试', 'error', TOAST_DURATION_LONG);
    } finally {
      setIsExporting(false);
    }
  }, [
    countScope,
    exportableLogs,
    isExporting,
    keyword,
    levelFilter,
    logs.length,
    normalizedKeyword.length,
    showToast,
    timeOrder,
  ]);

  const renderLogItem = useCallback(
    ({ item }: { item: RuntimeLogItem }) => (
      <RuntimeLogCard
        isDark={isDark}
        keyword={normalizedKeyword}
        log={item}
        onLongPress={(log) => {
          void handleCopySingleLog(log);
        }}
        palette={palette}
        styles={styles}
      />
    ),
    [handleCopySingleLog, isDark, normalizedKeyword, palette, styles],
  );

  const currentTimeOrderLabel = timeOrder === 'desc' ? '最新优先' : '最早优先';
  const currentCountScopeLabel = countScope === 'all' ? '全部日志' : '最近 50 条';
  const exportButtonLabel = exportableLogs.length > 0
    ? `导出 TXT（${exportableLogs.length}）`
    : '暂无可导出的日志';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack.Screen options={{ title: '运行日志', headerShown: false }} />

      <View style={styles.navigationBar}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.navigationButton, pressed && styles.navigationButtonPressed]}>
          <Ionicons name="arrow-back" size={28} color={palette.action} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.navigationTitle}>运行日志</Text>
        <Pressable
          accessibilityLabel="更多日志操作"
          accessibilityRole="button"
          onPress={() => setMoreMenuVisible(true)}
          style={({ pressed }) => [
            styles.navigationButton,
            styles.moreButton,
            pressed && styles.navigationButtonPressed,
          ]}>
          <Ionicons name="ellipsis-horizontal" size={23} color={palette.textPrimary} />
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.xl },
        ]}
        data={exportableLogs}
        initialNumToRender={10}
        ItemSeparatorComponent={() => <View style={styles.logSeparator} />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={30} color={palette.textTertiary} />
            <Text style={styles.emptyTitle}>
              {logs.length === 0 ? '暂无运行日志' : '没有匹配的日志'}
            </Text>
            <Text style={styles.emptyDescription}>
              {logs.length === 0 ? 'App 运行后，日志会显示在这里。' : '请尝试调整关键词、级别或显示范围。'}
            </Text>
          </View>
        )}
        ListHeaderComponent={(
          <View>
            <View style={styles.summaryBlock}>
              <Text style={styles.summaryCount}>
                {logs.length} 条日志 · {exportableLogs.length} 条匹配
              </Text>
              <Text style={styles.summaryDescription}>用于排查 App 运行问题</Text>
            </View>

            <View style={styles.searchContainer}>
              <Ionicons name="search" size={21} color={palette.textSecondary} />
              <TextInput
                accessibilityLabel="搜索运行日志"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setKeyword}
                onSubmitEditing={Keyboard.dismiss}
                placeholder="搜索 message、scope 或 metadata"
                placeholderTextColor={palette.textTertiary}
                returnKeyType="search"
                style={styles.searchInput}
                value={keyword}
              />
              {keyword ? (
                <Pressable
                  accessibilityLabel="清空日志搜索"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setKeyword('')}
                  style={styles.searchClearButton}>
                  <Ionicons name="close-circle" size={20} color={palette.textTertiary} />
                </Pressable>
              ) : null}
            </View>

            <ScrollView
              contentContainerStyle={styles.levelFilterContent}
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}>
              {LOG_LEVEL_FILTERS.map((filter) => {
                const selected = filter.key === levelFilter;
                return (
                  <Pressable
                    accessibilityLabel={`筛选${filter.label}日志`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={filter.key}
                    onPress={() => setLevelFilter(filter.key)}
                    style={({ pressed }) => [
                      styles.levelFilterChip,
                      selected && styles.levelFilterChipSelected,
                      pressed && styles.controlPressed,
                    ]}>
                    <Text style={[
                      styles.levelFilterText,
                      selected && styles.levelFilterTextSelected,
                    ]}>
                      {filter.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.controlRow}>
              <View style={styles.selectorGroup}>
                <CompactSelector
                  accessibilityLabel={`时间顺序，${currentTimeOrderLabel}`}
                  label={currentTimeOrderLabel}
                  onPress={() => setSelectorMenu('timeOrder')}
                  palette={palette}
                  styles={styles}
                />
                <CompactSelector
                  accessibilityLabel={`显示范围，${currentCountScopeLabel}`}
                  label={currentCountScopeLabel}
                  onPress={() => setSelectorMenu('countScope')}
                  palette={palette}
                  styles={styles}
                />
              </View>
              <Pressable
                accessibilityLabel={isRefreshing ? '正在刷新日志' : '刷新日志'}
                accessibilityRole="button"
                accessibilityState={{ busy: isRefreshing, disabled: isRefreshing }}
                disabled={isRefreshing}
                onPress={() => {
                  void handleRefreshPress();
                }}
                style={({ pressed }) => [styles.refreshButton, pressed && styles.controlPressed]}>
                {isRefreshing ? (
                  <ActivityIndicator color={palette.action} size="small" />
                ) : (
                  <Ionicons name="refresh" size={25} color={palette.action} />
                )}
              </Pressable>
            </View>

            <View style={styles.listHeadingRow}>
              <Text style={styles.listHeading}>日志记录</Text>
              <Pressable
                accessibilityLabel={exportButtonLabel}
                accessibilityRole="button"
                accessibilityState={{ busy: isExporting, disabled: isExporting || exportableLogs.length === 0 }}
                disabled={isExporting || exportableLogs.length === 0}
                onPress={() => {
                  void handleExportPress();
                }}
                style={({ pressed }) => [
                  styles.exportButton,
                  exportableLogs.length === 0 && styles.exportButtonDisabled,
                  pressed && styles.exportButtonPressed,
                ]}>
                {isExporting ? (
                  <ActivityIndicator color={palette.action} size="small" />
                ) : (
                  <Ionicons
                    name="share-outline"
                    size={20}
                    color={exportableLogs.length === 0 ? palette.textTertiary : palette.action}
                  />
                )}
                <Text
                  numberOfLines={1}
                  style={[
                    styles.exportButtonText,
                    exportableLogs.length === 0 && styles.exportButtonTextDisabled,
                  ]}>
                  {isExporting ? '正在导出…' : exportButtonLabel}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.copyHint}>长按单条日志可复制</Text>
          </View>
        )}
        maxToRenderPerBatch={12}
        onScrollBeginDrag={Keyboard.dismiss}
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={renderLogItem}
        showsVerticalScrollIndicator={false}
        updateCellsBatchingPeriod={40}
        windowSize={7}
      />

      <Modal
        animationType="fade"
        onRequestClose={() => setMoreMenuVisible(false)}
        statusBarTranslucent
        transparent
        visible={moreMenuVisible}>
        <Pressable
          accessibilityLabel="关闭更多菜单"
          accessibilityRole="button"
          onPress={() => setMoreMenuVisible(false)}
          style={styles.moreMenuScrim}>
          <View
            accessibilityViewIsModal
            onStartShouldSetResponder={() => true}
            style={[styles.moreMenu, { top: insets.top + 52 }]}>
            <Pressable
              accessibilityLabel="清空日志"
              accessibilityRole="button"
              onPress={handleClearRequest}
              style={({ pressed }) => [styles.moreMenuItem, pressed && styles.dangerPressed]}>
              <Ionicons name="trash-outline" size={20} color={palette.danger} />
              <Text style={styles.moreMenuDangerText}>清空日志</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <SelectionMenu
        bottomInset={insets.bottom}
        onClose={() => setSelectorMenu(null)}
        onSelect={(key) => {
          setTimeOrder(key);
          setSelectorMenu(null);
        }}
        options={LOG_TIME_ORDERS}
        palette={palette}
        selectedKey={timeOrder}
        styles={styles}
        title="时间顺序"
        visible={selectorMenu === 'timeOrder'}
      />

      <SelectionMenu
        bottomInset={insets.bottom}
        onClose={() => setSelectorMenu(null)}
        onSelect={(key) => {
          setCountScope(key);
          setSelectorMenu(null);
        }}
        options={LOG_COUNT_SCOPES}
        palette={palette}
        selectedKey={countScope}
        styles={styles}
        title="显示范围"
        visible={selectorMenu === 'countScope'}
      />

      <AppToast {...toastProps} bottomOffset={toastBottomOffset} />
    </SafeAreaView>
  );
}

function createStyles(palette: RuntimeLogsPalette) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: palette.pageBackground,
    },
    navigationBar: {
      minHeight: 56,
      paddingHorizontal: spacing.screenPadding,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: palette.pageBackground,
    },
    navigationButton: {
      width: layout.minimumTouchSize,
      height: layout.minimumTouchSize,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navigationButtonPressed: {
      opacity: 0.55,
    },
    moreButton: {
      backgroundColor: palette.control,
    },
    navigationTitle: {
      fontSize: 19,
      lineHeight: 24,
      fontWeight: '700',
      color: palette.textPrimary,
    },
    listContent: {
      paddingHorizontal: spacing.screenPadding,
    },
    summaryBlock: {
      paddingTop: spacing.xl,
      paddingBottom: spacing.xl,
      gap: spacing.xs,
    },
    summaryCount: {
      fontSize: 24,
      lineHeight: 31,
      fontWeight: '500',
      color: palette.textPrimary,
      letterSpacing: -0.3,
    },
    summaryDescription: {
      ...typography.body,
      color: palette.textSecondary,
    },
    searchContainer: {
      minHeight: 50,
      borderRadius: radius.pill,
      paddingLeft: spacing.lg,
      paddingRight: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: palette.control,
    },
    searchInput: {
      minWidth: 0,
      flex: 1,
      paddingVertical: 0,
      fontSize: 16,
      lineHeight: 21,
      color: palette.textPrimary,
    },
    searchClearButton: {
      width: layout.minimumTouchSize,
      height: layout.minimumTouchSize,
      alignItems: 'center',
      justifyContent: 'center',
    },
    levelFilterContent: {
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
      gap: spacing.sm,
    },
    levelFilterChip: {
      minHeight: layout.minimumTouchSize,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.control,
    },
    levelFilterChipSelected: {
      backgroundColor: palette.action,
    },
    levelFilterText: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '600',
      color: palette.textPrimary,
    },
    levelFilterTextSelected: {
      color: palette.white,
    },
    controlPressed: {
      opacity: 0.68,
    },
    controlRow: {
      marginTop: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    selectorGroup: {
      minWidth: 0,
      flex: 1,
      flexDirection: 'row',
      gap: spacing.sm,
    },
    selectorButton: {
      minWidth: 0,
      minHeight: layout.minimumTouchSize,
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.separator,
      borderRadius: radius.control,
      paddingHorizontal: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
      backgroundColor: palette.surface,
    },
    selectorText: {
      minWidth: 0,
      flexShrink: 1,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '600',
      color: palette.textPrimary,
    },
    refreshButton: {
      width: layout.minimumTouchSize,
      height: layout.minimumTouchSize,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listHeadingRow: {
      minHeight: layout.minimumTouchSize,
      marginTop: spacing.xxl,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    listHeading: {
      ...typography.sectionMajor,
      color: palette.textPrimary,
    },
    exportButton: {
      minWidth: 0,
      minHeight: layout.minimumTouchSize,
      flexShrink: 1,
      borderRadius: radius.control,
      paddingHorizontal: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    exportButtonPressed: {
      backgroundColor: palette.actionSoft,
    },
    exportButtonDisabled: {
      opacity: 0.85,
    },
    exportButtonText: {
      minWidth: 0,
      flexShrink: 1,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '500',
      color: palette.action,
    },
    exportButtonTextDisabled: {
      color: palette.textTertiary,
    },
    copyHint: {
      marginBottom: spacing.md,
      fontSize: 13,
      lineHeight: 18,
      color: palette.textTertiary,
    },
    logSeparator: {
      height: spacing.md,
    },
    logCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.separator,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.md,
      backgroundColor: palette.surface,
    },
    logCardPressed: {
      opacity: 0.8,
    },
    logTopRow: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    levelBadge: {
      minHeight: 28,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    levelBadgeText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      letterSpacing: 0.25,
    },
    logTimestamp: {
      flexShrink: 0,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: 'monospace',
      color: palette.textSecondary,
    },
    logScopeText: {
      minWidth: 0,
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: 'monospace',
      color: palette.textSecondary,
    },
    logMessageText: {
      fontSize: 16,
      lineHeight: 23,
      fontWeight: '600',
      color: palette.textPrimary,
    },
    metadataContainer: {
      position: 'relative',
      borderRadius: radius.sm,
      padding: spacing.md,
      backgroundColor: palette.surfaceMuted,
    },
    metadataContainerExpandable: {
      paddingRight: spacing.xxl,
    },
    logMetadataText: {
      fontSize: 12,
      lineHeight: 18,
      fontFamily: 'monospace',
      color: palette.textSecondary,
    },
    metadataChevron: {
      position: 'absolute',
      right: spacing.sm,
      top: spacing.md,
    },
    emptyState: {
      minHeight: 190,
      paddingHorizontal: spacing.xl,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    emptyTitle: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '600',
      color: palette.textPrimary,
      textAlign: 'center',
    },
    emptyDescription: {
      ...typography.caption,
      color: palette.textTertiary,
      textAlign: 'center',
    },
    menuScrim: {
      flex: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: spacing.md,
      backgroundColor: palette.scrim,
    },
    selectionSheet: {
      overflow: 'hidden',
      borderRadius: radius.lg,
      paddingVertical: spacing.sm,
      backgroundColor: palette.surface,
    },
    selectionTitle: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      color: palette.textTertiary,
    },
    selectionOption: {
      minHeight: 52,
      paddingHorizontal: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    selectionOptionText: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '500',
      color: palette.textPrimary,
    },
    moreMenuScrim: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    moreMenu: {
      position: 'absolute',
      right: spacing.screenPadding,
      width: 176,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.separator,
      borderRadius: radius.control,
      backgroundColor: palette.surface,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.16,
      shadowRadius: 16,
      elevation: 8,
    },
    moreMenuItem: {
      minHeight: 50,
      paddingHorizontal: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    moreMenuDangerText: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '500',
      color: palette.danger,
    },
    dangerPressed: {
      backgroundColor: palette.dangerSoft,
    },
  });
}
