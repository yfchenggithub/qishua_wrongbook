import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  type LayoutChangeEvent,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  type SectionListData,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BrandHeader,
  CardContainer,
  ProgressDots,
  QuickAnchorNav,
  type QuickAnchorNavItem,
  ScreenContainer,
  SegmentControl,
} from '@/src/components';
import type { MistakeListFilter, MistakeListItem } from '@/src/models/MistakeListItem';
import { libraryMock, type LibraryFilterValue } from '@/src/mocks/library';
import { Logger } from '@/src/services/Logger';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import * as MistakeListService from '@/src/services/MistakeListService';
import type { MistakeModuleCount, MistakeTagFilterCount } from '@/src/services/MistakeListService';
import { normalizeMistakeTagKey } from '@/src/services/MistakeTagService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';
import { addDays, parseLocalDateTime, startOfLocalDay } from '@/src/utils/date';
import { resolveNextReviewAtText } from '@/src/utils/reviewSchedule';

const SEARCH_DEBOUNCE_MS = 350;
const INLINE_MODULE_FILTER_OPTION_LIMIT = 3;
const INLINE_TAG_FILTER_OPTION_LIMIT = 6;
const INITIAL_VISIBLE_MISTAKE_LIMIT = 60;
const VISIBLE_MISTAKE_INCREMENT = 60;
const PAGE_SCOPE = 'LibraryScreen';
const TOAST_DURATION_DEFAULT = 1800;
const LIBRARY_ANCHOR_HIGHLIGHT_DURATION_MS = 1200;
const LIBRARY_ANCHOR_ACTIVE_OFFSET = 104;
const LIBRARY_ANCHOR_SCROLL_OFFSET = spacing.sm;
const LIBRARY_ANCHOR_FLOATING_COLLAPSED_SCROLL_OFFSET = 64;
const LIBRARY_ANCHOR_FLOATING_EXPANDED_SCROLL_OFFSET = 112;

type LibraryAnchorId = 'search' | 'filters' | 'quickView' | 'list';
type ToastType = 'success' | 'info' | 'warning' | 'error';

type LibraryModuleFilterValue = string | null;
type ListLoadMode = 'initial' | 'refresh' | 'filter';
type LibraryQuickViewId =
  | 'today'
  | 'overdue'
  | 'recent'
  | 'recentViewed'
  | 'never'
  | 'nearlyDone'
  | 'pinned';
type LibrarySortKey =
  | 'reviewTime'
  | 'overdueLongest'
  | 'recentAdded'
  | 'recentViewed'
  | 'reviewCountAsc'
  | 'nearMastered'
  | 'title';
type LibrarySectionId =
  | 'overdue'
  | 'today'
  | 'future7'
  | 'later'
  | 'noPlan'
  | 'recent'
  | 'recentViewed'
  | 'flat';

const LIBRARY_ANCHOR_LABELS: Record<LibraryAnchorId, string> = {
  search: '搜索',
  filters: '筛选',
  quickView: '快速查看',
  list: '题目列表',
};

const LIBRARY_ANCHOR_ITEMS: readonly QuickAnchorNavItem<LibraryAnchorId>[] = [
  { id: 'search', label: LIBRARY_ANCHOR_LABELS.search, shortLabel: '搜索', icon: 'search' },
  { id: 'filters', label: LIBRARY_ANCHOR_LABELS.filters, shortLabel: '筛选', icon: 'filter-list' },
  { id: 'quickView', label: LIBRARY_ANCHOR_LABELS.quickView, shortLabel: '快看', icon: 'bolt' },
  { id: 'list', label: LIBRARY_ANCHOR_LABELS.list, shortLabel: '题目', icon: 'view-list' },
];

interface LibraryDateBounds {
  startOfRecentWindow: Date;
  startOfToday: Date;
  startOfTomorrow: Date;
  startOfEightDaysLater: Date;
}

interface LibraryQuickViewOption {
  id: LibraryQuickViewId;
  label: string;
  icon: ComponentProps<typeof MaterialIcons>['name'];
  tone: 'success' | 'danger' | 'info' | 'neutral' | 'warning' | 'pinned';
}

interface LibrarySortOption {
  key: LibrarySortKey;
  label: string;
  description: string;
}

interface LibraryListSection {
  id: LibrarySectionId;
  title: string;
  count: number;
  defaultCollapsed: boolean;
  data: MistakeListItem[];
}

interface LibraryModuleFilterOption {
  key: string;
  value: LibraryModuleFilterValue;
  label: string;
  count: number;
}

interface LibraryTagFilterOption {
  key: string;
  value: string;
  label: string;
  count: number;
}

const QUICK_VIEW_OPTIONS: readonly LibraryQuickViewOption[] = [
  { id: 'today', label: '今日应做', icon: 'event-available', tone: 'success' },
  { id: 'overdue', label: '已逾期', icon: 'timer', tone: 'danger' },
  { id: 'recent', label: '最近添加', icon: 'schedule', tone: 'info' },
  { id: 'recentViewed', label: '最近访问', icon: 'visibility', tone: 'info' },
  { id: 'never', label: '从未复做', icon: 'history', tone: 'neutral' },
  { id: 'nearlyDone', label: '接近完成', icon: 'filter-alt', tone: 'warning' },
  { id: 'pinned', label: '我的置顶', icon: 'star-outline', tone: 'pinned' },
] as const;

const SORT_OPTIONS: readonly LibrarySortOption[] = [
  { key: 'reviewTime', label: '复做时间最近', description: '逾期和今日题优先' },
  { key: 'overdueLongest', label: '逾期最久', description: '逾期天数从大到小' },
  { key: 'recentAdded', label: '最近添加', description: '按录入时间倒序' },
  { key: 'recentViewed', label: '最近查看', description: '未查看的排在最后' },
  { key: 'reviewCountAsc', label: '复做次数少', description: '优先处理刷数更少的题' },
  { key: 'nearMastered', label: '接近七刷', description: '刷数高的排在前面' },
  { key: 'title', label: '标题名称', description: '按标题稳定排序' },
] as const;

function getQuickViewToneColor(tone: LibraryQuickViewOption['tone']): string {
  if (tone === 'danger') {
    return colors.danger;
  }
  if (tone === 'info') {
    return '#2563EB';
  }
  if (tone === 'warning') {
    return '#D97706';
  }
  if (tone === 'pinned') {
    return '#D97706';
  }
  if (tone === 'neutral') {
    return colors.textSecondary;
  }
  return colors.success;
}

function getSectionColor(sectionId: LibrarySectionId): string {
  if (sectionId === 'overdue') {
    return colors.danger;
  }
  if (sectionId === 'today') {
    return '#F97316';
  }
  if (sectionId === 'future7') {
    return '#2563EB';
  }
  if (sectionId === 'recent' || sectionId === 'recentViewed') {
    return '#2563EB';
  }
  return colors.textSecondary;
}

function getSectionIcon(
  sectionId: LibrarySectionId,
): ComponentProps<typeof MaterialIcons>['name'] {
  if (sectionId === 'overdue') {
    return 'error-outline';
  }
  if (sectionId === 'today') {
    return 'event-available';
  }
  if (sectionId === 'future7') {
    return 'date-range';
  }
  if (sectionId === 'later') {
    return 'event-note';
  }
  if (sectionId === 'recent') {
    return 'schedule';
  }
  if (sectionId === 'recentViewed') {
    return 'visibility';
  }
  return 'pending-actions';
}

function getToastBackgroundColor(type: ToastType): string {
  if (type === 'success') {
    return 'rgba(24, 38, 30, 0.95)';
  }
  if (type === 'error') {
    return 'rgba(88, 28, 28, 0.95)';
  }
  if (type === 'warning') {
    return 'rgba(92, 62, 18, 0.95)';
  }
  return 'rgba(38, 44, 53, 0.95)';
}

function sanitizeNextReviewText(text: string): string {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) {
    return '';
  }
  return normalized.replace(/^[^\u4E00-\u9FFF0-9A-Za-z]+/u, '').trim();
}

function mapSegmentValueToFilterSegment(value: LibraryFilterValue): MistakeListFilter['segment'] {
  if (value === 'pending') {
    return 'due';
  }
  if (value === 'mastered') {
    return 'mastered';
  }
  return 'all';
}

function buildLibraryListFilter(
  filterValue: LibraryFilterValue,
  keyword: string,
  module: LibraryModuleFilterValue,
  tagKeys: string[] = [],
): MistakeListFilter {
  return {
    segment: mapSegmentValueToFilterSegment(filterValue),
    keyword,
    module,
    tagKeys,
    limit: null,
  };
}

