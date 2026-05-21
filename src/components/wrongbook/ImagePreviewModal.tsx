import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Logger } from '@/src/services/Logger';
import { colors, spacing, typography } from '@/src/styles/tokens';

export interface ImagePreviewModalProps {
  visible: boolean;
  uri: string | null;
  title: string;
  onClose: () => void;
  interactionMode?: 'legacy' | 'zoomable';
  logSource?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2;
const LEGACY_DOUBLE_TAP_DELAY = 300;
const SPRING_CONFIG = {
  damping: 18,
  stiffness: 220,
  mass: 0.9,
} as const;

function clampScale(value: number): number {
  'worklet';

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function getTranslationLimit(containerSize: number, scale: number): number {
  'worklet';

  if (!Number.isFinite(containerSize) || containerSize <= 0 || scale <= MIN_SCALE) {
    return 0;
  }

  return ((containerSize * scale) - containerSize) / 2;
}

function clampTranslation(value: number, containerSize: number, scale: number): number {
  'worklet';

  const limit = getTranslationLimit(containerSize, scale);
  if (limit <= 0) {
    return 0;
  }

  return Math.min(limit, Math.max(-limit, value));
}

function normalizeUri(uri: string | null): string | null {
  if (typeof uri !== 'string') {
    return null;
  }

  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function ImagePreviewModal({
  visible,
  uri,
  title,
  onClose,
  interactionMode = 'legacy',
  logSource = 'unknown',
}: ImagePreviewModalProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const lastTapRef = useRef(0);
  const gestureSessionRef = useRef(0);

  const scale = useSharedValue(MIN_SCALE);
  const pinchStartScale = useSharedValue(MIN_SCALE);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const containerWidth = useSharedValue(0);
  const containerHeight = useSharedValue(0);

  const normalizedUri = useMemo(() => normalizeUri(uri), [uri]);
  const canShowImage = visible && !!normalizedUri && !imageFailed;
  const headerTitle = title.trim().length > 0 ? title : '图片预览';
  const isZoomable = interactionMode === 'zoomable';
  const previewLogScope = `ImagePreviewModal:${logSource}`;

  function buildLogMetadata(extra?: Record<string, unknown>) {
    return {
      visible,
      title: headerTitle,
      interactionMode,
      hasUri: !!normalizedUri,
      imageFailed,
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
    lastTapRef.current = 0;
    scale.value = MIN_SCALE;
    pinchStartScale.value = MIN_SCALE;
    translateX.value = 0;
    translateY.value = 0;
    panStartX.value = 0;
    panStartY.value = 0;
  }, [normalizedUri, panStartX, panStartY, pinchStartScale, scale, translateX, translateY, visible]);

  useEffect(() => {
    Logger.info(
      previewLogScope,
      visible ? 'preview_visible' : 'preview_hidden',
      buildLogMetadata({
        uriLength: normalizedUri?.length ?? 0,
      }),
    );
  }, [headerTitle, imageFailed, interactionMode, normalizedUri, previewLogScope, visible]);

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  const singleTapGesture = Gesture.Tap()
    .enabled(isZoomable)
    .maxDuration(250)
    .onEnd((_event, success) => {
      if (!success) {
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
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((event, success) => {
      if (!success) {
        return;
      }

      const nextScale = scale.value > MIN_SCALE + 0.05 ? MIN_SCALE : DOUBLE_TAP_SCALE;
      runOnJS(logInfo)('preview_double_tap', {
        tapX: event.x,
        tapY: event.y,
        currentScale: scale.value,
        nextScale,
        containerWidth: containerWidth.value,
        containerHeight: containerHeight.value,
      });

      scale.value = withSpring(nextScale, SPRING_CONFIG);
      pinchStartScale.value = nextScale;

      if (nextScale <= MIN_SCALE) {
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        panStartX.value = 0;
        panStartY.value = 0;
        runOnJS(logInfo)('preview_double_tap_reset', {
          nextScale,
        });
        return;
      }

      const offsetX = event.x - (containerWidth.value / 2);
      const offsetY = event.y - (containerHeight.value / 2);
      const nextTranslateX = clampTranslation(
        -offsetX * (nextScale - 1),
        containerWidth.value,
        nextScale,
      );
      const nextTranslateY = clampTranslation(
        -offsetY * (nextScale - 1),
        containerHeight.value,
        nextScale,
      );

      translateX.value = withSpring(nextTranslateX, SPRING_CONFIG);
      translateY.value = withSpring(nextTranslateY, SPRING_CONFIG);
      panStartX.value = nextTranslateX;
      panStartY.value = nextTranslateY;

      runOnJS(logInfo)('preview_double_tap_zoom_target', {
        offsetX,
        offsetY,
        nextTranslateX,
        nextTranslateY,
      });
    });

  const pinchGesture = Gesture.Pinch()
    .enabled(isZoomable)
    .onStart(() => {
      gestureSessionRef.current += 1;
      pinchStartScale.value = scale.value;
      runOnJS(logInfo)('preview_pinch_start', {
        sessionId: gestureSessionRef.current,
        scale: scale.value,
      });
    })
    .onEnd(() => {
      const nextScale = clampScale(scale.value);
      const nextTranslateX = clampTranslation(translateX.value, containerWidth.value, nextScale);
      const nextTranslateY = clampTranslation(translateY.value, containerHeight.value, nextScale);

      scale.value = withSpring(nextScale, SPRING_CONFIG);
      pinchStartScale.value = nextScale;

      if (nextScale <= MIN_SCALE) {
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

      runOnJS(logInfo)('preview_pinch_end', {
        sessionId: gestureSessionRef.current,
        nextScale,
        nextTranslateX: nextScale <= MIN_SCALE ? 0 : nextTranslateX,
        nextTranslateY: nextScale <= MIN_SCALE ? 0 : nextTranslateY,
      });
    })
    .onUpdate((event) => {
      const nextScale = clampScale(pinchStartScale.value * event.scale);
      scale.value = nextScale;
      translateX.value = clampTranslation(translateX.value, containerWidth.value, nextScale);
      translateY.value = clampTranslation(translateY.value, containerHeight.value, nextScale);
    });

  const panGesture = Gesture.Pan()
    .enabled(isZoomable)
    .minDistance(4)
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

      translateX.value = clampTranslation(
        panStartX.value + event.translationX,
        containerWidth.value,
        scale.value,
      );
      translateY.value = clampTranslation(
        panStartY.value + event.translationY,
        containerHeight.value,
        scale.value,
      );
    })
    .onEnd(() => {
      const nextTranslateX = clampTranslation(translateX.value, containerWidth.value, scale.value);
      const nextTranslateY = clampTranslation(translateY.value, containerHeight.value, scale.value);

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

  const gesture = Gesture.Simultaneous(
    pinchGesture,
    panGesture,
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
});
