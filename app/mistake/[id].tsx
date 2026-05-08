import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import type { DetailReviewRecordItem, MistakeDetailViewModel } from '@/src/models/MistakeDetailViewModel';
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

function buildReviewButtonTitle(detail: MistakeDetailViewModel): string {
  if (detail.status === 'mastered') {
    return '已完成七刷';
  }
  if (detail.status === 'archived') {
    return '已归档';
  }

  const nextReview = Math.min(detail.maxReviewCount, detail.reviewCount + 1);
  return `开始第 ${nextReview} 刷`;
}

function isReviewButtonDisabled(detail: MistakeDetailViewModel): boolean {
  if (detail.status !== 'active') {
    return true;
  }
  return detail.reviewCount >= detail.maxReviewCount;
}

function formatReviewResultLabel(result: DetailReviewRecordItem['result']): string {
  if (result === 'still_wrong') {
    return '仍然错';
  }
  if (result === 'too_easy') {
    return '过于简单';
  }
  return '完成';
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatReviewCreatedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }

  const year = parsed.getFullYear();
  const month = pad2(parsed.getMonth() + 1);
  const day = pad2(parsed.getDate());
  const hour = pad2(parsed.getHours());
  const minute = pad2(parsed.getMinutes());
  const second = pad2(parsed.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function ReviewRecordCard({ record }: { record: DetailReviewRecordItem }) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = !!record.solutionImageUri;
  const canShowImage = hasImage && !imageFailed;

  return (
    <View style={styles.reviewRecordRow}>
      <View style={styles.reviewRecordMain}>
        <Text style={styles.reviewRecordTitle}>第 {record.reviewIndex} 刷</Text>
        <Text style={styles.reviewRecordMeta}>时间：{formatReviewCreatedAt(record.createdAt)}</Text>
        <Text style={styles.reviewRecordMeta}>结果：{formatReviewResultLabel(record.result)}</Text>
      </View>

      {canShowImage ? (
        <Image
          source={{ uri: record.solutionImageUri! }}
          style={styles.reviewRecordImage}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      ) : hasImage ? (
        <View style={styles.reviewRecordBadge}>
          <Text style={styles.reviewRecordBadgeText}>已保存照片</Text>
        </View>
      ) : null}
    </View>
  );
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
  const hasFocusedRef = useRef(false);

  const handleBack = useCallback(() => {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/library' as never);
  }, [router]);

  const handleStartReview = useCallback((detail: MistakeDetailViewModel) => {
    if (detail.status !== 'active') {
      return;
    }
    if (detail.reviewCount >= detail.maxReviewCount) {
      return;
    }
    router.push(`/review/${detail.id}` as never);
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

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return undefined;
      }

      void loadDetail({ keepCurrent: true });
      return undefined;
    }, [loadDetail]),
  );

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

          <CardContainer style={styles.reviewRecordsCard} padding={spacing.lg}>
            <SectionTitle title="复做记录" />
            {state.detail.reviewRecords.length <= 0 ? (
              <Text style={styles.reviewRecordsEmptyText}>还没有复做记录</Text>
            ) : (
              <View style={styles.reviewRecordsList}>
                {state.detail.reviewRecords.map((record) => (
                  <ReviewRecordCard key={record.id} record={record} />
                ))}
              </View>
            )}
          </CardContainer>

          <PrimaryButton
            title={buildReviewButtonTitle(state.detail)}
            disabled={isReviewButtonDisabled(state.detail)}
            onPress={() => handleStartReview(state.detail)}
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
  reviewRecordsCard: {
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  reviewRecordsEmptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  reviewRecordsList: {
    gap: spacing.sm,
  },
  reviewRecordRow: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  reviewRecordMain: {
    flex: 1,
    gap: spacing.xs,
  },
  reviewRecordTitle: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  reviewRecordMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  reviewRecordImage: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reviewRecordBadge: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  reviewRecordBadgeText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
});
