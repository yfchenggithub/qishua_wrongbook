import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  PrimaryButton,
  ProgressDots,
  ScreenContainer,
  StatusPill,
} from '@/src/components';
import type { DetailImageSlot } from '@/src/models/MistakeDetailViewModel';
import type { ReviewResult } from '@/src/models/Mistake';
import type { LocalImage } from '@/src/models/LocalImage';
import type { ReviewPageData } from '@/src/services/ReviewFlowService';
import * as CompleteReviewService from '@/src/services/CompleteReviewService';
import * as ImageService from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import * as ReviewFlowService from '@/src/services/ReviewFlowService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'ReviewPage';
const TOAST_DURATION_DEFAULT = 2200;
const TOAST_DURATION_LONG = 3200;

type ToastType = 'success' | 'info' | 'error';

type ReviewPageState =
  | { kind: 'loading' }
  | { kind: 'success'; data: ReviewPageData }
  | { kind: 'notFound'; message: string }
  | { kind: 'error'; message: string };

const REVIEW_RESULT_OPTIONS: { label: string; value: ReviewResult }[] = [
  { label: '会了', value: 'mastered' },
  { label: '模糊', value: 'unsure' },
  { label: '不会', value: 'wrong' },
];

function normalizeRouteId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toBriefErrorMessage(message?: string): string {
  const fallback = '读取复做任务失败，请稍后重试。';
  const normalized = typeof message === 'string' ? message.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= 60) {
    return normalized;
  }
  return `${normalized.slice(0, 60)}...`;
}

