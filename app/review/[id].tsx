import { useLocalSearchParams, useRouter } from 'expo-router';
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
  PrimaryButton,
  ProgressDots,
  ScreenContainer,
  StatusPill,
} from '@/src/components';
import type { DetailImageSlot } from '@/src/models/MistakeDetailViewModel';
import type { LocalImage } from '@/src/models/LocalImage';
import type { ReviewPageData } from '@/src/services/ReviewFlowService';
import * as CompleteReviewService from '@/src/services/CompleteReviewService';
import * as ImageService from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import * as ReviewFlowService from '@/src/services/ReviewFlowService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'ReviewPage';

type ReviewPageState =
  | { kind: 'loading' }
  | { kind: 'success'; data: ReviewPageData }
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
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = useMemo(() => normalizeRouteId(id), [id]);

  const [state, setState] = useState<ReviewPageState>({ kind: 'loading' });
  const [capturedReviewImage, setCapturedReviewImage] = useState<LocalImage | null>(null);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<string | null>(null);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [isDeletingImage, setIsDeletingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requestIdRef = useRef(0);

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
    setSubmitErrorMessage(null);
  }, [routeId]);

  const handleCaptureReviewPhoto = useCallback(async () => {
    if (!routeId || state.kind !== 'success') {
      return;
    }
    if (isSubmitting || isDeletingImage || isCapturingPhoto) {
      return;
    }
    if (!state.data.session.canReview) {
      setSubmitErrorMessage(state.data.session.reason ?? '当前状态不能继续复做');
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
        const message = saveResult.errorMessage ?? '拍照失败，请重试';
        setSubmitErrorMessage(message);
        Alert.alert('拍照未完成', message);
        return;
      }

      if (capturedReviewImage?.uri && capturedReviewImage.uri !== saveResult.image.uri) {
        void ImageService.deleteLocalImage(capturedReviewImage.uri);
      }

      setCapturedReviewImage(saveResult.image);
      setSubmitErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSubmitErrorMessage(message);
      Logger.error(PAGE_SCOPE, 'Failed to capture review photo.', {
        routeId,
        error,
      });
      Alert.alert('拍照失败', message);
    } finally {
      setIsCapturingPhoto(false);
    }
  }, [capturedReviewImage?.uri, isCapturingPhoto, isDeletingImage, isSubmitting, routeId, state]);

  const handleDeleteReviewPhoto = useCallback(async () => {
    if (!capturedReviewImage || isSubmitting || isDeletingImage || isCapturingPhoto) {
      return;
    }

    setIsDeletingImage(true);
    try {
      const removed = await ImageService.deleteLocalImage(capturedReviewImage.uri);
      if (!removed) {
        const message = '删除复做照片失败，请稍后重试';
        setSubmitErrorMessage(message);
        Alert.alert('删除失败', message);
        return;
      }

      setCapturedReviewImage(null);
      setSubmitErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSubmitErrorMessage(message);
      Logger.error(PAGE_SCOPE, 'Failed to delete review photo.', { error });
      Alert.alert('删除失败', message);
    } finally {
      setIsDeletingImage(false);
    }
  }, [capturedReviewImage, isCapturingPhoto, isDeletingImage, isSubmitting]);

  const handleSubmit = useCallback(async () => {
    if (!routeId || state.kind !== 'success') {
      return;
    }
    if (isSubmitting || isCapturingPhoto || isDeletingImage) {
      return;
    }

    const { session } = state.data;
    if (!session.canReview) {
      setSubmitErrorMessage(session.reason ?? '当前状态不能继续复做');
      return;
    }

    if (!capturedReviewImage?.uri) {
      const message = '请先拍本次复做照片';
      setSubmitErrorMessage(message);
      return;
    }

    setIsSubmitting(true);
    setSubmitErrorMessage(null);
    try {
      const result = await CompleteReviewService.completeReview({
        mistakeId: routeId,
        reviewIndex: session.nextReviewIndex,
        solutionImageUri: capturedReviewImage.uri,
        result: 'done',
        cleanupImageOnFailure: true,
      });

      if (!result.ok) {
        const message = result.errorMessage ?? '提交复做失败，请稍后重试';
        setSubmitErrorMessage(message);
        return;
      }

      if (result.newStatus === 'mastered') {
        Alert.alert('提交成功', '恭喜，已完成七刷');
      } else {
        Alert.alert('提交成功', `第 ${session.nextReviewIndex} 刷已完成，下一次复做已安排`);
      }
      router.replace(`/mistake/${routeId}` as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSubmitErrorMessage(message);
      Logger.error(PAGE_SCOPE, 'Failed to submit review completion.', { error, routeId });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    capturedReviewImage?.uri,
    isCapturingPhoto,
    isDeletingImage,
    isSubmitting,
    routeId,
    router,
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
            <PrimaryButton title="返回" onPress={handleBack} style={styles.stateButtonLight} textStyle={styles.stateButtonLightText} />
          </View>
        </CardContainer>
      </ScreenContainer>
    );
  }

  const { detail, session } = state.data;
  const questionSlot = detail.imageSlots.find((slot) => slot.type === 'question');
  const captureDisabled = isSubmitting || isDeletingImage || isCapturingPhoto || !session.canReview;
  const deleteDisabled = isSubmitting || isDeletingImage || isCapturingPhoto;
  const submitDisabled =
    isSubmitting || isCapturingPhoto || isDeletingImage || !session.canReview;
  const submitButtonTitle = !session.canReview
    ? session.reason ?? '当前不可复做'
    : isSubmitting
      ? '保存中...'
      : `标记第 ${session.nextReviewIndex} 刷完成`;

  return (
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

      <CardContainer style={styles.captureCard} padding={spacing.lg}>
        <Text style={styles.captureTitle}>本次复做照片</Text>

        {!capturedReviewImage ? (
          <Pressable
            onPress={() => void handleCaptureReviewPhoto()}
            disabled={captureDisabled}
            style={[styles.capturePlaceholder, captureDisabled && styles.disabledControl]}>
            <Text style={styles.capturePlaceholderIcon}>+</Text>
            <Text style={styles.capturePlaceholderText}>拍本次做法</Text>
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
                style={[styles.captureActionButton, styles.primaryAction, captureDisabled && styles.disabledControl]}>
                <Text style={styles.primaryActionText}>重新拍照</Text>
              </Pressable>

              <Pressable
                onPress={() => void handleDeleteReviewPhoto()}
                disabled={deleteDisabled}
                style={[styles.captureActionButton, styles.secondaryAction, deleteDisabled && styles.disabledControl]}>
                <Text style={styles.secondaryActionText}>
                  {isDeletingImage ? '删除中...' : '删除'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </CardContainer>

      {submitErrorMessage ? (
        <CardContainer style={styles.errorCard} padding={spacing.lg}>
          <Text style={styles.errorText}>{submitErrorMessage}</Text>
        </CardContainer>
      ) : null}

      <PrimaryButton
        title={submitButtonTitle}
        disabled={submitDisabled}
        onPress={() => void handleSubmit()}
      />
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
  errorCard: {
    borderRadius: radius.xl,
    borderColor: '#F2C9C9',
    backgroundColor: '#FFF5F5',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
  disabledControl: {
    opacity: 0.5,
  },
});
