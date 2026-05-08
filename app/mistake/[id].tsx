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
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const BRAND = {
  title: '七刷错题本',
  subtitle: '详情来自本地 SQLite',
} as const;

type DetailPageState =
  | { kind: 'loading' }
  | { kind: 'success'; detail: MistakeDetailViewModel }
  | { kind: 'notFound'; message: string }
  | { kind: 'error'; message: string };

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
    return `标记第 ${Math.min(detail.maxReviewCount, detail.reviewCount + 1)} 刷完成`;
  }
  return '标记本次复做完成';
}

function StateCard({
  title,
  message,
  onBack,
  onRetry,
}: {
  title: string;
  message: string;
  onBack: () => void;
  onRetry?: () => void;
}) {
  return (
    <CardContainer style={styles.stateCard} padding={spacing.lg}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>

      <View style={styles.stateActions}>
        <Pressable style={styles.stateSecondaryButton} onPress={onBack}>
          <Text style={styles.stateSecondaryButtonText}>返回</Text>
        </Pressable>
        {onRetry ? (
          <Pressable style={styles.statePrimaryButton} onPress={onRetry}>
            <Text style={styles.statePrimaryButtonText}>重试</Text>
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
  const requestIdRef = useRef(0);

  const loadDetail = useCallback(async () => {
    if (!routeId) {
      setState({
        kind: 'error',
        message: '错题 id 无效，请返回重试。',
      });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState({ kind: 'loading' });

    const result = await MistakeDetailService.getMistakeDetail(routeId);
    if (requestId !== requestIdRef.current) {
      return;
    }

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
        message: result.errorMessage ?? '未找到对应错题。',
      });
      return;
    }

    setState({
      kind: 'error',
      message: result.errorMessage ?? '读取错题详情失败，请稍后重试。',
    });
  }, [routeId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  return (
    <ScreenContainer scroll contentStyle={styles.screenContent}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backText}>← 返回今日任务</Text>
      </Pressable>

      <BrandHeader title={BRAND.title} subtitle={BRAND.subtitle} />

      {state.kind === 'loading' ? (
        <CardContainer style={styles.loadingCard} padding={spacing.lg}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
          <Text style={styles.loadingText}>正在读取错题详情...</Text>
        </CardContainer>
      ) : null}

      {state.kind === 'error' ? (
        <StateCard
          title="加载失败"
          message={state.message}
          onBack={() => router.back()}
          onRetry={routeId ? () => void loadDetail() : undefined}
        />
      ) : null}

      {state.kind === 'notFound' ? (
        <StateCard
          title="未找到错题"
          message={state.message}
          onBack={() => router.back()}
          onRetry={routeId ? () => void loadDetail() : undefined}
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
              <Pressable onPress={() => void loadDetail()} style={styles.refreshButton}>
                <Text style={styles.refreshButtonText}>刷新</Text>
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
