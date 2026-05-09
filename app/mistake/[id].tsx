import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  ImagePreviewModal,
  PrimaryButton,
  ProgressDots,
  ScreenContainer,
  SectionTitle,
  StatusPill,
} from '@/src/components';
import type { DetailImageSlotType, DetailReviewRecordItem, MistakeDetailViewModel } from '@/src/models/MistakeDetailViewModel';
import * as ImageService from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const BRAND = {
  title: '七刷错题本',
  subtitle: '详情来自本地离线数据',
} as const;
const PAGE_SCOPE = 'MistakeDetailScreen';

type DetailPageState =
  | { kind: 'loading' }
  | { kind: 'success'; detail: MistakeDetailViewModel }
  | { kind: 'notFound'; message: string }
  | { kind: 'error'; message: string };

type SupplementTarget = 'my_solution' | 'answer';
type SupplementSource = 'camera' | 'library';
type PreviewImageState = {
  uri: string;
  title: string;
};

const DOUBLE_TAP_DELAY = 300;

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

function isCancelLikeMessage(message?: string): boolean {
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase();
  return normalized.includes('cancel') || normalized.includes('取消');
}

function isSupplementTarget(type: DetailImageSlotType): type is SupplementTarget {
  return type === 'my_solution' || type === 'answer';
}

function getSupplementDialogTitle(target: SupplementTarget): string {
  return target === 'my_solution' ? '补充我的做法' : '补充答案解析';
}

function getEmptyTitle(target: SupplementTarget): string {
  return target === 'my_solution' ? '我的做法：还没有添加' : '答案解析：还没有添加';
}

function getEmptyDescription(target: SupplementTarget): string {
  return target === 'my_solution'
    ? '建议补充自己的解法，复做时更容易对比。'
    : '建议补充答案或解析，复盘时更清楚。';
}

function getEmptyActionText(target: SupplementTarget): string {
  return target === 'my_solution' ? '补充做法' : '补充答案';
}

function normalizePreviewUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }

  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getSlotPreviewTitle(type: DetailImageSlotType): string {
  if (type === 'question') {
    return '题目图片';
  }
  if (type === 'my_solution') {
    return '我的做法';
  }
  if (type === 'answer') {
    return '答案解析';
  }
  return '图片预览';
}

