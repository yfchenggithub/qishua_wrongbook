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
import type { MistakeModuleCount } from '@/src/services/MistakeListService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';
import { resolveNextReviewAtText } from '@/src/utils/reviewSchedule';

const SEARCH_DEBOUNCE_MS = 350;
const INLINE_MODULE_FILTER_OPTION_LIMIT = 3;
const PAGE_SCOPE = 'LibraryScreen';

type LibraryModuleFilterValue = string | null;

interface LibraryModuleFilterOption {
  key: string;
  value: LibraryModuleFilterValue;
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
): MistakeListFilter {
  return {
    segment: mapSegmentValueToFilterSegment(filterValue),
    keyword,
    module,
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

export default function LibraryScreen() {
  const router = useRouter();
  const [searchText, setSearchText] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<LibraryFilterValue>('all');
  const [selectedModuleFilter, setSelectedModuleFilter] = useState<LibraryModuleFilterValue>(null);
  const [moduleFilterOptions, setModuleFilterOptions] = useState<LibraryModuleFilterOption[]>([
    { key: 'all', value: null, label: '全部', count: 0 },
  ]);
  const [isModuleFilterLoading, setIsModuleFilterLoading] = useState(false);
  const [moduleFilterErrorMessage, setModuleFilterErrorMessage] = useState<string | null>(null);
  const [moduleFilterSheetVisible, setModuleFilterSheetVisible] = useState(false);
  const [items, setItems] = useState<MistakeListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingMistakeId, setDeletingMistakeId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);
  const hasFocusedRef = useRef(false);
  const requestIdRef = useRef(0);
  const moduleFilterRequestIdRef = useRef(0);

  const loadList = useCallback(
    async (filter: MistakeListFilter, mode: 'initial' | 'refresh') => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (mode === 'initial') {
        setIsLoading(true);
      } else {
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

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(searchText.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const filter = buildLibraryListFilter(selectedFilter, debouncedKeyword, selectedModuleFilter);
    const mode: 'initial' | 'refresh' = hasLoadedRef.current ? 'refresh' : 'initial';
    hasLoadedRef.current = true;

    void loadList(filter, mode);
  }, [debouncedKeyword, loadList, selectedFilter, selectedModuleFilter]);

  useEffect(() => {
    const filter = buildLibraryListFilter(selectedFilter, debouncedKeyword, null);
    void loadModuleFilterOptions(filter);
  }, [debouncedKeyword, loadModuleFilterOptions, selectedFilter]);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return undefined;
      }

      const filter = buildLibraryListFilter(selectedFilter, debouncedKeyword, selectedModuleFilter);
      const moduleOptionsFilter = buildLibraryListFilter(selectedFilter, debouncedKeyword, null);
      void loadList(filter, 'refresh');
      void loadModuleFilterOptions(moduleOptionsFilter);
      return undefined;
    }, [debouncedKeyword, loadList, loadModuleFilterOptions, selectedFilter, selectedModuleFilter]),
  );

  const handleClearSearch = useCallback(() => {
    setSearchText('');
    setDebouncedKeyword('');
  }, []);

  const handleSelectModuleFilter = useCallback((value: LibraryModuleFilterValue) => {
    setSelectedModuleFilter(value);
  }, []);

  const handleRetry = useCallback(() => {
    const filter = buildLibraryListFilter(selectedFilter, debouncedKeyword, selectedModuleFilter);
    const moduleOptionsFilter = buildLibraryListFilter(selectedFilter, debouncedKeyword, null);
    void loadModuleFilterOptions(moduleOptionsFilter);
    void loadList(filter, 'refresh');
  }, [debouncedKeyword, loadList, loadModuleFilterOptions, selectedFilter, selectedModuleFilter]);

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

  const shouldShowModuleFilterMore = moduleFilterOptions.length > inlineModuleFilterOptions.length;
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
  }, [debouncedKeyword.length, selectedFilter, selectedModuleFilter]);

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
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    minHeight: 52,
    paddingHorizontal: spacing.md,
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
