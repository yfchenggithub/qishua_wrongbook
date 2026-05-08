import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  BrandHeader,
  CardContainer,
  DetailImageCard,
  PrimaryButton,
  ProgressDots,
  ScreenContainer,
  SectionTitle,
  StatusPill,
} from '@/src/components';
import type { MistakeDetailViewModel } from '@/src/models/MistakeDetailViewModel';
import { Logger } from '@/src/services/Logger';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const BRAND = {
  title: '七刷错题本',
  subtitle: '详情来自本地 SQLite',
} as const;
const PAGE_SCOPE = 'MistakeDetailScreen';

type DetailPageState =
  | { kind: 'loading' }
  | { kind: 'success'; detail: MistakeDetailViewModel }
  | { kind: 'notFound'; message: string }
  | { kind: 'error'; message: string };

function toBriefErrorMessage(message?: string): string {
  const fallback = '读取错题失败，请稍后重试。';
  const normalized = typeof message === 'string' ? message.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= 48) {
    return normalized;
  }
  return `${normalized.slice(0, 48)}...`;
}

function normalizeRouteId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapStatusToTone(status: MistakeDetailViewModel['status']): 'dark' | 'light' | 'success' {
  if (status === 'mastered') {
    return 'success';
  }
  if (status === 'archived') {
    return 'light';
  }
  return 'dark';
}

function buildCurrentReviewIndex(detail: MistakeDetailViewModel): number | undefined {
  if (detail.reviewCount >= detail.maxReviewCount) {
    return undefined;
  }
  return Math.min(detail.maxReviewCount, detail.reviewCount + 1);
}

function buildPlaceholderButtonTitle(detail: MistakeDetailViewModel): string {
  if (detail.status === 'active') {
    const nextReview = Math.min(detail.maxReviewCount, detail.reviewCount + 1);
    if (detail.reviewCount <= 0) {
      return `开始第 ${nextReview} 刷`;
    }
    return `标记第 ${nextReview} 刷完成`;
  }
  if (detail.status === 'mastered') {
    return '已完成七刷';
  }
  return '已归档';
}

function StateCard({
  title,
  message,
  detailText,
  onBack,
  onRetry,
  retryText = '重试',
}: {
  title: string;
  message: string;
  detailText?: string;
  onBack: () => void;
  onRetry?: () => void;
  retryText?: string;
}) {
  return (
    <CardContainer style={styles.stateCard} padding={spacing.lg}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {detailText ? <Text style={styles.stateDetailText}>{detailText}</Text> : null}

      <View style={styles.stateActions}>
        <Pressable style={styles.stateSecondaryButton} onPress={onBack}>
          <Text style={styles.stateSecondaryButtonText}>返回</Text>
        </Pressable>
        {onRetry ? (
          <Pressable style={styles.statePrimaryButton} onPress={onRetry}>
            <Text style={styles.statePrimaryButtonText}>{retryText}</Text>
          </Pressable>
        ) : null}
      </View>
    </CardContainer>
  );
}

