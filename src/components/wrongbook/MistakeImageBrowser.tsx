import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { AppToast } from '@/src/components/ui/AppToast';
import { HighlightedText } from '@/src/components/wrongbook/TextNoteEditor';
import { useAutoHidingControls } from '@/src/hooks/useAutoHidingControls';
import { useAppToast } from '@/src/hooks/useAppToast';
import type { TextHighlightRange } from '@/src/models/TextHighlight';
import {
  markImageBrowserGestureGuideSeen,
  shouldShowImageBrowserGestureGuide,
} from '@/src/services/ImageBrowserGuideService';
import { colors, spacing, typography } from '@/src/styles/tokens';

export type MistakeImageBrowserItem = {
  id: string;
  uri: string;
  title: string;
  subtitle?: string;
  kind?: 'image' | 'text';
  text?: string;
  textHighlights?: TextHighlightRange[];
  relatedTextId?: string;
  relatedTextItemId?: string;
};

export type MistakeImageBrowserLongPressHelpers = {
  showToast: (message: string) => void;
};

export interface MistakeImageBrowserProps {
  visible: boolean;
  items: MistakeImageBrowserItem[];
  initialIndex: number;
  onClose: () => void;
  onImageLongPress?: (
    item: MistakeImageBrowserItem,
    helpers: MistakeImageBrowserLongPressHelpers,
  ) => void;
  onOpenRelatedText?: (item: MistakeImageBrowserItem) => void;
}

type Size = {
  width: number;
  height: number;
};

type NormalizedBrowserItem =
  | (MistakeImageBrowserItem & {
    kind: 'image';
    normalizedUri: string;
  })
  | (MistakeImageBrowserItem & {
    kind: 'text';
    text: string;
  });

type SwitchDirection = 'prev' | 'next';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2;
const EDGE_RESISTANCE = 0.22;
const PAGE_EDGE_RESISTANCE = 0.32;
const SWIPE_SWITCH_DISTANCE = 64;
const SWIPE_SWITCH_VELOCITY = 760;
const SWITCH_EXIT_DURATION_MS = 140;
const SWITCH_ENTER_DURATION_MS = 170;
const TAP_GUARD_RELEASE_DELAY_MS = 240;
const GESTURE_HINT_VISIBLE_DURATION_MS = 2_000;
const GESTURE_HINT_FADE_DURATION_MS = 220;
const TOOLBAR_FADE_DURATION_MS = 180;
const TEXT_SINGLE_TAP_DELAY_MS = 280;
const SPRING_CONFIG = {
  damping: 18,
  stiffness: 220,
  mass: 0.9,
} as const;

function normalizeUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }
  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0 || !Number.isFinite(index)) {
    return 0;
  }
  return Math.min(length - 1, Math.max(0, Math.floor(index)));
}

