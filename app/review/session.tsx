import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  type GestureResponderEvent,
  Image,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BrandHeader,
  calculateImagePreviewHeight,
  CardContainer,
  FloatingBottomCta,
  ImagePreviewModal,
  PrimaryButton,
  ScreenContainer,
} from '@/src/components';
import type { DetailImageSlot } from '@/src/models/MistakeDetailViewModel';
import type { ReviewResult } from '@/src/models/Mistake';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';
import { Logger } from '@/src/services/Logger';
import type { ReviewSessionQueueItem } from '@/src/services/ReviewSessionService';
import * as ReviewSessionService from '@/src/services/ReviewSessionService';
import type { VoiceNoteEntity } from '@/src/services/VoiceNoteService';
import * as VoiceNoteService from '@/src/services/VoiceNoteService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'ReviewSessionPage';
const TOAST_DURATION_DEFAULT = 2000;
const TOAST_DURATION_LONG = 3200;
const QUESTION_PREVIEW_MIN_HEIGHT = 112;
const QUESTION_PREVIEW_MAX_HEIGHT = 228;
const QUESTION_PREVIEW_EMPTY_HEIGHT = 148;
const QUESTION_PREVIEW_FALLBACK_HEIGHT = 148;
const VOICE_PLAYBACK_END_BUFFER_MS = 280;
const VOICE_RECORDING_MIN_DURATION_MS = 3000;
const VOICE_RECORDING_MAX_DURATION_MS = 3 * 60 * 1000;
const SWIPE_HINT_MESSAGE = '点击「不会 / 模糊 / 会了」后进入下一题';
const SWIPE_HINT_DURATION_MS = 1500;
const SWIPE_HINT_THROTTLE_MS = 1500;
const SWIPE_VERTICAL_DISTANCE_THRESHOLD = 40;
const SWIPE_VERTICAL_DOMINANCE_RATIO = 1.2;
const BUTTON_HINT_LIFT_DISTANCE = 4;

type ToastType = 'success' | 'info' | 'error';
type SessionState = 'loading' | 'empty' | 'error' | 'ready';
type SessionResultKey = 'known' | 'fuzzy' | 'unknown';

interface SessionResultStats {
  known: number;
  fuzzy: number;
  unknown: number;
}

type ImageDimensions = {
  width: number;
  height: number;
};

type QuestionImageSizeState = ImageDimensions | null | 'unresolved';
type PreviewImageState = {
  uri: string;
  title: string;
};

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

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getReviewActionSymbol(tone: 'known' | 'fuzzy' | 'unknown'): string {
  if (tone === 'known') {
    return '\u2713';
  }
  if (tone === 'fuzzy') {
    return '?';
  }
  return '\u00D7';
}