export default function MistakeDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = useMemo(() => normalizeRouteId(id), [id]);

  const [state, setState] = useState<DetailPageState>({ kind: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestIdRef = useRef(0);

  const handleBack = useCallback(() => {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/library' as never);
  }, [router]);

  const loadDetail = useCallback(async (options?: { keepCurrent?: boolean }) => {
    const keepCurrent = options?.keepCurrent ?? false;

    if (!routeId) {
      Logger.error(PAGE_SCOPE, 'Invalid route id while loading detail.', { id });
      setIsRefreshing(false);
      setState({
        kind: 'error',
        message: '错题 id 无效，请返回重试。',
      });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (keepCurrent) {
      setIsRefreshing(true);
    } else {
      setIsRefreshing(false);
      setState({ kind: 'loading' });
    }

    let result: Awaited<ReturnType<typeof MistakeDetailService.getMistakeDetail>>;
    try {
      result = await MistakeDetailService.getMistakeDetail(routeId);
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setIsRefreshing(false);
      Logger.error(PAGE_SCOPE, 'Unexpected error while loading detail.', {
        id: routeId,
        error,
      });
      setState({
        kind: 'error',
        message: toBriefErrorMessage(error instanceof Error ? error.message : String(error)),
      });
      return;
    }

    if (requestId !== requestIdRef.current) {
      return;
    }

    setIsRefreshing(false);

    if (result.ok && result.detail) {
      setState({
        kind: 'success',
        detail: result.detail,
      });
      return;
    }

    if (result.notFound) {
      setState({
        kind: 'notFound',
        message: '没有找到这道错题',
      });
      return;
    }

    Logger.error(PAGE_SCOPE, 'Failed to load mistake detail.', {
      id: routeId,
      errorMessage: result.errorMessage,
    });

    setState({
      kind: 'error',
      message: toBriefErrorMessage(result.errorMessage),
    });
  }, [id, routeId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  return (
    <ScreenContainer scroll contentStyle={styles.screenContent}>
      <Pressable style={styles.backButton} onPress={handleBack}>
        <Text style={styles.backText}>← 返回今日任务</Text>
      </Pressable>

      <BrandHeader title={BRAND.title} subtitle={BRAND.subtitle} />

      {state.kind === 'loading' ? (
        <CardContainer style={styles.loadingCard} padding={spacing.lg}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
          <Text style={styles.loadingText}>正在加载错题...</Text>
        </CardContainer>
      ) : null}

      {state.kind === 'error' ? (
        <StateCard
          title="读取错题失败"
          message={state.message}
          detailText={routeId ? `错题 ID：${routeId}` : undefined}
          onBack={handleBack}
          onRetry={routeId ? () => void loadDetail() : undefined}
        />
      ) : null}

      {state.kind === 'notFound' ? (
        <StateCard
          title="没有找到这道错题"
          message={state.message}
          detailText={routeId ? `错题 ID：${routeId}` : undefined}
          onBack={handleBack}
          onRetry={routeId ? () => void loadDetail() : undefined}
          retryText="刷新"
        />
      ) : null}

      {state.kind === 'success' ? (
        <>
          <CardContainer style={styles.summaryCard} padding={spacing.xl}>
            <Text style={styles.summaryMeta}>{state.detail.module}</Text>
            <Text style={styles.summaryTitle}>{state.detail.title}</Text>
            <Text style={styles.summarySubtitle}>{state.detail.subtitle}</Text>

            <View style={styles.summaryBottomRow}>
              <View style={styles.progressLabelWrap}>
                <Text style={styles.progressNumber}>{state.detail.reviewCount}</Text>
                <Text style={styles.progressText}>/{state.detail.maxReviewCount}</Text>
              </View>

              <ProgressDots
                total={state.detail.maxReviewCount}
                current={buildCurrentReviewIndex(state.detail)}
                completed={state.detail.reviewCount}
                style={styles.summaryDots}
              />

              <StatusPill label={state.detail.statusLabel} tone={mapStatusToTone(state.detail.status)} />
            </View>

            <View style={styles.summaryInfoList}>
              <Text style={styles.summaryInfoText}>难度：{state.detail.difficulty}</Text>
              {state.detail.errorReason ? (
                <Text style={styles.summaryInfoText}>错因：{state.detail.errorReason}</Text>
              ) : null}
              {state.detail.note ? <Text style={styles.summaryInfoText}>备注：{state.detail.note}</Text> : null}
            </View>
          </CardContainer>

          <CardContainer style={styles.imagesSectionCard} padding={spacing.lg}>
            <View style={styles.imagesHeaderRow}>
              <SectionTitle title="题目 / 做法 / 答案" />
              <Pressable onPress={() => void loadDetail({ keepCurrent: true })} style={styles.refreshButton}>
                <Text style={styles.refreshButtonText}>{isRefreshing ? '刷新中...' : '刷新'}</Text>
              </Pressable>
            </View>

            <View style={styles.slotList}>
              {state.detail.imageSlots
                .filter((slot) => slot.type !== 'review_solution')
                .map((slot) => (
                  <DetailImageCard
                    key={slot.type}
                    title={slot.title}
                    uri={slot.uri}
                    exists={slot.exists}
                    fileSize={slot.fileSize}
                    emptyText={slot.emptyText}
                  />
                ))}
            </View>
          </CardContainer>

          <PrimaryButton
            title={buildPlaceholderButtonTitle(state.detail)}
            disabled={state.detail.status !== 'active'}
            onPress={() => Alert.alert('占位提示', '第 8 步接入复做流程')}
          />
        </>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  backText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  loadingCard: {
    borderRadius: radius.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  stateCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  stateTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
  },
  stateMessage: {
    ...typography.body,
    color: colors.textSecondary,
  },
  stateDetailText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  stateActions: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statePrimaryButton: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.black,
    backgroundColor: colors.black,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statePrimaryButtonText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  stateSecondaryButton: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stateSecondaryButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  summaryCard: {
    borderRadius: radius.xl,
  },
  summaryMeta: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  summaryTitle: {
    ...typography.titleMedium,
    marginTop: spacing.xs,
    fontSize: 32,
    lineHeight: 40,
  },
  summarySubtitle: {
    ...typography.body,
    marginTop: spacing.sm,
  },
  summaryBottomRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  progressLabelWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  progressNumber: {
    ...typography.titleMedium,
    fontSize: 42,
    lineHeight: 46,
  },
  progressText: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 18,
    lineHeight: 24,
  },
  summaryDots: {
    flex: 1,
    justifyContent: 'center',
  },
  summaryInfoList: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  summaryInfoText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  imagesSectionCard: {
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  imagesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  refreshButton: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  refreshButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  slotList: {
    gap: spacing.sm,
  },
});
