import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandHeader, CardContainer, PrimaryButton, ScreenContainer } from '@/src/components';
import type { DetailImageSlot } from '@/src/models/MistakeDetailViewModel';
import type { ReviewResult } from '@/src/models/Mistake';
import { Logger } from '@/src/services/Logger';
import type { ReviewSessionQueueItem } from '@/src/services/ReviewSessionService';
import * as ReviewSessionService from '@/src/services/ReviewSessionService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'ReviewSessionPage';
const TOAST_DURATION_DEFAULT = 2000;
const TOAST_DURATION_LONG = 3200;

type ToastType = 'success' | 'info' | 'error';
type SessionState = 'loading' | 'empty' | 'error' | 'ready';
type SessionResultKey = 'known' | 'fuzzy' | 'unknown';

interface SessionResultStats {
  known: number;
  fuzzy: number;
  unknown: number;
}

const EMPTY_RESULT_STATS: SessionResultStats = {
  known: 0,
  fuzzy: 0,
  unknown: 0,
};

const REVIEW_ACTIONS: {
  label: string;
  value: ReviewResult;
  statsKey: SessionResultKey;
  tone: 'known' | 'fuzzy' | 'unknown';
}[] = [
  {
    label: '不会',
    value: 'wrong',
    statsKey: 'unknown',
    tone: 'unknown',
  },
  {
    label: '模糊',
    value: 'unsure',
    statsKey: 'fuzzy',
    tone: 'fuzzy',
  },
  {
    label: '会了',
    value: 'mastered',
    statsKey: 'known',
    tone: 'known',
  },
];

function getToastBackgroundColor(type: ToastType): string {
  if (type === 'success') {
    return 'rgba(24, 38, 30, 0.95)';
  }
  if (type === 'error') {
    return 'rgba(88, 28, 28, 0.95)';
  }
  return 'rgba(38, 44, 53, 0.95)';
}

function toShortErrorMessage(input?: string): string {
  const fallback = '读取失败，请稍后重试。';
  const normalized = typeof input === 'string' ? input.trim() : '';
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= 60) {
    return normalized;
  }
  return `${normalized.slice(0, 60)}...`;
}

