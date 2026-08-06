import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppToast,
  CustomModuleManagerModal,
  LibraryBottomSheet,
  LibraryQuickView,
  LibrarySegmentedControl,
  ProgressDots,
  PageHeader,
  PageShell,
  SectionHeader,
  SurfaceCard,
} from '@/src/components';
import { useAppToast } from '@/src/hooks/useAppToast';
import type { CustomModule } from '@/src/models/CustomModule';
import type { MistakeListFilter, MistakeListItem } from '@/src/models/MistakeListItem';
import { CustomModuleService } from '@/src/services/CustomModuleService';
import { Logger } from '@/src/services/Logger';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import * as MistakeListService from '@/src/services/MistakeListService';
import { normalizeMistakeTagKey } from '@/src/services/MistakeTagService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';
import { addDays, parseLocalDateTime, startOfLocalDay, toDateOnlyString } from '@/src/utils/date';
import { resolveNextReviewAtText } from '@/src/utils/reviewSchedule';

const PAGE_SCOPE = 'LibraryScreen';
const SEARCH_DEBOUNCE_MS = 280;

type LibraryStatusMode = 'all' | 'collected' | 'active' | 'mastered';
type LibraryQuickMode = 'today' | 'overdue' | 'recentViewed' | 'recentAdded';
type LibraryViewMode = LibraryStatusMode | LibraryQuickMode;
type LibrarySortKey =
  | 'lastReviewed'
  | 'nextReview'
  | 'recentAdded'
  | 'recentViewed'
  | 'reviewCountAsc'
  | 'nearMastered'
  | 'title';
type ListLoadMode = 'initial' | 'filter' | 'refresh';

interface SelectedTag {
  key: string;
  label: string;
}

interface LibraryFilterState {
  keyword: string;
  module: string | null;
  tag: SelectedTag | null;
  viewMode: LibraryViewMode;
  sortKey: LibrarySortKey;
}

interface ModuleOption {
  key: string;
  value: string | null;
  label: string;
  count: number;
}

interface TagOption {
  key: string;
  value: string | null;
  label: string;
  count: number;
}

interface DateBounds {
  startOfToday: Date;
  startOfTomorrow: Date;
}

interface SortOption {
  key: LibrarySortKey;
  label: string;
  description: string;
}

const DEFAULT_FILTER_STATE: LibraryFilterState = {
  keyword: '',
  module: null,
  tag: null,
  viewMode: 'all',
  sortKey: 'lastReviewed',
};

const SORT_OPTIONS: readonly SortOption[] = [
  { key: 'lastReviewed', label: '最近复做', description: '按最后一次复做时间倒序' },
  { key: 'nextReview', label: '复做计划', description: '应复做日期较早的排在前面' },
  { key: 'recentAdded', label: '最近增加', description: '按录入时间倒序' },
  { key: 'recentViewed', label: '最近访问', description: '按最后访问时间倒序' },
  { key: 'reviewCountAsc', label: '复做次数少', description: '优先显示复做次数较少的题' },
  { key: 'nearMastered', label: '接近七刷', description: '优先显示复做进度较高的题' },
  { key: 'title', label: '题目名称', description: '按题目名称排序' },
] as const;

function isStatusMode(value: LibraryViewMode): value is LibraryStatusMode {
  return value === 'all' || value === 'collected' || value === 'active' || value === 'mastered';
}

function isQuickMode(value: LibraryViewMode): value is LibraryQuickMode {
  return !isStatusMode(value);
}

function normalizeMistakeId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeModuleName(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function getTimeValue(value: string | null | undefined): number | null {
  const parsed = parseLocalDateTime(value ?? null);
  if (!parsed) {
    return null;
  }
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : time;
}

function buildDateBounds(baseDate = new Date()): DateBounds {
  const startOfToday = startOfLocalDay(baseDate);
  return {
    startOfToday,
    startOfTomorrow: addDays(startOfToday, 1),
  };
}

function isTodayDueItem(item: MistakeListItem, bounds: DateBounds): boolean {
  if (item.status !== 'active') {
    return false;
  }
  const nextReviewTime = getTimeValue(item.nextReviewAt);
  return (
    nextReviewTime !== null
    && nextReviewTime < bounds.startOfTomorrow.getTime()
  );
}

function isScheduledDateItem(item: MistakeListItem, scheduledDate: string): boolean {
  if (item.status !== 'active') {
    return false;
  }
  const nextReviewDate = parseLocalDateTime(item.nextReviewAt ?? null);
  return nextReviewDate !== null && toDateOnlyString(nextReviewDate) === scheduledDate;
}

function normalizeRouteValue(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function isLibraryQuickMode(value: string | null): value is LibraryQuickMode {
  return value === 'today'
    || value === 'overdue'
    || value === 'recentViewed'
    || value === 'recentAdded';
}

function normalizeScheduledDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null;
  }
  const parsed = parseLocalDateTime(value);
  return parsed && toDateOnlyString(parsed) === value ? value : null;
}

function isOverdueItem(item: MistakeListItem, bounds: DateBounds): boolean {
  if (item.status !== 'active') {
    return false;
  }
  const nextReviewTime = getTimeValue(item.nextReviewAt);
  return nextReviewTime !== null && nextReviewTime < bounds.startOfToday.getTime();
}

function matchesViewMode(
  item: MistakeListItem,
  viewMode: LibraryViewMode,
  bounds: DateBounds,
): boolean {
  if (viewMode === 'all' || viewMode === 'recentAdded') {
    return true;
  }
  if (viewMode === 'collected') {
    return item.status === 'collected';
  }
  if (viewMode === 'active') {
    return item.status === 'active';
  }
  if (viewMode === 'mastered') {
    return item.status === 'mastered';
  }
  if (viewMode === 'today') {
    return isTodayDueItem(item, bounds);
  }
  if (viewMode === 'overdue') {
    return isOverdueItem(item, bounds);
  }
  return getTimeValue(item.lastViewedAt) !== null;
}

