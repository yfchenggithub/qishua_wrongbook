import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BrandHeader,
  CardContainer,
  ImagePreviewModal,
  MistakeImageSection,
  PrimaryButton,
  ProgressDots,
  ScreenContainer,
  SectionTitle,
  StatusPill,
} from '@/src/components';
import { useMistakeDetailImages } from '@/src/hooks/useMistakeDetailImages';
import type {
  DetailImageSlot,
  DetailImageSlotType,
  DetailReviewRecordItem,
  MistakeDetailViewModel,
} from '@/src/models/MistakeDetailViewModel';
import { Logger } from '@/src/services/Logger';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const BRAND = {
  title: '七刷错题本',
  subtitle: '详情来自本地离线数据',
} as const;

const PAGE_SCOPE = 'MistakeDetailScreen';
const TOAST_DURATION_DEFAULT = 2000;

type ToastType = 'success' | 'info' | 'error';

type DetailPageState =
  | { kind: 'loading' }
  | { kind: 'success'; detail: MistakeDetailViewModel }
  | { kind: 'notFound'; message: string }
  | { kind: 'error'; message: string };

type PreviewImageState = {
  uri: string;
  title: string;
};

type ManagedDetailType = Exclude<DetailImageSlotType, 'review_solution'>;

const MANAGED_IMAGE_ORDER: ManagedDetailType[] = ['question', 'my_solution', 'answer'];

function normalizeRouteId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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
  if (result === 'wrong' || result === 'unknown') {
    return '不会';
  }
  if (result === 'unsure' || result === 'vague') {
    return '模糊';
  }
  if (result === 'mastered' || result === 'known') {
    return '会了';
  }
  return '已完成';
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

function normalizePreviewUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }
  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isManagedType(type: DetailImageSlotType): type is ManagedDetailType {
  return type === 'question' || type === 'my_solution' || type === 'answer';
}

function getSlotPreviewTitle(type: ManagedDetailType): string {
  if (type === 'question') {
    return '题目';
  }
  if (type === 'my_solution') {
    return '我的做法';
  }
  return '答案解析';
}

function getDeleteTypeName(type: ManagedDetailType): string {
  if (type === 'question') {
    return '题目';
  }
  if (type === 'my_solution') {
    return '我的做法';
  }
  return '答案解析';
}

function sortManagedImageSlots(slots: DetailImageSlot[]): DetailImageSlot[] {
  const mapByType = new Map<ManagedDetailType, DetailImageSlot>();
  for (const slot of slots) {
    if (!isManagedType(slot.type)) {
      continue;
    }
    mapByType.set(slot.type, slot);
  }

  return MANAGED_IMAGE_ORDER.map((type) => mapByType.get(type)).filter(
    (slot): slot is DetailImageSlot => !!slot,
  );
}

function getToastBackgroundColor(type: ToastType): string {
  if (type === 'success') {
    return 'rgba(24, 38, 30, 0.95)';
  }
  if (type === 'error') {
    return 'rgba(88, 28, 28, 0.95)';
  }
  return 'rgba(38, 44, 53, 0.95)';
}

