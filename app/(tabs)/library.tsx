import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  BrandHeader,
  CardContainer,
  ProgressDots,
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
import { resolveNextReviewAtText } from '@/src/utils/reviewSchedule';

const SEARCH_DEBOUNCE_MS = 350;
const INLINE_MODULE_FILTER_OPTION_LIMIT = 3;
const INLINE_TAG_FILTER_OPTION_LIMIT = 6;
const PAGE_SCOPE = 'LibraryScreen';

type LibraryModuleFilterValue = string | null;
type ListLoadMode = 'initial' | 'refresh' | 'filter';

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
}: {
  item: MistakeListItem;
  isDeleting?: boolean;
  onPress: () => void;
  onLongPress: () => void;
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
                <View style={styles.difficultyPill}>
                  <Text
                    numberOfLines={1}
                    allowFontScaling={false}
                    maxFontSizeMultiplier={1.0}
                    style={styles.difficultyText}>
                    难度 {item.difficulty}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={18} style={styles.arrow} />
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
  const [searchText, setSearchText] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<LibraryFilterValue>('all');
  const [selectedModuleFilter, setSelectedModuleFilter] = useState<LibraryModuleFilterValue>(null);
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [moduleFilterOptions, setModuleFilterOptions] = useState<LibraryModuleFilterOption[]>([
    { key: 'all', value: null, label: '全部', count: 0 },
  ]);
  const [tagFilterOptions, setTagFilterOptions] = useState<LibraryTagFilterOption[]>([]);
  const [isModuleFilterLoading, setIsModuleFilterLoading] = useState(false);
  const [isTagFilterLoading, setIsTagFilterLoading] = useState(false);
  const [moduleFilterErrorMessage, setModuleFilterErrorMessage] = useState<string | null>(null);
  const [tagFilterErrorMessage, setTagFilterErrorMessage] = useState<string | null>(null);
  const [moduleFilterSheetVisible, setModuleFilterSheetVisible] = useState(false);
  const [tagFilterSheetVisible, setTagFilterSheetVisible] = useState(false);
  const [items, setItems] = useState<MistakeListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingMistakeId, setDeletingMistakeId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);
  const hasFocusedRef = useRef(false);
  const requestIdRef = useRef(0);
  const moduleFilterRequestIdRef = useRef(0);
  const tagFilterRequestIdRef = useRef(0);

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
      router.push(`/mistake/${routeId}` as never);
    },
    [deletingMistakeId, router]
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
  const currentResultCount = moduleFilterErrorMessage
    ? items.length
    : (selectedModuleFilterOption?.count ?? items.length);

  const emptyConfig = useMemo(() => {
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
  }, [debouncedKeyword.length, selectedFilter, selectedModuleFilter, selectedTagFilterCount]);

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
      </View>
    );
  }, [emptyConfig, errorMessage, handleGoAddMistake, handleRetry, isLoading]);

  return (
    <ScreenContainer withPadding={false} safeAreaEdges={['top']}>
      <FlatList<MistakeListItem>
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MistakeLibraryCard
            item={item}
            isDeleting={deletingMistakeId === item.id}
            onPress={() => handleOpenDetail(item.id)}
            onLongPress={() => handleLongPressDelete(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.listItemSeparator} />}
        showsVerticalScrollIndicator={false}
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

            <View style={styles.searchPanel}>
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

            <SegmentControl
              options={libraryMock.filters}
              value={selectedFilter}
              onChange={(next) => setSelectedFilter(next as LibraryFilterValue)}
            />

            <View style={styles.metaRow}>
              <Text style={styles.countText}>当前共 {currentResultCount} 题</Text>
              {isRefreshing ? <Text style={styles.refreshText}>刷新中...</Text> : null}
            </View>
          </View>
        }
        ListEmptyComponent={listEmpty}
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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  listContent: {
    paddingBottom: layout.bottomTabHeight,
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