function ReviewRecordCard({
  record,
  onPreview,
}: {
  record: DetailReviewRecordItem;
  onPreview?: (uri: string, title: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const lastTapRef = useRef(0);
  const normalizedUri = normalizePreviewUri(record.solutionImageUri);
  const hasImage = !!normalizedUri;
  const canShowImage = hasImage && !imageFailed;

  const previewTitle =
    Number.isFinite(record.reviewIndex) && record.reviewIndex > 0
      ? `第 ${record.reviewIndex} 刷记录`
      : '复做记录';

  const handleImagePress = useCallback(() => {
    if (!canShowImage || !normalizedUri || !onPreview) {
      return;
    }

    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      onPreview(normalizedUri, previewTitle);
      lastTapRef.current = 0;
      return;
    }

    lastTapRef.current = now;
  }, [canShowImage, normalizedUri, onPreview, previewTitle]);

  return (
    <View style={styles.reviewRecordRow}>
      <View style={styles.reviewRecordMain}>
        <Text style={styles.reviewRecordTitle}>第 {record.reviewIndex} 刷</Text>
        <Text style={styles.reviewRecordMeta}>时间：{formatReviewCreatedAt(record.createdAt)}</Text>
        <Text style={styles.reviewRecordMeta}>结果：{formatReviewResultLabel(record.result)}</Text>
      </View>

      {canShowImage ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${previewTitle}，双击查看大图`}
          onPress={handleImagePress}
          style={({ pressed }) => [styles.reviewRecordImageWrap, pressed && styles.previewTapPressed]}>
          <Image
            source={{ uri: normalizedUri }}
            style={styles.reviewRecordImage}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        </Pressable>
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
  onBack,
  onRetry,
  retryText = '重试',
}: {
  title: string;
  message: string;
  onBack: () => void;
  onRetry?: () => void;
  retryText?: string;
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
  const [supplementingType, setSupplementingType] = useState<SupplementTarget | null>(null);
  const [previewImage, setPreviewImage] = useState<PreviewImageState | null>(null);
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

  const handleClosePreview = useCallback(() => {
    setPreviewImage(null);
  }, []);

  const handleOpenPreview = useCallback((uri: string | null | undefined, title: string) => {
    const normalizedUri = normalizePreviewUri(uri);
    if (!normalizedUri) {
      return;
    }

    setPreviewImage({
      uri: normalizedUri,
      title,
    });
  }, []);

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
        message: '没有找到这道错题。',
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

  const handlePickAndSaveSupplementImage = useCallback(async (
    target: SupplementTarget,
    source: SupplementSource,
  ) => {
    if (state.kind !== 'success') {
      return;
    }
    if (supplementingType !== null) {
      return;
    }

    const mistakeId = state.detail.id;
    setSupplementingType(target);

    try {
      const saveResult = source === 'camera'
        ? await ImageService.takePhotoAndSave({ mistakeId, type: target })
        : await ImageService.pickImageAndSave({ mistakeId, type: target });

      const imageUri = saveResult.image?.uri?.trim();
      if (!saveResult.ok || !imageUri) {
        if (!isCancelLikeMessage(saveResult.errorMessage)) {
          Alert.alert('提示', saveResult.errorMessage?.trim() || '保存失败，请重试');
        }
        return;
      }

      const persistResult = await MistakeDetailService.saveOptionalDetailImage({
        mistakeId,
        imageType: target,
        imageUri,
      });
      if (!persistResult.ok) {
        Alert.alert('提示', persistResult.errorMessage ?? '保存失败，请重试');
        return;
      }

      await loadDetail({ keepCurrent: true });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to supplement detail image.', {
        id: mistakeId,
        target,
        source,
        error,
      });
      Alert.alert('提示', '保存失败，请重试');
    } finally {
      setSupplementingType(null);
    }
  }, [loadDetail, state, supplementingType]);

  const handlePressSupplement = useCallback((target: SupplementTarget) => {
    if (supplementingType !== null) {
      return;
    }

    Alert.alert(getSupplementDialogTitle(target), '请选择图片来源', [
      {
        text: '拍照',
        onPress: () => {
          void handlePickAndSaveSupplementImage(target, 'camera');
        },
      },
      {
        text: '从相册选择',
        onPress: () => {
          void handlePickAndSaveSupplementImage(target, 'library');
        },
      },
      {
        text: '取消',
        style: 'cancel',
      },
    ]);
  }, [handlePickAndSaveSupplementImage, supplementingType]);

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
          onBack={handleBack}
          onRetry={routeId ? () => void loadDetail() : undefined}
        />
      ) : null}

      {state.kind === 'notFound' ? (
        <StateCard
          title="没有找到这道错题"
          message={state.message}
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
              <SectionTitle title="题目 / 我的做法 / 答案解析" />
              <Pressable
                onPress={() => void loadDetail({ keepCurrent: true })}
                disabled={isRefreshing || supplementingType !== null}
                style={[
                  styles.refreshButton,
                  (isRefreshing || supplementingType !== null) && styles.refreshButtonDisabled,
                ]}>
                <Text style={styles.refreshButtonText}>{isRefreshing ? '刷新中...' : '刷新'}</Text>
              </Pressable>
            </View>

            <View style={styles.slotList}>
              {state.detail.imageSlots
                .filter((slot) => slot.type !== 'review_solution')
                .map((slot) => {
                  const hasUri = typeof slot.uri === 'string' && slot.uri.trim().length > 0;
                  const supplementTarget = isSupplementTarget(slot.type) ? slot.type : null;

                  return (
                    <DetailImageCard
                      key={slot.type}
                      title={slot.title}
                      uri={slot.uri}
                      exists={slot.exists}
                      fileSize={slot.fileSize}
                      emptyText={slot.emptyText}
                      loadErrorText={slot.type === 'question' ? '题目图片加载失败' : '图片加载失败'}
                      compactEmpty={supplementTarget !== null && !hasUri}
                      emptyTitle={supplementTarget ? getEmptyTitle(supplementTarget) : undefined}
                      emptyDescription={supplementTarget ? getEmptyDescription(supplementTarget) : undefined}
                      emptyActionText={supplementTarget ? getEmptyActionText(supplementTarget) : undefined}
                      onEmptyActionPress={
                        supplementTarget ? () => handlePressSupplement(supplementTarget) : undefined
                      }
                      isEmptyActionLoading={
                        supplementTarget !== null && supplementingType === supplementTarget
                      }
                      emptyActionDisabled={
                        supplementTarget !== null
                        && supplementingType !== null
                        && supplementingType !== supplementTarget
                      }
                      onPreview={() => handleOpenPreview(slot.uri, getSlotPreviewTitle(slot.type))}
                    />
                  );
                })}
            </View>
          </CardContainer>

          <CardContainer style={styles.reviewRecordsCard} padding={spacing.lg}>
            <SectionTitle title="复做记录" />
            {state.detail.reviewRecords.length <= 0 ? (
              <Text style={styles.reviewRecordsEmptyText}>还没有复做记录</Text>
            ) : (
              <View style={styles.reviewRecordsList}>
                {state.detail.reviewRecords.map((record) => (
                  <ReviewRecordCard
                    key={record.id}
                    record={record}
                    onPreview={(uri, title) => handleOpenPreview(uri, title)}
                  />
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

      <ImagePreviewModal
        visible={previewImage !== null}
        uri={previewImage?.uri ?? null}
        title={previewImage?.title ?? ''}
        onClose={handleClosePreview}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl + layout.bottomTabHeight,
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
  refreshButtonDisabled: {
    opacity: 0.6,
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
  reviewRecordImageWrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  reviewRecordImage: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  previewTapPressed: {
    opacity: 0.84,
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