function ReviewRecordCard({
  record,
  onPreview,
}: {
  record: DetailReviewRecordItem;
  onPreview?: (uri: string, title: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedUri = normalizePreviewUri(record.solutionImageUri);
  const hasImage = !!normalizedUri;
  const canShowImage = hasImage && !imageFailed;

  const previewTitle =
    Number.isFinite(record.reviewIndex) && record.reviewIndex > 0
      ? `第 ${record.reviewIndex} 刷记录`
      : '复做记录';

  return (
    <View style={styles.reviewRecordRow}>
      <View style={styles.reviewRecordMain}>
        <Text style={styles.reviewRecordTitle}>第 {record.reviewIndex} 刷</Text>
        <Text style={styles.reviewRecordMeta}>时间：{formatReviewCreatedAt(record.createdAt)}</Text>
        <Text style={styles.reviewRecordMeta}>结果：{formatReviewResultLabel(record.result)}</Text>
      </View>

      {canShowImage ? (
        <View style={styles.reviewRecordPreviewWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${previewTitle}，点击查看大图`}
            onPress={() => {
              if (!normalizedUri || !onPreview) {
                return;
              }
              onPreview(normalizedUri, previewTitle);
            }}
            style={({ pressed }) => [styles.reviewRecordImageWrap, pressed && styles.previewTapPressed]}>
            <Image
              source={{ uri: normalizedUri }}
              style={styles.reviewRecordImage}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          </Pressable>
          <Text style={styles.reviewRecordPreviewHint}>点击查看大图</Text>
        </View>
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
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = useMemo(() => normalizeRouteId(id), [id]);

  const [state, setState] = useState<DetailPageState>({ kind: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [previewImage, setPreviewImage] = useState<PreviewImageState | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);

  const requestIdRef = useRef(0);
  const hasFocusedRef = useRef(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastBottomOffset = Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg);

  const handleBack = useCallback(() => {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/library' as never);
  }, [router]);

  const handleStartReview = useCallback(
    (detail: MistakeDetailViewModel) => {
      if (detail.status !== 'active') {
        return;
      }
      if (detail.reviewCount >= detail.maxReviewCount) {
        return;
      }
      router.push(`/review/${detail.id}` as never);
    },
    [router],
  );

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateY, {
        toValue: 8,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToastVisible(false);
    });
  }, [toastOpacity, toastTranslateY]);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration = TOAST_DURATION_DEFAULT) => {
      const normalizedMessage = message.trim();
      if (!normalizedMessage) {
        return;
      }

      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }

      setToastMessage(normalizedMessage);
      setToastType(type);
      setToastVisible(true);
      toastOpacity.setValue(0);
      toastTranslateY.setValue(8);

      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();

      toastTimerRef.current = setTimeout(() => {
        hideToast();
        toastTimerRef.current = null;
      }, duration);
    },
    [hideToast, toastOpacity, toastTranslateY],
  );

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

  const loadDetail = useCallback(
    async (options?: { keepCurrent?: boolean }) => {
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
    },
    [id, routeId],
  );

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

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    },
    [],
  );

  const detailSlots = state.kind === 'success' ? state.detail.imageSlots : [];

  const {
    orderedSlots,
    takePhotoType,
    deleteType,
    isTypeBusy,
    takePhotoForType,
    deleteImageForType,
  } = useMistakeDetailImages({
    mistakeId: state.kind === 'success' ? state.detail.id : null,
    imageSlots: detailSlots,
    refreshDetail: async () => {
      await loadDetail({ keepCurrent: true });
    },
    showToast,
  });

  const managedSlots = useMemo(() => sortManagedImageSlots(orderedSlots), [orderedSlots]);

  const handlePressDelete = useCallback(
    (type: ManagedDetailType) => {
      Logger.info(PAGE_SCOPE, 'Delete image clicked.', {
        routeId,
        imageType: type,
      });

      Alert.alert('确认删除这张图片？', '删除后无法恢复。', [
        {
          text: '取消',
          style: 'cancel',
          onPress: () => {
            Logger.info(PAGE_SCOPE, 'Delete image canceled by user.', {
              routeId,
              imageType: type,
            });
          },
        },
        {
          text: '确认删除',
          style: 'destructive',
          onPress: () => {
            Logger.info(PAGE_SCOPE, 'Delete image confirmed by user.', {
              routeId,
              imageType: type,
            });
            void deleteImageForType(type);
          },
        },
      ]);
    },
    [deleteImageForType, routeId],
  );

  const handlePressEdit = useCallback(
    (slot: DetailImageSlot) => {
      if (state.kind !== 'success') {
        return;
      }
      if (!isManagedType(slot.type)) {
        return;
      }

      const normalizedUri = normalizePreviewUri(slot.uri);
      if (!normalizedUri) {
        return;
      }

      Logger.info(PAGE_SCOPE, 'Edit image clicked.', {
        mistakeId: state.detail.id,
        imageType: slot.type,
      });

      router.push(
        {
          pathname: '/mistake/[id]/image-edit',
          params: {
            id: state.detail.id,
            imageType: slot.type,
          },
        } as never,
      );
    },
    [router, state],
  );

  return (
    <View style={styles.pageRoot}>
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
                <SectionTitle title="图片管理" />
                <Pressable
                  onPress={() => void loadDetail({ keepCurrent: true })}
                  disabled={isRefreshing || takePhotoType !== null || deleteType !== null}
                  style={[
                    styles.refreshButton,
                    (isRefreshing || takePhotoType !== null || deleteType !== null)
                      && styles.refreshButtonDisabled,
                  ]}>
                  <Text style={styles.refreshButtonText}>{isRefreshing ? '刷新中...' : '刷新'}</Text>
                </Pressable>
              </View>

              <View style={styles.slotList}>
                {managedSlots.map((slot) => {
                  const slotType = slot.type;
                  if (!isManagedType(slotType)) {
                    return null;
                  }

                  return (
                    <MistakeImageSection
                      key={slotType}
                      title={slot.title || getDeleteTypeName(slotType)}
                      imageUri={slot.uri}
                      imageExists={slot.exists}
                      fileSize={slot.fileSize}
                      emptyText={slot.emptyText}
                      loadErrorText={slotType === 'question' ? '题目图片加载失败' : '图片加载失败'}
                      isBusy={isTypeBusy(slotType)}
                      isTakePhotoLoading={takePhotoType === slotType}
                      isDeleteLoading={deleteType === slotType}
                      onTakePhoto={() => {
                        void takePhotoForType(slotType);
                      }}
                      onEdit={() => handlePressEdit(slot)}
                      onDelete={() => handlePressDelete(slotType)}
                      onPreview={() => handleOpenPreview(slot.uri, getSlotPreviewTitle(slotType))}
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

      {toastVisible ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastContainer,
            {
              bottom: toastBottomOffset,
              opacity: toastOpacity,
              transform: [{ translateY: toastTranslateY }],
            },
          ]}>
          <View style={[styles.toastBubble, { backgroundColor: getToastBackgroundColor(toastType) }]}>
            <Text maxFontSizeMultiplier={1.1} style={styles.toastText}>
              {toastMessage}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
  },
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
  reviewRecordPreviewWrap: {
    alignItems: 'flex-end',
    gap: 2,
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
  reviewRecordPreviewHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 12,
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
  toastContainer: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
  toastBubble: {
    maxWidth: '86%',
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.black,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  toastText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '600',
    textAlign: 'center',
  },
});
