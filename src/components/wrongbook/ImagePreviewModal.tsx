import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Logger } from '@/src/services/Logger';
import { colors, spacing, typography } from '@/src/styles/tokens';

export type ImagePreviewModalImageActionItem = {
  uri: string;
  title: string;
};

export type ImagePreviewModalLongPressHelpers = {
  showToast: (message: string) => void;
};

export interface ImagePreviewModalProps {
  visible: boolean;
  uri: string | null;
  title: string;
  onClose: () => void;
  interactionMode?: 'legacy' | 'zoomable';
  logSource?: string;
  onImageLongPress?: (
    item: ImagePreviewModalImageActionItem,
    helpers: ImagePreviewModalLongPressHelpers,
  ) => void;
}

type Size = {
  width: number;
  height: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2;
const LEGACY_DOUBLE_TAP_DELAY = 300;
const EDGE_RESISTANCE = 0.22;
const TAP_GUARD_RELEASE_DELAY_MS = 240;
const SPRING_CONFIG = {
  damping: 18,
  stiffness: 220,
  mass: 0.9,
} as const;

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

function normalizeUri(uri: string | null): string | null {
  if (typeof uri !== 'string') {
    return null;
  }

  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
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

export function ImagePreviewModal({
  visible,
  uri,
  title,
  onClose,
  interactionMode = 'legacy',
  logSource = 'unknown',
  onImageLongPress,
}: ImagePreviewModalProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [intrinsicSize, setIntrinsicSize] = useState<Size | null>(null);
  const [containerSizeState, setContainerSizeState] = useState<Size>({ width: 0, height: 0 });
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const lastTapRef = useRef(0);
  const gestureSessionRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scale = useSharedValue(MIN_SCALE);
  const pinchStartScale = useSharedValue(MIN_SCALE);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartX = useSharedValue(0);
  const pinchStartY = useSharedValue(0);
  const containerWidth = useSharedValue(0);
  const containerHeight = useSharedValue(0);
  const contentWidth = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const suppressSingleTap = useSharedValue(0);

  const normalizedUri = useMemo(() => normalizeUri(uri), [uri]);
  const canShowImage = visible && !!normalizedUri && !imageFailed;
  const headerTitle = title.trim().length > 0 ? title : '图片预览';
  const isZoomable = interactionMode === 'zoomable';
  const previewLogScope = `ImagePreviewModal:${logSource}`;
  const containedSize = useMemo(
    () => computeContainedSize(containerSizeState, intrinsicSize),
    [containerSizeState, intrinsicSize],
  );

  function buildLogMetadata(extra?: Record<string, unknown>) {
    return {
      visible,
      title: headerTitle,
      interactionMode,
      hasUri: !!normalizedUri,
      imageFailed,
      intrinsicWidth: intrinsicSize?.width ?? 0,
      intrinsicHeight: intrinsicSize?.height ?? 0,
      containerWidth: containerSizeState.width,
      containerHeight: containerSizeState.height,
      contentWidth: containedSize.width,
      contentHeight: containedSize.height,
      ...extra,
    };
  }

  function logInfo(eventName: string, extra?: Record<string, unknown>) {
    Logger.info(previewLogScope, eventName, buildLogMetadata(extra));
  }

  function handleClose(reason: string, extra?: Record<string, unknown>) {
    logInfo(reason, extra);
    onClose();
  }

  useEffect(() => {
    setImageFailed(false);
    setIntrinsicSize(null);
    setContainerSizeState({ width: 0, height: 0 });
    lastTapRef.current = 0;
    scale.value = MIN_SCALE;
    pinchStartScale.value = MIN_SCALE;
    translateX.value = 0;
    translateY.value = 0;
    panStartX.value = 0;
    panStartY.value = 0;
    pinchStartX.value = 0;
    pinchStartY.value = 0;
    suppressSingleTap.value = 0;
    contentWidth.value = 0;
    contentHeight.value = 0;
  }, [
    contentHeight,
    contentWidth,
    normalizedUri,
    panStartX,
    panStartY,
    pinchStartScale,
    pinchStartX,
    pinchStartY,
    scale,
    suppressSingleTap,
    translateX,
    translateY,
    visible,
  ]);

  useEffect(() => {
    if (visible) {
      return;
    }

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastVisible(false);
  }, [visible]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    },
    [],
  );

  const showPreviewToast = useCallback((message: string) => {
    const nextMessage = message.trim();
    if (!nextMessage) {
      return;
    }

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }

    setToastMessage(nextMessage);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, 1400);
  }, []);

  const handleImageLongPress = useCallback(() => {
    if (!normalizedUri || !onImageLongPress) {
      return;
    }

    onImageLongPress(
      {
        uri: normalizedUri,
        title: headerTitle,
      },
      { showToast: showPreviewToast },
    );
  }, [headerTitle, normalizedUri, onImageLongPress, showPreviewToast]);

  useEffect(() => {
    Logger.info(
      previewLogScope,
      visible ? 'preview_visible' : 'preview_hidden',
      buildLogMetadata({
        uriLength: normalizedUri?.length ?? 0,
      }),
    );
  }, [
    containedSize.height,
    containedSize.width,
    containerSizeState.height,
    containerSizeState.width,
    headerTitle,
    imageFailed,
    intrinsicSize,
    interactionMode,
    normalizedUri,
    previewLogScope,
    visible,
  ]);

  useEffect(() => {
    if (!normalizedUri) {
      return;
    }

    let cancelled = false;
    Image.getSize(
      normalizedUri,
      (width, height) => {
        if (cancelled) {
          return;
        }

        const nextSize = { width, height };
        setIntrinsicSize(nextSize);
        Logger.info(previewLogScope, 'preview_image_intrinsic_measured', buildLogMetadata(nextSize));
      },
      () => {
        if (cancelled) {
          return;
        }

        Logger.warn(previewLogScope, 'preview_image_intrinsic_measure_failed', buildLogMetadata());
        setIntrinsicSize(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [normalizedUri, previewLogScope]);

  useEffect(() => {
    contentWidth.value = containedSize.width;
    contentHeight.value = containedSize.height;

    if (containedSize.width > 0 && containedSize.height > 0) {
      Logger.info(
        previewLogScope,
        'preview_content_size_resolved',
        buildLogMetadata({
          resolvedContentWidth: containedSize.width,
          resolvedContentHeight: containedSize.height,
        }),
      );
    }
  }, [
    containedSize.height,
    containedSize.width,
    contentHeight,
    contentWidth,
    previewLogScope,
  ]);

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const singleTapGesture = Gesture.Tap()
    .enabled(isZoomable)
    .shouldCancelWhenOutside(false)
    .maxDuration(250)
    .onEnd((_event, success) => {
      if (!success) {
        return;
      }
      if (suppressSingleTap.value > 0.5) {
        return;
      }

      runOnJS(handleClose)('preview_single_tap_close', {
        scale: scale.value,
        translateX: translateX.value,
        translateY: translateY.value,
      });
    });

  const doubleTapGesture = Gesture.Tap()
    .enabled(isZoomable)
    .shouldCancelWhenOutside(false)
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((event, success) => {
      if (!success) {
        return;
      }

      const currentScale = scale.value;
      const nextScale = currentScale > MIN_SCALE + 0.05 ? MIN_SCALE : DOUBLE_TAP_SCALE;
      runOnJS(logInfo)('preview_double_tap', {
        tapX: event.x,
        tapY: event.y,
        currentScale,
        nextScale,
      });

      if (nextScale <= MIN_SCALE) {
        scale.value = withSpring(MIN_SCALE, SPRING_CONFIG);
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        panStartX.value = 0;
        panStartY.value = 0;
        runOnJS(logInfo)('preview_double_tap_reset');
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

      runOnJS(logInfo)('preview_double_tap_zoom_target', {
        focalX,
        focalY,
        nextTranslateX,
        nextTranslateY,
      });
    });

  const pinchGesture = Gesture.Pinch()
    .enabled(isZoomable)
    .shouldCancelWhenOutside(false)
    .onStart((event) => {
      gestureSessionRef.current += 1;
      pinchStartScale.value = scale.value;
      pinchStartX.value = translateX.value;
      pinchStartY.value = translateY.value;
      runOnJS(logInfo)('preview_pinch_start', {
        sessionId: gestureSessionRef.current,
        scale: scale.value,
        focalX: event.focalX,
        focalY: event.focalY,
      });
    })
    .onUpdate((event) => {
      const nextScale = clampScale(pinchStartScale.value * event.scale);
      const focalX = event.focalX - (containerWidth.value / 2);
      const focalY = event.focalY - (containerHeight.value / 2);
      const scaleRatio = nextScale / pinchStartScale.value;

      const rawTranslateX =
        pinchStartX.value + ((1 - scaleRatio) * (focalX - pinchStartX.value));
      const rawTranslateY =
        pinchStartY.value + ((1 - scaleRatio) * (focalY - pinchStartY.value));

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

      runOnJS(logInfo)('preview_pinch_end', {
        sessionId: gestureSessionRef.current,
        nextScale,
        nextTranslateX: nextScale <= MIN_SCALE ? 0 : nextTranslateX,
        nextTranslateY: nextScale <= MIN_SCALE ? 0 : nextTranslateY,
      });
    });

  const panGesture = Gesture.Pan()
    .enabled(isZoomable)
    .shouldCancelWhenOutside(false)
    .minDistance(1)
    .maxPointers(1)
    .onStart(() => {
      gestureSessionRef.current += 1;
      panStartX.value = translateX.value;
      panStartY.value = translateY.value;
      runOnJS(logInfo)('preview_pan_start', {
        sessionId: gestureSessionRef.current,
        scale: scale.value,
        translateX: translateX.value,
        translateY: translateY.value,
      });
    })
    .onUpdate((event) => {
      if (scale.value <= MIN_SCALE + 0.01) {
        translateX.value = 0;
        translateY.value = 0;
        return;
      }

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
    })
    .onEnd(() => {
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

      if (scale.value <= MIN_SCALE + 0.01) {
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        panStartX.value = 0;
        panStartY.value = 0;
      } else {
        translateX.value = withSpring(nextTranslateX, SPRING_CONFIG);
        translateY.value = withSpring(nextTranslateY, SPRING_CONFIG);
        panStartX.value = nextTranslateX;
        panStartY.value = nextTranslateY;
      }

      runOnJS(logInfo)('preview_pan_end', {
        sessionId: gestureSessionRef.current,
        scale: scale.value,
        nextTranslateX: scale.value <= MIN_SCALE + 0.01 ? 0 : nextTranslateX,
        nextTranslateY: scale.value <= MIN_SCALE + 0.01 ? 0 : nextTranslateY,
      });
    });

  const longPressGesture = Gesture.LongPress()
    .enabled(isZoomable && !!normalizedUri && typeof onImageLongPress === 'function')
    .shouldCancelWhenOutside(false)
    .minDuration(520)
    .maxDistance(12)
    .onStart(() => {
      suppressSingleTap.value = 1;
      runOnJS(handleImageLongPress)();
    })
    .onEnd(() => {
      suppressSingleTap.value = withDelay(
        TAP_GUARD_RELEASE_DELAY_MS,
        withTiming(0, { duration: 80 }),
      );
    });

  const gesture = Gesture.Simultaneous(
    pinchGesture,
    panGesture,
    longPressGesture,
    Gesture.Exclusive(doubleTapGesture, singleTapGesture),
  );

  const handleLegacyContentPress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < LEGACY_DOUBLE_TAP_DELAY) {
      handleClose('preview_legacy_double_tap_close');
      lastTapRef.current = 0;
      return;
    }

    logInfo('preview_legacy_single_tap_waiting_second_tap');
    lastTapRef.current = now;
  };

  const content = canShowImage ? (
    <>
      {isZoomable ? (
        <Animated.View style={[styles.imageWrap, animatedImageStyle]}>
          <Image
            source={{ uri: normalizedUri }}
            resizeMode="contain"
            style={styles.image}
            onError={() => {
              Logger.warn(previewLogScope, 'preview_image_load_failed', buildLogMetadata());
              setImageFailed(true);
            }}
          />
        </Animated.View>
      ) : (
        <Image
          source={{ uri: normalizedUri }}
          resizeMode="contain"
          style={styles.image}
          onError={() => {
            Logger.warn(previewLogScope, 'preview_image_load_failed', buildLogMetadata());
            setImageFailed(true);
          }}
        />
      )}

      <View pointerEvents="none" style={styles.gestureHintWrap}>
        <Text style={styles.gestureHintText}>
          {isZoomable ? '单击关闭 · 双击放大 · 双指缩放 · 拖动查看' : '双击关闭预览'}
        </Text>
      </View>
    </>
  ) : (
    <Text style={styles.errorText}>
      {normalizedUri ? '图片加载失败，请返回重试。' : '暂无可预览图片。'}
    </Text>
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      onRequestClose={() => handleClose('preview_system_request_close')}>
      <GestureHandlerRootView
        style={styles.modalRoot}
        onLayout={() => {
          Logger.info(
            previewLogScope,
            'preview_modal_root_ready',
            buildLogMetadata({ isZoomable }),
          );
        }}>
        <View style={styles.overlay}>
          <View style={styles.header}>
            <Text numberOfLines={1} style={styles.title}>
              {headerTitle}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.closeButton}
              onPress={() => handleClose('preview_close_button_press')}>
              <Text style={styles.closeButtonText}>关闭</Text>
            </Pressable>
          </View>

          {isZoomable ? (
            <GestureDetector gesture={gesture}>
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel="图片预览，单击关闭，双击放大或缩小，支持双指缩放和拖动查看"
                onLayout={(event) => {
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

                  Logger.info(
                    previewLogScope,
                    'preview_layout_measured',
                    buildLogMetadata({
                      width: nextWidth,
                      height: nextHeight,
                    }),
                  );
                }}
                style={styles.content}>
                {content}
              </View>
            </GestureDetector>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="双击关闭预览"
              style={({ pressed }) => [styles.content, pressed && styles.contentPressed]}
              onPress={handleLegacyContentPress}>
              {content}
            </Pressable>
          )}

          {toastVisible ? (
            <View pointerEvents="none" style={styles.toastWrap}>
              <View style={styles.toastBubble}>
                <Text style={styles.toastText}>{toastMessage}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: colors.black,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.white,
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
  },
  closeButton: {
    minHeight: 36,
    minWidth: 56,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4A4A4A',
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  contentPressed: {
    opacity: 0.96,
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
  errorText: {
    ...typography.body,
    color: '#D8D8D8',
    textAlign: 'center',
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
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastBubble: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.32)',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  toastText: {
    ...typography.bodySmall,
    color: '#F3F4F6',
    fontWeight: '600',
  },
});
