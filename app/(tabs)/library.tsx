import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
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
  StatusPill,
} from '@/src/components';
import type { MistakeListFilter, MistakeListItem, MistakeListStatus } from '@/src/models/MistakeListItem';
import { libraryMock, type LibraryFilterValue } from '@/src/mocks/library';
import * as MistakeListService from '@/src/services/MistakeListService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const SEARCH_DEBOUNCE_MS = 350;

function mapStatusToTone(status: MistakeListStatus): 'dark' | 'light' | 'success' {
  if (status === 'mastered') {
    return 'success';
  }
  if (status === 'due_today') {
    return 'dark';
  }
  return 'light';
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

function ThumbnailPlaceholder() {
  return (
    <View style={styles.thumb}>
      <View style={styles.thumbAxisX} />
      <View style={styles.thumbAxisY} />
      <View style={styles.thumbCurve} />
    </View>
  );
}

function MistakeLibraryCard({
  item,
  onPress,
}: {
  item: MistakeListItem;
  onPress: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!item.thumbnailUri && !imageFailed;

  return (
    <Pressable onPress={onPress} style={styles.cardPressable}>
      <CardContainer padding={spacing.lg} style={styles.card}>
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
              <Text style={styles.cardMeta}>{item.module}</Text>
              <Text style={styles.arrow}>{'>'}</Text>
            </View>

            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSource}>{item.subtitle}</Text>

            <Text style={styles.progressLabel}>
              进度：{item.reviewCount}/{item.maxReviewCount}
            </Text>

            <View style={styles.progressRow}>
              <ProgressDots
                total={item.maxReviewCount}
                current={item.reviewCount}
                completed={item.reviewCount}
              />
              <StatusPill label={item.statusLabel} tone={mapStatusToTone(item.displayStatus)} />
            </View>
          </View>
        </View>
      </CardContainer>
    </Pressable>
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const [searchText, setSearchText] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<LibraryFilterValue>('all');
  const [items, setItems] = useState<MistakeListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);

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

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(searchText.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const filter: MistakeListFilter = {
      segment: mapSegmentValueToFilterSegment(selectedFilter),
      keyword: debouncedKeyword,
    };

    const mode: 'initial' | 'refresh' = hasLoadedRef.current ? 'refresh' : 'initial';
    hasLoadedRef.current = true;
    void loadList(filter, mode);
  }, [debouncedKeyword, loadList, selectedFilter]);

  const handleClearSearch = useCallback(() => {
    setSearchText('');
    setDebouncedKeyword('');
  }, []);

  const handleRetry = useCallback(() => {
    const filter: MistakeListFilter = {
      segment: mapSegmentValueToFilterSegment(selectedFilter),
      keyword: debouncedKeyword,
    };
    void loadList(filter, 'refresh');
  }, [debouncedKeyword, loadList, selectedFilter]);

  const listEmpty = useMemo(() => {
    if (isLoading) {
      return (
        <View style={styles.stateWrap}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
          <Text style={styles.stateText}>正在加载题库...</Text>
        </View>
      );
    }

    if (errorMessage) {
      return (
        <View style={styles.stateWrap}>
          <Text style={styles.stateErrorText}>题库读取失败：{errorMessage}</Text>
          <Pressable onPress={handleRetry} style={styles.retryButton}>
            <Text style={styles.retryText}>点击重试</Text>
          </Pressable>
        </View>
      );
    }

    if (debouncedKeyword.length > 0) {
      return (
        <View style={styles.stateWrap}>
          <Text style={styles.stateText}>没有找到相关错题</Text>
        </View>
      );
    }

    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateText}>题库还没有错题，先去新增页录入一题。</Text>
      </View>
    );
  }, [debouncedKeyword.length, errorMessage, handleRetry, isLoading]);

  return (
    <ScreenContainer withPadding={false}>
      <FlatList<MistakeListItem>
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MistakeLibraryCard item={item} onPress={() => router.push(`/mistake/${item.id}` as never)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.listItemSeparator} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        refreshing={isRefreshing}
        onRefresh={handleRetry}
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

            <SegmentControl
              options={libraryMock.filters}
              value={selectedFilter}
              onChange={(next) => setSelectedFilter(next as LibraryFilterValue)}
            />

            <View style={styles.metaRow}>
              <Text style={styles.countText}>当前共 {items.length} 题</Text>
              {isRefreshing ? <Text style={styles.refreshText}>刷新中...</Text> : null}
            </View>
          </View>
        }
        ListEmptyComponent={listEmpty}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    minHeight: 60,
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
    marginTop: spacing.lg,
    marginHorizontal: spacing.screenPadding,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 132,
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
  cardPressable: {
    marginHorizontal: spacing.screenPadding,
    borderRadius: radius.xl,
  },
  card: {
    borderRadius: radius.xl,
  },
  cardRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  cardMain: {
    flex: 1,
    gap: spacing.xs,
  },
  cardTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardMeta: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  arrow: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 24,
    lineHeight: 24,
  },
  cardTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  cardSource: {
    ...typography.body,
    color: colors.textSecondary,
  },
  progressLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  progressRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  thumb: {
    width: 112,
    height: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbImage: {
    width: 112,
    height: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  thumbAxisX: {
    position: 'absolute',
    width: 76,
    height: 1.5,
    backgroundColor: '#8E949D',
  },
  thumbAxisY: {
    position: 'absolute',
    width: 1.5,
    height: 76,
    backgroundColor: '#8E949D',
  },
  thumbCurve: {
    width: 54,
    height: 40,
    borderWidth: 1.5,
    borderColor: '#8E949D',
    borderRadius: radius.pill,
    transform: [{ rotate: '-18deg' }],
  },
});
