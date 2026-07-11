import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { RelatedMistakeCard, ScreenContainer, SegmentControl } from '@/src/components';
import type { RelatedMistakeItem, RelatedMistakeSourceInfo } from '@/src/models/RelatedMistake';
import { Logger } from '@/src/services/Logger';
import * as MistakeRelationService from '@/src/services/MistakeRelationService';
import type { RelatedMistakeCandidateResult } from '@/src/services/MistakeRelationService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'AddRelatedMistakeScreen';
const SEARCH_DEBOUNCE_MS = 300;

type AddMode = 'system' | 'manual';

const MODE_OPTIONS = [
  { label: '系统推荐', value: 'system' },
  { label: '搜索添加', value: 'manual' },
] as const;

function normalizeRouteParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMode(value: string | string[] | undefined): AddMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'manual' ? 'manual' : 'system';
}

export default function AddRelatedMistakeScreen() {
  const router = useRouter();
  const { id, mode } = useLocalSearchParams<{
    id?: string | string[];
    mode?: string | string[];
  }>();
  const mistakeId = useMemo(() => normalizeRouteParam(id), [id]);
  const initialMode = useMemo(() => normalizeMode(mode), [mode]);
  const [selectedMode, setSelectedMode] = useState<AddMode>(initialMode);
  const [sourceMistake, setSourceMistake] = useState<RelatedMistakeSourceInfo | null>(null);
  const [systemItems, setSystemItems] = useState<RelatedMistakeItem[]>([]);
  const [searchItems, setSearchItems] = useState<RelatedMistakeItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addingMistakeId, setAddingMistakeId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const requestIdRef = useRef(0);

  useEffect(() => {
    setSelectedMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchText]);

  const loadCandidates = useCallback(
    async (modeToLoad: AddMode, loadMode: 'initial' | 'refresh' = 'initial') => {
      if (!mistakeId) {
        setIsLoading(false);
        setIsRefreshing(false);
        setErrorMessage('错题 id 无效，请返回重试。');
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (loadMode === 'initial') {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setErrorMessage(null);

      let result: RelatedMistakeCandidateResult;
      try {
        result =
          modeToLoad === 'system'
            ? await MistakeRelationService.getSuggestedRelatedMistakes(mistakeId)
            : await MistakeRelationService.searchMistakesForManualRelation({
                mistakeId,
                keyword: debouncedSearchText,
              });
      } catch (error) {
        result = {
          ok: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      setIsLoading(false);
      setIsRefreshing(false);

      if (!result.ok) {
        Logger.error(PAGE_SCOPE, 'Failed to load add related candidates.', {
          mistakeId,
          selectedMode: modeToLoad,
          errorMessage: result.errorMessage ?? null,
        });
        if (modeToLoad === 'system') {
          setSystemItems([]);
        } else {
          setSearchItems([]);
        }
        setErrorMessage(result.errorMessage ?? '读取可添加错题失败，请稍后重试。');
        return;
      }

      setSourceMistake(result.sourceMistake ?? null);
      const nextItems = (result.items ?? []).filter((item) => !addedIds.has(item.id));
      if (modeToLoad === 'system') {
        setSystemItems(nextItems);
      } else {
        setSearchItems(nextItems);
      }
    },
    [addedIds, debouncedSearchText, mistakeId],
  );

  useFocusEffect(
    useCallback(() => {
      void loadCandidates(selectedMode, 'initial');
    }, [loadCandidates, selectedMode]),
  );

  useEffect(() => {
    if (selectedMode !== 'manual') {
      return;
    }
    void loadCandidates('manual', 'refresh');
  }, [debouncedSearchText, loadCandidates, selectedMode]);

  const handleBack = useCallback(() => {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
    if (mistakeId) {
      router.replace(`/mistake-related/${mistakeId}` as never);
      return;
    }
    router.replace('/(tabs)/library' as never);
  }, [mistakeId, router]);

  const handleAdd = useCallback(
    async (item: RelatedMistakeItem) => {
      if (!mistakeId || addingMistakeId !== null || addedIds.has(item.id)) {
        return;
      }

      setAddingMistakeId(item.id);
      try {
        const result = await MistakeRelationService.addRelatedMistake({
          sourceMistakeId: mistakeId,
          targetMistakeId: item.id,
          source: selectedMode === 'system' ? 'system' : 'manual',
        });

        if (!result.ok) {
          setErrorMessage(result.errorMessage ?? '添加相关错题失败，请稍后重试。');
          return;
        }

        setAddedIds((current) => {
          const next = new Set(current);
          next.add(item.id);
          return next;
        });
        if (selectedMode === 'system') {
          setSystemItems((current) => current.filter((candidate) => candidate.id !== item.id));
        } else {
          setSearchItems((current) => current.filter((candidate) => candidate.id !== item.id));
        }
      } finally {
        setAddingMistakeId(null);
      }
    },
    [addedIds, addingMistakeId, mistakeId, selectedMode],
  );

  const visibleItems = selectedMode === 'system' ? systemItems : searchItems;

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={handleBack}
          style={({ pressed }) => [styles.iconButton, pressed ? styles.iconButtonPressed : null]}>
          <MaterialIcons name="arrow-back" size={23} color={colors.textPrimary} />
        </Pressable>
        <Text numberOfLines={1} style={styles.screenTitle}>
          添加相关错题
        </Text>
        <View style={styles.iconButton} />
      </View>

      <Text numberOfLines={1} style={styles.sourceText}>
        来源于：<Text style={styles.sourceStrong}>{sourceMistake?.title ?? '当前错题'}</Text>
      </Text>

      <SegmentControl
        options={MODE_OPTIONS.map((option) => ({ ...option }))}
        value={selectedMode}
        onChange={(value) => {
          setSelectedMode(value as AddMode);
          setErrorMessage(null);
        }}
        style={styles.segment}
      />

      {selectedMode === 'system' ? (
        <View style={styles.ruleBox}>
          <MaterialIcons name="auto-awesome" size={18} color={colors.success} />
          <Text style={styles.ruleText}>
            推荐规则：按同模块、同错因、难度接近从本地错题中推荐。
          </Text>
        </View>
      ) : (
        <View style={styles.searchWrap}>
          <MaterialIcons name="search" size={22} color={colors.textMuted} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="搜索题目名称、模块、错因或备注"
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            style={styles.searchInput}
            onSubmitEditing={() => setDebouncedSearchText(searchText.trim())}
          />
          {searchText.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清空搜索"
              onPress={() => {
                setSearchText('');
                setDebouncedSearchText('');
              }}
              style={styles.clearButton}>
              <MaterialIcons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );

  const empty = useMemo(() => {
    if (isLoading) {
      return (
        <View style={styles.stateCard}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
          <Text style={styles.stateText}>正在加载可添加错题...</Text>
        </View>
      );
    }

    if (errorMessage) {
      return (
        <View style={styles.stateCard}>
          <Text style={styles.stateErrorText}>{errorMessage}</Text>
          <Pressable
            onPress={() => void loadCandidates(selectedMode, 'refresh')}
            style={styles.retryButton}>
            <Text style={styles.retryButtonText}>重试</Text>
          </Pressable>
        </View>
      );
    }

    const message =
      selectedMode === 'system'
        ? '暂时没有新的系统推荐'
        : debouncedSearchText.length > 0
          ? '没有找到可添加的错题'
          : '输入关键词，或从最近错题中选择';

    return (
      <View style={styles.stateCard}>
        <Text style={styles.stateText}>{message}</Text>
      </View>
    );
  }, [debouncedSearchText.length, errorMessage, isLoading, loadCandidates, selectedMode]);

  return (
    <ScreenContainer withPadding={false} safeAreaEdges={['top', 'bottom']}>
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isAdded = addedIds.has(item.id);
          return (
            <View style={styles.itemWrap}>
              <RelatedMistakeCard
                item={item}
                actionLabel={isAdded ? '已添加' : '添加'}
                actionTone="add"
                busy={addingMistakeId === item.id}
                disabled={addingMistakeId !== null || isAdded}
                onAction={() => {
                  void handleAdd(item);
                }}
              />
            </View>
          );
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadCandidates(selectedMode, 'refresh')}
            tintColor={colors.textPrimary}
            colors={[colors.textPrimary]}
          />
        }
        contentContainerStyle={styles.listContent}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  topBar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  screenTitle: {
    ...typography.sectionTitle,
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '900',
    textAlign: 'center',
  },
  sourceText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  sourceStrong: {
    color: colors.success,
    fontWeight: '900',
  },
  segment: {
    borderRadius: radius.pill,
  },
  ruleBox: {
    minHeight: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.successBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  ruleText: {
    ...typography.caption,
    flex: 1,
    color: colors.success,
    fontWeight: '700',
  },
  searchWrap: {
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    ...typography.bodySmall,
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: layout.bottomTabHeight,
  },
  itemWrap: {
    paddingHorizontal: spacing.screenPadding,
  },
  separator: {
    height: spacing.md,
  },
  stateCard: {
    marginTop: spacing.md,
    marginHorizontal: spacing.screenPadding,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
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
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '800',
  },
});