function formatDurationMs(durationMs: number): string {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(safeDurationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function toReviewRecordVoiceNote(value: VoiceNoteEntity | null): ReviewRecordVoiceNote | null {
  if (!value) {
    return null;
  }

  return {
    id: value.id,
    fileUri: value.fileUri,
    fileName: value.fileName,
    durationMs: value.durationMs,
    sizeBytes: value.sizeBytes,
    createdAt: value.createdAt,
  };
}

function pickSlotImageDimensions(slot?: DetailImageSlot): ImageDimensions | null {
  const candidates: [number | null | undefined, number | null | undefined][] = [
    [slot?.imageWidth, slot?.imageHeight],
    [slot?.width, slot?.height],
  ];

  for (const [widthValue, heightValue] of candidates) {
    if (isPositiveFinite(widthValue) && isPositiveFinite(heightValue)) {
      return {
        width: widthValue,
        height: heightValue,
      };
    }
  }

  return null;
}

function QuestionImageCard({
  slot,
  onPreview,
}: {
  slot?: DetailImageSlot;
  onPreview?: (uri: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [measuredDimensions, setMeasuredDimensions] = useState<QuestionImageSizeState>('unresolved');

  const normalizedUri = useMemo(() => {
    const rawUri = typeof slot?.uri === 'string' ? slot.uri.trim() : '';
    return rawUri.length > 0 ? rawUri : null;
  }, [slot?.uri]);

  const providedDimensions = useMemo(
    () => pickSlotImageDimensions(slot),
    [slot?.height, slot?.imageHeight, slot?.imageWidth, slot?.width],
  );

  const activeDimensions = useMemo(() => {
    if (providedDimensions) {
      return providedDimensions;
    }
    if (measuredDimensions && measuredDimensions !== 'unresolved') {
      return measuredDimensions;
    }
    return null;
  }, [measuredDimensions, providedDimensions]);

  useEffect(() => {
    setImageFailed(false);
    setMeasuredDimensions('unresolved');
  }, [normalizedUri]);

  useEffect(() => {
    if (!normalizedUri || providedDimensions || measuredDimensions !== 'unresolved') {
      return;
    }

    let cancelled = false;
    Image.getSize(
      normalizedUri,
      (nextWidth, nextHeight) => {
        if (cancelled) {
          return;
        }
        if (!isPositiveFinite(nextWidth) || !isPositiveFinite(nextHeight)) {
          setMeasuredDimensions(null);
          return;
        }
        setMeasuredDimensions({ width: nextWidth, height: nextHeight });
      },
      () => {
        if (cancelled) {
          return;
        }
        setMeasuredDimensions(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [measuredDimensions, normalizedUri, providedDimensions]);

  const computedPreviewHeight = useMemo(
    () =>
      calculateImagePreviewHeight({
        containerWidth: previewWidth,
        imageWidth: activeDimensions?.width,
        imageHeight: activeDimensions?.height,
        minHeight: QUESTION_PREVIEW_MIN_HEIGHT,
        maxHeight: QUESTION_PREVIEW_MAX_HEIGHT,
        fallbackHeight: QUESTION_PREVIEW_FALLBACK_HEIGHT,
      }),
    [activeDimensions?.height, activeDimensions?.width, previewWidth],
  );

  const handleQuestionImageLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (!isPositiveFinite(nextWidth)) {
      return;
    }

    setPreviewWidth((current) => {
      if (Math.abs(current - nextWidth) < 0.5) {
        return current;
      }
      return nextWidth;
    });
  }, []);

  const hasUri = !!normalizedUri;
  const canShowImage = hasUri && slot?.exists === true && !imageFailed;
  const fileMissing = hasUri && slot?.exists === false;
  const loadFailed = hasUri && slot?.exists === true && imageFailed;

  return (
    <CardContainer style={styles.questionCard} padding={spacing.lg}>
      <View style={styles.sectionHeaderRow}>
        <View style={styles.sectionIconWrap}>
          <MaterialIcons name="image" size={20} color="#16A34A" />
        </View>
        <Text style={styles.questionTitle}>题目图片</Text>
      </View>
      <View
        onLayout={handleQuestionImageLayout}
        style={[
          styles.questionImageWrap,
          hasUri ? { height: computedPreviewHeight } : styles.questionImageWrapEmpty,
          !hasUri ? { height: QUESTION_PREVIEW_EMPTY_HEIGHT } : null,
        ]}>
        {canShowImage ? (
          <View style={styles.questionImageFrame}>
            {onPreview ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="题目图片，点击查看大图"
                onPress={() => {
                  onPreview(normalizedUri!);
                }}
                style={({ pressed }) => [styles.questionImagePressable, pressed && styles.questionImagePressablePressed]}>
                <Image
                  source={{ uri: normalizedUri! }}
                  style={styles.questionImage}
                  resizeMode="contain"
                  onError={() => setImageFailed(true)}
                />
              </Pressable>
            ) : (
              <Image
                source={{ uri: normalizedUri! }}
                style={styles.questionImage}
                resizeMode="contain"
                onError={() => setImageFailed(true)}
              />
            )}
            {onPreview ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="查看题目大图"
                onPress={() => {
                  onPreview(normalizedUri!);
                }}
                style={styles.questionPreviewButton}>
                <Text style={styles.questionPreviewButtonText}>查看大图</Text>
              </Pressable>
            ) : null}
          </View>
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
  const navigation = useNavigation();
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
  const [previewImage, setPreviewImage] = useState<PreviewImageState | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);
  const [swipeHintVisible, setSwipeHintVisible] = useState(false);
  const [lastSwipeHintTime, setLastSwipeHintTime] = useState(0);
  const [voiceNote, setVoiceNote] = useState<VoiceNoteEntity | null>(null);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [isVoicePlaying, setIsVoicePlaying] = useState(false);
  const [isVoiceBusy, setIsVoiceBusy] = useState(false);
  const [actionBarHeight, setActionBarHeight] = useState(0);

  const queueRequestIdRef = useRef(0);
  const currentRequestIdRef = useRef(0);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSwipeHintTimeRef = useRef(0);
  const buttonsHintAnim = useRef(new Animated.Value(0)).current;
  const touchStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovedWithScrollRef = useRef(false);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const voicePlaybackResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceReplacePendingUriRef = useRef<string | null>(null);
  const voiceStopInProgressRef = useRef(false);
  const allowNextLeaveRef = useRef(false);

  const totalCount = queue.length;
  const hasRemaining = sessionState === 'ready' && currentIndex < totalCount;
  const isCompleted = sessionState === 'ready' && totalCount > 0 && currentIndex >= totalCount;
  const currentQueueItem = hasRemaining ? queue[currentIndex] ?? null : null;
  const currentQueueItemId = currentQueueItem?.id ?? null;

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

  const triggerButtonsHintAnimation = useCallback(() => {
    buttonsHintAnim.stopAnimation();
    buttonsHintAnim.setValue(0);
    Animated.sequence([
      Animated.timing(buttonsHintAnim, {
        toValue: 1,
        duration: 130,
        useNativeDriver: true,
      }),
      Animated.spring(buttonsHintAnim, {
        toValue: 0,
        speed: 22,
        bounciness: 3,
        useNativeDriver: true,
      }),
    ]).start();
  }, [buttonsHintAnim]);

  const showSwipeHint = useCallback(() => {
    if (
      sessionState !== 'ready' ||
      isCompleted ||
      isLoadingCurrent ||
      !!currentErrorMessage ||
      isSubmitting ||
      previewImage !== null
    ) {
      return;
    }

    const now = Date.now();
    const lastShownAt = Math.max(lastSwipeHintTimeRef.current, lastSwipeHintTime);
    if (now - lastShownAt < SWIPE_HINT_THROTTLE_MS) {
      return;
    }

    lastSwipeHintTimeRef.current = now;
    setLastSwipeHintTime(now);
    setSwipeHintVisible(true);
    triggerButtonsHintAnimation();
    showToast(SWIPE_HINT_MESSAGE, 'info', SWIPE_HINT_DURATION_MS);

    if (swipeHintTimerRef.current) {
      clearTimeout(swipeHintTimerRef.current);
      swipeHintTimerRef.current = null;
    }

    swipeHintTimerRef.current = setTimeout(() => {
      setSwipeHintVisible(false);
      swipeHintTimerRef.current = null;
    }, SWIPE_HINT_DURATION_MS);
  }, [
    currentErrorMessage,
    isCompleted,
    isLoadingCurrent,
    isSubmitting,
    lastSwipeHintTime,
    previewImage,
    sessionState,
    showToast,
    triggerButtonsHintAnimation,
  ]);

  const handleTouchStart = useCallback((event: GestureResponderEvent) => {
    touchMovedWithScrollRef.current = false;
    touchStartPointRef.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
    };
  }, []);

  const handleTouchEnd = useCallback(
    (event: GestureResponderEvent) => {
      const startPoint = touchStartPointRef.current;
      touchStartPointRef.current = null;

      if (!startPoint) {
        touchMovedWithScrollRef.current = false;
        return;
      }

      if (touchMovedWithScrollRef.current) {
        touchMovedWithScrollRef.current = false;
        return;
      }

      const dx = event.nativeEvent.pageX - startPoint.x;
      const dy = event.nativeEvent.pageY - startPoint.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDy < SWIPE_VERTICAL_DISTANCE_THRESHOLD) {
        return;
      }

      if (absDy <= absDx * SWIPE_VERTICAL_DOMINANCE_RATIO) {
        return;
      }

      showSwipeHint();
    },
    [showSwipeHint],
  );

  const handleScroll = useCallback(() => {
    touchMovedWithScrollRef.current = true;
  }, []);

  const clearVoicePlaybackResetTimer = useCallback(() => {
    if (voicePlaybackResetTimerRef.current) {
      clearTimeout(voicePlaybackResetTimerRef.current);
      voicePlaybackResetTimerRef.current = null;
    }
  }, []);

  const stopVoicePlayback = useCallback(
    async (showErrorToast = false) => {
      clearVoicePlaybackResetTimer();
      setIsVoicePlaying(false);

      const stopResult = await VoiceNoteService.stopPlaying();
      if (!stopResult.ok && showErrorToast) {
        showToast(toShortErrorMessage(stopResult.errorMessage), 'error', TOAST_DURATION_LONG);
      }
    },
    [clearVoicePlaybackResetTimer, showToast],
  );

  const discardCurrentVoiceRecording = useCallback(async () => {
    if (!isVoiceRecording) {
      return true;
    }

    setIsVoiceBusy(true);
    const discardResult = await VoiceNoteService.stopAndDiscardRecording();
    voiceReplacePendingUriRef.current = null;
    voiceRecordingStartedAtRef.current = null;
    voiceStopInProgressRef.current = false;
    setIsVoiceRecording(false);
    setRecordingElapsedMs(0);
    setIsVoiceBusy(false);

    if (!discardResult.ok) {
      Logger.warn(PAGE_SCOPE, 'stop_recording_failed', {
        reason: 'discard_recording_on_leave_failed',
        errorMessage: discardResult.errorMessage ?? null,
      });
      return false;
    }

    return true;
  }, [isVoiceRecording]);

  const confirmLeaveWhileRecording = useCallback(
    (onContinue: () => void) => {
      Alert.alert(
        '正在录音',
        '正在录音，离开后将放弃本次录音，是否继续？',
        [
          {
            text: '继续录音',
            style: 'cancel',
          },
          {
            text: '继续离开',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                await discardCurrentVoiceRecording();
                allowNextLeaveRef.current = true;
                onContinue();
              })();
            },
          },
        ],
      );
    },
    [discardCurrentVoiceRecording],
  );

  const startVoiceRecording = useCallback(
    async (isRerecord: boolean) => {
      if (isVoiceBusy || isVoiceRecording || isSubmitting || isLoadingCurrent || !!currentErrorMessage) {
        return;
      }

      setIsVoiceBusy(true);

      const permissionResult = await VoiceNoteService.requestPermission();
      if (!permissionResult.granted) {
        const friendlyMessage = '未获得麦克风权限，无法开始录音。';
        Logger.warn(PAGE_SCOPE, 'start_recording', {
          granted: false,
          canAskAgain: permissionResult.canAskAgain,
          status: permissionResult.status,
          permissionErrorMessage: permissionResult.errorMessage ?? null,
        });
        showToast(toShortErrorMessage(friendlyMessage), 'error', TOAST_DURATION_LONG);
        setIsVoiceBusy(false);
        return;
      }

      const existingUri = isRerecord ? voiceNote?.fileUri ?? null : null;
      voiceReplacePendingUriRef.current = existingUri;

      const startResult = await VoiceNoteService.startRecording();
      if (!startResult.ok) {
        voiceReplacePendingUriRef.current = null;
        Logger.warn(PAGE_SCOPE, 'start_recording', {
          granted: true,
          ok: false,
          errorMessage: startResult.errorMessage ?? null,
        });
        showToast(toShortErrorMessage(startResult.errorMessage), 'error', TOAST_DURATION_LONG);
        setIsVoiceBusy(false);
        return;
      }

      await stopVoicePlayback(false);
      setIsVoiceRecording(true);
      setRecordingElapsedMs(0);
      voiceRecordingStartedAtRef.current = Date.now();
      voiceStopInProgressRef.current = false;
      setIsVoiceBusy(false);
    },
    [
      currentErrorMessage,
      isLoadingCurrent,
      isSubmitting,
      isVoiceBusy,
      isVoiceRecording,
      stopVoicePlayback,
      showToast,
      voiceNote?.fileUri,
    ],
  );

  const stopAndSaveVoiceRecording = useCallback(
    async (trigger: 'manual' | 'auto_limit' = 'manual') => {
      if (!isVoiceRecording || isVoiceBusy || voiceStopInProgressRef.current) {
        return;
      }

      voiceStopInProgressRef.current = true;
      setIsVoiceBusy(true);
      const saveResult = await VoiceNoteService.stopAndSaveRecording();
      const replaceUri = voiceReplacePendingUriRef.current;

      voiceReplacePendingUriRef.current = null;
      voiceRecordingStartedAtRef.current = null;
      setIsVoiceRecording(false);
      setRecordingElapsedMs(0);

      if (!saveResult.ok) {
        Logger.warn(PAGE_SCOPE, 'stop_recording_failed', {
          trigger,
          reason: 'stop_and_save_failed',
          errorMessage: saveResult.errorMessage ?? null,
        });
        showToast(toShortErrorMessage(saveResult.errorMessage), 'error', TOAST_DURATION_LONG);
        setIsVoiceBusy(false);
        voiceStopInProgressRef.current = false;
        return;
      }

      const nextVoiceNote = saveResult.voiceNote;
      if (nextVoiceNote.durationMs < VOICE_RECORDING_MIN_DURATION_MS) {
        Logger.info(PAGE_SCOPE, 'stop_recording_failed', {
          trigger,
          reason: 'too_short',
          durationMs: nextVoiceNote.durationMs,
          minimumDurationMs: VOICE_RECORDING_MIN_DURATION_MS,
        });
        void VoiceNoteService.deleteVoiceNote(nextVoiceNote.fileUri);
        showToast('录音时间太短，请至少录3秒', 'info', TOAST_DURATION_LONG);
        setIsVoiceBusy(false);
        voiceStopInProgressRef.current = false;
        return;
      }

      setVoiceNote(nextVoiceNote);

      if (replaceUri && replaceUri !== nextVoiceNote.fileUri) {
        void VoiceNoteService.deleteVoiceNote(replaceUri);
      }

      if (trigger === 'auto_limit') {
        showToast('已达到3分钟上限，录音已保存', 'success', TOAST_DURATION_LONG);
      } else {
        showToast('语音讲解已保存', 'success');
      }
      setIsVoiceBusy(false);
      voiceStopInProgressRef.current = false;
    },
    [isVoiceBusy, isVoiceRecording, showToast],
  );

  const playVoiceNote = useCallback(async () => {
    if (!voiceNote || isVoiceBusy || isVoiceRecording) {
      return;
    }

    if (isVoicePlaying) {
      await stopVoicePlayback(true);
      return;
    }

    setIsVoiceBusy(true);
    const playResult = await VoiceNoteService.playVoiceNote(voiceNote.fileUri);
    if (!playResult.ok) {
      showToast(toShortErrorMessage(playResult.errorMessage), 'error', TOAST_DURATION_LONG);
      setIsVoiceBusy(false);
      return;
    }

    clearVoicePlaybackResetTimer();
    setIsVoicePlaying(true);
    voicePlaybackResetTimerRef.current = setTimeout(() => {
      setIsVoicePlaying(false);
      voicePlaybackResetTimerRef.current = null;
    }, Math.max(voiceNote.durationMs + VOICE_PLAYBACK_END_BUFFER_MS, 1000));
    setIsVoiceBusy(false);
  }, [
    clearVoicePlaybackResetTimer,
    isVoiceBusy,
    isVoicePlaying,
    isVoiceRecording,
    showToast,
    stopVoicePlayback,
    voiceNote,
  ]);

  const confirmRerecordVoiceNote = useCallback(() => {
    if (!voiceNote || isVoiceBusy || isVoiceRecording) {
      return;
    }

    Alert.alert(
      '确认重录',
      '重录将替换当前讲解，确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认重录',
          style: 'destructive',
          onPress: () => {
            void startVoiceRecording(true);
          },
        },
      ],
    );
  }, [isVoiceBusy, isVoiceRecording, startVoiceRecording, voiceNote]);

  const deleteCurrentVoiceNote = useCallback(async () => {
    if (!voiceNote || isVoiceBusy || isVoiceRecording) {
      return;
    }

    setIsVoiceBusy(true);
    await stopVoicePlayback(false);
    const deleteResult = await VoiceNoteService.deleteVoiceNote(voiceNote.fileUri);
    if (!deleteResult.ok) {
      showToast(toShortErrorMessage(deleteResult.errorMessage), 'info');
      setIsVoiceBusy(false);
      return;
    }

    setVoiceNote(null);
    setIsVoicePlaying(false);
    showToast('语音讲解已删除', 'info');
    setIsVoiceBusy(false);
  }, [isVoiceBusy, isVoiceRecording, showToast, stopVoicePlayback, voiceNote]);

  const confirmDeleteVoiceNote = useCallback(() => {
    if (!voiceNote || isVoiceBusy || isVoiceRecording) {
      return;
    }

    Alert.alert('确认删除', '删除后将无法恢复，确定删除吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void deleteCurrentVoiceNote();
        },
      },
    ]);
  }, [deleteCurrentVoiceNote, isVoiceBusy, isVoiceRecording, voiceNote]);

  const navigateHome = useCallback(() => {
    router.replace('/(tabs)' as never);
  }, [router]);

  const handleOpenQuestionPreview = useCallback((uri: string) => {
    const normalizedUri = uri.trim();
    if (!normalizedUri) {
      return;
    }
    setPreviewImage({
      uri: normalizedUri,
      title: '题目图片',
    });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewImage(null);
  }, []);

  const handleRequestExit = useCallback(() => {
    if (isVoiceRecording) {
      confirmLeaveWhileRecording(() => {
        navigateHome();
      });
      return;
    }

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
  }, [confirmLeaveWhileRecording, hasRemaining, isCompleted, isVoiceRecording, navigateHome]);

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

  useFocusEffect(
    useCallback(
      () => () => {
        void stopVoicePlayback(false);
      },
      [stopVoicePlayback],
    ),
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowNextLeaveRef.current) {
        allowNextLeaveRef.current = false;
        return;
      }

      if (!isVoiceRecording) {
        return;
      }

      event.preventDefault();
      confirmLeaveWhileRecording(() => {
        allowNextLeaveRef.current = true;
        navigation.dispatch(event.data.action);
      });
    });

    return unsubscribe;
  }, [confirmLeaveWhileRecording, isVoiceRecording, navigation]);

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
    setVoiceNote(null);
    setIsVoiceRecording(false);
    setRecordingElapsedMs(0);
    setIsVoicePlaying(false);
    voiceRecordingStartedAtRef.current = null;
    voiceReplacePendingUriRef.current = null;
    voiceStopInProgressRef.current = false;
    clearVoicePlaybackResetTimer();
    void VoiceNoteService.stopAndDiscardRecording();

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
  }, [clearVoicePlaybackResetTimer]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      if (swipeHintTimerRef.current) {
        clearTimeout(swipeHintTimerRef.current);
        swipeHintTimerRef.current = null;
      }
      clearVoicePlaybackResetTimer();
      void VoiceNoteService.stopPlaying();
      void VoiceNoteService.stopAndDiscardRecording();
    },
    [clearVoicePlaybackResetTimer],
  );

  useEffect(() => {
    if (!isVoiceRecording) {
      return;
    }

    const updateTimer = () => {
      const startedAt = voiceRecordingStartedAtRef.current;
      if (!startedAt) {
        return;
      }
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const roundedElapsedMs = Math.floor(elapsedMs / 1000) * 1000;
      setRecordingElapsedMs((current) => (current === roundedElapsedMs ? current : roundedElapsedMs));

      if (elapsedMs >= VOICE_RECORDING_MAX_DURATION_MS && !voiceStopInProgressRef.current) {
        void stopAndSaveVoiceRecording('auto_limit');
      }
    };

    updateTimer();
    const intervalId = setInterval(updateTimer, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isVoiceRecording, stopAndSaveVoiceRecording]);

  useEffect(() => {
    if (!currentQueueItemId) {
      setVoiceNote(null);
      setIsVoiceRecording(false);
      setRecordingElapsedMs(0);
      setIsVoicePlaying(false);
      voiceRecordingStartedAtRef.current = null;
      voiceReplacePendingUriRef.current = null;
      voiceStopInProgressRef.current = false;
      clearVoicePlaybackResetTimer();
      void VoiceNoteService.stopAndDiscardRecording();
      return;
    }

    setVoiceNote(null);
    setIsVoiceRecording(false);
    setRecordingElapsedMs(0);
    setIsVoicePlaying(false);
    voiceRecordingStartedAtRef.current = null;
    voiceReplacePendingUriRef.current = null;
    voiceStopInProgressRef.current = false;
    clearVoicePlaybackResetTimer();
    void stopVoicePlayback(false);
    void VoiceNoteService.stopAndDiscardRecording();
  }, [clearVoicePlaybackResetTimer, currentQueueItemId, stopVoicePlayback]);

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
      if (!currentQueueItem || !currentMeta || isLoadingCurrent || isSubmitting || isCompleted || isVoiceBusy) {
        return;
      }

      if (isVoiceRecording) {
        showToast('请先停止并保存语音讲解，再提交本题结果。', 'info');
        return;
      }

      if (isVoicePlaying) {
        await stopVoicePlayback(false);
      }

      setIsSubmitting(true);
      try {
        const submitResult = await ReviewSessionService.submitTodayReviewResult({
          mistakeId: currentQueueItem.id,
          reviewIndex: currentMeta.nextReviewIndex,
          result,
          voiceNote: toReviewRecordVoiceNote(voiceNote),
        });

        if (!submitResult.ok) {
          showToast(toShortErrorMessage(submitResult.errorMessage ?? '保存失败，请重试。'), 'error', TOAST_DURATION_LONG);
          return;
        }

        incrementStats(statsKey);
        const isLast = currentIndex >= totalCount - 1;
        if (submitResult.warningMessage) {
          showToast(toShortErrorMessage(submitResult.warningMessage), 'info', TOAST_DURATION_LONG);
        } else {
          showToast(isLast ? '已记录，今日复做完成' : '已记录，进入下一题', 'success');
        }
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
    [
      currentIndex,
      currentMeta,
      currentQueueItem,
      incrementStats,
      isCompleted,
      isLoadingCurrent,
      isSubmitting,
      isVoicePlaying,
      isVoiceBusy,
      isVoiceRecording,
      showToast,
      stopVoicePlayback,
      totalCount,
      voiceNote,
    ],
  );

  const progressCurrent = totalCount <= 0 ? 0 : Math.min(currentIndex + 1, totalCount);
  const reviewRound = currentMeta?.nextReviewIndex ?? currentQueueItem?.nextReviewIndex ?? 1;
  const showResultActions =
    sessionState === 'ready' && !isCompleted && !isLoadingCurrent && !currentErrorMessage;
  const actionBarBottomOffset = Math.max(insets.bottom + spacing.xs, spacing.xs);
  const fallbackActionBarHeight = 112;
  const effectiveActionBarHeight = actionBarHeight > 0 ? actionBarHeight : fallbackActionBarHeight;
  const contentBottomPadding = showResultActions
    ? actionBarBottomOffset + effectiveActionBarHeight + spacing.lg
    : spacing.xl;
  const toastBottomOffset = showResultActions
    ? actionBarBottomOffset + effectiveActionBarHeight + spacing.sm
    : insets.bottom + spacing.lg;

  return (
    <View style={styles.pageRoot}>
      <View pointerEvents="none" style={styles.pageGlowTop} />
      <View pointerEvents="none" style={styles.pageGlowBottom} />
      <ScreenContainer
        scroll
        style={styles.screenSafeArea}
        contentStyle={[styles.screenContent, { paddingBottom: contentBottomPadding }]}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}>
        <Pressable style={styles.exitButton} onPress={handleRequestExit}>
          <Text style={styles.exitButtonText}>退出今日复做</Text>
        </Pressable>

        <BrandHeader
          title="今日复做"
          subtitle=""
          style={styles.brandHeader}
          titleStyle={styles.brandHeaderTitle}
          subtitleStyle={styles.brandHeaderSubtitleHidden}
        />

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
              <View style={styles.progressMainRow}>
                <View style={styles.progressNumberRow}>
                  <Text style={styles.progressNumberCurrent}>{progressCurrent}</Text>
                  <Text style={styles.progressNumberSlash}> / </Text>
                  <Text style={styles.progressNumberTotal}>{totalCount}</Text>
                </View>
                <View style={styles.reviewPill}>
                  <Text style={styles.reviewPillText}>{`第 ${reviewRound} 刷`}</Text>
                </View>
              </View>
              <View style={styles.progressDivider} />
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

            {!isLoadingCurrent && !currentErrorMessage ? (
              <QuestionImageCard slot={currentQuestionSlot} onPreview={handleOpenQuestionPreview} />
            ) : null}

            {!isLoadingCurrent && !currentErrorMessage ? (
              <CardContainer style={styles.voiceCard} padding={spacing.lg}>
                <View style={styles.voiceHeaderRow}>
                  <View style={styles.voiceIconWrap}>
                    <MaterialIcons name={isVoiceRecording ? 'mic' : 'record-voice-over'} size={19} color="#0F766E" />
                  </View>
                  <View style={styles.voiceHeaderTextWrap}>
                    <Text style={styles.voiceTitle}>
                      {isVoiceRecording ? '正在录音' : '语音讲解'}
                    </Text>
                    {!isVoiceRecording && !voiceNote ? (
                      <Text style={styles.voiceDescription}>
                        {'讲一遍你的思路，下次更容易想起来'}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {isVoiceRecording ? (
                  <>
                    <Text style={styles.voiceTimerText}>{formatDurationMs(recordingElapsedMs)}</Text>
                    <Text style={styles.voiceHintText}>
                      {'说出关键条件、解题思路和容易错的地方'}
                    </Text>
                    <Pressable
                      disabled={isVoiceBusy}
                      onPress={() => {
                        void stopAndSaveVoiceRecording();
                      }}
                      style={({ pressed }) => [
                        styles.voiceMainButton,
                        styles.voiceMainButtonDanger,
                        (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                      ]}>
                      <Text style={styles.voiceMainButtonText}>
                        {isVoiceBusy ? '保存中...' : '停止并保存'}
                      </Text>
                    </Pressable>
                  </>
                ) : null}

                {!isVoiceRecording && !voiceNote ? (
                  <Pressable
                    disabled={isVoiceBusy}
                    onPress={() => {
                      void startVoiceRecording(false);
                    }}
                    style={({ pressed }) => [
                      styles.voiceMainButton,
                      (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                    ]}>
                    <Text style={styles.voiceMainButtonText}>
                      {isVoiceBusy ? '准备中...' : '录制讲解'}
                    </Text>
                  </Pressable>
                ) : null}

                {!isVoiceRecording && voiceNote ? (
                  <>
                    <Text style={styles.voiceDurationText}>
                      {`时长 ${formatDurationMs(voiceNote.durationMs)}`}
                    </Text>
                    <View style={styles.voiceActionRow}>
                      <Pressable
                        disabled={isVoiceBusy}
                        onPress={() => {
                          void playVoiceNote();
                        }}
                        style={({ pressed }) => [
                          styles.voiceActionButton,
                          styles.voiceActionButtonPlay,
                          (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                        ]}>
                        <Text style={styles.voiceActionButtonText}>
                          {isVoicePlaying ? '停止播放' : '播放'}
                        </Text>
                      </Pressable>
                      <Pressable
                        disabled={isVoiceBusy}
                        onPress={confirmRerecordVoiceNote}
                        style={({ pressed }) => [
                          styles.voiceActionButton,
                          (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                        ]}>
                        <Text style={styles.voiceActionButtonText}>重录</Text>
                      </Pressable>
                      <Pressable
                        disabled={isVoiceBusy}
                        onPress={confirmDeleteVoiceNote}
                        style={({ pressed }) => [
                          styles.voiceActionButton,
                          styles.voiceActionButtonDanger,
                          (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                        ]}>
                        <Text style={styles.voiceActionButtonDangerText}>删除</Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}
              </CardContainer>
            ) : null}

          </>
        ) : null}
      </ScreenContainer>

      <ImagePreviewModal
        visible={previewImage !== null}
        uri={previewImage?.uri ?? null}
        title={previewImage?.title ?? ''}
        interactionMode="zoomable"
        logSource="review_session"
        onClose={handleClosePreview}
      />

      {showResultActions ? (
        <FloatingBottomCta
          bottom={actionBarBottomOffset}
          hintActive={swipeHintVisible}
          hintText="选择结果后会自动进入下一题"
          onHeightChange={(nextHeight) => {
            setActionBarHeight((prev) => (prev === nextHeight ? prev : nextHeight));
          }}>
          <Animated.View
            style={[
              styles.actionRowAnimated,
              {
                transform: [
                  {
                    translateY: buttonsHintAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -BUTTON_HINT_LIFT_DISTANCE],
                    }),
                  },
                ],
              },
            ]}>
            <View style={styles.actionRow}>
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
                  <View style={styles.resultButtonContent}>
                    {isSubmitting ? null : <Text style={styles.resultButtonIcon}>{getReviewActionSymbol(action.tone)}</Text>}
                    <Text numberOfLines={1} style={styles.resultButtonText}>
                      {isSubmitting ? '记录中...' : action.label}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        </FloatingBottomCta>
      ) : null}

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
    backgroundColor: '#F8FAFC',
  },
  pageGlowTop: {
    position: 'absolute',
    top: -140,
    right: -96,
    width: 320,
    height: 320,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(34, 197, 94, 0.09)',
  },
  pageGlowBottom: {
    position: 'absolute',
    bottom: 20,
    left: -120,
    width: 260,
    height: 260,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(14, 165, 233, 0.07)',
  },
  screenSafeArea: {
    backgroundColor: 'transparent',
  },
  screenContent: {
    paddingTop: spacing.md,
    gap: spacing.md,
    backgroundColor: 'transparent',
  },
  brandHeader: {
    gap: spacing.xs,
  },
  brandHeaderTitle: {
    ...typography.titleLarge,
    fontSize: 30,
    lineHeight: 36,
    color: '#0F172A',
    fontWeight: '800',
  },
  brandHeaderSubtitleHidden: {
    display: 'none',
  },
  exitButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    marginLeft: -spacing.xs,
  },
  exitButtonText: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: '#334155',
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCFCE7',
  },
  progressCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  progressMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  progressNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  progressNumberCurrent: {
    ...typography.titleLarge,
    fontSize: 48,
    lineHeight: 54,
    color: '#059669',
    fontWeight: '800',
  },
  progressNumberSlash: {
    ...typography.titleMedium,
    marginHorizontal: spacing.xs,
    fontSize: 28,
    lineHeight: 34,
    color: '#059669',
    fontWeight: '700',
  },
  progressNumberTotal: {
    ...typography.titleLarge,
    fontSize: 40,
    lineHeight: 46,
    color: '#059669',
    fontWeight: '800',
  },
  reviewPill: {
    alignSelf: 'center',
    borderRadius: radius.pill,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  reviewPillText: {
    ...typography.bodySmall,
    color: '#166534',
    fontWeight: '700',
  },
  progressDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  progressTitle: {
    ...typography.sectionTitle,
    marginTop: 2,
    fontSize: 30,
    lineHeight: 36,
    color: colors.success,
    fontWeight: '800',
  },
  progressModule: {
    ...typography.body,
    color: colors.success,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  questionCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  questionTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
    color: '#1F2937',
  },
  questionImageWrap: {
    width: '100%',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#EEF2F7',
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  questionImageWrapEmpty: {
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
  },
  questionImageFrame: {
    width: '100%',
    height: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#F8FAFC',
  },
  questionImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  questionImagePressable: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionImagePressablePressed: {
    opacity: 0.92,
  },
  questionPreviewButton: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: 'rgba(248, 250, 252, 0.92)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  questionPreviewButtonText: {
    ...typography.caption,
    color: '#475569',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  questionPreviewHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
  },
  questionPlaceholderText: {
    ...typography.body,
    color: '#94A3B8',
    textAlign: 'center',
    fontWeight: '600',
  },
  questionErrorText: {
    ...typography.body,
    color: '#DC2626',
    textAlign: 'center',
    fontWeight: '600',
  },
  voiceCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  voiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  voiceIconWrap: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#CCFBF1',
  },
  voiceHeaderTextWrap: {
    flex: 1,
    gap: 2,
  },
  voiceTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 27,
    color: '#0F172A',
    fontWeight: '700',
  },
  voiceDescription: {
    ...typography.bodySmall,
    fontSize: 14,
    lineHeight: 19,
    color: '#64748B',
    fontWeight: '500',
  },
  voiceTimerText: {
    ...typography.titleMedium,
    fontSize: 28,
    lineHeight: 34,
    color: '#0F172A',
    fontWeight: '800',
  },
  voiceHintText: {
    ...typography.bodySmall,
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  voiceMainButton: {
    minHeight: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  voiceMainButtonDanger: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  voiceMainButtonText: {
    ...typography.bodySmall,
    color: '#1F2937',
    fontWeight: '700',
  },
  voiceDurationText: {
    ...typography.bodySmall,
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  voiceActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  voiceActionButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  voiceActionButtonPlay: {
    borderColor: '#99F6E4',
    backgroundColor: '#F0FDFA',
  },
  voiceActionButtonDanger: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  voiceActionButtonText: {
    ...typography.bodySmall,
    color: '#334155',
    fontWeight: '700',
  },
  voiceActionButtonDangerText: {
    ...typography.bodySmall,
    color: '#B91C1C',
    fontWeight: '700',
  },
  voiceButtonPressed: {
    opacity: 0.78,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionRowAnimated: {
    width: '100%',
  },
  resultButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  resultButtonKnown: {
    backgroundColor: '#22C55E',
    borderColor: '#16A34A',
  },
  resultButtonFuzzy: {
    backgroundColor: '#F59E0B',
    borderColor: '#D97706',
  },
  resultButtonUnknown: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  resultButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  resultButtonIcon: {
    ...typography.sectionTitle,
    fontSize: 16,
    lineHeight: 20,
    color: colors.white,
    fontWeight: '800',
  },
  resultButtonText: {
    ...typography.sectionTitle,
    fontSize: 17,
    lineHeight: 22,
    color: colors.white,
    fontWeight: '800',
    flexShrink: 1,
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