function getEffectiveSortKey(filters: LibraryFilterState): LibrarySortKey {
  if (filters.viewMode === 'recentViewed') {
    return 'recentViewed';
  }
  if (filters.viewMode === 'recentAdded') {
    return 'recentAdded';
  }
  return filters.sortKey;
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

function sortItems(
  sourceItems: readonly MistakeListItem[],
  sortKey: LibrarySortKey,
): MistakeListItem[] {
  return [...sourceItems].sort((left, right) => {
    const ignoresPinned = sortKey === 'recentViewed' || sortKey === 'recentAdded';
    if (!ignoresPinned && left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1;
    }

    let result = 0;
    if (sortKey === 'lastReviewed') {
      result = compareNullableTime(left.lastReviewAt, right.lastReviewAt, 'desc');
    } else if (sortKey === 'nextReview') {
      result = compareNullableTime(left.nextReviewAt, right.nextReviewAt, 'asc');
    } else if (sortKey === 'recentAdded') {
      result = compareNullableTime(left.createdAt, right.createdAt, 'desc');
    } else if (sortKey === 'recentViewed') {
      result = compareNullableTime(left.lastViewedAt, right.lastViewedAt, 'desc');
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
    return createdTieBreak !== 0 ? createdTieBreak : left.id.localeCompare(right.id);
  });
}

function itemHasTag(item: MistakeListItem, tagKey: string): boolean {
  return item.tags.some(
    (tag) => normalizeMistakeTagKey(tag.normalized_name || tag.name) === tagKey,
  );
}

function filterByModuleAndTag(
  sourceItems: readonly MistakeListItem[],
  moduleName: string | null,
  tag: SelectedTag | null,
): MistakeListItem[] {
  return sourceItems.filter((item) => {
    if (moduleName !== null && item.module !== moduleName) {
      return false;
    }
    return tag === null || itemHasTag(item, tag.key);
  });
}

function buildModuleOptions(
  sourceItems: readonly MistakeListItem[],
  selectedModule: string | null,
): ModuleOption[] {
  const counts = new Map<string, number>();
  for (const item of sourceItems) {
    const moduleName = normalizeModuleName(item.module);
    if (moduleName) {
      counts.set(moduleName, (counts.get(moduleName) ?? 0) + 1);
    }
  }
  if (selectedModule && !counts.has(selectedModule)) {
    counts.set(selectedModule, 0);
  }

  const moduleOptions = [...counts.entries()]
    .sort(([leftName, leftCount], [rightName, rightCount]) => (
      rightCount - leftCount || leftName.localeCompare(rightName, 'zh-Hans-CN')
    ))
    .map(([moduleName, count]) => ({
      key: `module:${moduleName}`,
      value: moduleName,
      label: moduleName,
      count,
    }));

  return [
    { key: 'module:all', value: null, label: '全部模块', count: sourceItems.length },
    ...moduleOptions,
  ];
}

function buildTagOptions(
  sourceItems: readonly MistakeListItem[],
  moduleName: string | null,
  selectedTag?: SelectedTag | null,
): TagOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  const candidates = moduleName === null
    ? sourceItems
    : sourceItems.filter((item) => item.module === moduleName);

  for (const item of candidates) {
    const seen = new Set<string>();
    for (const tag of item.tags) {
      const key = normalizeMistakeTagKey(tag.normalized_name || tag.name);
      const label = tag.name.trim();
      if (!key || !label || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const current = counts.get(key);
      counts.set(key, { label: current?.label ?? label, count: (current?.count ?? 0) + 1 });
    }
  }
  if (selectedTag && !counts.has(selectedTag.key)) {
    counts.set(selectedTag.key, { label: selectedTag.label, count: 0 });
  }

  const tagOptions = [...counts.entries()]
    .sort(([leftKey, left], [rightKey, right]) => (
      right.count - left.count
      || left.label.localeCompare(right.label, 'zh-Hans-CN')
      || leftKey.localeCompare(rightKey)
    ))
    .map(([key, value]) => ({
      key: `tag:${key}`,
      value: key,
      label: value.label,
      count: value.count,
    }));

  return [
    { key: 'tag:all', value: null, label: '全部标签', count: candidates.length },
    ...tagOptions,
  ];
}

function buildSearchFilter(keyword: string): MistakeListFilter {
  return {
    segment: 'all',
    keyword,
    module: null,
    tagKeys: [],
    limit: null,
  };
}

function sanitizeNextReviewText(text: string): string {
  return text.replace(/^[^\u4E00-\u9FFF0-9A-Za-z]+/u, '').trim();
}

function ThumbnailPlaceholder() {
  return (
    <View style={styles.thumbnailPlaceholder}>
      <MaterialIcons name="image-not-supported" size={25} color={colors.textMuted} />
      <Text style={styles.thumbnailPlaceholderText}>暂无题图</Text>
    </View>
  );
}

function MistakeCard({
  item,
  isDeleting,
  onPress,
  onLongPress,
  onMorePress,
}: {
  item: MistakeListItem;
  isDeleting: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onMorePress: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const didLongPressRef = useRef(false);

  useEffect(() => {
    setImageFailed(false);
  }, [item.thumbnailUri]);

  const nextReviewInfo = useMemo(
    () => resolveNextReviewAtText({
      reviewCount: item.reviewCount,
      maxReviewCount: item.maxReviewCount,
      nextReviewAt: item.nextReviewAt ?? null,
    }),
    [item.maxReviewCount, item.nextReviewAt, item.reviewCount],
  );
  const nextReviewText = item.status === 'collected'
    ? '待加入七刷'
    : sanitizeNextReviewText(nextReviewInfo.displayText);
  const showImage = !!item.thumbnailUri && !imageFailed;
  const currentProgress = Math.min(item.maxReviewCount, item.reviewCount + 1);

  return (
    <SurfaceCard padding={0} style={[styles.card, isDeleting ? styles.cardDisabled : null]}>
      <Pressable
        accessibilityLabel={`${item.questionCode ? `${item.questionCode}，` : ''}${item.title}，第 ${item.reviewCount} / ${item.maxReviewCount} 刷`}
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
        style={({ pressed }) => [styles.cardPressable, pressed ? styles.cardPressed : null]}>
        <View style={styles.cardRow}>
        {showImage ? (
          <Image
            onError={() => setImageFailed(true)}
            resizeMode="cover"
            source={{ uri: item.thumbnailUri! }}
            style={styles.thumbnail}
          />
        ) : (
          <ThumbnailPlaceholder />
        )}

        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <View style={styles.moduleInfoRow}>
              {item.questionCode ? (
                <View style={styles.questionCodeBadge}>
                  <Text style={styles.questionCodeText}>{item.questionCode}</Text>
                </View>
              ) : null}
              <Text numberOfLines={1} style={styles.moduleText}>
                {item.module}
              </Text>
            </View>
            <View style={styles.cardTopActions}>
              {item.isPinned ? <MaterialIcons name="star" size={16} color="#D58A18" /> : null}
              <Pressable
                accessibilityLabel="更多题目操作"
                accessibilityRole="button"
                hitSlop={10}
                onPress={onMorePress}
                style={({ pressed }) => [
                  styles.moreButton,
                  pressed ? styles.iconButtonPressed : null,
                ]}>
                <MaterialIcons name="more-vert" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>

          <Text numberOfLines={2} style={styles.cardTitle}>
            {item.title}
          </Text>

          {item.tags.length > 0 ? (
            <Text numberOfLines={1} style={styles.cardTags}>
              {item.tags.slice(0, 2).map((tag) => `#${tag.name}`).join('  ')}
            </Text>
          ) : null}

          <View style={styles.progressRow}>
            <Text numberOfLines={1} style={styles.progressText}>
              第 {item.reviewCount} / {item.maxReviewCount} 刷
            </Text>
            <ProgressDots
              completed={item.reviewCount}
              current={currentProgress}
              style={styles.progressDots}
              total={item.maxReviewCount}
            />
          </View>

          <View style={styles.cardFooterRow}>
            <Text numberOfLines={1} style={styles.nextReviewText}>
              {nextReviewText}
            </Text>
            <Text style={styles.difficultyText}>难度 {item.difficulty}</Text>
          </View>
        </View>
        </View>

        {isDeleting ? (
          <View style={styles.deletingOverlay}>
            <ActivityIndicator color={colors.danger} size="small" />
            <Text style={styles.deletingText}>删除中…</Text>
          </View>
        ) : null}
      </Pressable>
    </SurfaceCard>
  );
}

function OptionRow({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${label}，${count}道错题`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetOption,
        selected ? styles.sheetOptionSelected : null,
        pressed ? styles.sheetOptionPressed : null,
      ]}>
      <Text numberOfLines={1} style={[styles.sheetOptionLabel, selected ? styles.sheetOptionLabelSelected : null]}>
        {label}
      </Text>
      <View style={styles.sheetOptionEnd}>
        <Text style={styles.sheetOptionCount}>{count}</Text>
        <View style={styles.sheetCheckSlot}>
          {selected ? <MaterialIcons name="check" size={21} color={colors.success} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{
    quickMode?: string | string[];
    scheduledDate?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<MistakeListItem>>(null);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const hasFocusedRef = useRef(false);
  const { props: toastProps, showToast } = useAppToast();

  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<LibraryFilterState>(DEFAULT_FILTER_STATE);
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const [items, setItems] = useState<MistakeListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingMistakeId, setDeletingMistakeId] = useState<string | null>(null);
  const [pinningMistakeId, setPinningMistakeId] = useState<string | null>(null);
  const [joiningReviewPlanMistakeId, setJoiningReviewPlanMistakeId] = useState<string | null>(null);

  const [moduleSheetVisible, setModuleSheetVisible] = useState(false);
  const [tagSheetVisible, setTagSheetVisible] = useState(false);
  const [draftTag, setDraftTag] = useState<SelectedTag | null>(null);
  const [tagSearchText, setTagSearchText] = useState('');
  const [sortSheetVisible, setSortSheetVisible] = useState(false);

  const [customModuleModalVisible, setCustomModuleModalVisible] = useState(false);
  const [customModules, setCustomModules] = useState<CustomModule[]>([]);
  const [customModuleBusy, setCustomModuleBusy] = useState(false);
  const [customModuleMessage, setCustomModuleMessage] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const routeQuickMode = normalizeRouteValue(searchParams.quickMode);
  const routeScheduledDate = normalizeScheduledDate(normalizeRouteValue(searchParams.scheduledDate));

  useEffect(() => {
    if (routeScheduledDate) {
      setScheduledDate(routeScheduledDate);
      setFilters((current) => ({
        ...current,
        viewMode: 'active',
        sortKey: 'nextReview',
      }));
      listRef.current?.scrollToOffset({ animated: false, offset: 0 });
      return;
    }

    if (isLibraryQuickMode(routeQuickMode)) {
      setScheduledDate(null);
      setFilters((current) => ({
        ...current,
        viewMode: routeQuickMode,
      }));
      listRef.current?.scrollToOffset({ animated: false, offset: 0 });
    }
  }, [routeQuickMode, routeScheduledDate]);

  const loadItems = useCallback(async (keyword: string, mode: ListLoadMode) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (mode === 'initial') {
      setIsLoading(true);
    } else if (mode === 'refresh') {
      setIsRefreshing(true);
    } else {
      setIsFiltering(true);
    }
    setErrorMessage(null);

    try {
      const nextItems = await MistakeListService.getMistakeListItems(buildSearchFilter(keyword));
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      setItems(nextItems);
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      Logger.error(PAGE_SCOPE, 'Failed to load library items.', { keyword, mode, error });
      setItems([]);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      setIsLoading(false);
      setIsFiltering(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const keyword = searchText.trim();
      setFilters((current) => (
        current.keyword === keyword ? current : { ...current, keyword }
      ));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const mode: ListLoadMode = hasLoadedRef.current ? 'filter' : 'initial';
    hasLoadedRef.current = true;
    void loadItems(filters.keyword, mode);
  }, [filters.keyword, loadItems]);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return undefined;
      }
      void loadItems(filters.keyword, 'filter');
      return undefined;
    }, [filters.keyword, loadItems]),
  );

  const dateBounds = buildDateBounds();
  const moduleOptions = useMemo(
    () => buildModuleOptions(items, filters.module),
    [filters.module, items],
  );
  const tagOptions = useMemo(
    () => buildTagOptions(items, filters.module, filters.tag),
    [filters.module, filters.tag, items],
  );
  const scopedItems = useMemo(
    () => filterByModuleAndTag(items, filters.module, filters.tag),
    [filters.module, filters.tag, items],
  );
  const statusCounts = useMemo(() => ({
    all: scopedItems.length,
    collected: scopedItems.filter((item) => item.status === 'collected').length,
    active: scopedItems.filter((item) => item.status === 'active').length,
    mastered: scopedItems.filter((item) => item.status === 'mastered').length,
  }), [scopedItems]);
  const quickCounts = useMemo(() => ({
    today: scopedItems.filter((item) => isTodayDueItem(item, dateBounds)).length,
    overdue: scopedItems.filter((item) => isOverdueItem(item, dateBounds)).length,
  }), [dateBounds, scopedItems]);
  const effectiveSortKey = getEffectiveSortKey(filters);
  const resultItems = useMemo(
    () => sortItems(
      scopedItems.filter((item) => (
        scheduledDate
          ? isScheduledDateItem(item, scheduledDate)
          : matchesViewMode(item, filters.viewMode, dateBounds)
      )),
      effectiveSortKey,
    ),
    [dateBounds, effectiveSortKey, filters.viewMode, scheduledDate, scopedItems],
  );
  const selectedSortOption = SORT_OPTIONS.find((option) => option.key === effectiveSortKey)
    ?? SORT_OPTIONS[0];

  const statusOptions = useMemo(() => [
    { value: 'all' as const, label: '全部', count: statusCounts.all },
    { value: 'collected' as const, label: '待整理', count: statusCounts.collected },
    { value: 'active' as const, label: '待复做', count: statusCounts.active },
    { value: 'mastered' as const, label: '已七刷', count: statusCounts.mastered },
  ], [statusCounts]);
  const quickOptions = useMemo(() => [
    {
      value: 'today' as const,
      label: '今日应做',
      icon: 'event-available' as ComponentProps<typeof MaterialIcons>['name'],
      count: quickCounts.today,
    },
    {
      value: 'overdue' as const,
      label: '已逾期',
      icon: 'history' as ComponentProps<typeof MaterialIcons>['name'],
      count: quickCounts.overdue,
      tone: 'danger' as const,
    },
    {
      value: 'recentViewed' as const,
      label: '最近访问',
      icon: 'visibility' as ComponentProps<typeof MaterialIcons>['name'],
    },
    {
      value: 'recentAdded' as const,
      label: '最近增加',
      icon: 'more-time' as ComponentProps<typeof MaterialIcons>['name'],
    },
  ], [quickCounts]);

  const filteredTagOptions = useMemo(() => {
    const keyword = normalizeMistakeTagKey(tagSearchText);
    if (!keyword) {
      return tagOptions;
    }
    const allOption = tagOptions[0];
    return [
      allOption,
      ...tagOptions.slice(1).filter((option) => (
        normalizeMistakeTagKey(option.label).includes(keyword)
      )),
    ];
  }, [tagOptions, tagSearchText]);
  const tagPreviewCount = useMemo(() => {
    const previewItems = filterByModuleAndTag(items, filters.module, draftTag);
    return previewItems.filter((item) => (
      scheduledDate
        ? isScheduledDateItem(item, scheduledDate)
        : matchesViewMode(item, filters.viewMode, dateBounds)
    )).length;
  }, [dateBounds, draftTag, filters.module, filters.viewMode, items, scheduledDate]);

  const hasResettableState = (
    searchText.trim().length > 0
    || filters.keyword.length > 0
    || filters.module !== null
    || filters.tag !== null
    || filters.viewMode !== 'all'
    || filters.sortKey !== DEFAULT_FILTER_STATE.sortKey
    || scheduledDate !== null
  );
  const hasFilteringConstraint = (
    filters.keyword.length > 0
    || filters.module !== null
    || filters.tag !== null
    || filters.viewMode !== 'all'
    || scheduledDate !== null
  );

  const scrollToTop = useCallback((animated = true) => {
    listRef.current?.scrollToOffset({ animated, offset: 0 });
  }, []);

  const handleReset = useCallback(() => {
    setSearchText('');
    setFilters(DEFAULT_FILTER_STATE);
    setDraftTag(null);
    setTagSearchText('');
    setScheduledDate(null);
    scrollToTop();
  }, [scrollToTop]);

  const handleOpenModuleSheet = useCallback(() => {
    setModuleSheetVisible(true);
  }, []);

  const handleSelectModule = useCallback((moduleName: string | null) => {
    const validTags = new Set(
      buildTagOptions(items, moduleName).slice(1).map((option) => option.value),
    );
    setFilters((current) => ({
      ...current,
      module: moduleName,
      tag: current.tag && !validTags.has(current.tag.key) ? null : current.tag,
    }));
    setModuleSheetVisible(false);
    scrollToTop();
  }, [items, scrollToTop]);

  const handleOpenTagSheet = useCallback(() => {
    setDraftTag(filters.tag);
    setTagSearchText('');
    setTagSheetVisible(true);
  }, [filters.tag]);

  const handleApplyTag = useCallback(() => {
    setFilters((current) => ({ ...current, tag: draftTag }));
    setTagSheetVisible(false);
    scrollToTop();
  }, [draftTag, scrollToTop]);

  const handleSelectStatus = useCallback((value: LibraryStatusMode) => {
    setScheduledDate(null);
    setFilters((current) => ({ ...current, viewMode: value }));
    scrollToTop();
  }, [scrollToTop]);

  const handleSelectQuick = useCallback((value: LibraryQuickMode) => {
    setScheduledDate(null);
    setFilters((current) => ({
      ...current,
      viewMode: current.viewMode === value ? 'all' : value,
    }));
    scrollToTop();
  }, [scrollToTop]);

  const handleSelectSort = useCallback((sortKey: LibrarySortKey) => {
    setFilters((current) => ({
      ...current,
      sortKey,
      viewMode: isQuickMode(current.viewMode) ? 'all' : current.viewMode,
    }));
    setSortSheetVisible(false);
    scrollToTop();
  }, [scrollToTop]);

  const handleRetry = useCallback(() => {
    void loadItems(filters.keyword, 'refresh');
  }, [filters.keyword, loadItems]);

  const handleOpenDetail = useCallback((id: string) => {
    if (deletingMistakeId !== null) {
      return;
    }
    const routeId = normalizeMistakeId(id);
    if (!routeId) {
      Logger.warn(PAGE_SCOPE, 'Skip opening detail because mistake id is empty.', { id });
      return;
    }
    const viewedAt = new Date().toISOString();
    setItems((current) => current.map((item) => (
      item.id === routeId ? { ...item, lastViewedAt: viewedAt } : item
    )));
    void MistakeListService.markMistakeViewed(routeId);
    router.push(`/mistake/${routeId}` as never);
  }, [deletingMistakeId, router]);

  const handleTogglePinned = useCallback(async (item: MistakeListItem) => {
    if (deletingMistakeId || pinningMistakeId || isLoading || isRefreshing) {
      return;
    }
    const mistakeId = normalizeMistakeId(item.id);
    if (!mistakeId) {
      return;
    }
    setPinningMistakeId(mistakeId);
    try {
      const updated = await MistakeListService.setMistakePinned(mistakeId, !item.isPinned);
      if (!mountedRef.current) {
        return;
      }
      if (!updated) {
        Alert.alert('操作失败', '没有找到这道错题，请刷新后重试。');
        return;
      }
      setItems((current) => current.map((currentItem) => (
        currentItem.id === mistakeId ? { ...currentItem, ...updated } : currentItem
      )));
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to toggle pinned state.', { mistakeId, error });
      Alert.alert('操作失败', error instanceof Error ? error.message : '置顶状态保存失败。');
    } finally {
      if (mountedRef.current) {
        setPinningMistakeId(null);
      }
    }
  }, [deletingMistakeId, isLoading, isRefreshing, pinningMistakeId]);

  const handleJoinReviewPlan = useCallback((item: MistakeListItem) => {
    if (deletingMistakeId || joiningReviewPlanMistakeId || isLoading || isRefreshing) {
      return;
    }
    const mistakeId = normalizeMistakeId(item.id);
    if (!mistakeId) {
      return;
    }
    setJoiningReviewPlanMistakeId(mistakeId);
    void (async () => {
      try {
        const result = await MistakeDetailService.joinMistakeReviewPlan(mistakeId);
        if (!mountedRef.current) {
          return;
        }
        if (!result.ok) {
          Alert.alert('加入失败', result.errorMessage ?? '加入七刷失败，请稍后重试。');
          return;
        }
        showToast('已加入七刷，今天可复做', 'success');
        await loadItems(filters.keyword, 'filter');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to join review plan.', { mistakeId, error });
        Alert.alert('加入失败', error instanceof Error ? error.message : '加入七刷失败。');
      } finally {
        if (mountedRef.current) {
          setJoiningReviewPlanMistakeId(null);
        }
      }
    })();
  }, [
    deletingMistakeId,
    filters.keyword,
    isLoading,
    isRefreshing,
    joiningReviewPlanMistakeId,
    loadItems,
    showToast,
  ]);

  const handleDelete = useCallback((item: MistakeListItem) => {
    if (deletingMistakeId || isLoading || isRefreshing) {
      return;
    }
    const mistakeId = normalizeMistakeId(item.id);
    if (!mistakeId) {
      return;
    }
    const title = item.title.trim();
    const titlePreview = title.length > 18 ? `${title.slice(0, 18)}…` : title;
    Alert.alert(
      '删除这道错题？',
      `将删除「${titlePreview}」及其复做记录、图片和语音讲解，删除后无法恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingMistakeId(mistakeId);
              try {
                const result = await MistakeDetailService.deleteMistake(mistakeId);
                if (!mountedRef.current) {
                  return;
                }
                if (!result.ok) {
                  Alert.alert('删除失败', result.errorMessage ?? '删除错题失败，请稍后重试。');
                  return;
                }
                setItems((current) => current.filter((currentItem) => currentItem.id !== mistakeId));
              } catch (error) {
                Logger.error(PAGE_SCOPE, 'Failed to delete mistake.', { mistakeId, error });
                Alert.alert('删除失败', error instanceof Error ? error.message : '删除错题失败。');
              } finally {
                if (mountedRef.current) {
                  setDeletingMistakeId(null);
                }
              }
            })();
          },
        },
      ],
    );
  }, [deletingMistakeId, isLoading, isRefreshing]);

  const handleOpenMistakeMenu = useCallback((item: MistakeListItem) => {
    if (
      deletingMistakeId
      || joiningReviewPlanMistakeId
      || pinningMistakeId
      || isLoading
      || isRefreshing
    ) {
      return;
    }
    Alert.alert('题目操作', item.title, [
      ...(item.status === 'collected'
        ? [{ text: '加入七刷', onPress: () => handleJoinReviewPlan(item) }]
        : []),
      { text: item.isPinned ? '取消置顶' : '置顶题目', onPress: () => void handleTogglePinned(item) },
      { text: '删除题目', style: 'destructive' as const, onPress: () => handleDelete(item) },
      { text: '取消', style: 'cancel' as const },
    ]);
  }, [
    deletingMistakeId,
    handleDelete,
    handleJoinReviewPlan,
    handleTogglePinned,
    isLoading,
    isRefreshing,
    joiningReviewPlanMistakeId,
    pinningMistakeId,
  ]);

  const handleOpenCustomModuleManager = useCallback(() => {
    setModuleSheetVisible(false);
    setCustomModuleModalVisible(true);
    setCustomModuleBusy(true);
    setCustomModuleMessage(null);
    void CustomModuleService.listCustomModules()
      .then((modules) => {
        if (mountedRef.current) {
          setCustomModules(modules);
        }
      })
      .catch((error) => {
        Logger.error(PAGE_SCOPE, 'Failed to load custom modules.', error);
        if (mountedRef.current) {
          setCustomModuleMessage('自定义模块加载失败');
        }
      })
      .finally(() => {
        if (mountedRef.current) {
          setCustomModuleBusy(false);
        }
      });
  }, []);

  const handleCreateCustomModule = useCallback(async (moduleName: string): Promise<boolean> => {
    if (customModuleBusy) {
      return false;
    }
    setCustomModuleBusy(true);
    setCustomModuleMessage(null);
    try {
      const result = await CustomModuleService.createCustomModule(moduleName);
      if (!mountedRef.current) {
        return false;
      }
      if (!result.ok) {
        const message = result.errorMessage ?? '创建自定义模块失败';
        setCustomModuleMessage(message);
        showToast(message, 'warning');
        return false;
      }
      if (result.modules) {
        setCustomModules(result.modules);
      }
      showToast('已添加自定义模块', 'success');
      return true;
    } finally {
      if (mountedRef.current) {
        setCustomModuleBusy(false);
      }
    }
  }, [customModuleBusy, showToast]);

  const handleUpdateCustomModule = useCallback(async (
    moduleId: number,
    moduleName: string,
  ): Promise<boolean> => {
    if (customModuleBusy) {
      return false;
    }
    setCustomModuleBusy(true);
    setCustomModuleMessage(null);
    try {
      const result = await CustomModuleService.updateCustomModuleName(moduleId, moduleName);
      if (!mountedRef.current) {
        return false;
      }
      if (!result.ok) {
        const message = result.errorMessage ?? '编辑自定义模块失败';
        setCustomModuleMessage(message);
        showToast(message, 'warning');
        return false;
      }
      if (result.modules) {
        setCustomModules(result.modules);
      }
      showToast('自定义模块已更新', 'success');
      return true;
    } finally {
      if (mountedRef.current) {
        setCustomModuleBusy(false);
      }
    }
  }, [customModuleBusy, showToast]);

  const handleDeleteCustomModule = useCallback((moduleItem: CustomModule) => {
    if (customModuleBusy) {
      return;
    }
    Alert.alert('删除模块', `确认删除“${moduleItem.name}”？已保存错题不会被删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setCustomModuleBusy(true);
            setCustomModuleMessage(null);
            try {
              const result = await CustomModuleService.deleteCustomModule(moduleItem.id);
              if (!mountedRef.current) {
                return;
              }
              if (!result.ok) {
                const message = result.errorMessage ?? '删除自定义模块失败';
                setCustomModuleMessage(message);
                showToast(message, 'error');
                return;
              }
              if (result.modules) {
                setCustomModules(result.modules);
              }
              showToast('自定义模块已删除', 'info');
            } finally {
              if (mountedRef.current) {
                setCustomModuleBusy(false);
              }
            }
          })();
        },
      },
    ]);
  }, [customModuleBusy, showToast]);

  const handleMoveCustomModule = useCallback((moduleId: number, direction: 'up' | 'down') => {
    if (customModuleBusy) {
      return;
    }
    setCustomModuleBusy(true);
    setCustomModuleMessage(null);
    void CustomModuleService.moveCustomModule(moduleId, direction)
      .then((result) => {
        if (!mountedRef.current) {
          return;
        }
        if (!result.ok) {
          const message = result.errorMessage ?? '调整模块排序失败';
          setCustomModuleMessage(message);
          showToast(message, 'warning');
          return;
        }
        if (result.modules) {
          setCustomModules(result.modules);
        }
      })
      .finally(() => {
        if (mountedRef.current) {
          setCustomModuleBusy(false);
        }
      });
  }, [customModuleBusy, showToast]);

  const renderEmptyState = () => {
    if (isLoading) {
      return (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={colors.textPrimary} size="small" />
          <Text style={styles.stateText}>正在加载错题…</Text>
        </View>
      );
    }
    if (errorMessage) {
      return (
        <View style={styles.stateWrap}>
          <MaterialIcons name="error-outline" size={30} color={colors.danger} />
          <Text style={styles.stateTitle}>错题读取失败</Text>
          <Text style={styles.stateText}>{errorMessage}</Text>
          <Pressable onPress={handleRetry} style={styles.secondaryStateButton}>
            <Text style={styles.secondaryStateButtonText}>重新加载</Text>
          </Pressable>
        </View>
      );
    }
    if (hasFilteringConstraint) {
      return (
        <View style={styles.stateWrap}>
          <MaterialIcons name="search-off" size={32} color={colors.textMuted} />
          <Text style={styles.stateTitle}>没有找到符合条件的错题</Text>
          <Text style={styles.stateText}>可以调整搜索词，或清除当前筛选后再试。</Text>
          <Pressable onPress={handleReset} style={styles.secondaryStateButton}>
            <Text style={styles.secondaryStateButtonText}>清除筛选</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.stateWrap}>
        <MaterialIcons name="library-books" size={32} color={colors.textMuted} />
        <Text style={styles.stateTitle}>还没有错题</Text>
        <Text style={styles.stateText}>去新增页记录第一道错题吧。</Text>
        <Pressable onPress={() => router.push('/add' as never)} style={styles.secondaryStateButton}>
          <Text style={styles.secondaryStateButtonText}>新增错题</Text>
        </Pressable>
      </View>
    );
  };

  const listHeader = (
    <View style={styles.headerContent}>
      <PageHeader
        showOffline
        subtitle="只记录错题、做法、答案和 7 次复做"
        title="错题库"
      />

      <View style={styles.searchBox}>
        <MaterialIcons name="search" size={23} color={colors.textMuted} />
        <TextInput
          accessibilityLabel="搜索编号、题目、模块或标签"
          maxFontSizeMultiplier={1.2}
          onChangeText={setSearchText}
          placeholder="搜索编号、题目、模块或标签"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          style={styles.searchInput}
          value={searchText}
        />
        {searchText.length > 0 ? (
          <Pressable
            accessibilityLabel="清空搜索"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              setSearchText('');
              setFilters((current) => ({ ...current, keyword: '' }));
            }}
            style={({ pressed }) => [styles.clearSearchButton, pressed ? styles.iconButtonPressed : null]}>
            <MaterialIcons name="cancel" size={19} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filterRow}>
        <Pressable
          accessibilityLabel={`模块筛选，当前${filters.module ?? '全部'}`}
          accessibilityRole="button"
          onPress={handleOpenModuleSheet}
          style={({ pressed }) => [styles.filterButton, pressed ? styles.filterButtonPressed : null]}>
          <Text style={styles.filterPrefix}>模块</Text>
          <Text numberOfLines={1} style={styles.filterValue}>{filters.module ?? '全部'}</Text>
          <MaterialIcons name="keyboard-arrow-down" size={20} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityLabel={`标签筛选，当前${filters.tag?.label ?? '全部'}`}
          accessibilityRole="button"
          onPress={handleOpenTagSheet}
          style={({ pressed }) => [styles.filterButton, pressed ? styles.filterButtonPressed : null]}>
          <Text style={styles.filterPrefix}>标签</Text>
          <Text numberOfLines={1} style={styles.filterValue}>{filters.tag?.label ?? '全部'}</Text>
          <MaterialIcons name="keyboard-arrow-down" size={20} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityLabel="重置错题库筛选"
          accessibilityRole="button"
          accessibilityState={{ disabled: !hasResettableState }}
          disabled={!hasResettableState}
          onPress={handleReset}
          style={({ pressed }) => [styles.resetButton, pressed ? styles.filterButtonPressed : null]}>
          <Text style={[styles.resetText, !hasResettableState ? styles.resetTextDisabled : null]}>重置</Text>
        </Pressable>
      </View>

      <LibrarySegmentedControl
        onChange={handleSelectStatus}
        options={statusOptions}
        style={styles.statusSegment}
        value={isStatusMode(filters.viewMode) ? filters.viewMode : null}
      />

      <View style={styles.quickSection}>
        <SectionHeader title="快捷查看" />
        <LibraryQuickView
          onChange={handleSelectQuick}
          options={quickOptions}
          value={isQuickMode(filters.viewMode) ? filters.viewMode : null}
        />
      </View>

      <View style={styles.resultsHeader}>
        <View style={styles.resultCountWrap}>
          <Text style={styles.resultCount}>
            {scheduledDate ? `${scheduledDate} · ` : ''}{resultItems.length} 道错题
          </Text>
          {isFiltering ? <ActivityIndicator color={colors.textMuted} size="small" /> : null}
        </View>
        <Pressable
          accessibilityLabel={`当前排序，${selectedSortOption.label}`}
          accessibilityRole="button"
          onPress={() => setSortSheetVisible(true)}
          style={({ pressed }) => [styles.sortButton, pressed ? styles.filterButtonPressed : null]}>
          <Text numberOfLines={1} style={styles.sortButtonText}>{selectedSortOption.label}</Text>
          <MaterialIcons name="keyboard-arrow-down" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.pageRoot}>
      <PageShell hasBottomTab safeAreaEdges={['top']} withPadding={false}>
        <FlatList
          ref={listRef}
          contentContainerStyle={styles.listContent}
          data={isLoading || errorMessage ? [] : resultItems}
          ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
          keyExtractor={(item) => item.id}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={renderEmptyState}
          ListHeaderComponent={listHeader}
          refreshControl={(
            <RefreshControl
              colors={[colors.textPrimary]}
              onRefresh={handleRetry}
              refreshing={isRefreshing}
              tintColor={colors.textPrimary}
            />
          )}
          renderItem={({ item }) => (
            <MistakeCard
              isDeleting={deletingMistakeId === item.id}
              item={item}
              onLongPress={() => handleOpenMistakeMenu(item)}
              onMorePress={() => handleOpenMistakeMenu(item)}
              onPress={() => handleOpenDetail(item.id)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />

        <LibraryBottomSheet
          footer={(
            <Pressable
              accessibilityRole="button"
              onPress={handleOpenCustomModuleManager}
              style={({ pressed }) => [styles.manageModuleButton, pressed ? styles.sheetOptionPressed : null]}>
              <MaterialIcons name="tune" size={19} color={colors.success} />
              <Text style={styles.manageModuleText}>管理自定义模块</Text>
            </Pressable>
          )}
          onClose={() => setModuleSheetVisible(false)}
          title="选择模块"
          visible={moduleSheetVisible}>
          <FlatList
            contentContainerStyle={styles.sheetListContent}
            data={moduleOptions}
            keyExtractor={(option) => option.key}
            renderItem={({ item: option }) => (
              <OptionRow
                count={option.count}
                label={option.label}
                onPress={() => handleSelectModule(option.value)}
                selected={filters.module === option.value}
              />
            )}
            style={styles.sheetList}
          />
        </LibraryBottomSheet>

        <LibraryBottomSheet
          footer={(
            <Pressable
              accessibilityLabel={`查看${tagPreviewCount}道题`}
              accessibilityRole="button"
              onPress={handleApplyTag}
              style={({ pressed }) => [styles.primarySheetButton, pressed ? styles.primarySheetButtonPressed : null]}>
              <Text style={styles.primarySheetButtonText}>查看 {tagPreviewCount} 道题</Text>
            </Pressable>
          )}
          onClose={() => setTagSheetVisible(false)}
          title="选择标签"
          visible={tagSheetVisible}>
          <View style={styles.tagSheetContent}>
            <View style={styles.tagSearchBox}>
              <MaterialIcons name="search" size={20} color={colors.textMuted} />
              <TextInput
                accessibilityLabel="搜索标签"
                onChangeText={setTagSearchText}
                placeholder="搜索标签"
                placeholderTextColor={colors.textMuted}
                style={styles.tagSearchInput}
                value={tagSearchText}
              />
              {tagSearchText.length > 0 ? (
                <Pressable
                  accessibilityLabel="清空标签搜索"
                  hitSlop={8}
                  onPress={() => setTagSearchText('')}>
                  <MaterialIcons name="cancel" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
            <FlatList
              contentContainerStyle={styles.tagListContent}
              data={filteredTagOptions}
              keyExtractor={(option) => option.key}
              ListEmptyComponent={<Text style={styles.noTagText}>没有匹配的标签</Text>}
              renderItem={({ item: option }) => (
                <OptionRow
                  count={option.count}
                  label={option.label}
                  onPress={() => setDraftTag(
                    option.value === null ? null : { key: option.value, label: option.label },
                  )}
                  selected={draftTag?.key === option.value || (draftTag === null && option.value === null)}
                />
              )}
              style={styles.tagList}
            />
          </View>
        </LibraryBottomSheet>

        <LibraryBottomSheet
          onClose={() => setSortSheetVisible(false)}
          title="排序方式"
          visible={sortSheetVisible}>
          <ScrollView contentContainerStyle={styles.sortList}>
            {SORT_OPTIONS.map((option) => {
              const selected = effectiveSortKey === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityLabel={`排序方式，${option.label}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => handleSelectSort(option.key)}
                  style={({ pressed }) => [
                    styles.sortOption,
                    selected ? styles.sheetOptionSelected : null,
                    pressed ? styles.sheetOptionPressed : null,
                  ]}>
                  <View style={styles.sortOptionTextWrap}>
                    <Text style={[styles.sortOptionTitle, selected ? styles.sheetOptionLabelSelected : null]}>
                      {option.label}
                    </Text>
                    <Text style={styles.sortOptionDescription}>{option.description}</Text>
                  </View>
                  {selected ? <MaterialIcons name="check" size={21} color={colors.success} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </LibraryBottomSheet>

        <CustomModuleManagerModal
          busy={customModuleBusy}
          customModules={customModules}
          message={customModuleMessage}
          onClose={() => setCustomModuleModalVisible(false)}
          onCreateModule={handleCreateCustomModule}
          onDeleteModule={handleDeleteCustomModule}
          onMoveModule={handleMoveCustomModule}
          onSelectModule={(moduleName) => {
            setFilters((current) => ({ ...current, module: moduleName, tag: null }));
            scrollToTop();
          }}
          onUpdateModule={handleUpdateCustomModule}
          onUseTemplate={handleCreateCustomModule}
          selectedModule={filters.module}
          visible={customModuleModalVisible}
        />
      </PageShell>
      <AppToast
        {...toastProps}
        bottomOffset={Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: layout.bottomTabHeight + spacing.xxl,
  },
  headerContent: {
    paddingTop: layout.headerTopPadding,
    paddingBottom: spacing.lg,
  },
  searchBox: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  clearSearchButton: {
    width: 32,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  filterRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  filterButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterButtonPressed: {
    opacity: 0.58,
    backgroundColor: colors.surfaceMuted,
  },
  filterPrefix: {
    flexShrink: 0,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  filterValue: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  resetButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
  },
  resetText: {
    color: colors.success,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  resetTextDisabled: {
    color: colors.textMuted,
    fontWeight: '500',
  },
  quickSection: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  statusSegment: {
    marginBottom: spacing.xl,
  },
  resultsHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  resultCountWrap: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  resultCount: {
    color: colors.textSecondary,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
  sortButton: {
    maxWidth: '50%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingLeft: spacing.md,
    borderRadius: radius.md,
  },
  sortButtonText: {
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  itemSeparator: {
    height: spacing.md,
  },
  card: {
    overflow: 'hidden',
  },
  cardPressable: {
    minHeight: 142,
    padding: spacing.md,
  },
  cardPressed: {
    opacity: 0.72,
  },
  cardDisabled: {
    opacity: 0.62,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.md,
  },
  thumbnail: {
    width: 88,
    minHeight: 116,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  thumbnailPlaceholder: {
    width: 88,
    minHeight: 116,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  thumbnailPlaceholderText: {
    ...typography.caption,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardTopRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  moduleInfoRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  questionCodeBadge: {
    flexShrink: 0,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  questionCodeText: {
    color: colors.success,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  moduleText: {
    flex: 1,
    minWidth: 0,
    color: '#4D678B',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  cardTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moreButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  cardTitle: {
    marginTop: 2,
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
  },
  cardTags: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  progressRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  progressText: {
    flexShrink: 0,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  progressDots: {
    flexShrink: 1,
  },
  cardFooterRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  nextReviewText: {
    flex: 1,
    minWidth: 0,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  difficultyText: {
    flexShrink: 0,
    color: '#C66A08',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  deletingOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  deletingText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
  },
  stateWrap: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  stateTitle: {
    ...typography.sectionTitle,
    marginTop: spacing.xs,
    textAlign: 'center',
    fontSize: 18,
    lineHeight: 24,
  },
  stateText: {
    ...typography.body,
    textAlign: 'center',
  },
  secondaryStateButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  secondaryStateButtonText: {
    color: colors.success,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  sheetList: {
    flexShrink: 1,
    maxHeight: 460,
  },
  sheetListContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sheetOption: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  sheetOptionSelected: {
    backgroundColor: colors.successBg,
  },
  sheetOptionPressed: {
    opacity: 0.58,
    backgroundColor: colors.surfaceMuted,
  },
  sheetOptionLabel: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  sheetOptionLabelSelected: {
    color: colors.success,
    fontWeight: '700',
  },
  sheetOptionEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sheetOptionCount: {
    minWidth: 32,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'right',
  },
  sheetCheckSlot: {
    width: 22,
    alignItems: 'center',
  },
  manageModuleButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
  },
  manageModuleText: {
    color: colors.success,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  tagSheetContent: {
    flexShrink: 1,
    maxHeight: 500,
    paddingTop: spacing.md,
  },
  tagSearchBox: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  tagSearchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
  },
  tagList: {
    flexShrink: 1,
    marginTop: spacing.sm,
  },
  tagListContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  noTagText: {
    ...typography.body,
    padding: spacing.xl,
    textAlign: 'center',
  },
  primarySheetButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.success,
  },
  primarySheetButtonPressed: {
    opacity: 0.75,
  },
  primarySheetButtonText: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  sortList: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sortOption: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  sortOptionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  sortOptionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  sortOptionDescription: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
});