function clampScale(value: number): number {
  'worklet';
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function getTranslationLimit(contentSize: number, containerSize: number, scale: number): number {
  'worklet';

  if (!Number.isFinite(contentSize) || !Number.isFinite(containerSize)) {
    return 0;
  }
  if (contentSize <= 0 || containerSize <= 0 || scale <= MIN_SCALE) {
    return 0;
  }

  const scaledContentSize = contentSize * scale;
  if (scaledContentSize <= containerSize) {
    return 0;
  }
  return (scaledContentSize - containerSize) / 2;
}

function clampTranslation(value: number, contentSize: number, containerSize: number, scale: number): number {
  'worklet';

  const limit = getTranslationLimit(contentSize, containerSize, scale);
  if (limit <= 0) {
    return 0;
  }
  return Math.min(limit, Math.max(-limit, value));
}

function applyTranslationResistance(
  value: number,
  contentSize: number,
  containerSize: number,
  scale: number,
): number {
  'worklet';

  const limit = getTranslationLimit(contentSize, containerSize, scale);
  if (limit <= 0) {
    return 0;
  }

  if (value < -limit) {
    return -limit + ((value + limit) * EDGE_RESISTANCE);
  }
  if (value > limit) {
    return limit + ((value - limit) * EDGE_RESISTANCE);
  }
  return value;
}

function computeContainedSize(container: Size, intrinsic: Size | null): Size {
  if (container.width <= 0 || container.height <= 0) {
    return { width: 0, height: 0 };
  }
  if (!intrinsic || intrinsic.width <= 0 || intrinsic.height <= 0) {
    return container;
  }

  const scale = Math.min(container.width / intrinsic.width, container.height / intrinsic.height);
  return {
    width: intrinsic.width * scale,
    height: intrinsic.height * scale,
  };
}

type SwipeZoomImageStageProps = {
  uri: string;
  canSwipePrev: boolean;
  canSwipeNext: boolean;
  onRequestPrev: () => void;
  onRequestNext: () => void;
  onReachFirstBoundary: () => void;
  onReachLastBoundary: () => void;
  onToggleToolbar: () => void;
  onUserInteraction: () => void;
  isGestureHintVisible: boolean;
  onLongPressImage?: () => void;
};

function SwipeZoomImageStage({
  uri,
  canSwipePrev,
  canSwipeNext,
  onRequestPrev,
  onRequestNext,
  onReachFirstBoundary,
  onReachLastBoundary,
  onToggleToolbar,
  onUserInteraction,
  isGestureHintVisible,
  onLongPressImage,
}: SwipeZoomImageStageProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [intrinsicSize, setIntrinsicSize] = useState<Size | null>(null);
  const [containerSizeState, setContainerSizeState] = useState<Size>({ width: 0, height: 0 });

  const scale = useSharedValue(MIN_SCALE);
  const pinchStartScale = useSharedValue(MIN_SCALE);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartX = useSharedValue(0);
  const pinchStartY = useSharedValue(0);
  const pageTranslateY = useSharedValue(0);
  const containerWidth = useSharedValue(0);
  const containerHeight = useSharedValue(0);
  const contentWidth = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const hasPanMotion = useSharedValue(0);
  const suppressSingleTap = useSharedValue(0);
  const gestureHintOpacity = useSharedValue(0);

  const containedSize = useMemo(
    () => computeContainedSize(containerSizeState, intrinsicSize),
    [containerSizeState, intrinsicSize],
  );

  useEffect(() => {
    setImageFailed(false);
    setIntrinsicSize(null);

    scale.value = MIN_SCALE;
    pinchStartScale.value = MIN_SCALE;
    translateX.value = 0;
    translateY.value = 0;
    panStartX.value = 0;
    panStartY.value = 0;
    pinchStartX.value = 0;
    pinchStartY.value = 0;
    pageTranslateY.value = 0;
    contentWidth.value = 0;
    contentHeight.value = 0;
    hasPanMotion.value = 0;
    suppressSingleTap.value = 0;
  }, [
    contentHeight,
    contentWidth,
    hasPanMotion,
    pageTranslateY,
    panStartX,
    panStartY,
    pinchStartScale,
    pinchStartX,
    pinchStartY,
    scale,
    suppressSingleTap,
    translateX,
    translateY,
    uri,
  ]);

  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (cancelled) {
          return;
        }
        setIntrinsicSize({ width, height });
      },
      () => {
        if (cancelled) {
          return;
        }
        setIntrinsicSize(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [uri]);

  useEffect(() => {
    contentWidth.value = containedSize.width;
    contentHeight.value = containedSize.height;
  }, [containedSize.height, containedSize.width, contentHeight, contentWidth]);

  const animatedPageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pageTranslateY.value }],
  }));

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const animatedGestureHintStyle = useAnimatedStyle(() => ({
    opacity: gestureHintOpacity.value,
  }));

  useEffect(() => {
    gestureHintOpacity.value = withTiming(isGestureHintVisible ? 1 : 0, {
      duration: isGestureHintVisible ? 160 : GESTURE_HINT_FADE_DURATION_MS,
    });
  }, [gestureHintOpacity, isGestureHintVisible]);

  const singleTapGesture = Gesture.Tap()
    .shouldCancelWhenOutside(false)
    .maxDuration(250)
    .onEnd((_event, success) => {
      if (!success) {
        return;
      }
      if (hasPanMotion.value > 0.5 || suppressSingleTap.value > 0.5) {
        return;
      }
      runOnJS(onUserInteraction)();
      runOnJS(onToggleToolbar)();
    });

  const doubleTapGesture = Gesture.Tap()
    .shouldCancelWhenOutside(false)
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((event, success) => {
      if (!success) {
        return;
      }

      runOnJS(onUserInteraction)();

      const currentScale = scale.value;
      const nextScale = currentScale > MIN_SCALE + 0.05 ? MIN_SCALE : DOUBLE_TAP_SCALE;

      if (nextScale <= MIN_SCALE) {
        scale.value = withSpring(MIN_SCALE, SPRING_CONFIG);
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        panStartX.value = 0;
        panStartY.value = 0;
        return;
      }

      const focalX = event.x - (containerWidth.value / 2);
      const focalY = event.y - (containerHeight.value / 2);
      const scaleRatio = nextScale / currentScale;
      const nextTranslateX = clampTranslation(
        translateX.value + ((1 - scaleRatio) * (focalX - translateX.value)),
        contentWidth.value,
        containerWidth.value,
        nextScale,
      );
      const nextTranslateY = clampTranslation(
        translateY.value + ((1 - scaleRatio) * (focalY - translateY.value)),
        contentHeight.value,
        containerHeight.value,
        nextScale,
      );

      scale.value = withSpring(nextScale, SPRING_CONFIG);
      translateX.value = withSpring(nextTranslateX, SPRING_CONFIG);
      translateY.value = withSpring(nextTranslateY, SPRING_CONFIG);
      panStartX.value = nextTranslateX;
      panStartY.value = nextTranslateY;
      pinchStartScale.value = nextScale;
    });

  const pinchGesture = Gesture.Pinch()
    .shouldCancelWhenOutside(false)
    .onStart(() => {
      runOnJS(onUserInteraction)();
      pinchStartScale.value = scale.value;
      pinchStartX.value = translateX.value;
      pinchStartY.value = translateY.value;
      pageTranslateY.value = 0;
      suppressSingleTap.value = 1;
    })
    .onUpdate((event) => {
      const nextScale = clampScale(pinchStartScale.value * event.scale);
      const focalX = event.focalX - (containerWidth.value / 2);
      const focalY = event.focalY - (containerHeight.value / 2);
      const scaleRatio = nextScale / pinchStartScale.value;

      const rawTranslateX = pinchStartX.value + ((1 - scaleRatio) * (focalX - pinchStartX.value));
      const rawTranslateY = pinchStartY.value + ((1 - scaleRatio) * (focalY - pinchStartY.value));

      scale.value = nextScale;
      translateX.value = applyTranslationResistance(
        rawTranslateX,
        contentWidth.value,
        containerWidth.value,
        nextScale,
      );
      translateY.value = applyTranslationResistance(
        rawTranslateY,
        contentHeight.value,
        containerHeight.value,
        nextScale,
      );
    })
    .onEnd(() => {
      const nextScale = clampScale(scale.value);
      const nextTranslateX = clampTranslation(
        translateX.value,
        contentWidth.value,
        containerWidth.value,
        nextScale,
      );
      const nextTranslateY = clampTranslation(
        translateY.value,
        contentHeight.value,
        containerHeight.value,
        nextScale,
      );

      if (nextScale <= MIN_SCALE) {
        scale.value = withSpring(MIN_SCALE, SPRING_CONFIG);
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        panStartX.value = 0;
        panStartY.value = 0;
        pinchStartScale.value = MIN_SCALE;
      } else {
        scale.value = withSpring(nextScale, SPRING_CONFIG);
        translateX.value = withSpring(nextTranslateX, SPRING_CONFIG);
        translateY.value = withSpring(nextTranslateY, SPRING_CONFIG);
        panStartX.value = nextTranslateX;
        panStartY.value = nextTranslateY;
        pinchStartScale.value = nextScale;
      }

      suppressSingleTap.value = withDelay(
        TAP_GUARD_RELEASE_DELAY_MS,
        withTiming(0, { duration: 80 }),
      );
    });

  const panGesture = Gesture.Pan()
    .shouldCancelWhenOutside(false)
    .minDistance(1)
    .maxPointers(1)
    .onStart(() => {
      runOnJS(onUserInteraction)();
      hasPanMotion.value = 0;
      suppressSingleTap.value = 1;
      panStartX.value = translateX.value;
      panStartY.value = translateY.value;
    })
    .onUpdate((event) => {
      if (Math.abs(event.translationX) > 6 || Math.abs(event.translationY) > 6) {
        hasPanMotion.value = 1;
      }

      if (scale.value > MIN_SCALE + 0.01) {
        const rawTranslateX = panStartX.value + event.translationX;
        const rawTranslateY = panStartY.value + event.translationY;

        translateX.value = applyTranslationResistance(
          rawTranslateX,
          contentWidth.value,
          containerWidth.value,
          scale.value,
        );
        translateY.value = applyTranslationResistance(
          rawTranslateY,
          contentHeight.value,
          containerHeight.value,
          scale.value,
        );
        pageTranslateY.value = 0;
        return;
      }

      translateX.value = 0;
      translateY.value = 0;
      const rawPageShift = event.translationY;
      const draggingToPrev = rawPageShift > 0;
      const draggingToNext = rawPageShift < 0;

      if ((draggingToPrev && !canSwipePrev) || (draggingToNext && !canSwipeNext)) {
        pageTranslateY.value = rawPageShift * PAGE_EDGE_RESISTANCE;
        return;
      }

      pageTranslateY.value = rawPageShift;
    })
    .onEnd((event) => {
      if (scale.value > MIN_SCALE + 0.01) {
        const nextTranslateX = clampTranslation(
          translateX.value,
          contentWidth.value,
          containerWidth.value,
          scale.value,
        );
        const nextTranslateY = clampTranslation(
          translateY.value,
          contentHeight.value,
          containerHeight.value,
          scale.value,
        );

        translateX.value = withSpring(nextTranslateX, SPRING_CONFIG);
        translateY.value = withSpring(nextTranslateY, SPRING_CONFIG);
        panStartX.value = nextTranslateX;
        panStartY.value = nextTranslateY;
        pageTranslateY.value = withSpring(0, SPRING_CONFIG);
        suppressSingleTap.value = withDelay(
          TAP_GUARD_RELEASE_DELAY_MS,
          withTiming(0, { duration: 80 }),
        );
        hasPanMotion.value = withTiming(0, { duration: 130 });
        return;
      }

      const shiftY = pageTranslateY.value;
      const shouldPrev = shiftY > SWIPE_SWITCH_DISTANCE || event.velocityY > SWIPE_SWITCH_VELOCITY;
      const shouldNext = shiftY < -SWIPE_SWITCH_DISTANCE || event.velocityY < -SWIPE_SWITCH_VELOCITY;

      if (shouldPrev) {
        if (canSwipePrev) {
          runOnJS(onRequestPrev)();
        } else {
          runOnJS(onReachFirstBoundary)();
        }
      } else if (shouldNext) {
        if (canSwipeNext) {
          runOnJS(onRequestNext)();
        } else {
          runOnJS(onReachLastBoundary)();
        }
      }

      pageTranslateY.value = withSpring(0, SPRING_CONFIG);
      suppressSingleTap.value = withDelay(
        TAP_GUARD_RELEASE_DELAY_MS,
        withTiming(0, { duration: 80 }),
      );
      hasPanMotion.value = withTiming(0, { duration: 130 });
    });

  const longPressGesture = Gesture.LongPress()
    .shouldCancelWhenOutside(false)
    .minDuration(520)
    .maxDistance(12)
    .onStart(() => {
      runOnJS(onUserInteraction)();
      suppressSingleTap.value = 1;
      hasPanMotion.value = 1;
      if (onLongPressImage) {
        runOnJS(onLongPressImage)();
      }
    })
    .onEnd(() => {
      suppressSingleTap.value = withDelay(
        TAP_GUARD_RELEASE_DELAY_MS,
        withTiming(0, { duration: 80 }),
      );
      hasPanMotion.value = withTiming(0, { duration: 130 });
    });

  const gesture = Gesture.Simultaneous(
    pinchGesture,
    panGesture,
    longPressGesture,
    Gesture.Exclusive(doubleTapGesture, singleTapGesture),
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.stage, animatedPageStyle]}>
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel="图片预览，单击隐藏或显示工具栏，双击放大或缩小，支持双指缩放和拖动查看"
          onLayout={(event: LayoutChangeEvent) => {
            const nextWidth = event.nativeEvent.layout.width;
            const nextHeight = event.nativeEvent.layout.height;
            containerWidth.value = nextWidth;
            containerHeight.value = nextHeight;
            setContainerSizeState((current) => {
              if (
                Math.abs(current.width - nextWidth) < 0.5
                && Math.abs(current.height - nextHeight) < 0.5
              ) {
                return current;
              }
              return {
                width: nextWidth,
                height: nextHeight,
              };
            });
          }}
          style={styles.stageContent}>
          {!imageFailed ? (
            <Animated.View style={[styles.imageWrap, animatedImageStyle]}>
              <Image
                source={{ uri }}
                resizeMode="contain"
                style={styles.image}
                onError={() => {
                  setImageFailed(true);
                }}
              />
            </Animated.View>
          ) : (
            <Text style={styles.errorText}>图片加载失败，请返回重试。</Text>
          )}
          <Animated.View
            pointerEvents="none"
            style={[styles.gestureHintWrap, animatedGestureHintStyle]}>
            <Text style={styles.gestureHintText}>
              单击隐藏工具栏 · 上下滑动切图 · 双击放大 · 双指缩放 · 长按保存/分享
            </Text>
          </Animated.View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