function normalizeModuleFilterValue(moduleName: string | null | undefined): string | null {
  const normalized = typeof moduleName === 'string' ? moduleName.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function buildLibraryModuleFilterOptions(
  moduleCounts: MistakeModuleCount[],
): LibraryModuleFilterOption[] {
  const moduleOptions = moduleCounts.reduce<LibraryModuleFilterOption[]>((options, item) => {
    const moduleName = normalizeModuleFilterValue(item.module);
    const count = Number.isFinite(item.count) ? Math.max(0, Math.floor(item.count)) : 0;
    if (!moduleName || count <= 0) {
      return options;
    }

    options.push({
      key: `module:${moduleName}`,
      value: moduleName,
      label: moduleName,
      count,
    });
    return options;
  }, []);
  const allCount = moduleOptions.reduce((sum, option) => sum + option.count, 0);

  return [
    {
      key: 'all',
      value: null,
      label: '全部',
      count: allCount,
    },
    ...moduleOptions,
  ];
}

function formatLibraryModuleFilterOptionText(option: LibraryModuleFilterOption): string {
  if (option.count <= 0) {
    return option.label;
  }
  return `${option.label} ${option.count}题`;
}

function formatLibraryModuleFilterAccessibilityLabel(option: LibraryModuleFilterOption): string {
  if (option.value === null) {
    return `显示全部模块，共${option.count}道错题`;
  }
  return `筛选${option.label}模块，共${option.count}道错题`;
}

function formatLibraryModuleFilterHint(
  option: LibraryModuleFilterOption | null,
  selectedModuleFilter: LibraryModuleFilterValue,
): string {
  if (selectedModuleFilter === null) {
    const count = option?.count ?? 0;
    return `已筛选：全部模块，共 ${count} 题`;
  }

  const countText = option ? `，共 ${option.count} 题` : '';
  return `已筛选：“${selectedModuleFilter}”模块${countText}`;
}

function buildLibraryTagFilterOptions(
  tagCounts: MistakeTagFilterCount[],
): LibraryTagFilterOption[] {
  return tagCounts.reduce<LibraryTagFilterOption[]>((options, item) => {
    const label = typeof item.name === 'string' ? item.name.trim() : '';
    const normalizedName = typeof item.normalizedName === 'string'
      ? item.normalizedName.trim()
      : '';
    const count = Number.isFinite(item.count) ? Math.max(0, Math.floor(item.count)) : 0;
    if (!label || !normalizedName || count <= 0) {
      return options;
    }

    options.push({
      key: `tag:${normalizedName}`,
      value: normalizedName,
      label,
      count,
    });
    return options;
  }, []);
}

function formatLibraryTagFilterAccessibilityLabel(option: LibraryTagFilterOption): string {
  return `筛选标签：${option.label}，共${option.count}道错题`;
}

function normalizeMistakeId(id: string): string | null {
  const normalized = typeof id === 'string' ? id.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function buildLibraryDateBounds(baseDate = new Date()): LibraryDateBounds {
  const startOfToday = startOfLocalDay(baseDate);
  const startOfTomorrow = addDays(startOfToday, 1);
  const startOfEightDaysLater = addDays(startOfToday, 8);
  const startOfRecentWindow = addDays(startOfToday, -6);
  return {
    startOfRecentWindow,
    startOfToday,
    startOfTomorrow,
    startOfEightDaysLater,
  };
}

function getTimeValue(value: string | null | undefined): number | null {
  const parsed = parseLocalDateTime(value ?? null);
  if (!parsed) {
    return null;
  }
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : time;
}

function isTodayDueItem(item: MistakeListItem, bounds: LibraryDateBounds): boolean {
  if (item.status !== 'active') {
    return false;
  }
  const nextReviewTime = getTimeValue(item.nextReviewAt);
  return (
    nextReviewTime !== null
    && nextReviewTime >= bounds.startOfToday.getTime()
    && nextReviewTime < bounds.startOfTomorrow.getTime()
  );
}

function isOverdueItem(item: MistakeListItem, bounds: LibraryDateBounds): boolean {
  if (item.status !== 'active') {
    return false;
  }
  const nextReviewTime = getTimeValue(item.nextReviewAt);
  return nextReviewTime !== null && nextReviewTime < bounds.startOfToday.getTime();
}

function isRecentlyAddedItem(item: MistakeListItem, bounds: LibraryDateBounds): boolean {
  const createdTime = getTimeValue(item.createdAt);
  return (
    createdTime !== null
    && createdTime >= bounds.startOfRecentWindow.getTime()
  );
}

function isRecentlyViewedItem(item: MistakeListItem, bounds: LibraryDateBounds): boolean {
  const viewedTime = getTimeValue(item.lastViewedAt ?? null);
  return (
    viewedTime !== null
    && viewedTime >= bounds.startOfRecentWindow.getTime()
  );
}

function isNeverReviewedItem(item: MistakeListItem): boolean {
  return item.reviewCount === 0 && item.status !== 'archived';
}

function isNearlyDoneItem(item: MistakeListItem): boolean {
  return item.status === 'active' && (item.reviewCount === 5 || item.reviewCount === 6);
}

function isRecentQuickView(
  quickViewId: LibraryQuickViewId | null,
): quickViewId is 'recent' | 'recentViewed' {
  return quickViewId === 'recent' || quickViewId === 'recentViewed';
}

function getDefaultSortKeyForRecentQuickView(quickViewId: 'recent' | 'recentViewed'): LibrarySortKey {
  return quickViewId === 'recentViewed' ? 'recentViewed' : 'recentAdded';
}

function getQuickViewCounts(
  sourceItems: readonly MistakeListItem[],
  bounds: LibraryDateBounds,
): Record<LibraryQuickViewId, number> {
  const counts: Record<LibraryQuickViewId, number> = {
    today: 0,
    overdue: 0,
    recent: 0,
    recentViewed: 0,
    never: 0,
    nearlyDone: 0,
    pinned: 0,
  };

  for (const item of sourceItems) {
    if (isTodayDueItem(item, bounds)) {
      counts.today += 1;
    }
    if (isOverdueItem(item, bounds)) {
      counts.overdue += 1;
    }
    if (isRecentlyAddedItem(item, bounds)) {
      counts.recent += 1;
    }
    if (isRecentlyViewedItem(item, bounds)) {
      counts.recentViewed += 1;
    }
    if (isNeverReviewedItem(item)) {
      counts.never += 1;
    }
    if (isNearlyDoneItem(item)) {
      counts.nearlyDone += 1;
    }
    if (item.isPinned) {
      counts.pinned += 1;
    }
  }

  return counts;
}

function filterMistakesByQuickView(
  sourceItems: readonly MistakeListItem[],
  quickViewId: LibraryQuickViewId | null,
  bounds: LibraryDateBounds,
): MistakeListItem[] {
  if (!quickViewId) {
    return [...sourceItems];
  }

  return sourceItems.filter((item) => {
    if (quickViewId === 'today') {
      return isTodayDueItem(item, bounds);
    }
    if (quickViewId === 'overdue') {
      return isOverdueItem(item, bounds);
    }
    if (quickViewId === 'recent') {
      return isRecentlyAddedItem(item, bounds);
    }
    if (quickViewId === 'recentViewed') {
      return isRecentlyViewedItem(item, bounds);
    }
    if (quickViewId === 'never') {
      return isNeverReviewedItem(item);
    }
    if (quickViewId === 'nearlyDone') {
      return isNearlyDoneItem(item);
    }
    return item.isPinned;
  });
}

function compareNullableTime(
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
  direction: 'asc' | 'desc',
): number {
  const leftTime = getTimeValue(leftValue);
  const rightTime = getTimeValue(rightValue);
  if (leftTime === null && rightTime === null) {
    return 0;
  }
  if (leftTime === null) {
    return 1;
  }
  if (rightTime === null) {
    return -1;
  }
  return direction === 'asc' ? leftTime - rightTime : rightTime - leftTime;
}

function sortMistakes(
  sourceItems: readonly MistakeListItem[],
  sortKey: LibrarySortKey,
  bounds: LibraryDateBounds,
  selectedFilter: LibraryFilterValue,
  activeQuickViewId: LibraryQuickViewId | null,
): MistakeListItem[] {
  const indexById = new Map(sourceItems.map((item, index) => [item.id, index]));
  const itemsWithIndex = [...sourceItems];

  itemsWithIndex.sort((left, right) => {
    if (!isRecentQuickView(activeQuickViewId) && activeQuickViewId !== 'pinned' && left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1;
    }

    let result = 0;
    if (sortKey === 'reviewTime') {
      result = selectedFilter === 'mastered'
        ? compareNullableTime(left.updatedAt, right.updatedAt, 'desc')
        : compareNullableTime(left.nextReviewAt, right.nextReviewAt, 'asc');
    } else if (sortKey === 'overdueLongest') {
      const leftOverdueTime = isOverdueItem(left, bounds) ? getTimeValue(left.nextReviewAt) : null;
      const rightOverdueTime = isOverdueItem(right, bounds) ? getTimeValue(right.nextReviewAt) : null;
      result = compareNullableTime(leftOverdueTime === null ? null : new Date(leftOverdueTime).toISOString(), rightOverdueTime === null ? null : new Date(rightOverdueTime).toISOString(), 'asc');
      if (leftOverdueTime === null && rightOverdueTime !== null) {
        result = 1;
      } else if (leftOverdueTime !== null && rightOverdueTime === null) {
        result = -1;
      }
    } else if (sortKey === 'recentAdded') {
      result = compareNullableTime(left.createdAt, right.createdAt, 'desc');
    } else if (sortKey === 'recentViewed') {
      result = compareNullableTime(left.lastViewedAt ?? null, right.lastViewedAt ?? null, 'desc');
    } else if (sortKey === 'reviewCountAsc') {
      result = left.reviewCount - right.reviewCount;
    } else if (sortKey === 'nearMastered') {
      result = right.reviewCount - left.reviewCount;
    } else {
      result = left.title.localeCompare(right.title, 'zh-Hans-CN');
    }

    if (result !== 0) {
      return result;
    }

    const createdTieBreak = compareNullableTime(left.createdAt, right.createdAt, 'desc');
    if (createdTieBreak !== 0) {
      return createdTieBreak;
    }

    return (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0);
  });

  return itemsWithIndex;
}

function buildSection(
  id: LibrarySectionId,
  title: string,
  items: MistakeListItem[],
  defaultCollapsed: boolean,
): LibraryListSection | null {
  if (items.length <= 0) {
    return null;
  }
  return {
    id,
    title,
    count: items.length,
    defaultCollapsed,
    data: items,
  };
}

function groupMistakesByReviewDate(
  sourceItems: readonly MistakeListItem[],
  selectedFilter: LibraryFilterValue,
  bounds: LibraryDateBounds,
  activeQuickViewId: LibraryQuickViewId | null,
): LibraryListSection[] {
  if (activeQuickViewId === 'recent' || activeQuickViewId === 'recentViewed') {
    const section = buildSection(
      activeQuickViewId,
      activeQuickViewId === 'recent' ? '最近添加' : '最近访问',
      [...sourceItems],
      false,
    );
    return section ? [section] : [];
  }

  if (selectedFilter === 'mastered') {
    return [
      {
        id: 'flat',
        title: '',
        count: sourceItems.length,
        defaultCollapsed: false,
        data: [...sourceItems],
      },
    ];
  }

  const overdue: MistakeListItem[] = [];
  const today: MistakeListItem[] = [];
  const future7: MistakeListItem[] = [];
  const later: MistakeListItem[] = [];
  const noPlan: MistakeListItem[] = [];

  const todayStart = bounds.startOfToday.getTime();
  const tomorrowStart = bounds.startOfTomorrow.getTime();
  const eightDaysLaterStart = bounds.startOfEightDaysLater.getTime();

  for (const item of sourceItems) {
    const nextReviewTime = getTimeValue(item.nextReviewAt);
    if (nextReviewTime === null) {
      if (item.status !== 'archived') {
        noPlan.push(item);
      }
      continue;
    }
    if (nextReviewTime < todayStart) {
      overdue.push(item);
    } else if (nextReviewTime >= todayStart && nextReviewTime < tomorrowStart) {
      today.push(item);
    } else if (nextReviewTime >= tomorrowStart && nextReviewTime < eightDaysLaterStart) {
      future7.push(item);
    } else {
      later.push(item);
    }
  }

  return [
    buildSection('overdue', '已逾期', overdue, false),
    buildSection('today', '今天应复做', today, false),
    buildSection('future7', '未来 7 天', future7, true),
    buildSection('later', '更晚复做', later, true),
    buildSection('noPlan', '暂无复做计划', noPlan, true),
  ].filter((section): section is LibraryListSection => section !== null);
}

function limitLibrarySectionData(
  sections: readonly LibraryListSection[],
  limit: number,
): LibraryListSection[] {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  let remaining = normalizedLimit;

  return sections.reduce<LibraryListSection[]>((visibleSections, section) => {
    const isCollapsedHeader = section.count > 0 && section.data.length <= 0;
    if (isCollapsedHeader) {
      visibleSections.push(section);
      return visibleSections;
    }

    if (remaining <= 0) {
      return visibleSections;
    }

    const visibleData = section.data.slice(0, remaining);
    remaining -= visibleData.length;
    if (visibleData.length > 0) {
      visibleSections.push({
        ...section,
        data: visibleData,
      });
    }
    return visibleSections;
  }, []);
}

function ThumbnailPlaceholder() {
  return (
    <View style={styles.thumb}>
      <MaterialIcons size={28} name="image-not-supported" color={colors.textMuted} />
      <Text style={styles.thumbPlaceholderText}>题目</Text>
      <Text style={styles.thumbPlaceholderText}>无图</Text>
    </View>
  );
}

function MistakeLibraryCard({
  item,
  isDeleting = false,
  onPress,
  onLongPress,
  onMorePress,
}: {
  item: MistakeListItem;
  isDeleting?: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onMorePress: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const didLongPressRef = useRef(false);

  useEffect(() => {
    setImageFailed(false);
  }, [item.thumbnailUri]);

  const showImage = !!item.thumbnailUri && !imageFailed;
  const nextReviewInfo = useMemo(
    () =>
      resolveNextReviewAtText({
        reviewCount: item.reviewCount,
        maxReviewCount: item.maxReviewCount,
        nextReviewAt: item.nextReviewAt ?? null,
      }),
    [item.maxReviewCount, item.nextReviewAt, item.reviewCount],
  );
  const nextReviewLineText = useMemo(() => {
    const sanitized = sanitizeNextReviewText(nextReviewInfo.displayText);
    if (!nextReviewInfo.absoluteDate) {
      return sanitized;
    }

    const groupedDateMatch = /[\(\uFF08]([^\)\uFF09]+)[\)\uFF09]/.exec(sanitized);
    if (groupedDateMatch && groupedDateMatch[1]) {
      const compactDatePart = groupedDateMatch[1].replace(/\s+/g, '');
      return `${nextReviewInfo.label}(${compactDatePart})`;
    }

    return `${nextReviewInfo.label}(${nextReviewInfo.absoluteDate})`;
  }, [nextReviewInfo.absoluteDate, nextReviewInfo.displayText, nextReviewInfo.label]);

  return (
    <Pressable
      disabled={isDeleting}
      onLongPress={() => {
        didLongPressRef.current = true;
        onLongPress();
      }}
      onPress={() => {
        if (didLongPressRef.current) {
          didLongPressRef.current = false;
          return;
        }
        onPress();
      }}
      style={[styles.cardPressable, isDeleting && styles.cardPressableDisabled]}>
      <CardContainer padding={14} style={styles.card}>
        <View style={styles.cardRow}>
          {showImage ? (
            <Image
              source={{ uri: item.thumbnailUri! }}
              style={styles.thumbImage}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ThumbnailPlaceholder />
          )}

          <View style={styles.cardMain}>
            <View style={styles.cardTopLine}>
              <View style={styles.modulePill}>
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  allowFontScaling={false}
                  maxFontSizeMultiplier={1.0}
                  style={styles.cardMeta}>
                  {item.module}
                </Text>
              </View>
              <View style={styles.cardTopLineEnd}>
                {item.isPinned ? (
                  <View style={styles.pinnedMark}>
                    <MaterialIcons name="star" size={13} color="#D97706" />
                  </View>
                ) : null}
                <View style={styles.difficultyPill}>
                  <Text
                    numberOfLines={1}
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1.0}
                    style={styles.difficultyText}>
                    难度 {item.difficulty}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.isPinned ? '打开题目菜单，当前已置顶' : '打开题目菜单'}
                  hitSlop={8}
                  onPress={onMorePress}
                  style={({ pressed }) => [
                    styles.cardMoreButton,
                    pressed ? styles.cardMoreButtonPressed : null,
                  ]}>
                  <MaterialIcons name="more-vert" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            </View>

            <View style={styles.titleRow}>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                allowFontScaling={false}
                maxFontSizeMultiplier={1.0}
                style={styles.cardTitle}>
                {item.title}
              </Text>
            </View>
            {item.tags.length > 0 ? (
              <View style={styles.cardTagRow}>
                {item.tags.slice(0, 2).map((tag) => (
                  <View key={tag.id} style={styles.cardTagPill}>
                    <Text numberOfLines={1} style={styles.cardTagText}>
                      {tag.name}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.progressRow}>
              <Text
                numberOfLines={1}
                allowFontScaling={false}
                maxFontSizeMultiplier={1.0}
                style={styles.progressLabel}>
                进度 {item.reviewCount}/{item.maxReviewCount}
              </Text>
              <ProgressDots
                total={item.maxReviewCount}
                current={item.reviewCount}
                completed={item.reviewCount}
                style={styles.progressDots}
              />
            </View>
            <View style={styles.nextReviewWrap}>
              <Text
                numberOfLines={1}
                allowFontScaling={false}
                maxFontSizeMultiplier={1.0}
                style={styles.nextReviewLabel}>
                下一次复做
              </Text>
              <Text
                numberOfLines={1}
                allowFontScaling={false}
                maxFontSizeMultiplier={1.0}
                style={[
                  styles.nextReviewText,
                  nextReviewInfo.tone === 'success' && styles.nextReviewTextSuccess,
                  nextReviewInfo.tone === 'muted' && styles.nextReviewTextMuted,
                  nextReviewInfo.tone === 'danger' && styles.nextReviewTextDanger,
                ]}>
                {nextReviewLineText}
              </Text>
            </View>
          </View>
        </View>
        {isDeleting ? (
          <View pointerEvents="none" style={styles.cardDeletingMask}>
            <ActivityIndicator size="small" color={colors.danger} />
            <Text style={styles.cardDeletingText}>删除中...</Text>
          </View>
        ) : null}
      </CardContainer>
    </Pressable>
  );
}

function QuickViewBar({
  activeQuickViewId,
  counts,
  onSelect,
}: {
  activeQuickViewId: LibraryQuickViewId | null;
  counts: Record<LibraryQuickViewId, number>;
  onSelect: (quickViewId: LibraryQuickViewId) => void;
}) {
  return (
    <View style={styles.quickViewBlock}>
      <Text style={styles.quickViewTitle}>快速查看</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickViewContent}>
        {QUICK_VIEW_OPTIONS.map((option) => {
          const selected = activeQuickViewId === option.id;
          const count = counts[option.id] ?? 0;
          const countText = ` ${count}`;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityLabel={`${selected ? '取消' : '启用'}快速查看：${option.label}`}
              onPress={() => onSelect(option.id)}
              style={({ pressed }) => [
                styles.quickViewChip,
                selected ? styles.quickViewChipSelected : null,
                selected && option.tone === 'danger' ? styles.quickViewChipDangerSelected : null,
                selected && option.tone === 'info' ? styles.quickViewChipInfoSelected : null,
                selected && option.tone === 'warning' ? styles.quickViewChipWarningSelected : null,
                selected && option.tone === 'pinned' ? styles.quickViewChipPinnedSelected : null,
                pressed ? styles.moduleFilterChipPressed : null,
              ]}>
              <MaterialIcons
                name={option.icon}
                size={16}
                color={selected ? getQuickViewToneColor(option.tone) : colors.textSecondary}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.quickViewChipText,
                  selected ? { color: getQuickViewToneColor(option.tone) } : null,
                ]}>
                {option.label}
                {countText}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SortSelectorSheet({
  visible,
  selectedSortKey,
  onClose,
  onSelect,
}: {
  visible: boolean;
  selectedSortKey: LibrarySortKey;
  onClose: () => void;
  onSelect: (sortKey: LibrarySortKey) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.moduleSheetOverlay}>
        <Pressable style={styles.moduleSheetBackdrop} onPress={onClose} />
        <View style={styles.moduleSheet}>
          <View style={styles.moduleSheetHandle} />
          <View style={styles.moduleSheetHeader}>
            <View style={styles.moduleSheetHeaderTextWrap}>
              <Text style={styles.moduleSheetTitle}>排序方式</Text>
              <Text style={styles.moduleSheetSubtitle}>切换后立即应用到当前结果</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭排序选择"
              onPress={onClose}
              style={({ pressed }) => [
                styles.moduleSheetCloseButton,
                pressed ? styles.moduleSheetCloseButtonPressed : null,
              ]}>
              <MaterialIcons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.sortSheetList}>
            {SORT_OPTIONS.map((option) => {
              const selected = selectedSortKey === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityLabel={`排序：${option.label}`}
                  onPress={() => onSelect(option.key)}
                  style={({ pressed }) => [
                    styles.sortSheetOption,
                    selected ? styles.sortSheetOptionSelected : null,
                    pressed ? styles.moduleFilterChipPressed : null,
                  ]}>
                  <View style={styles.sortSheetOptionTextWrap}>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.sortSheetOptionTitle,
                        selected ? styles.sortSheetOptionTitleSelected : null,
                      ]}>
                      {option.label}
                    </Text>
                    <Text numberOfLines={1} style={styles.sortSheetOptionDescription}>
                      {option.description}
                    </Text>
                  </View>
                  {selected ? <MaterialIcons name="check" size={20} color={colors.success} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ReviewSectionHeader({
  section,
  collapsed,
  onToggle,
}: {
  section: SectionListData<MistakeListItem, LibraryListSection>;
  collapsed: boolean;
  onToggle: (sectionId: LibrarySectionId) => void;
}) {
  if (section.id === 'flat') {
    return null;
  }

  return (
    <View style={styles.sectionHeaderOuter}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${collapsed ? '展开' : '收起'}${section.title}`}
        onPress={() => onToggle(section.id)}
        style={({ pressed }) => [
          styles.reviewSectionHeader,
          pressed ? styles.moduleFilterChipPressed : null,
        ]}>
        <View style={styles.reviewSectionTitleWrap}>
          <MaterialIcons
            name={getSectionIcon(section.id)}
            size={18}
            color={getSectionColor(section.id)}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.reviewSectionTitle,
              { color: getSectionColor(section.id) },
            ]}>
            {section.title} · {section.count}题
          </Text>
        </View>
        <View style={styles.reviewSectionToggle}>
          <Text style={styles.reviewSectionToggleText}>{collapsed ? '展开' : '收起'}</Text>
          <MaterialIcons
            name={collapsed ? 'keyboard-arrow-down' : 'keyboard-arrow-up'}
            size={20}
            color={colors.textSecondary}
          />
        </View>
      </Pressable>
    </View>
  );
}

function LibraryModuleFilterSheet({
  visible,
  options,
  selectedValue,
  onClose,
  onSelectOption,
}: {
  visible: boolean;
  options: LibraryModuleFilterOption[];
  selectedValue: LibraryModuleFilterValue;
  onClose: () => void;
  onSelectOption: (value: LibraryModuleFilterValue) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.moduleSheetOverlay}>
        <Pressable style={styles.moduleSheetBackdrop} onPress={onClose} />
        <View style={styles.moduleSheet}>
          <View style={styles.moduleSheetHandle} />
          <View style={styles.moduleSheetHeader}>
            <View style={styles.moduleSheetHeaderTextWrap}>
              <Text style={styles.moduleSheetTitle}>选择模块</Text>
              <Text style={styles.moduleSheetSubtitle}>{`共 ${options.length} 个筛选项`}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭模块选择"
              onPress={onClose}
              style={({ pressed }) => [
                styles.moduleSheetCloseButton,
                pressed ? styles.moduleSheetCloseButtonPressed : null,
              ]}>
              <MaterialIcons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.moduleFilterSheetScroll}
            contentContainerStyle={styles.moduleFilterSheetContent}>
            {options.map((option) => {
              const selected = selectedValue === option.value;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityLabel={formatLibraryModuleFilterAccessibilityLabel(option)}
                  onPress={() => onSelectOption(option.value)}
                  style={({ pressed }) => [
                    styles.moduleFilterSheetChip,
                    selected ? styles.moduleFilterSheetChipSelected : null,
                    pressed ? styles.moduleFilterChipPressed : null,
                  ]}>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.1}
                    style={[
                      styles.moduleFilterChipText,
                      selected ? styles.moduleFilterChipTextSelected : null,
                    ]}>
                    {formatLibraryModuleFilterOptionText(option)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function LibraryTagFilterSheet({
  visible,
  options,
  selectedValues,
  onClose,
  onToggleOption,
}: {
  visible: boolean;
  options: LibraryTagFilterOption[];
  selectedValues: string[];
  onClose: () => void;
  onToggleOption: (value: string) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.moduleSheetOverlay}>
        <Pressable style={styles.moduleSheetBackdrop} onPress={onClose} />
        <View style={styles.moduleSheet}>
          <View style={styles.moduleSheetHandle} />
          <View style={styles.moduleSheetHeader}>
            <View style={styles.moduleSheetHeaderTextWrap}>
              <Text style={styles.moduleSheetTitle}>选择标签</Text>
              <Text style={styles.moduleSheetSubtitle}>{`共 ${options.length} 个标签`}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭标签选择"
              onPress={onClose}
              style={({ pressed }) => [
                styles.moduleSheetCloseButton,
                pressed ? styles.moduleSheetCloseButtonPressed : null,
              ]}>
              <MaterialIcons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.moduleFilterSheetScroll}
            contentContainerStyle={styles.moduleFilterSheetContent}>
            {options.map((option) => {
              const selected = selectedSet.has(option.value);
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityLabel={formatLibraryTagFilterAccessibilityLabel(option)}
                  onPress={() => onToggleOption(option.value)}
                  style={({ pressed }) => [
                    styles.tagFilterSheetChip,
                    selected ? styles.tagFilterChipSelected : null,
                    pressed ? styles.moduleFilterChipPressed : null,
                  ]}>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.1}
                    style={[
                      styles.tagFilterChipText,
                      selected ? styles.tagFilterChipTextSelected : null,
                    ]}>
                    {option.label}
                  </Text>
                  {selected ? <MaterialIcons name="check" size={16} color={colors.success} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [searchText, setSearchText] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<LibraryFilterValue>('all');
  const [selectedModuleFilter, setSelectedModuleFilter] = useState<LibraryModuleFilterValue>(null);
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [moduleFilterOptions, setModuleFilterOptions] = useState<LibraryModuleFilterOption[]>([
    { key: 'all', value: null, label: '全部', count: 0 },
  ]);
  const [tagFilterOptions, setTagFilterOptions] = useState<LibraryTagFilterOption[]>([]);
  const [activeQuickViewId, setActiveQuickViewId] = useState<LibraryQuickViewId | null>(null);
  const [activeAnchorId, setActiveAnchorId] = useState<LibraryAnchorId>('search');
  const [highlightedAnchorId, setHighlightedAnchorId] = useState<LibraryAnchorId | null>(null);
  const [isFloatingAnchorVisible, setIsFloatingAnchorVisible] = useState(false);
  const [isAnchorNavCollapsed, setIsAnchorNavCollapsed] = useState(true);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);
  const [sortKey, setSortKey] = useState<LibrarySortKey>('reviewTime');
  const [sortSheetVisible, setSortSheetVisible] = useState(false);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Partial<Record<LibrarySectionId, boolean>>>({});
  const [isModuleFilterLoading, setIsModuleFilterLoading] = useState(false);
  const [isTagFilterLoading, setIsTagFilterLoading] = useState(false);
  const [moduleFilterErrorMessage, setModuleFilterErrorMessage] = useState<string | null>(null);
  const [tagFilterErrorMessage, setTagFilterErrorMessage] = useState<string | null>(null);
  const [moduleFilterSheetVisible, setModuleFilterSheetVisible] = useState(false);
  const [tagFilterSheetVisible, setTagFilterSheetVisible] = useState(false);
  const [items, setItems] = useState<MistakeListItem[]>([]);
  const [visibleItemLimit, setVisibleItemLimit] = useState(INITIAL_VISIBLE_MISTAKE_LIMIT);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingMistakeId, setDeletingMistakeId] = useState<string | null>(null);
  const [pinningMistakeId, setPinningMistakeId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);
  const hasFocusedRef = useRef(false);
  const libraryListRef = useRef<SectionList<MistakeListItem, LibraryListSection>>(null);
  const anchorLayoutsRef = useRef<Partial<Record<LibraryAnchorId, number>>>({});
  const anchorNavLayoutRef = useRef<{ y: number; height: number } | null>(null);
  const anchorHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const moduleFilterRequestIdRef = useRef(0);
  const tagFilterRequestIdRef = useRef(0);
  const sortBeforeRecentQuickViewRef = useRef<LibrarySortKey>('reviewTime');
  const quickViewSortWasAppliedRef = useRef(false);

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
      if (anchorHighlightTimerRef.current) {
        clearTimeout(anchorHighlightTimerRef.current);
        anchorHighlightTimerRef.current = null;
      }
    },
    [],
  );

  const scrollToLibraryOffset = useCallback((offset: number) => {
    const targetOffset = Math.max(0, offset);
    const listRef = libraryListRef.current as unknown as {
      getScrollResponder?: () => {
        scrollTo?: (params: { x?: number; y?: number; animated?: boolean }) => void;
        scrollResponderScrollTo?: (params: { x?: number; y?: number; animated?: boolean }) => void;
      } | null;
    };
    const scrollResponder = listRef?.getScrollResponder?.();
    if (scrollResponder?.scrollTo) {
      scrollResponder.scrollTo({
        x: 0,
        y: targetOffset,
        animated: true,
      });
      return;
    }
    scrollResponder?.scrollResponderScrollTo?.({
      x: 0,
      y: targetOffset,
      animated: true,
    });
  }, []);

  const handleAnchorLayout = useCallback(
    (anchorId: LibraryAnchorId, event: LayoutChangeEvent) => {
      anchorLayoutsRef.current = {
        ...anchorLayoutsRef.current,
        [anchorId]: event.nativeEvent.layout.y,
      };
    },
    [],
  );

  const handleAnchorNavLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    anchorNavLayoutRef.current = {
      y: Math.max(0, Math.round(y)),
      height: Math.max(0, Math.round(height)),
    };
  }, []);

  const handleAnchorPress = useCallback(
    (anchorId: LibraryAnchorId) => {
      setActiveAnchorId(anchorId);
      const anchorOffset = anchorLayoutsRef.current[anchorId];
      const label = LIBRARY_ANCHOR_LABELS[anchorId];
      if (typeof anchorOffset === 'number') {
        const anchorNavLayout = anchorNavLayoutRef.current;
        const floatingTriggerY = anchorNavLayout
          ? anchorNavLayout.y + anchorNavLayout.height - spacing.md
          : Number.POSITIVE_INFINITY;
        const willShowFloatingAnchor =
          Math.max(0, anchorOffset - LIBRARY_ANCHOR_SCROLL_OFFSET) >= floatingTriggerY;

        let scrollOffset: number = LIBRARY_ANCHOR_SCROLL_OFFSET;
        if (isFloatingAnchorVisible || willShowFloatingAnchor) {
          scrollOffset = isAnchorNavCollapsed
            ? LIBRARY_ANCHOR_FLOATING_COLLAPSED_SCROLL_OFFSET
            : LIBRARY_ANCHOR_FLOATING_EXPANDED_SCROLL_OFFSET;
        }

        scrollToLibraryOffset(anchorOffset - scrollOffset);
        setHighlightedAnchorId(anchorId);
        if (anchorHighlightTimerRef.current) {
          clearTimeout(anchorHighlightTimerRef.current);
        }
        anchorHighlightTimerRef.current = setTimeout(() => {
          setHighlightedAnchorId(null);
          anchorHighlightTimerRef.current = null;
        }, LIBRARY_ANCHOR_HIGHLIGHT_DURATION_MS);
        showToast(`已跳转到 ${label}`, 'success');
        return;
      }
      showToast(`${label}位置准备中，请稍后再试`, 'info');
    },
    [isAnchorNavCollapsed, isFloatingAnchorVisible, scrollToLibraryOffset, showToast],
  );

  const handleLibraryScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const activeOffset = event.nativeEvent.contentOffset.y + LIBRARY_ANCHOR_ACTIVE_OFFSET;
    let nextAnchorId: LibraryAnchorId = LIBRARY_ANCHOR_ITEMS[0].id;

    for (const item of LIBRARY_ANCHOR_ITEMS) {
      const anchorOffset = anchorLayoutsRef.current[item.id];
      if (typeof anchorOffset === 'number' && anchorOffset <= activeOffset) {
        nextAnchorId = item.id;
      }
    }

    setActiveAnchorId((currentAnchorId) =>
      currentAnchorId === nextAnchorId ? currentAnchorId : nextAnchorId,
    );

    const anchorNavLayout = anchorNavLayoutRef.current;
    const y = event.nativeEvent.contentOffset.y;
    const nextFloatingAnchorVisible = anchorNavLayout
      ? y >= anchorNavLayout.y + anchorNavLayout.height - spacing.md
      : false;
    setIsFloatingAnchorVisible((current) =>
      current === nextFloatingAnchorVisible ? current : nextFloatingAnchorVisible,
    );
    if (!nextFloatingAnchorVisible) {
      setIsAnchorNavCollapsed((current) => (current ? current : true));
    }
  }, []);

  const handleToggleAnchorNavCollapsed = useCallback(() => {
    setIsAnchorNavCollapsed((current) => !current);
  }, []);

  const loadList = useCallback(
    async (filter: MistakeListFilter, mode: ListLoadMode) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (mode === 'initial') {
        setIsLoading(true);
      } else if (mode === 'refresh') {
        setIsRefreshing(true);
      }
      setErrorMessage(null);

      try {
        const listItems = await MistakeListService.getMistakeListItems(filter);
        if (requestId !== requestIdRef.current) {
          return;
        }
        setItems(listItems);
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        Logger.error(PAGE_SCOPE, 'Failed to load library list.', {
          filter,
          mode,
          error,
        });
        setItems([]);
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    []
  );

  const loadModuleFilterOptions = useCallback(async (filter: MistakeListFilter) => {
    const requestId = moduleFilterRequestIdRef.current + 1;
    moduleFilterRequestIdRef.current = requestId;
    setIsModuleFilterLoading(true);
    setModuleFilterErrorMessage(null);

    try {
      const moduleCounts = await MistakeListService.getMistakeModuleCounts(filter);
      if (requestId !== moduleFilterRequestIdRef.current) {
        return;
      }

      const nextOptions = buildLibraryModuleFilterOptions(moduleCounts);
      const validModules = new Set(
        nextOptions
          .map((option) => option.value)
          .filter((value): value is string => value !== null),
      );
      setModuleFilterOptions(nextOptions);
      setSelectedModuleFilter((currentValue) =>
        currentValue !== null && !validModules.has(currentValue) ? null : currentValue,
      );
    } catch (error) {
      if (requestId !== moduleFilterRequestIdRef.current) {
        return;
      }
      Logger.error(PAGE_SCOPE, 'Failed to load library module filter options.', {
        filter,
        error,
      });
      setModuleFilterErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId !== moduleFilterRequestIdRef.current) {
        return;
      }
      setIsModuleFilterLoading(false);
    }
  }, []);

  const loadTagFilterOptions = useCallback(async (filter: MistakeListFilter) => {
    const requestId = tagFilterRequestIdRef.current + 1;
    tagFilterRequestIdRef.current = requestId;
    setIsTagFilterLoading(true);
    setTagFilterErrorMessage(null);

    try {
      const tagCounts = await MistakeListService.getMistakeTagFilterCounts(filter);
      if (requestId !== tagFilterRequestIdRef.current) {
        return;
      }

      const nextOptions = buildLibraryTagFilterOptions(tagCounts);
      const validTagKeys = new Set(nextOptions.map((option) => option.value));
      setTagFilterOptions(nextOptions);
      setSelectedTagFilters((currentValues) => {
        const nextValues = currentValues.filter((tagKey) => validTagKeys.has(tagKey));
        if (nextValues.length === currentValues.length) {
          return currentValues;
        }
        return nextValues;
      });
    } catch (error) {
      if (requestId !== tagFilterRequestIdRef.current) {
        return;
      }
      Logger.error(PAGE_SCOPE, 'Failed to load library tag filter options.', {
        filter,
        error,
      });
      setTagFilterErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId !== tagFilterRequestIdRef.current) {
        return;
      }
      setIsTagFilterLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(searchText.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    setVisibleItemLimit(INITIAL_VISIBLE_MISTAKE_LIMIT);
  }, [
    activeQuickViewId,
    debouncedKeyword,
    selectedFilter,
    selectedModuleFilter,
    selectedTagFilters,
    sortKey,
  ]);

  useEffect(() => {
    const filter = buildLibraryListFilter(
      selectedFilter,
      debouncedKeyword,
      selectedModuleFilter,
      selectedTagFilters,
    );
    const mode: ListLoadMode = hasLoadedRef.current ? 'filter' : 'initial';
    hasLoadedRef.current = true;

    void loadList(filter, mode);
  }, [debouncedKeyword, loadList, selectedFilter, selectedModuleFilter, selectedTagFilters]);

  useEffect(() => {
    const filter = buildLibraryListFilter(selectedFilter, debouncedKeyword, null, selectedTagFilters);
    void loadModuleFilterOptions(filter);
  }, [debouncedKeyword, loadModuleFilterOptions, selectedFilter, selectedTagFilters]);

  useEffect(() => {
    const filter = buildLibraryListFilter(selectedFilter, debouncedKeyword, selectedModuleFilter, []);
    void loadTagFilterOptions(filter);
  }, [debouncedKeyword, loadTagFilterOptions, selectedFilter, selectedModuleFilter]);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return undefined;
      }

      const filter = buildLibraryListFilter(
        selectedFilter,
        debouncedKeyword,
        selectedModuleFilter,
        selectedTagFilters,
      );
      const moduleOptionsFilter = buildLibraryListFilter(
        selectedFilter,
        debouncedKeyword,
        null,
        selectedTagFilters,
      );
      const tagOptionsFilter = buildLibraryListFilter(
        selectedFilter,
        debouncedKeyword,
        selectedModuleFilter,
        [],
      );
      void loadList(filter, 'filter');
      void loadModuleFilterOptions(moduleOptionsFilter);
      void loadTagFilterOptions(tagOptionsFilter);
      return undefined;
    }, [
      debouncedKeyword,
      loadList,
      loadModuleFilterOptions,
      loadTagFilterOptions,
      selectedFilter,
      selectedModuleFilter,
      selectedTagFilters,
    ]),
  );

  const handleClearSearch = useCallback(() => {
    setSearchText('');
    setDebouncedKeyword('');
  }, []);

  const handleSelectModuleFilter = useCallback((value: LibraryModuleFilterValue) => {
    setSelectedModuleFilter(value);
  }, []);

  const handleToggleTagFilter = useCallback((value: string) => {
    const normalized = normalizeMistakeTagKey(value);
    if (!normalized) {
      return;
    }

    setSelectedTagFilters((currentValues) =>
      currentValues.includes(normalized)
        ? currentValues.filter((tagKey) => tagKey !== normalized)
        : [...currentValues, normalized],
    );
  }, []);

  const handleRemoveTagFilter = useCallback((value: string) => {
    const normalized = normalizeMistakeTagKey(value);
    setSelectedTagFilters((currentValues) => {
      const nextValues = currentValues.filter((tagKey) => tagKey !== normalized);
      return nextValues.length === currentValues.length ? currentValues : nextValues;
    });
  }, []);

  const handleClearTagFilters = useCallback(() => {
    setSelectedTagFilters((currentValues) => (currentValues.length <= 0 ? currentValues : []));
  }, []);

  const handleRetry = useCallback(() => {
    const filter = buildLibraryListFilter(
      selectedFilter,
      debouncedKeyword,
      selectedModuleFilter,
      selectedTagFilters,
    );
    const moduleOptionsFilter = buildLibraryListFilter(
      selectedFilter,
      debouncedKeyword,
      null,
      selectedTagFilters,
    );
    const tagOptionsFilter = buildLibraryListFilter(
      selectedFilter,
      debouncedKeyword,
      selectedModuleFilter,
      [],
    );
    void loadModuleFilterOptions(moduleOptionsFilter);
    void loadTagFilterOptions(tagOptionsFilter);
    void loadList(filter, 'refresh');
  }, [
    debouncedKeyword,
    loadList,
    loadModuleFilterOptions,
    loadTagFilterOptions,
    selectedFilter,
    selectedModuleFilter,
    selectedTagFilters,
  ]);

  const handleGoAddMistake = useCallback(() => {
    router.push('/add' as never);
  }, [router]);

  const handleOpenDetail = useCallback(
    (id: string) => {
      if (deletingMistakeId !== null) {
        return;
      }

      const routeId = normalizeMistakeId(id);
      if (!routeId) {
        Logger.warn(PAGE_SCOPE, 'Skip opening detail because mistake id is empty.', { id });
        return;
      }
      const viewedAt = new Date().toISOString();
      setItems((currentItems) =>
        currentItems.map((currentItem) =>
          currentItem.id === routeId ? { ...currentItem, lastViewedAt: viewedAt } : currentItem,
        ),
      );
      void MistakeListService.markMistakeViewed(routeId);
      router.push(`/mistake/${routeId}` as never);
    },
    [deletingMistakeId, router]
  );

  const handleTogglePinned = useCallback(
    async (item: MistakeListItem) => {
      if (deletingMistakeId !== null || pinningMistakeId !== null || isLoading || isRefreshing) {
        return;
      }

      const mistakeId = normalizeMistakeId(item.id);
      if (!mistakeId) {
        Logger.warn(PAGE_SCOPE, 'Skip pinning because mistake id is empty.', { id: item.id });
        return;
      }

      const nextPinned = !item.isPinned;
      setPinningMistakeId(mistakeId);
      try {
        const updated = await MistakeListService.setMistakePinned(mistakeId, nextPinned);
        if (!updated) {
          Alert.alert('操作失败', '没有找到这道错题，请刷新后重试。');
          return;
        }
        setItems((currentItems) =>
          currentItems.map((currentItem) =>
            currentItem.id === mistakeId ? { ...currentItem, ...updated } : currentItem,
          ),
        );
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to toggle pinned state from library.', {
          mistakeId,
          nextPinned,
          error,
        });
        Alert.alert('操作失败', error instanceof Error ? error.message : '置顶状态保存失败，请稍后重试。');
      } finally {
        setPinningMistakeId(null);
      }
    },
    [deletingMistakeId, isLoading, isRefreshing, pinningMistakeId],
  );

  const handleLongPressDelete = useCallback(
    (item: MistakeListItem) => {
      if (deletingMistakeId !== null || isLoading || isRefreshing) {
        return;
      }

      const mistakeId = normalizeMistakeId(item.id);
      if (!mistakeId) {
        Logger.warn(PAGE_SCOPE, 'Skip deleting because mistake id is empty.', { id: item.id });
        return;
      }

      const title = item.title.trim();
      const titlePreview = title.length > 18 ? `${title.slice(0, 18)}...` : title;

      Alert.alert(
        '删除这道错题？',
        `将删除「${titlePreview}」及其复做记录、图片和语音讲解，删除后无法恢复。`,
        [
          {
            text: '取消',
            style: 'cancel',
          },
          {
            text: '确认删除',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setDeletingMistakeId(mistakeId);
                try {
                  const result = await MistakeDetailService.deleteMistake(mistakeId);
                  if (!result.ok) {
                    Alert.alert('删除失败', result.errorMessage ?? '删除错题失败，请稍后重试。');
                    return;
                  }

                  setItems((currentItems) =>
                    currentItems.filter((currentItem) => currentItem.id !== mistakeId),
                  );
                } catch (error) {
                  Logger.error(PAGE_SCOPE, 'Failed to delete mistake from library.', {
                    mistakeId,
                    error,
                  });
                  Alert.alert(
                    '删除失败',
                    error instanceof Error ? error.message : '删除错题失败，请稍后重试。',
                  );
                } finally {
                  setDeletingMistakeId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [deletingMistakeId, isLoading, isRefreshing],
  );

  const handleOpenMistakeMenu = useCallback(
    (item: MistakeListItem) => {
      if (deletingMistakeId !== null || pinningMistakeId !== null || isLoading || isRefreshing) {
        return;
      }

      Alert.alert(
        '题目操作',
        item.title,
        [
          {
            text: item.isPinned ? '取消置顶' : '置顶题目',
            onPress: () => {
              void handleTogglePinned(item);
            },
          },
          {
            text: '删除题目',
            style: 'destructive',
            onPress: () => handleLongPressDelete(item),
          },
          {
            text: '取消',
            style: 'cancel',
          },
        ],
      );
    },
    [
      deletingMistakeId,
      handleLongPressDelete,
      handleTogglePinned,
      isLoading,
      isRefreshing,
      pinningMistakeId,
    ],
  );

  const handleSelectQuickView = useCallback(
    (quickViewId: LibraryQuickViewId) => {
      setActiveQuickViewId((current) => {
        const currentIsRecentQuickView = isRecentQuickView(current);
        const nextIsRecentQuickView = isRecentQuickView(quickViewId);

        if (current === quickViewId) {
          if (currentIsRecentQuickView && quickViewSortWasAppliedRef.current) {
            setSortKey(sortBeforeRecentQuickViewRef.current);
          }
          quickViewSortWasAppliedRef.current = false;
          return null;
        }

        if (nextIsRecentQuickView) {
          if (!currentIsRecentQuickView) {
            sortBeforeRecentQuickViewRef.current = sortKey;
          }
          setSortKey(getDefaultSortKeyForRecentQuickView(quickViewId));
          quickViewSortWasAppliedRef.current = true;
        } else if (currentIsRecentQuickView && quickViewSortWasAppliedRef.current) {
          setSortKey(sortBeforeRecentQuickViewRef.current);
          quickViewSortWasAppliedRef.current = false;
        }

        return quickViewId;
      });
    },
    [sortKey],
  );

  const handleSelectSort = useCallback((nextSortKey: LibrarySortKey) => {
    setSortKey(nextSortKey);
    setSortSheetVisible(false);
    quickViewSortWasAppliedRef.current = false;
  }, []);

  const handleToggleSection = useCallback((sectionId: LibrarySectionId) => {
    setCollapsedSectionIds((current) => ({
      ...current,
      [sectionId]: !(current[sectionId] ?? (sectionId === 'future7' || sectionId === 'later' || sectionId === 'noPlan')),
    }));
  }, []);

  const handleClearQuickView = useCallback(() => {
    setActiveQuickViewId((current) => {
      if (isRecentQuickView(current) && quickViewSortWasAppliedRef.current) {
        setSortKey(sortBeforeRecentQuickViewRef.current);
      }
      quickViewSortWasAppliedRef.current = false;
      return null;
    });
  }, []);

  const handleShowMoreResults = useCallback(() => {
    setVisibleItemLimit((currentLimit) => currentLimit + VISIBLE_MISTAKE_INCREMENT);
  }, []);

  const inlineModuleFilterOptions = useMemo<LibraryModuleFilterOption[]>(() => {
    if (moduleFilterOptions.length <= INLINE_MODULE_FILTER_OPTION_LIMIT) {
      return moduleFilterOptions;
    }

    const selectedOption =
      moduleFilterOptions.find((option) => option.value === selectedModuleFilter) ?? null;
    const inlineOptions: LibraryModuleFilterOption[] = [];
    const addOption = (option: LibraryModuleFilterOption | null | undefined) => {
      if (!option || inlineOptions.some((item) => item.key === option.key)) {
        return;
      }
      if (inlineOptions.length < INLINE_MODULE_FILTER_OPTION_LIMIT) {
        inlineOptions.push(option);
      }
    };

    addOption(moduleFilterOptions[0]);
    addOption(selectedOption);
    for (const option of moduleFilterOptions.slice(1)) {
      addOption(option);
    }

    return inlineOptions;
  }, [moduleFilterOptions, selectedModuleFilter]);

  const selectedTagFilterOptions = useMemo<LibraryTagFilterOption[]>(() => {
    const optionByValue = new Map(tagFilterOptions.map((option) => [option.value, option]));

    return selectedTagFilters.map((value) => {
      const option = optionByValue.get(value);
      if (option) {
        return option;
      }

      return {
        key: `tag:selected:${value}`,
        value,
        label: value,
        count: 0,
      };
    });
  }, [selectedTagFilters, tagFilterOptions]);

  const inlineTagFilterOptions = useMemo<LibraryTagFilterOption[]>(() => {
    if (tagFilterOptions.length <= INLINE_TAG_FILTER_OPTION_LIMIT) {
      return tagFilterOptions;
    }

    const inlineOptions: LibraryTagFilterOption[] = [];
    const addOption = (option: LibraryTagFilterOption | null | undefined) => {
      if (!option || inlineOptions.some((item) => item.value === option.value)) {
        return;
      }
      if (inlineOptions.length < INLINE_TAG_FILTER_OPTION_LIMIT) {
        inlineOptions.push(option);
      }
    };

    selectedTagFilterOptions.forEach(addOption);
    for (const option of tagFilterOptions) {
      addOption(option);
    }

    return inlineOptions;
  }, [selectedTagFilterOptions, tagFilterOptions]);

  const shouldShowModuleFilterMore = moduleFilterOptions.length > inlineModuleFilterOptions.length;
  const shouldShowTagFilterMore = tagFilterOptions.length > inlineTagFilterOptions.length;
  const selectedTagFilterCount = selectedTagFilters.length;
  const selectedModuleFilterOption =
    moduleFilterOptions.find((option) => option.value === selectedModuleFilter) ?? null;
  const moduleFilterHintText = moduleFilterErrorMessage
    ? `模块统计失败：${moduleFilterErrorMessage}`
    : formatLibraryModuleFilterHint(selectedModuleFilterOption, selectedModuleFilter);
  const dateBounds = useMemo(() => buildLibraryDateBounds(), []);
  const quickViewCounts = useMemo(
    () => getQuickViewCounts(items, dateBounds),
    [dateBounds, items],
  );
  const quickFilteredItems = useMemo(
    () => filterMistakesByQuickView(items, activeQuickViewId, dateBounds),
    [activeQuickViewId, dateBounds, items],
  );
  const sortedItems = useMemo(
    () => sortMistakes(quickFilteredItems, sortKey, dateBounds, selectedFilter, activeQuickViewId),
    [activeQuickViewId, dateBounds, quickFilteredItems, selectedFilter, sortKey],
  );
  const groupedSections = useMemo(
    () => groupMistakesByReviewDate(sortedItems, selectedFilter, dateBounds, activeQuickViewId),
    [activeQuickViewId, dateBounds, selectedFilter, sortedItems],
  );
  const collapsedAwareSections = useMemo(
    () =>
      groupedSections.map((section) => {
        const collapsed = collapsedSectionIds[section.id] ?? section.defaultCollapsed;
        return collapsed ? { ...section, data: [] } : section;
      }),
    [collapsedSectionIds, groupedSections],
  );
  const visibleSections = useMemo(
    () => limitLibrarySectionData(collapsedAwareSections, visibleItemLimit),
    [collapsedAwareSections, visibleItemLimit],
  );
  const currentResultCount = sortedItems.length;
  const visibleCardCount = visibleSections.reduce((sum, section) => sum + section.data.length, 0);
  const expandedResultLimit = Math.min(currentResultCount, visibleItemLimit);
  const hasMoreVisibleResults = currentResultCount > visibleItemLimit;
  const resultCountText =
    currentResultCount > expandedResultLimit
      ? `当前匹配 ${currentResultCount} 题 · 已展开 ${expandedResultLimit}`
      : `当前匹配 ${currentResultCount} 题`;
  const selectedSortOption = SORT_OPTIONS.find((option) => option.key === sortKey) ?? SORT_OPTIONS[0];

  const emptyConfig = useMemo(() => {
    if (activeQuickViewId) {
      if (activeQuickViewId === 'overdue') {
        return {
          message: '暂无已逾期题目\n你已经按计划完成了所有复做',
          showAddButton: false,
          showClearQuickViewButton: true,
        };
      }

      if (activeQuickViewId === 'pinned') {
        return {
          message: '还没有置顶题目\n可以在题目右上角菜单中选择“置顶”',
          showAddButton: false,
          showClearQuickViewButton: true,
        };
      }

      if (activeQuickViewId === 'recentViewed') {
        return {
          message: '暂无最近访问题目\n打开题目详情后会记录最近访问',
          showAddButton: false,
          showClearQuickViewButton: true,
        };
      }

      const activeOption = QUICK_VIEW_OPTIONS.find((option) => option.id === activeQuickViewId);
      return {
        message: `暂无${activeOption?.label ?? '相关'}题目`,
        showAddButton: false,
        showClearQuickViewButton: true,
      };
    }

    if (debouncedKeyword.length > 0) {
      return {
        message: '没有找到相关错题',
        showAddButton: false,
      };
    }

    if (selectedTagFilterCount > 0) {
      return {
        message: '\u5f53\u524d\u6807\u7b7e\u4e0b\u6ca1\u6709\u9519\u9898',
        showAddButton: false,
      };
    }

    if (selectedModuleFilter !== null) {
      return {
        message: `“${selectedModuleFilter}”模块暂无符合条件的错题`,
        showAddButton: false,
      };
    }

    if (selectedFilter === 'pending') {
      return {
        message: '今天没有待复做错题',
        showAddButton: true,
      };
    }

    if (selectedFilter === 'mastered') {
      return {
        message: '还没有完成七刷的错题',
        showAddButton: true,
      };
    }

    return {
      message: '暂无错题，去新增页录入第一题',
      showAddButton: true,
    };
  }, [activeQuickViewId, debouncedKeyword.length, selectedFilter, selectedModuleFilter, selectedTagFilterCount]);

  const listEmpty = useMemo(() => {
    if (isLoading) {
      return (
        <View style={styles.stateWrap}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
          <Text style={styles.stateText}>正在加载错题...</Text>
        </View>
      );
    }

    if (errorMessage) {
      return (
        <View style={styles.stateWrap}>
          <Text style={styles.stateErrorText}>数据读取失败：{errorMessage}</Text>
          <Pressable onPress={handleRetry} style={styles.retryButton}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateText}>{emptyConfig.message}</Text>
        {emptyConfig.showAddButton ? (
          <Pressable onPress={handleGoAddMistake} style={styles.goAddButton}>
            <Text style={styles.goAddButtonText}>去新增错题</Text>
          </Pressable>
        ) : null}
        {emptyConfig.showClearQuickViewButton ? (
          <Pressable onPress={handleClearQuickView} style={styles.goAddButton}>
            <Text style={styles.goAddButtonText}>查看全部题目</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }, [emptyConfig, errorMessage, handleClearQuickView, handleGoAddMistake, handleRetry, isLoading]);

  const listFooter = useMemo(() => {
    if (isLoading || currentResultCount <= 0 || !hasMoreVisibleResults) {
      return null;
    }

    return (
      <View style={styles.listFooter}>
        <Text style={styles.listFooterHint}>
          已显示 {visibleCardCount} 题，优先用上方搜索和筛选缩小范围
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="继续显示更多错题"
          onPress={handleShowMoreResults}
          style={({ pressed }) => [
            styles.showMoreButton,
            pressed ? styles.moduleFilterChipPressed : null,
          ]}>
          <Text style={styles.showMoreButtonText}>
            继续显示更多
          </Text>
          <MaterialIcons name="expand-more" size={20} color={colors.success} />
        </Pressable>
      </View>
    );
  }, [
    currentResultCount,
    handleShowMoreResults,
    hasMoreVisibleResults,
    isLoading,
    visibleCardCount,
  ]);

  const shouldShowFloatingAnchorNav = isFloatingAnchorVisible;
  const floatingAnchorTop = Math.max(insets.top + spacing.sm, spacing.md);
  const toastBottomOffset = Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg);

  return (
    <View style={styles.pageRoot}>
    <ScreenContainer withPadding={false} safeAreaEdges={['top']}>
      <SectionList<MistakeListItem, LibraryListSection>
        ref={libraryListRef}
        sections={currentResultCount <= 0 ? [] : visibleSections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MistakeLibraryCard
            item={item}
            isDeleting={deletingMistakeId === item.id}
            onPress={() => handleOpenDetail(item.id)}
            onLongPress={() => handleOpenMistakeMenu(item)}
            onMorePress={() => handleOpenMistakeMenu(item)}
          />
        )}
        renderSectionHeader={({ section }) => (
          <ReviewSectionHeader
            section={section}
            collapsed={collapsedSectionIds[section.id] ?? section.defaultCollapsed}
            onToggle={handleToggleSection}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.listItemSeparator} />}
        stickySectionHeadersEnabled={selectedFilter !== 'mastered'}
        showsVerticalScrollIndicator={false}
        onScroll={handleLibraryScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRetry}
            tintColor={colors.textPrimary}
            colors={[colors.textPrimary]}
          />
        }
        ListHeaderComponent={
          <View style={styles.screenContent}>
            <BrandHeader title={libraryMock.brand.title} subtitle={libraryMock.brand.subtitle} />

            <View onLayout={handleAnchorNavLayout}>
              <QuickAnchorNav
                items={LIBRARY_ANCHOR_ITEMS}
                activeAnchorId={activeAnchorId}
                horizontalCompact
                onAnchorPress={handleAnchorPress}
              />
            </View>

            <View
              style={[
                styles.searchPanel,
                highlightedAnchorId === 'search' ? styles.anchorSectionHighlighted : null,
              ]}
              onLayout={(event) => handleAnchorLayout('search', event)}>
              <View style={styles.searchWrap}>
              <MaterialIcons size={24} name="search" color={colors.textMuted} />
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                  placeholder={libraryMock.searchPlaceholder}
                placeholderTextColor={colors.textMuted}
                style={styles.searchInput}
                maxFontSizeMultiplier={1.2}
                returnKeyType="search"
                onSubmitEditing={() => setDebouncedKeyword(searchText.trim())}
              />
              {searchText.length > 0 ? (
                <Pressable
                  style={styles.searchClearButton}
                  onPress={handleClearSearch}
                  accessibilityRole="button"
                  accessibilityLabel="清空搜索">
                  <MaterialIcons size={20} name="close" color={colors.textMuted} />
                </Pressable>
              ) : null}
              </View>

              {selectedTagFilterOptions.length > 0 ? (
                <View style={styles.activeFilterRow}>
                  {selectedTagFilterOptions.map((option) => (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove tag filter: ${option.label}`}
                      onPress={() => handleRemoveTagFilter(option.value)}
                      style={({ pressed }) => [
                        styles.activeFilterChip,
                        pressed ? styles.moduleFilterChipPressed : null,
                      ]}>
                      <Text numberOfLines={1} style={styles.activeFilterChipText}>
                        {option.label}
                      </Text>
                      <MaterialIcons name="close" size={14} color={colors.success} />
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear tag filters"
                    onPress={handleClearTagFilters}
                    style={({ pressed }) => [
                      styles.activeFilterClearButton,
                      pressed ? styles.moduleFilterChipPressed : null,
                    ]}>
                    <Text style={styles.activeFilterClearText}>{'\u6e05\u7a7a'}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <View
              style={highlightedAnchorId === 'filters' ? styles.anchorSectionHighlighted : null}
              onLayout={(event) => handleAnchorLayout('filters', event)}>
            <CardContainer style={styles.moduleFilterCard} padding={spacing.md}>
              <View style={styles.moduleFilterHeaderRow}>
                <View style={styles.moduleFilterTitleWrap}>
                  <MaterialIcons name="filter-list" size={20} color="#334155" />
                  <Text style={styles.moduleFilterTitle}>模块筛选</Text>
                </View>
                {isModuleFilterLoading ? (
                  <ActivityIndicator size="small" color={colors.textMuted} />
                ) : null}
              </View>
              <View style={styles.moduleFilterOptions}>
                {inlineModuleFilterOptions.map((option) => {
                  const selected = selectedModuleFilter === option.value;
                  return (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityLabel={formatLibraryModuleFilterAccessibilityLabel(option)}
                      onPress={() => handleSelectModuleFilter(option.value)}
                      style={({ pressed }) => [
                        styles.moduleFilterChip,
                        selected ? styles.moduleFilterChipSelected : null,
                        pressed ? styles.moduleFilterChipPressed : null,
                      ]}>
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.1}
                        style={[
                          styles.moduleFilterChipText,
                          selected ? styles.moduleFilterChipTextSelected : null,
                        ]}>
                        {formatLibraryModuleFilterOptionText(option)}
                      </Text>
                    </Pressable>
                  );
                })}
                {shouldShowModuleFilterMore ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="查看更多模块"
                    onPress={() => setModuleFilterSheetVisible(true)}
                    style={({ pressed }) => [
                      styles.moduleFilterMoreButton,
                      pressed ? styles.moduleFilterChipPressed : null,
                    ]}>
                    <MaterialIcons name="more-horiz" size={18} color="#334155" />
                    <Text numberOfLines={1} style={styles.moduleFilterMoreText}>
                      更多
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <Text numberOfLines={1} style={styles.moduleFilterHint}>
                {moduleFilterHintText}
              </Text>
              <View style={styles.filterDivider} />
              <View style={styles.tagFilterHeaderRow}>
                <View style={styles.tagFilterTitleWrap}>
                  <MaterialIcons name="sell" size={20} color="#334155" />
                  <Text style={styles.tagFilterTitle}>{'\u6807\u7b7e\u7b5b\u9009'}</Text>
                </View>
                {isTagFilterLoading ? (
                  <ActivityIndicator size="small" color={colors.textMuted} />
                ) : null}
              </View>
              {tagFilterErrorMessage ? (
                <Text numberOfLines={2} style={styles.tagFilterErrorText}>
                  {'\u6807\u7b7e\u7edf\u8ba1\u5931\u8d25\uff1a'}
                  {tagFilterErrorMessage}
                </Text>
              ) : null}
              {tagFilterOptions.length > 0 ? (
                <View style={styles.tagFilterOptions}>
                  {inlineTagFilterOptions.map((option) => {
                    const selected = selectedTagFilters.includes(option.value);
                    return (
                      <Pressable
                        key={option.key}
                        accessibilityRole="button"
                        accessibilityLabel={formatLibraryTagFilterAccessibilityLabel(option)}
                        onPress={() => handleToggleTagFilter(option.value)}
                        style={({ pressed }) => [
                          styles.tagFilterChip,
                          selected ? styles.tagFilterChipSelected : null,
                          pressed ? styles.moduleFilterChipPressed : null,
                        ]}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.tagFilterChipText,
                            selected ? styles.tagFilterChipTextSelected : null,
                          ]}>
                          {option.label}
                        </Text>
                        {selected ? (
                          <MaterialIcons name="check" size={15} color={colors.success} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                  {shouldShowTagFilterMore ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Show more tags"
                      onPress={() => setTagFilterSheetVisible(true)}
                      style={({ pressed }) => [
                        styles.tagFilterMoreButton,
                        pressed ? styles.moduleFilterChipPressed : null,
                      ]}>
                      <MaterialIcons name="more-horiz" size={18} color="#334155" />
                      <Text numberOfLines={1} style={styles.tagFilterMoreText}>
                        {'\u66f4\u591a'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <Text style={styles.tagFilterEmptyText}>
                  {isTagFilterLoading
                    ? '\u6b63\u5728\u52a0\u8f7d\u6807\u7b7e...'
                    : '\u6682\u65e0\u53ef\u7b5b\u9009\u6807\u7b7e'}
                </Text>
              )}
            </CardContainer>
            </View>

            <SegmentControl
              options={libraryMock.filters}
              value={selectedFilter}
              onChange={(next) => setSelectedFilter(next as LibraryFilterValue)}
            />

            <View
              style={highlightedAnchorId === 'quickView' ? styles.anchorSectionHighlighted : null}
              onLayout={(event) => handleAnchorLayout('quickView', event)}>
              <QuickViewBar
                activeQuickViewId={activeQuickViewId}
                counts={quickViewCounts}
                onSelect={handleSelectQuickView}
              />
            </View>

            <View
              style={[
                styles.metaRow,
                highlightedAnchorId === 'list' ? styles.anchorSectionHighlighted : null,
              ]}
              onLayout={(event) => handleAnchorLayout('list', event)}>
              <Text style={styles.countText}>{resultCountText}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`当前排序：${selectedSortOption.label}`}
                onPress={() => setSortSheetVisible(true)}
                style={({ pressed }) => [
                  styles.sortButton,
                  pressed ? styles.moduleFilterChipPressed : null,
                ]}>
                <Text numberOfLines={1} style={styles.sortButtonText}>
                  排序：{selectedSortOption.label}
                </Text>
                <MaterialIcons name="arrow-drop-down" size={20} color={colors.textPrimary} />
              </Pressable>
            </View>
            {isRefreshing ? <Text style={styles.refreshText}>刷新中...</Text> : null}
          </View>
        }
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
      />
      <LibraryModuleFilterSheet
        visible={moduleFilterSheetVisible}
        options={moduleFilterOptions}
        selectedValue={selectedModuleFilter}
        onClose={() => setModuleFilterSheetVisible(false)}
        onSelectOption={(value) => {
          setModuleFilterSheetVisible(false);
          handleSelectModuleFilter(value);
        }}
      />
      <LibraryTagFilterSheet
        visible={tagFilterSheetVisible}
        options={tagFilterOptions}
        selectedValues={selectedTagFilters}
        onClose={() => setTagFilterSheetVisible(false)}
        onToggleOption={handleToggleTagFilter}
      />
      <SortSelectorSheet
        visible={sortSheetVisible}
        selectedSortKey={sortKey}
        onClose={() => setSortSheetVisible(false)}
        onSelect={handleSelectSort}
      />
    </ScreenContainer>
    {shouldShowFloatingAnchorNav ? (
      <View
        pointerEvents="box-none"
        style={[
          styles.floatingAnchorWrap,
          { top: floatingAnchorTop },
        ]}>
        <QuickAnchorNav
          items={LIBRARY_ANCHOR_ITEMS}
          activeAnchorId={activeAnchorId}
          collapsed={isAnchorNavCollapsed}
          floating
          horizontalCompact
          onToggleCollapsed={handleToggleAnchorNavCollapsed}
          onAnchorPress={handleAnchorPress}
        />
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
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
  },
  floatingAnchorWrap: {
    position: 'absolute',
    left: spacing.screenPadding,
    right: spacing.screenPadding,
    zIndex: 30,
    elevation: 30,
  },
  anchorSectionHighlighted: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: '#FBFFFC',
    padding: spacing.xs,
    shadowColor: colors.success,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  screenContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  listContent: {
    paddingBottom: layout.bottomTabHeight,
  },
  quickViewBlock: {
    gap: spacing.xs,
  },
  quickViewTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '800',
  },
  quickViewContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingRight: spacing.xl,
  },
  quickViewChip: {
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  quickViewChipSelected: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
  },
  quickViewChipDangerSelected: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  quickViewChipInfoSelected: {
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
  },
  quickViewChipWarningSelected: {
    borderColor: '#FED7AA',
    backgroundColor: '#FFF7ED',
  },
  quickViewChipPinnedSelected: {
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
  },
  quickViewChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  sortButton: {
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: '64%',
  },
  sortButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  sortSheetList: {
    gap: spacing.sm,
  },
  sortSheetOption: {
    minHeight: 54,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sortSheetOptionSelected: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
  },
  sortSheetOptionTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sortSheetOptionTitle: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  sortSheetOptionTitleSelected: {
    color: colors.success,
  },
  sortSheetOptionDescription: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sectionHeaderOuter: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  reviewSectionHeader: {
    minHeight: 36,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  reviewSectionTitleWrap: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  reviewSectionTitle: {
    ...typography.bodySmall,
    fontWeight: '900',
    flexShrink: 1,
  },
  reviewSectionToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  reviewSectionToggleText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '800',
  },
  searchPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  searchClearButton: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  activeFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activeFilterChip: {
    maxWidth: '70%',
    minHeight: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  activeFilterChipText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '800',
    flexShrink: 1,
  },
  activeFilterClearButton: {
    minHeight: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginLeft: 'auto',
  },
  activeFilterClearText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '800',
  },
  moduleFilterCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  moduleFilterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  moduleFilterTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  moduleFilterTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
    color: '#1F2937',
    fontWeight: '800',
  },
  moduleFilterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  moduleFilterChip: {
    minWidth: 116,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  moduleFilterChipSelected: {
    borderColor: '#BBF7D0',
    backgroundColor: '#DCFCE7',
  },
  moduleFilterChipPressed: {
    opacity: 0.78,
  },
  moduleFilterChipText: {
    ...typography.bodySmall,
    color: '#64748B',
    fontWeight: '700',
    textAlign: 'center',
  },
  moduleFilterChipTextSelected: {
    color: colors.success,
    fontWeight: '800',
  },
  moduleFilterMoreButton: {
    height: 38,
    minWidth: 86,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  moduleFilterMoreText: {
    ...typography.bodySmall,
    color: '#334155',
    fontWeight: '800',
  },
  moduleFilterHint: {
    ...typography.caption,
    color: '#64748B',
    fontWeight: '600',
  },
  filterDivider: {
    height: 1,
    backgroundColor: '#EEF2F7',
    marginVertical: spacing.xs,
  },
  tagFilterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tagFilterTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  tagFilterTitle: {
    ...typography.body,
    color: '#1F2937',
    fontWeight: '800',
  },
  tagFilterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tagFilterChip: {
    minHeight: 34,
    maxWidth: '48%',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tagFilterChipSelected: {
    borderColor: colors.success,
    backgroundColor: colors.successBg,
  },
  tagFilterChipText: {
    ...typography.bodySmall,
    color: '#334155',
    fontWeight: '700',
    flexShrink: 1,
  },
  tagFilterChipTextSelected: {
    color: colors.success,
    fontWeight: '800',
  },
  tagFilterMoreButton: {
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tagFilterMoreText: {
    ...typography.bodySmall,
    color: '#334155',
    fontWeight: '800',
  },
  tagFilterEmptyText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  tagFilterErrorText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '600',
  },
  moduleFilterSheetScroll: {
    maxHeight: 420,
  },
  moduleFilterSheetContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  moduleFilterSheetChip: {
    minWidth: 118,
    maxWidth: '48%',
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  moduleFilterSheetChipSelected: {
    borderColor: colors.success,
    backgroundColor: '#DCFCE7',
  },
  tagFilterSheetChip: {
    minWidth: 118,
    maxWidth: '48%',
    minHeight: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  moduleSheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  moduleSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
  },
  moduleSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  moduleSheetHandle: {
    width: 42,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  moduleSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  moduleSheetHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  moduleSheetTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  moduleSheetSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  moduleSheetCloseButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  moduleSheetCloseButtonPressed: {
    opacity: 0.78,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  refreshText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  listItemSeparator: {
    height: spacing.md,
  },
  listFooter: {
    marginHorizontal: spacing.screenPadding,
    marginTop: spacing.md,
    gap: spacing.sm,
    alignItems: 'center',
  },
  listFooterHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  showMoreButton: {
    minHeight: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  showMoreButtonText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '800',
  },
  stateWrap: {
    marginTop: spacing.md,
    marginHorizontal: spacing.screenPadding,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 112,
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  stateErrorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  goAddButton: {
    marginTop: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  goAddButtonText: {
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
  cardPressable: {
    marginHorizontal: 14,
    borderRadius: radius.xl,
  },
  cardPressableDisabled: {
    opacity: 0.76,
  },
  card: {
    borderRadius: 26,
    position: 'relative',
    overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  cardDeletingMask: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
  },
  cardDeletingText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '800',
  },
  cardTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: spacing.sm,
  },
  modulePill: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#DBE7FF',
    backgroundColor: '#EEF3FF',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  cardMeta: {
    ...typography.caption,
    color: '#4A5F9D',
    fontWeight: '700',
    flexShrink: 1,
    minWidth: 0,
    lineHeight: 16,
  },
  cardTopLineEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  pinnedMark: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMoreButton: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMoreButtonPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  arrow: {
    color: colors.textMuted,
    flexShrink: 0,
  },
  cardTitle: {
    ...typography.body,
    color: colors.success,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    flexShrink: 1,
    minWidth: 0,
  },
  titleRow: {
    minWidth: 0,
    flexShrink: 1,
  },
  cardTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  cardTagPill: {
    maxWidth: '48%',
    borderRadius: radius.pill,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  cardTagText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '800',
    lineHeight: 16,
  },
  difficultyPill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#FFE2C4',
    backgroundColor: '#FFF3E8',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  difficultyText: {
    ...typography.caption,
    color: '#A75D17',
    fontWeight: '700',
    lineHeight: 16,
    flexShrink: 0,
  },
  progressLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    flexShrink: 0,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
  },
  progressDots: {
    gap: 3,
    flexShrink: 1,
    minWidth: 0,
  },
  nextReviewWrap: {
    gap: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  nextReviewLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 0,
  },
  nextReviewText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
    minWidth: 0,
  },
  nextReviewTextSuccess: {
    color: colors.success,
  },
  nextReviewTextMuted: {
    color: colors.textMuted,
  },
  nextReviewTextDanger: {
    color: colors.danger,
  },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  thumbPlaceholderText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  thumbImage: {
    width: 84,
    height: 84,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
});