function mapStatusToTone(status: ReviewPageData['session']['status']): 'dark' | 'light' | 'success' {
  if (status === 'mastered') {
    return 'success';
  }
  if (status === 'archived') {
    return 'light';
  }
  return 'dark';
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

function QuestionPreviewCard({ slot }: { slot?: DetailImageSlot }) {
  const [imageFailed, setImageFailed] = useState(false);

  const normalizedUri = useMemo(() => {
    const raw = slot?.uri;
    if (typeof raw !== 'string') {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [slot?.uri]);

  useEffect(() => {
    setImageFailed(false);
  }, [normalizedUri]);

  const hasUri = !!normalizedUri;
  const canShowImage = hasUri && slot?.exists === true && !imageFailed;
  const fileMissing = hasUri && slot?.exists === false;
  const loadFailed = hasUri && slot?.exists === true && imageFailed;

  return (
    <CardContainer style={styles.questionCard} padding={spacing.lg}>
      <Text style={styles.questionCardTitle}>题目</Text>

      <View style={[styles.questionPreviewBox, !hasUri && styles.questionPreviewBoxEmpty]}>
        {canShowImage ? (
          <Image
            source={{ uri: normalizedUri! }}
            style={styles.questionPreviewImage}
            resizeMode="contain"
            onError={() => setImageFailed(true)}
          />
        ) : null}

        {!hasUri ? <Text style={styles.placeholderText}>题目图片缺失</Text> : null}
        {fileMissing ? <Text style={styles.errorText}>题目图片文件不存在</Text> : null}
        {loadFailed ? <Text style={styles.errorText}>题目图片加载失败</Text> : null}
      </View>
    </CardContainer>
  );
}

export default function ReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = useMemo(() => normalizeRouteId(id), [id]);

  const [state, setState] = useState<ReviewPageState>({ kind: 'loading' });
  const [capturedReviewImage, setCapturedReviewImage] = useState<LocalImage | null>(null);
  const [selectedResult, setSelectedResult] = useState<ReviewResult | null>(null);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [isDeletingImage, setIsDeletingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);

  const requestIdRef = useRef(0);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastBottomOffset = insets.bottom + spacing.lg;

  const handleBack = useCallback(() => {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }

    if (routeId) {
      router.replace(`/mistake/${routeId}` as never);
      return;
    }

    router.replace('/(tabs)/library' as never);
  }, [routeId, router]);

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

  const loadPageData = useCallback(async () => {
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

    let result: Awaited<ReturnType<typeof ReviewFlowService.getReviewPageData>>;
    try {
      result = await ReviewFlowService.getReviewPageData(routeId);
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      Logger.error(PAGE_SCOPE, 'Unexpected error while loading review page data.', {
        routeId,
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
    if (result.ok && result.data) {
      setState({ kind: 'success', data: result.data });
      return;
    }

    if (result.notFound) {
      setState({
        kind: 'notFound',
        message: '没有找到这道错题',
      });
      return;
    }

    setState({
      kind: 'error',
      message: toBriefErrorMessage(result.errorMessage),
    });
  }, [routeId]);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  useEffect(() => {
    setCapturedReviewImage(null);
    setSelectedResult(null);
  }, [routeId]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      if (navigateTimerRef.current) {
        clearTimeout(navigateTimerRef.current);
        navigateTimerRef.current = null;
      }
    },
    [],
  );

  const handleCaptureReviewPhoto = useCallback(async () => {
    if (!routeId || state.kind !== 'success') {
      return;
    }
    if (isSubmitting || isDeletingImage || isCapturingPhoto) {
      return;
    }
    if (!state.data.session.canReview) {
      showToast(state.data.session.reason ?? '当前状态不能继续复做', 'info');
      return;
    }

    setIsCapturingPhoto(true);
    try {
      const saveResult = await ImageService.takePhotoAndSave({
        mistakeId: routeId,
        type: 'review_solution',
        index: state.data.session.nextReviewIndex,
      });

      if (!saveResult.ok || !saveResult.image) {
        Logger.warn(PAGE_SCOPE, 'Capture review photo did not return a valid image.', {
          routeId,
          errorMessage: saveResult.errorMessage ?? null,
        });
        showToast('拍照失败，请重试', 'error', TOAST_DURATION_LONG);
        return;
      }

      if (capturedReviewImage?.uri && capturedReviewImage.uri !== saveResult.image.uri) {
        void ImageService.deleteLocalImage(capturedReviewImage.uri);
      }

      setCapturedReviewImage(saveResult.image);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to capture review photo.', {
        routeId,
        error,
      });
      showToast('拍照失败，请重试', 'error', TOAST_DURATION_LONG);
    } finally {
      setIsCapturingPhoto(false);
    }
  }, [
    capturedReviewImage?.uri,
    isCapturingPhoto,
    isDeletingImage,
    isSubmitting,
    routeId,
    showToast,
    state,
  ]);

  const handleDeleteReviewPhoto = useCallback(async () => {
    if (!capturedReviewImage || isSubmitting || isDeletingImage || isCapturingPhoto) {
      return;
    }

    setIsDeletingImage(true);
    try {
      const removed = await ImageService.deleteLocalImage(capturedReviewImage.uri);
      if (!removed) {
        Logger.warn(PAGE_SCOPE, 'deleteLocalImage returned false when deleting review photo.', {
          uri: capturedReviewImage.uri,
        });
        showToast('删除失败，请稍后重试', 'error', TOAST_DURATION_LONG);
        return;
      }

      setCapturedReviewImage(null);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to delete review photo.', { error });
      showToast('删除失败，请稍后重试', 'error', TOAST_DURATION_LONG);
    } finally {
      setIsDeletingImage(false);
    }
  }, [capturedReviewImage, isCapturingPhoto, isDeletingImage, isSubmitting, showToast]);

  const handleSubmit = useCallback(async () => {
    if (!routeId || state.kind !== 'success') {
      return;
    }
    if (isSubmitting || isCapturingPhoto || isDeletingImage) {
      return;
    }

    const { session } = state.data;
    if (!session.canReview) {
      showToast(session.reason ?? '当前状态不能继续复做', 'info');
      return;
    }

    if (!selectedResult) {
      showToast('请先选择本次结果', 'info');
      return;
    }

    setIsSubmitting(true);
    let submittedSuccessfully = false;
    try {
      const result = await CompleteReviewService.completeReview({
        mistakeId: routeId,
        reviewIndex: session.nextReviewIndex,
        solutionImageUri: capturedReviewImage?.uri ?? null,
        result: selectedResult,
        cleanupImageOnFailure: true,
      });

      if (!result.ok) {
        Logger.warn(PAGE_SCOPE, 'Review submit finished without success.', {
          routeId,
          reviewIndex: session.nextReviewIndex,
          errorMessage: result.errorMessage ?? null,
        });
        showToast('保存失败，请稍后重试', 'error', TOAST_DURATION_LONG);
        return;
      }

      submittedSuccessfully = true;
      showToast('已保存本次复做', 'success');
      if (navigateTimerRef.current) {
        clearTimeout(navigateTimerRef.current);
      }
      navigateTimerRef.current = setTimeout(() => {
        router.replace(`/mistake/${routeId}` as never);
      }, 320);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to submit review completion.', { error, routeId });
      showToast('保存失败，请稍后重试', 'error', TOAST_DURATION_LONG);
    } finally {
      if (!submittedSuccessfully) {
        setIsSubmitting(false);
      }
    }
  }, [
    capturedReviewImage?.uri,
    isCapturingPhoto,
    isDeletingImage,
    isSubmitting,
    routeId,
    router,
    selectedResult,
    showToast,
    state,
  ]);

  if (state.kind === 'loading') {
    return (
      <ScreenContainer scroll contentStyle={styles.screenContent}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>返回错题详情</Text>
        </Pressable>
        <BrandHeader title="七刷错题本" subtitle="复做任务" />
        <CardContainer style={styles.loadingCard} padding={spacing.lg}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
          <Text style={styles.loadingText}>正在加载复做任务...</Text>
        </CardContainer>
      </ScreenContainer>
    );
  }

  if (state.kind === 'notFound') {
    return (
      <ScreenContainer scroll contentStyle={styles.screenContent}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>返回错题详情</Text>
        </Pressable>
        <BrandHeader title="七刷错题本" subtitle="复做任务" />
        <CardContainer style={styles.stateCard} padding={spacing.lg}>
          <Text style={styles.stateTitle}>{state.message}</Text>
          <PrimaryButton title="返回" onPress={handleBack} />
        </CardContainer>
      </ScreenContainer>
    );
  }

  if (state.kind === 'error') {
    return (
      <ScreenContainer scroll contentStyle={styles.screenContent}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>返回错题详情</Text>
        </Pressable>
        <BrandHeader title="七刷错题本" subtitle="复做任务" />
        <CardContainer style={styles.stateCard} padding={spacing.lg}>
          <Text style={styles.stateTitle}>读取复做任务失败</Text>
          <Text style={styles.stateMessage}>{state.message}</Text>
          <View style={styles.stateButtonRow}>
            <PrimaryButton title="重试" onPress={() => void loadPageData()} style={styles.stateButton} />
            <PrimaryButton
              title="返回"
              onPress={handleBack}
              style={styles.stateButtonLight}
              textStyle={styles.stateButtonLightText}
            />
          </View>
        </CardContainer>
      </ScreenContainer>
    );
  }

  const { detail, session } = state.data;
  const questionSlot = detail.imageSlots.find((slot) => slot.type === 'question');
  const captureDisabled = isSubmitting || isDeletingImage || isCapturingPhoto || !session.canReview;
  const deleteDisabled = isSubmitting || isDeletingImage || isCapturingPhoto;
  const resultSelectDisabled =
    isSubmitting || isCapturingPhoto || isDeletingImage || !session.canReview;
  const submitDisabled =
    isSubmitting || isCapturingPhoto || isDeletingImage || !session.canReview;
  const submitButtonTitle = !session.canReview
    ? session.reason ?? '当前不可复做'
    : isSubmitting
      ? '保存中…'
      : '保存本次复做';

  return (
    <View style={styles.pageRoot}>
      <ScreenContainer scroll contentStyle={styles.screenContent}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>返回错题详情</Text>
        </Pressable>

        <BrandHeader title="七刷错题本" subtitle="复做任务" />

        <CardContainer style={styles.summaryCard} padding={spacing.lg}>
          <Text style={styles.moduleText}>{detail.module}</Text>
          <Text style={styles.titleText}>{detail.title}</Text>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              当前进度：{session.currentReviewCount}/{session.maxReviewCount}
            </Text>
            <StatusPill label={detail.statusLabel} tone={mapStatusToTone(session.status)} />
          </View>
          <Text style={styles.nextReviewText}>本次复做：第 {session.nextReviewIndex} 刷</Text>
          <ProgressDots
            total={session.maxReviewCount}
            current={session.nextReviewIndex}
            completed={session.currentReviewCount}
            style={styles.progressDots}
          />
          {!session.canReview ? (
            <Text style={styles.reasonText}>当前不可复做：{session.reason ?? '请返回详情页刷新'}</Text>
          ) : null}
        </CardContainer>

        <QuestionPreviewCard slot={questionSlot} />

        <CardContainer style={styles.resultCard} padding={spacing.lg}>
          <Text style={styles.resultTitle}>本次结果</Text>
          <View style={styles.resultOptionsRow}>
            {REVIEW_RESULT_OPTIONS.map((option) => {
              const selected = selectedResult === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setSelectedResult(option.value)}
                  disabled={resultSelectDisabled}
                  style={[
                    styles.resultOptionButton,
                    selected ? styles.resultOptionButtonSelected : styles.resultOptionButtonIdle,
                    resultSelectDisabled ? styles.disabledControl : null,
                  ]}>
                  <Text
                    style={[
                      styles.resultOptionText,
                      selected ? styles.resultOptionTextSelected : styles.resultOptionTextIdle,
                    ]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </CardContainer>

        <CardContainer style={styles.captureCard} padding={spacing.lg}>
          <Text style={styles.captureTitle}>本次复做照片（可选）</Text>

          {!capturedReviewImage ? (
            <Pressable
              onPress={() => void handleCaptureReviewPhoto()}
              disabled={captureDisabled}
              style={[styles.capturePlaceholder, captureDisabled && styles.disabledControl]}>
              <Text style={styles.capturePlaceholderIcon}>+</Text>
              <Text style={styles.capturePlaceholderText}>拍本次做法（可选）</Text>
            </Pressable>
          ) : (
            <View style={styles.previewWrap}>
              <Image
                source={{ uri: capturedReviewImage.uri }}
                style={styles.reviewPreviewImage}
                resizeMode="contain"
              />
              <View style={styles.captureActionRow}>
                <Pressable
                  onPress={() => void handleCaptureReviewPhoto()}
                  disabled={captureDisabled}
                  style={[
                    styles.captureActionButton,
                    styles.primaryAction,
                    captureDisabled && styles.disabledControl,
                  ]}>
                  <Text style={styles.primaryActionText}>重新拍照</Text>
                </Pressable>

                <Pressable
                  onPress={() => void handleDeleteReviewPhoto()}
                  disabled={deleteDisabled}
                  style={[
                    styles.captureActionButton,
                    styles.secondaryAction,
                    deleteDisabled && styles.disabledControl,
                  ]}>
                  <Text style={styles.secondaryActionText}>
                    {isDeletingImage ? '删除中…' : '删除'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </CardContainer>

        <PrimaryButton
          title={submitButtonTitle}
          disabled={submitDisabled}
          onPress={() => void handleSubmit()}
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
    gap: spacing.lg,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  backButtonText: {
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
    gap: spacing.md,
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
  stateButtonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stateButton: {
    flex: 1,
  },
  stateButtonLight: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stateButtonLightText: {
    color: colors.textPrimary,
  },
  summaryCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  moduleText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  titleText: {
    ...typography.sectionTitle,
    fontSize: 28,
    lineHeight: 36,
  },
  progressRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  progressText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  nextReviewText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  progressDots: {
    marginTop: spacing.xs,
  },
  reasonText: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
    fontWeight: '700',
  },
  questionCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  questionCardTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  questionPreviewBox: {
    height: 300,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: spacing.md,
  },
  questionPreviewBoxEmpty: {
    borderStyle: 'dashed',
  },
  questionPreviewImage: {
    width: '100%',
    height: '100%',
  },
  resultCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  resultTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  resultOptionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  resultOptionButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  resultOptionButtonIdle: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  resultOptionButtonSelected: {
    borderColor: colors.black,
    backgroundColor: colors.black,
  },
  resultOptionText: {
    ...typography.body,
    fontWeight: '700',
  },
  resultOptionTextIdle: {
    color: colors.textPrimary,
  },
  resultOptionTextSelected: {
    color: colors.white,
  },
  captureCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  captureTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  capturePlaceholder: {
    minHeight: 220,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  capturePlaceholderIcon: {
    ...typography.titleMedium,
    color: colors.textSecondary,
    fontSize: 40,
    lineHeight: 44,
  },
  capturePlaceholderText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  previewWrap: {
    gap: spacing.sm,
  },
  reviewPreviewImage: {
    minHeight: 260,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  captureActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  captureActionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  primaryAction: {
    backgroundColor: colors.black,
    borderColor: colors.black,
  },
  primaryActionText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  secondaryAction: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
  },
  secondaryActionText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  placeholderText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
  disabledControl: {
    opacity: 0.5,
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