type TextPreviewStageProps = {
  text: string;
  highlights?: TextHighlightRange[];
  canShowPrev: boolean;
  canShowNext: boolean;
  onRequestPrev: () => void;
  onRequestNext: () => void;
  controlsVisible: boolean;
  controlsOpacity: SharedValue<number>;
  onToggleControls: () => void;
  onUserInteraction: () => void;
  onCancelAutoHide: () => void;
};

function TextPreviewStage({
  text,
  highlights,
  canShowPrev,
  canShowNext,
  onRequestPrev,
  onRequestNext,
  controlsVisible,
  controlsOpacity,
  onToggleControls,
  onUserInteraction,
  onCancelAutoHide,
}: TextPreviewStageProps) {
  const touchStartRef = useRef<{ x: number; y: number; timestamp: number } | null>(null);
  const pendingTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatedControlsStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  const clearPendingTap = useCallback(() => {
    if (pendingTapTimerRef.current === null) {
      return;
    }

    clearTimeout(pendingTapTimerRef.current);
    pendingTapTimerRef.current = null;
  }, []);

  useEffect(() => clearPendingTap, [clearPendingTap]);

  const handleTouchStart = (event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent;
    touchStartRef.current = { x: pageX, y: pageY, timestamp: Date.now() };
  };

  const handleTouchEnd = (event: GestureResponderEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) {
      return;
    }

    const { pageX, pageY } = event.nativeEvent;
    const moved = Math.hypot(pageX - start.x, pageY - start.y);
    if (moved <= 10 && Date.now() - start.timestamp <= 250) {
      if (pendingTapTimerRef.current !== null) {
        clearPendingTap();
        return;
      }

      pendingTapTimerRef.current = setTimeout(() => {
        pendingTapTimerRef.current = null;
        onToggleControls();
      }, TEXT_SINGLE_TAP_DELAY_MS);
    }
  };

  return (
    <View style={styles.textStage}>
      <ScrollView
        accessibilityLabel="文字讲解全文"
        contentContainerStyle={styles.textScrollContent}
        onScrollBeginDrag={() => {
          clearPendingTap();
          touchStartRef.current = null;
          onUserInteraction();
        }}
        onTouchCancel={() => {
          clearPendingTap();
          touchStartRef.current = null;
        }}
        onTouchEnd={handleTouchEnd}
        onTouchStart={handleTouchStart}
        persistentScrollbar
        showsVerticalScrollIndicator>
        <HighlightedText
          value={text}
          emptyText="暂无文字讲解"
          highlights={highlights}
          selectable
          style={styles.textPreviewContent}
          emptyTextStyle={styles.errorText}
        />
      </ScrollView>
      <Animated.View
        pointerEvents={controlsVisible ? 'auto' : 'none'}
        style={[styles.textNavigation, animatedControlsStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看上一项内容"
          disabled={!canShowPrev}
          onPressIn={onCancelAutoHide}
          onPress={onRequestPrev}
          style={({ pressed }) => [
            styles.textNavigationButton,
            !canShowPrev && styles.textNavigationButtonDisabled,
            pressed && canShowPrev && styles.headerButtonPressed,
          ]}>
          <Text style={styles.textNavigationButtonText}>上一项</Text>
        </Pressable>
        <Text style={styles.textNavigationHint}>上下滚动查看全文</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看下一项内容"
          disabled={!canShowNext}
          onPressIn={onCancelAutoHide}
          onPress={onRequestNext}
          style={({ pressed }) => [
            styles.textNavigationButton,
            !canShowNext && styles.textNavigationButtonDisabled,
            pressed && canShowNext && styles.headerButtonPressed,
          ]}>
          <Text style={styles.textNavigationButtonText}>下一项</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function MistakeImageBrowser({
  visible,
  items,
  initialIndex,
  onClose,
  onImageLongPress,
  onOpenRelatedText,
}: MistakeImageBrowserProps) {
  const insets = useSafeAreaInsets();
  const normalizedItems = useMemo(() => {
    const result: NormalizedBrowserItem[] = [];
    for (const item of items) {
      if (item.kind === 'text') {
        const normalizedText = typeof item.text === 'string' ? item.text.trim() : '';
        if (!normalizedText) {
          continue;
        }
        result.push({
          ...item,
          kind: 'text',
          text: normalizedText,
        });
        continue;
      }

      const normalizedUri = normalizeUri(item.uri);
      if (!normalizedUri) {
        continue;
      }
      result.push({
        ...item,
        kind: 'image',
        normalizedUri,
      });
    }
    return result;
  }, [items]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isGestureHintVisible, setIsGestureHintVisible] = useState(false);
  const switchingRef = useRef(false);
  const stageHeightRef = useRef(0);
  const gestureGuideCheckedForOpenRef = useRef(false);
  const activeItem = normalizedItems[clampIndex(activeIndex, normalizedItems.length)] ?? null;
  const {
    props: toastProps,
    showToast: showBrowserToast,
    hideToast,
  } = useAppToast({ defaultDuration: 1400, animated: false });
  const {
    controlsVisible: isToolbarVisible,
    toggleControls,
    hideControls,
    cancelAutoHide,
  } = useAutoHidingControls(visible, activeItem?.id);
  const stageTranslateY = useSharedValue(0);
  const stageOpacity = useSharedValue(1);
  const toolbarOpacity = useSharedValue(1);

  const stageAnimatedStyle = useAnimatedStyle(() => ({
    opacity: stageOpacity.value,
    transform: [{ translateY: stageTranslateY.value }],
  }));

  const toolbarAnimatedStyle = useAnimatedStyle(() => ({
    opacity: toolbarOpacity.value,
  }));

  const hideGestureHint = useCallback(() => {
    setIsGestureHintVisible(false);
  }, []);

  const toggleToolbar = useCallback(() => {
    hideToast();
    toggleControls();
  }, [hideToast, toggleControls]);

  const handleViewingGesture = useCallback(() => {
    hideGestureHint();
    hideToast();
    hideControls();
  }, [hideControls, hideGestureHint, hideToast]);

  useEffect(() => {
    toolbarOpacity.value = withTiming(isToolbarVisible ? 1 : 0, {
      duration: TOOLBAR_FADE_DURATION_MS,
    });
  }, [isToolbarVisible, toolbarOpacity]);

  useEffect(() => {
    if (!isToolbarVisible) {
      hideGestureHint();
    }
  }, [hideGestureHint, isToolbarVisible]);

  const resolveStageTravelDistance = useCallback(() => {
    const measuredHeight = stageHeightRef.current;
    if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
      return 220;
    }
    return Math.max(160, measuredHeight * 0.42);
  }, []);

  const resolveStageEnterDistance = useCallback(() => {
    const measuredHeight = stageHeightRef.current;
    if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
      return 86;
    }
    return Math.max(72, measuredHeight * 0.22);
  }, []);

  const clearSwitchingFlag = useCallback(() => {
    switchingRef.current = false;
  }, []);

  const animateSwitchToIndex = useCallback(
    (targetIndex: number, direction: SwitchDirection) => {
      if (switchingRef.current) {
        return;
      }
      if (targetIndex < 0 || targetIndex >= normalizedItems.length || targetIndex === activeIndex) {
        return;
      }

      switchingRef.current = true;
      const exitSign = direction === 'next' ? -1 : 1;
      const enterSign = -exitSign;
      const exitDistance = resolveStageTravelDistance();
      const enterDistance = resolveStageEnterDistance();

      stageTranslateY.value = withTiming(
        exitSign * exitDistance,
        { duration: SWITCH_EXIT_DURATION_MS },
        (finished) => {
          if (!finished) {
            runOnJS(clearSwitchingFlag)();
            return;
          }

          runOnJS(setActiveIndex)(targetIndex);
          stageTranslateY.value = enterSign * enterDistance;
          stageOpacity.value = 0.92;
          stageTranslateY.value = withSpring(0, SPRING_CONFIG, (enterFinished) => {
            if (!enterFinished) {
              runOnJS(clearSwitchingFlag)();
              return;
            }
            runOnJS(clearSwitchingFlag)();
          });
          stageOpacity.value = withTiming(1, { duration: SWITCH_ENTER_DURATION_MS });
        },
      );
    },
    [
      activeIndex,
      clearSwitchingFlag,
      normalizedItems.length,
      resolveStageEnterDistance,
      resolveStageTravelDistance,
      stageOpacity,
      stageTranslateY,
    ],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }
    toolbarOpacity.value = 1;
    const safeInitialIndex = clampIndex(initialIndex, normalizedItems.length);
    setActiveIndex(safeInitialIndex);
    switchingRef.current = false;
    stageTranslateY.value = 0;
    stageOpacity.value = 1;
  }, [initialIndex, normalizedItems.length, stageOpacity, stageTranslateY, toolbarOpacity, visible]);

  useEffect(() => {
    if (visible) {
      return;
    }
    toolbarOpacity.value = 1;
    setIsGestureHintVisible(false);
    gestureGuideCheckedForOpenRef.current = false;
    switchingRef.current = false;
    stageTranslateY.value = 0;
    stageOpacity.value = 1;
    hideToast();
  }, [hideToast, stageOpacity, stageTranslateY, toolbarOpacity, visible]);

  const canSwipePrev = activeIndex > 0;
  const canSwipeNext = activeIndex < normalizedItems.length - 1;

  useEffect(() => {
    if (!visible || activeItem?.kind !== 'image' || gestureGuideCheckedForOpenRef.current) {
      return;
    }

    gestureGuideCheckedForOpenRef.current = true;
    let cancelled = false;
    void (async () => {
      const shouldShow = await shouldShowImageBrowserGestureGuide();
      if (cancelled || !shouldShow) {
        return;
      }

      setIsGestureHintVisible(true);
      void markImageBrowserGestureGuideSeen();
    })();

    return () => {
      cancelled = true;
    };
  }, [activeItem?.kind, visible]);

  useEffect(() => {
    if (!isGestureHintVisible) {
      return;
    }

    const timer = setTimeout(() => {
      setIsGestureHintVisible(false);
    }, GESTURE_HINT_VISIBLE_DURATION_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [isGestureHintVisible]);

  const handleSwitchPrev = useCallback(() => {
    animateSwitchToIndex(activeIndex - 1, 'prev');
  }, [activeIndex, animateSwitchToIndex]);

  const handleSwitchNext = useCallback(() => {
    animateSwitchToIndex(activeIndex + 1, 'next');
  }, [activeIndex, animateSwitchToIndex]);

  const handleOpenActiveText = useCallback(() => {
    if (!activeItem) {
      return;
    }
    if (activeItem.kind === 'image' && activeItem.relatedTextItemId) {
      const textIndex = normalizedItems.findIndex(
        (item) => item.id === activeItem.relatedTextItemId,
      );
      if (textIndex >= 0) {
        animateSwitchToIndex(textIndex, textIndex > activeIndex ? 'next' : 'prev');
      }
      return;
    }
    if (activeItem.kind === 'text' && activeItem.relatedTextId) {
      onOpenRelatedText?.(activeItem);
    }
  }, [activeIndex, activeItem, animateSwitchToIndex, normalizedItems, onOpenRelatedText]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      {visible ? (
        <StatusBar style="dark" backgroundColor={colors.imageViewerBackground} translucent />
      ) : null}
      <GestureHandlerRootView style={styles.modalRoot}>
        <View style={styles.overlay}>
          <Animated.View
            pointerEvents={isToolbarVisible ? 'box-none' : 'none'}
            style={[
              styles.header,
              {
                paddingTop: insets.top + spacing.sm,
                paddingLeft: insets.left + spacing.lg,
                paddingRight: insets.right + spacing.lg,
              },
              toolbarAnimatedStyle,
            ]}>
            <View pointerEvents="none" style={styles.headerTextWrap}>
              <Text numberOfLines={1} style={styles.title}>
                {activeItem?.title ?? '内容预览'}
              </Text>
              {activeItem?.subtitle ? (
                <Text numberOfLines={1} style={styles.subtitle}>
                  {activeItem.subtitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.headerActions}>
              {(activeItem?.kind === 'image' && activeItem.relatedTextItemId)
                || (activeItem?.kind === 'text' && activeItem.relatedTextId && onOpenRelatedText) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={activeItem.kind === 'text' ? '编辑本次文字讲解' : '查看本次复做的文字讲解'}
                  onPressIn={cancelAutoHide}
                  onPress={handleOpenActiveText}
                  style={({ pressed }) => [
                    styles.relatedTextButton,
                    pressed && styles.headerButtonPressed,
                  ]}>
                  <Text style={styles.relatedTextButtonText}>
                    {activeItem.kind === 'text' ? '编辑' : '文字讲解'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭全屏预览"
                onPressIn={cancelAutoHide}
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.headerButtonPressed,
                ]}>
                <MaterialIcons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>
          </Animated.View>

          <Animated.View
            style={[
              styles.body,
              activeItem?.kind === 'text'
                ? {
                    paddingTop: insets.top,
                    paddingBottom: insets.bottom,
                    paddingLeft: insets.left + spacing.md,
                    paddingRight: insets.right + spacing.md,
                  }
                : {
                    paddingTop: insets.top,
                    paddingBottom: insets.bottom,
                    paddingLeft: insets.left,
                    paddingRight: insets.right,
                  },
              stageAnimatedStyle,
            ]}
            onLayout={(event) => {
              const nextHeight = event.nativeEvent.layout.height;
              if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
                return;
              }
              stageHeightRef.current = nextHeight;
            }}>
            {activeItem?.kind === 'image' ? (
              <SwipeZoomImageStage
                key={activeItem.id}
                uri={activeItem.normalizedUri}
                canSwipePrev={canSwipePrev}
                canSwipeNext={canSwipeNext}
                onRequestPrev={handleSwitchPrev}
                onRequestNext={handleSwitchNext}
                onReachFirstBoundary={() => {
                  showBrowserToast('当前是第一项');
                }}
                onReachLastBoundary={() => {
                  showBrowserToast('当前是最后一项');
                }}
                onToggleToolbar={toggleToolbar}
                onUserInteraction={handleViewingGesture}
                isGestureHintVisible={isGestureHintVisible}
                onLongPressImage={() => {
                  onImageLongPress?.(activeItem, { showToast: showBrowserToast });
                }}
              />
            ) : activeItem?.kind === 'text' ? (
              <TextPreviewStage
                key={activeItem.id}
                text={activeItem.text}
                highlights={activeItem.textHighlights}
                canShowPrev={canSwipePrev}
                canShowNext={canSwipeNext}
                onRequestPrev={handleSwitchPrev}
                onRequestNext={handleSwitchNext}
                controlsVisible={isToolbarVisible}
                controlsOpacity={toolbarOpacity}
                onToggleControls={toggleToolbar}
                onUserInteraction={handleViewingGesture}
                onCancelAutoHide={cancelAutoHide}
              />
            ) : (
              <View style={styles.emptyWrap}>
                <Text style={styles.errorText}>暂无可预览内容。</Text>
              </View>
            )}
          </Animated.View>

          {activeItem ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.progressLayer,
                {
                  bottom: insets.bottom
                    + (activeItem.kind === 'text' ? 56 : spacing.sm),
                },
                toolbarAnimatedStyle,
              ]}>
              <View style={styles.progressWrap}>
                <Text style={styles.progressText}>
                  {activeIndex + 1} / {normalizedItems.length}
                </Text>
              </View>
            </Animated.View>
          ) : null}

          <AppToast
            {...toastProps}
            bottomOffset={spacing.xl}
          />
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: colors.imageViewerBackground,
  },
  overlay: {
    flex: 1,
    backgroundColor: colors.imageViewerBackground,
  },
  header: {
    position: 'absolute',
    zIndex: 2,
    top: 0,
    left: 0,
    right: 0,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.imageViewerBackground,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  relatedTextButton: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C4B5FD',
    backgroundColor: '#F5F3FF',
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  relatedTextButtonText: {
    ...typography.bodySmall,
    color: '#6D28D9',
    fontWeight: '700',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonPressed: {
    opacity: 0.72,
  },
  textStage: {
    flex: 1,
    borderRadius: spacing.md,
    backgroundColor: '#111827',
    overflow: 'hidden',
  },
  textScrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: 72,
  },
  textPreviewContent: {
    ...typography.body,
    color: colors.white,
    fontSize: 18,
    lineHeight: 30,
  },
  textNavigation: {
    position: 'absolute',
    zIndex: 1,
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    backgroundColor: '#111827',
    paddingHorizontal: spacing.sm,
  },
  textNavigationButton: {
    minHeight: 34,
    minWidth: 64,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  textNavigationButtonDisabled: {
    opacity: 0.35,
  },
  textNavigationButtonText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '700',
  },
  textNavigationHint: {
    ...typography.caption,
    flex: 1,
    color: '#C7D2FE',
    textAlign: 'center',
  },
  body: {
    flex: 1,
  },
  stage: {
    flex: 1,
  },
  stageContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  imageWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  progressLayer: {
    position: 'absolute',
    zIndex: 2,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  progressWrap: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  progressText: {
    ...typography.caption,
    color: '#E5E7EB',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  gestureHintWrap: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  gestureHintText: {
    ...typography.caption,
    color: '#E5E7EB',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
});
