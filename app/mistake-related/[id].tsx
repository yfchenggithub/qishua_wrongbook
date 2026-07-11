import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { RelatedMistakeCard, ScreenContainer, SegmentControl } from '@/src/components';
import type { RelatedMistakeItem, RelatedMistakeSourceInfo } from '@/src/models/RelatedMistake';
import { Logger } from '@/src/services/Logger';
import * as MistakeRelationService from '@/src/services/MistakeRelationService';
import type {
  RelatedMistakeFilter,
  RelatedMistakeListResult,
} from '@/src/services/MistakeRelationService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'RelatedMistakesScreen';

type RelatedTab = 'all' | 'system' | 'manual';

const FILTER_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '系统推荐', value: 'system' },
  { label: '手动添加', value: 'manual' },
] as const;

function normalizeRouteParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFilter(tab: RelatedTab): RelatedMistakeFilter {
  return tab;
}

export default function RelatedMistakesScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const mistakeId = useMemo(() => normalizeRouteParam(id), [id]);
  const [selectedTab, setSelectedTab] = useState<RelatedTab>('all');
  const [sourceMistake, setSourceMistake] = useState<RelatedMistakeSourceInfo | null>(null);
  const [items, setItems] = useState<RelatedMistakeItem[]>([]);
  const [summary, setSummary] = useState({ total: 0, system: 0, manual: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [removingRelationId, setRemovingRelationId] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadRelatedMistakes = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!mistakeId) {
        setIsLoading(false);
        setIsRefreshing(false);
        setErrorMessage('错题 id 无效，请返回重试。');
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (mode === 'initial') {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setErrorMessage(null);

      let result: RelatedMistakeListResult;
      try {
        result = await MistakeRelationService.getRelatedMistakes(
          mistakeId,
          toFilter(selectedTab),
        );
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
        Logger.error(PAGE_SCOPE, 'Failed to load related mistakes.', {
          mistakeId,
          selectedTab,
          errorMessage: result.errorMessage ?? null,
        });
        setItems([]);
        setErrorMessage(result.errorMessage ?? '读取相关错题失败，请稍后重试。');
        return;
      }

      setSourceMistake(result.sourceMistake ?? null);
      setSummary(result.summary ?? { total: 0, system: 0, manual: 0 });
      setItems(result.items ?? []);
    },
    [mistakeId, selectedTab],
  );

  useFocusEffect(
    useCallback(() => {
      void loadRelatedMistakes('initial');
    }, [loadRelatedMistakes]),
  );

  const handleBack = useCallback(() => {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/library' as never);
  }, [router]);

  const handleOpenAdd = useCallback(() => {
    if (!mistakeId) {
      return;
    }
    router.push(
      {
        pathname: '/mistake-related/add',
        params: {
          id: mistakeId,
          mode: selectedTab === 'manual' ? 'manual' : 'system',
        },
      } as never,
    );
  }, [mistakeId, router, selectedTab]);

  const handleOpenDetail = useCallback(
    (item: RelatedMistakeItem) => {
      if (!mistakeId) {
        return;
      }
      router.push(
        {
          pathname: '/mistake/[id]',
          params: {
            id: item.id,
            relatedFromId: mistakeId,
            relatedFromTitle: sourceMistake?.title ?? '',
          },
        } as never,
      );
    },
    [mistakeId, router, sourceMistake?.title],
  );

  const handleRemoveRelation = useCallback(
    (item: RelatedMistakeItem) => {
      const relationId = item.relationId?.trim();
      if (!relationId || removingRelationId !== null) {
        return;
      }

      Alert.alert(
        '移除相关错题',
        `确定从相关错题中移除“${item.title}”吗？`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '移除',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setRemovingRelationId(relationId);
                try {
                  const result = await MistakeRelationService.removeRelatedMistake(relationId);
                  if (!result.ok) {
                    Alert.alert('移除失败', result.errorMessage ?? '移除相关错题失败，请稍后重试。');
                    return;
                  }
                  await loadRelatedMistakes('refresh');
                } finally {
                  setRemovingRelationId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [loadRelatedMistakes, removingRelationId],
  );

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
          相关错题
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="添加相关错题"
          onPress={handleOpenAdd}
          style={({ pressed }) => [styles.addTopButton, pressed ? styles.addTopButtonPressed : null]}>
          <Text style={styles.addTopButtonText}>添加</Text>
        </Pressable>
      </View>

      <Text numberOfLines={1} style={styles.sourceText}>
        来源于：<Text style={styles.sourceStrong}>{sourceMistake?.title ?? '当前错题'}</Text>
      </Text>

      <SegmentControl
        options={FILTER_OPTIONS.map((option) => ({ ...option }))}
        value={selectedTab}
        onChange={(value) => setSelectedTab(value as RelatedTab)}
        style={styles.segment}
      />

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>共 {summary.total} 题</Text>
        <Text style={styles.summaryText}>系统推荐 {summary.system} 题</Text>
        <Text style={styles.summaryText}>手动添加 {summary.manual} 题</Text>
      </View>
    </View>
  );

  const empty = useMemo(() => {
    if (isLoading) {
      return (
        <View style={styles.stateCard}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
          <Text style={styles.stateText}>正在加载相关错题...</Text>
        </View>
      );
    }

    if (errorMessage) {
      return (
        <View style={styles.stateCard}>
          <Text style={styles.stateErrorText}>{errorMessage}</Text>
          <Pressable
            onPress={() => void loadRelatedMistakes('refresh')}
            style={styles.retryButton}>
            <Text style={styles.retryButtonText}>重试</Text>
          </Pressable>
        </View>
      );
    }

    const message =
      selectedTab === 'system'
        ? '还没有从系统推荐加入相关错题'
        : selectedTab === 'manual'
          ? '还没有手动添加相关错题'
          : '还没有相关错题';

    return (
      <View style={styles.stateCard}>
        <Text style={styles.stateText}>{message}</Text>
        <Pressable onPress={handleOpenAdd} style={styles.emptyAddButton}>
          <MaterialIcons name="add" size={18} color={colors.success} />
          <Text style={styles.emptyAddButtonText}>添加相关错题</Text>
        </Pressable>
      </View>
    );
  }, [errorMessage, handleOpenAdd, isLoading, loadRelatedMistakes, selectedTab]);

  return (
    <ScreenContainer withPadding={false} safeAreaEdges={['top', 'bottom']}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.itemWrap}>
            <RelatedMistakeCard
              item={item}
              actionLabel="移除"
              actionTone="remove"
              busy={removingRelationId === item.relationId}
              disabled={removingRelationId !== null}
              onPress={() => handleOpenDetail(item)}
              onAction={() => handleRemoveRelation(item)}
            />
          </View>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadRelatedMistakes('refresh')}
            tintColor={colors.textPrimary}
            colors={[colors.textPrimary]}
          />
        }
        contentContainerStyle={styles.listContent}
      />
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="添加相关错题"
          onPress={handleOpenAdd}
          style={({ pressed }) => [styles.footerButton, pressed ? styles.footerButtonPressed : null]}>
          <MaterialIcons name="add" size={22} color={colors.white} />
          <Text style={styles.footerButtonText}>添加相关错题</Text>
        </Pressable>
      </View>
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
  addTopButton: {
    minWidth: 40,
    minHeight: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTopButtonPressed: {
    backgroundColor: colors.successBg,
  },
  addTopButtonText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '900',
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
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: layout.bottomTabHeight + spacing.xxl,
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
  emptyAddButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.md,
  },
  emptyAddButtonText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '900',
  },
  footer: {
    position: 'absolute',
    left: spacing.screenPadding,
    right: spacing.screenPadding,
    bottom: spacing.lg,
  },
  footerButton: {
    minHeight: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    shadowColor: colors.success,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  footerButtonPressed: {
    opacity: 0.86,
  },
  footerButtonText: {
    ...typography.sectionTitle,
    color: colors.white,
    fontWeight: '900',
  },
});