function QuestionImageCard({ slot }: { slot?: DetailImageSlot }) {
  const [imageFailed, setImageFailed] = useState(false);

  const normalizedUri = useMemo(() => {
    const rawUri = typeof slot?.uri === 'string' ? slot.uri.trim() : '';
    return rawUri.length > 0 ? rawUri : null;
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
      <Text style={styles.questionTitle}>题目图片</Text>
      <View style={[styles.questionImageWrap, !hasUri && styles.questionImageWrapEmpty]}>
        {canShowImage ? (
          <Image
            source={{ uri: normalizedUri! }}
            style={styles.questionImage}
            resizeMode="contain"
            onError={() => setImageFailed(true)}
          />
        ) : null}
        {!hasUri ? <Text style={styles.questionPlaceholderText}>还没有上传题目图片</Text> : null}
        {fileMissing ? <Text style={styles.questionErrorText}>题目图片文件不存在</Text> : null}
        {loadFailed ? <Text style={styles.questionErrorText}>题目图片加载失败</Text> : null}
      </View>
    </CardContainer>
  );
}

export default function ReviewSessionPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [queue, setQueue] = useState<ReviewSessionQueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [resultStats, setResultStats] = useState<SessionResultStats>(EMPTY_RESULT_STATS);
  const [currentErrorMessage, setCurrentErrorMessage] = useState<string | null>(null);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentReloadNonce, setCurrentReloadNonce] = useState(0);
  const [currentQuestionSlot, setCurrentQuestionSlot] = useState<DetailImageSlot | undefined>(undefined);
  const [currentMeta, setCurrentMeta] = useState<{
    mistakeId: string;
    module: string;
    title: string;
    nextReviewIndex: number;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);

  const queueRequestIdRef = useRef(0);
  const currentRequestIdRef = useRef(0);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalCount = queue.length;
  const hasRemaining = sessionState === 'ready' && currentIndex < totalCount;
  const isCompleted = sessionState === 'ready' && totalCount > 0 && currentIndex >= totalCount;
  const currentQueueItem = hasRemaining ? queue[currentIndex] ?? null : null;

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

  const navigateHome = useCallback(() => {
    router.replace('/(tabs)' as never);
  }, [router]);

  const handleRequestExit = useCallback(() => {
    if (!hasRemaining || isCompleted) {
      navigateHome();
      return;
    }

    Alert.alert('确认退出', '今日复做还没完成，确定退出吗？', [
      {
        text: '取消',
        style: 'cancel',
      },
      {
        text: '确定退出',
        style: 'destructive',
        onPress: navigateHome,
      },
    ]);
  }, [hasRemaining, isCompleted, navigateHome]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleRequestExit();
        return true;
      });

      return () => {
        subscription.remove();
      };
    }, [handleRequestExit]),
  );

  const loadQueue = useCallback(async () => {
    const requestId = queueRequestIdRef.current + 1;
    queueRequestIdRef.current = requestId;
    setSessionState('loading');
    setSessionErrorMessage(null);
    setCurrentErrorMessage(null);
    setCurrentMeta(null);
    setCurrentQuestionSlot(undefined);
    setQueue([]);
    setCurrentIndex(0);
    setResultStats(EMPTY_RESULT_STATS);

    try {
      const todayQueue = await ReviewSessionService.getTodayReviewSessionQueue();
      if (requestId !== queueRequestIdRef.current) {
        return;
      }

      if (todayQueue.length <= 0) {
        setSessionState('empty');
        return;
      }

      setQueue(todayQueue);
      setCurrentIndex(0);
      setSessionState('ready');
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to load today review queue.', { error });
      if (requestId !== queueRequestIdRef.current) {
        return;
      }
      setSessionErrorMessage('读取今日复做队列失败，请稍后重试。');
      setSessionState('error');
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!currentQueueItem || sessionState !== 'ready' || isCompleted) {
      setCurrentMeta(null);
      setCurrentQuestionSlot(undefined);
      setCurrentErrorMessage(null);
      setIsLoadingCurrent(false);
      return;
    }

    const requestId = currentRequestIdRef.current + 1;
    currentRequestIdRef.current = requestId;
    setIsLoadingCurrent(true);
    setCurrentErrorMessage(null);
    setCurrentMeta(null);
    setCurrentQuestionSlot(undefined);

    const loadCurrent = async () => {
      const result = await ReviewSessionService.loadTodayReviewItem(currentQueueItem.id);
      if (requestId !== currentRequestIdRef.current) {
        return;
      }

      if (result.ok) {
        const questionSlot = result.data.detail.imageSlots.find((slot) => slot.type === 'question');
        setCurrentMeta({
          mistakeId: result.data.detail.id,
          module: result.data.detail.module,
          title: result.data.detail.title,
          nextReviewIndex: result.data.session.nextReviewIndex,
        });
        setCurrentQuestionSlot(questionSlot);
        setCurrentErrorMessage(null);
        setIsLoadingCurrent(false);
        return;
      }

      if (result.canSkip) {
        setIsLoadingCurrent(false);
        showToast(`${toShortErrorMessage(result.errorMessage)} 已自动跳过`, 'info');
        setCurrentIndex((prev) => prev + 1);
        return;
      }

      setCurrentErrorMessage(toShortErrorMessage(result.errorMessage));
      setIsLoadingCurrent(false);
    };

    void loadCurrent();
  }, [currentQueueItem, currentReloadNonce, isCompleted, sessionState, showToast]);

  const incrementStats = useCallback((statsKey: SessionResultKey) => {
    setResultStats((previous) => ({
      ...previous,
      [statsKey]: previous[statsKey] + 1,
    }));
  }, []);

  const handleSelectResult = useCallback(
    async (result: ReviewResult, statsKey: SessionResultKey) => {
      if (!currentQueueItem || !currentMeta || isLoadingCurrent || isSubmitting || isCompleted) {
        return;
      }

      setIsSubmitting(true);
      try {
        const submitResult = await ReviewSessionService.submitTodayReviewResult({
          mistakeId: currentQueueItem.id,
          reviewIndex: currentMeta.nextReviewIndex,
          result,
        });

        if (!submitResult.ok) {
          showToast(toShortErrorMessage(submitResult.errorMessage ?? '保存失败，请重试。'), 'error', TOAST_DURATION_LONG);
          return;
        }

        incrementStats(statsKey);
        const isLast = currentIndex >= totalCount - 1;
        showToast(isLast ? '已记录，今日复做完成' : '已记录，进入下一题', 'success');
        setCurrentIndex((prev) => prev + 1);
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to submit session review result.', {
          mistakeId: currentQueueItem.id,
          reviewIndex: currentMeta.nextReviewIndex,
          error,
        });
        showToast('保存失败，请稍后重试', 'error', TOAST_DURATION_LONG);
      } finally {
        setIsSubmitting(false);
      }
    },
    [currentIndex, currentMeta, currentQueueItem, incrementStats, isCompleted, isLoadingCurrent, isSubmitting, showToast, totalCount],
  );

  const progressText = useMemo(() => {
    if (totalCount <= 0) {
      return '0 / 0';
    }
    if (isCompleted) {
      return `${totalCount} / ${totalCount}`;
    }
    return `${currentIndex + 1} / ${totalCount}`;
  }, [currentIndex, isCompleted, totalCount]);

  const toastBottomOffset = insets.bottom + spacing.lg;

  return (
    <View style={styles.pageRoot}>
      <ScreenContainer scroll contentStyle={styles.screenContent}>
        <Pressable style={styles.exitButton} onPress={handleRequestExit}>
          <Text style={styles.exitButtonText}>退出今日复做</Text>
        </Pressable>

        <BrandHeader title="七刷错题本" subtitle="今日复做会话" />

        {sessionState === 'loading' ? (
          <CardContainer style={styles.stateCard} padding={spacing.lg}>
            <ActivityIndicator size="small" color={colors.textPrimary} />
            <Text style={styles.stateText}>正在加载今日复做队列...</Text>
          </CardContainer>
        ) : null}

        {sessionState === 'error' ? (
          <CardContainer style={styles.stateCard} padding={spacing.lg}>
            <Text style={styles.stateTitle}>加载失败</Text>
            <Text style={styles.stateText}>{sessionErrorMessage ?? '读取今日复做队列失败。'}</Text>
            <View style={styles.stateActionRow}>
              <PrimaryButton title="重试" onPress={() => void loadQueue()} style={styles.stateActionButton} />
              <PrimaryButton
                title="返回首页"
                onPress={navigateHome}
                style={styles.stateActionButtonLight}
                textStyle={styles.stateActionButtonLightText}
              />
            </View>
          </CardContainer>
        ) : null}

        {sessionState === 'empty' ? (
          <CardContainer style={styles.stateCard} padding={spacing.lg}>
            <Text style={styles.stateTitle}>今天没有需要复做的错题</Text>
            <Text style={styles.stateText}>可以先去新增错题，系统会自动安排下一次复做。</Text>
            <PrimaryButton title="返回首页" onPress={navigateHome} />
          </CardContainer>
        ) : null}

        {isCompleted ? (
          <CardContainer style={styles.completeCard} padding={spacing.xl}>
            <Text style={styles.completeTitle}>今日复做完成</Text>
            <Text style={styles.completeSubtitle}>今天一共完成 {totalCount} 道题</Text>
            <View style={styles.completeStatsRow}>
              <View style={styles.completeStatCell}>
                <Text style={styles.completeStatLabel}>会了</Text>
                <Text style={styles.completeStatValue}>{resultStats.known}</Text>
              </View>
              <View style={styles.completeStatCell}>
                <Text style={styles.completeStatLabel}>模糊</Text>
                <Text style={styles.completeStatValue}>{resultStats.fuzzy}</Text>
              </View>
              <View style={styles.completeStatCell}>
                <Text style={styles.completeStatLabel}>不会</Text>
                <Text style={styles.completeStatValue}>{resultStats.unknown}</Text>
              </View>
            </View>
            <PrimaryButton title="返回首页" onPress={navigateHome} />
          </CardContainer>
        ) : null}

        {sessionState === 'ready' && !isCompleted ? (
          <>
            <CardContainer style={styles.progressCard} padding={spacing.lg}>
              <Text style={styles.progressHeader}>今日复做</Text>
              <Text style={styles.progressNumber}>{progressText}</Text>
              <Text style={styles.progressSubText}>第 {currentMeta?.nextReviewIndex ?? currentQueueItem?.nextReviewIndex ?? 1} 刷</Text>
              <Text style={styles.progressTitle} numberOfLines={2}>
                {currentMeta?.title ?? currentQueueItem?.title ?? '正在准备题目...'}
              </Text>
              <Text style={styles.progressModule}>{currentMeta?.module ?? currentQueueItem?.module ?? ''}</Text>
            </CardContainer>

            {isLoadingCurrent ? (
              <CardContainer style={styles.stateCard} padding={spacing.lg}>
                <ActivityIndicator size="small" color={colors.textPrimary} />
                <Text style={styles.stateText}>正在加载当前题目...</Text>
              </CardContainer>
            ) : null}

            {!isLoadingCurrent && currentErrorMessage ? (
              <CardContainer style={styles.stateCard} padding={spacing.lg}>
                <Text style={styles.stateTitle}>当前题加载失败</Text>
                <Text style={styles.stateText}>{currentErrorMessage}</Text>
                <View style={styles.stateActionRow}>
                  <PrimaryButton
                    title="重试本题"
                    onPress={() => {
                      setCurrentErrorMessage(null);
                      setCurrentReloadNonce((prev) => prev + 1);
                    }}
                    style={styles.stateActionButton}
                  />
                  <PrimaryButton
                    title="退出会话"
                    onPress={handleRequestExit}
                    style={styles.stateActionButtonLight}
                    textStyle={styles.stateActionButtonLightText}
                  />
                </View>
              </CardContainer>
            ) : null}

            {!isLoadingCurrent && !currentErrorMessage ? <QuestionImageCard slot={currentQuestionSlot} /> : null}

            {!isLoadingCurrent && !currentErrorMessage ? (
              <View style={styles.actionSection}>
                <Text style={styles.actionHint}>选择结果后会自动进入下一题</Text>
                {REVIEW_ACTIONS.map((action) => (
                  <Pressable
                    key={action.value}
                    onPress={() => void handleSelectResult(action.value, action.statsKey)}
                    disabled={isSubmitting}
                    style={[
                      styles.resultButton,
                      action.tone === 'known'
                        ? styles.resultButtonKnown
                        : action.tone === 'fuzzy'
                          ? styles.resultButtonFuzzy
                          : styles.resultButtonUnknown,
                      isSubmitting ? styles.disabledControl : null,
                    ]}>
                    <Text style={styles.resultButtonText}>
                      {isSubmitting ? '记录中...' : action.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
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
            <Text style={styles.toastText}>{toastMessage}</Text>
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
  exitButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  exitButtonText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  progressCard: {
    borderRadius: radius.xl,
    gap: spacing.xs,
  },
  progressHeader: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  progressNumber: {
    ...typography.titleLarge,
    fontSize: 40,
    lineHeight: 46,
  },
  progressSubText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  progressTitle: {
    ...typography.sectionTitle,
    fontSize: 24,
    lineHeight: 32,
    marginTop: spacing.sm,
  },
  progressModule: {
    ...typography.body,
    color: colors.textSecondary,
  },
  questionCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  questionTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
  },
  questionImageWrap: {
    height: 320,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: spacing.md,
  },
  questionImageWrapEmpty: {
    borderStyle: 'dashed',
  },
  questionImage: {
    width: '100%',
    height: '100%',
  },
  questionPlaceholderText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  questionErrorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
  actionSection: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  actionHint: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  resultButton: {
    minHeight: 58,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  resultButtonKnown: {
    backgroundColor: '#0F5F2D',
    borderColor: '#0F5F2D',
  },
  resultButtonFuzzy: {
    backgroundColor: '#8A5A06',
    borderColor: '#8A5A06',
  },
  resultButtonUnknown: {
    backgroundColor: '#8E2323',
    borderColor: '#8E2323',
  },
  resultButtonText: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 28,
    color: colors.white,
    fontWeight: '800',
  },
  completeCard: {
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  completeTitle: {
    ...typography.titleMedium,
    fontSize: 34,
    lineHeight: 42,
  },
  completeSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  completeStatsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  completeStatCell: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  completeStatLabel: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  completeStatValue: {
    ...typography.sectionTitle,
    fontSize: 28,
    lineHeight: 34,
  },
  stateCard: {
    borderRadius: radius.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  stateTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
    textAlign: 'center',
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  stateActionRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stateActionButton: {
    flex: 1,
  },
  stateActionButtonLight: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stateActionButtonLightText: {
    color: colors.textPrimary,
  },
  disabledControl: {
    opacity: 0.6,
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
