import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File } from 'expo-file-system';

import { CardContainer, ScreenContainer } from '@/src/components';
import type { ImageSlot } from '@/src/services/ImageProcessService';
import * as ImageProcessService from '@/src/services/ImageProcessService';
import * as ImageStorageService from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';
import type { ManagedDetailImageType } from '@/src/services/MistakeDetailService';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import * as ReviewRecordImageService from '@/src/services/ReviewRecordImageService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'MistakeImageCropScreen';
const PREVIEW_STAGE_MIN_HEIGHT = 420;
const MIN_CROP_SIZE = 56;
const HANDLE_SIZE = 26;
const HANDLE_HIT_SLOP = 18;
const MOVE_AREA_INSET = 14;
const CORNER_MARK_SIZE = 10;
const CORNER_MARK_THICKNESS = 2;
const SAVE_DELAY_MS = 180;
const IS_CROP_DEBUG_ENABLED = __DEV__;

type Corner = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';

type ImageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ImageSize = {
  width: number;
  height: number;
};

type DebugProbePreview = {
  uri: string;
  width: number;
  height: number;
  fileSize: number;
  sourceSizeUsed: ImageSize;
  sourceSizeMeasured: ImageSize;
  normalizedCropRect: ImageProcessService.CropRect;
  createdAt: string;
};

type CropImageType = ManagedDetailImageType | 'review_solution';

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'success';
      mistakeId: string;
      imageSlot: ImageSlot;
      imageType: CropImageType;
      reviewRecordId: string | null;
      title: string;
      sourceUri: string;
      sourceWidth: number;
      sourceHeight: number;
      sourceIsTemporary: boolean;
      oldImageUri: string;
    };

const DEFAULT_CROP_PERCENT: Record<ImageSlot, { x: number; y: number; width: number; height: number }> = {
  question: { x: 0.05, y: 0.35, width: 0.9, height: 0.25 },
  solution: { x: 0.05, y: 0.2, width: 0.9, height: 0.6 },
  answer: { x: 0.05, y: 0.2, width: 0.9, height: 0.6 },
};

function normalizeRouteText(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeImageType(value: string | string[] | undefined): CropImageType | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'question' || raw === 'my_solution' || raw === 'answer' || raw === 'review_solution') {
    return raw;
  }
  return null;
}

function normalizeImageSlot(value: string | string[] | undefined): ImageSlot | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'question' || raw === 'solution' || raw === 'answer') {
    return raw;
  }
  return null;
}

function toShortUri(uri: string | null | undefined): string | null {
  if (!uri) {
    return null;
  }
  const normalized = uri.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 36)}...${normalized.slice(-28)}`;
}

function clamp(numberValue: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, numberValue));
}

function createCropDebugSessionId(): string {
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `crop-${Date.now().toString(36)}-${randomPart}`;
}

function getImageTitle(slot: ImageSlot, imageType: CropImageType): string {
  if (imageType === 'review_solution') {
    return '裁剪复做图片';
  }
  if (slot === 'question') {
    return '裁剪题目图片';
  }
  if (slot === 'solution') {
    return '裁剪我的做法';
  }
  return '裁剪答案解析';
}

function mapSlotToImageType(slot: ImageSlot): ManagedDetailImageType {
  if (slot === 'question') {
    return 'question';
  }
  if (slot === 'solution') {
    return 'my_solution';
  }
  return 'answer';
}

function mapImageTypeToSlot(type: CropImageType): ImageSlot {
  if (type === 'question') {
    return 'question';
  }
  if (type === 'my_solution') {
    return 'solution';
  }
  if (type === 'answer') {
    return 'answer';
  }
  return 'solution';
}

function buildDisplayedImageRect(container: ImageSize, imageSize: ImageSize): ImageRect | null {
  if (container.width <= 0 || container.height <= 0 || imageSize.width <= 0 || imageSize.height <= 0) {
    return null;
  }

  const containerRatio = container.width / container.height;
  const imageRatio = imageSize.width / imageSize.height;

  if (imageRatio > containerRatio) {
    const width = container.width;
    const height = width / imageRatio;
    return {
      x: 0,
      y: (container.height - height) / 2,
      width,
      height,
    };
  }

  const height = container.height;
  const width = height * imageRatio;
  return {
    x: (container.width - width) / 2,
    y: 0,
    width,
    height,
  };
}

function buildDefaultCropRect(displayedRect: ImageRect, slot: ImageSlot): ImageRect {
  const percent = DEFAULT_CROP_PERCENT[slot];
  return {
    x: displayedRect.x + displayedRect.width * percent.x,
    y: displayedRect.y + displayedRect.height * percent.y,
    width: Math.max(MIN_CROP_SIZE, displayedRect.width * percent.width),
    height: Math.max(MIN_CROP_SIZE, displayedRect.height * percent.height),
  };
}

function clampCropRect(rect: ImageRect, bounds: ImageRect): ImageRect {
  const minWidth = Math.min(MIN_CROP_SIZE, bounds.width);
  const minHeight = Math.min(MIN_CROP_SIZE, bounds.height);

  const width = clamp(rect.width, minWidth, bounds.width);
  const height = clamp(rect.height, minHeight, bounds.height);
  const maxX = bounds.x + bounds.width - width;
  const maxY = bounds.y + bounds.height - height;

  return {
    x: clamp(rect.x, bounds.x, maxX),
    y: clamp(rect.y, bounds.y, maxY),
    width,
    height,
  };
}

function moveCropRect(base: ImageRect, dx: number, dy: number, bounds: ImageRect): ImageRect {
  return clampCropRect(
    {
      x: base.x + dx,
      y: base.y + dy,
      width: base.width,
      height: base.height,
    },
    bounds,
  );
}

function resizeCropRect(base: ImageRect, corner: Corner, dx: number, dy: number, bounds: ImageRect): ImageRect {
  const minWidth = Math.min(MIN_CROP_SIZE, bounds.width);
  const minHeight = Math.min(MIN_CROP_SIZE, bounds.height);
  const baseRight = base.x + base.width;
  const baseBottom = base.y + base.height;

  if (corner === 'top_left') {
    const nextX = clamp(base.x + dx, bounds.x, baseRight - minWidth);
    const nextY = clamp(base.y + dy, bounds.y, baseBottom - minHeight);
    return clampCropRect(
      {
        x: nextX,
        y: nextY,
        width: baseRight - nextX,
        height: baseBottom - nextY,
      },
      bounds,
    );
  }

  if (corner === 'top_right') {
    const nextRight = clamp(baseRight + dx, base.x + minWidth, bounds.x + bounds.width);
    const nextY = clamp(base.y + dy, bounds.y, baseBottom - minHeight);
    return clampCropRect(
      {
        x: base.x,
        y: nextY,
        width: nextRight - base.x,
        height: baseBottom - nextY,
      },
      bounds,
    );
  }

  if (corner === 'bottom_left') {
    const nextX = clamp(base.x + dx, bounds.x, baseRight - minWidth);
    const nextBottom = clamp(baseBottom + dy, base.y + minHeight, bounds.y + bounds.height);
    return clampCropRect(
      {
        x: nextX,
        y: base.y,
        width: baseRight - nextX,
        height: nextBottom - base.y,
      },
      bounds,
    );
  }

  const nextRight = clamp(baseRight + dx, base.x + minWidth, bounds.x + bounds.width);
  const nextBottom = clamp(baseBottom + dy, base.y + minHeight, bounds.y + bounds.height);
  return clampCropRect(
    {
      x: base.x,
      y: base.y,
      width: nextRight - base.x,
      height: nextBottom - base.y,
    },
    bounds,
  );
}

function parseCropRectToSourceRect(
  cropBox: ImageRect,
  displayedImageRect: ImageRect,
  sourceImageSize: ImageSize,
): ImageProcessService.CropRect | null {
  if (
    displayedImageRect.width <= 0
    || displayedImageRect.height <= 0
    || sourceImageSize.width <= 0
    || sourceImageSize.height <= 0
  ) {
    return null;
  }

  const relativeX = (cropBox.x - displayedImageRect.x) / displayedImageRect.width;
  const relativeY = (cropBox.y - displayedImageRect.y) / displayedImageRect.height;
  const relativeWidth = cropBox.width / displayedImageRect.width;
  const relativeHeight = cropBox.height / displayedImageRect.height;

  let originX = relativeX * sourceImageSize.width;
  let originY = relativeY * sourceImageSize.height;
  let width = relativeWidth * sourceImageSize.width;
  let height = relativeHeight * sourceImageSize.height;

  if (!Number.isFinite(originX) || !Number.isFinite(originY) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  originX = clamp(originX, 0, sourceImageSize.width - 1);
  originY = clamp(originY, 0, sourceImageSize.height - 1);
  width = clamp(width, 1, sourceImageSize.width - originX);
  height = clamp(height, 1, sourceImageSize.height - originY);

  if (width <= 0 || height <= 0) {
    return null;
  }

  const roundedOriginX = clamp(Math.round(originX), 0, Math.max(0, sourceImageSize.width - 1));
  const roundedOriginY = clamp(Math.round(originY), 0, Math.max(0, sourceImageSize.height - 1));
  const roundedWidth = clamp(Math.round(width), 1, sourceImageSize.width - roundedOriginX);
  const roundedHeight = clamp(Math.round(height), 1, sourceImageSize.height - roundedOriginY);

  if (roundedWidth <= 0 || roundedHeight <= 0) {
    return null;
  }

  return {
    originX: roundedOriginX,
    originY: roundedOriginY,
    width: roundedWidth,
    height: roundedHeight,
  };
}

export default function MistakeImageEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, imageSlot, imageType, sourceUri, oldImageUri, reviewRecordId } = useLocalSearchParams<{
    id?: string | string[];
    imageSlot?: string | string[];
    imageType?: string | string[];
    sourceUri?: string | string[];
    oldImageUri?: string | string[];
    reviewRecordId?: string | string[];
  }>();

  const routeMistakeId = useMemo(() => normalizeRouteText(id), [id]);
  const routeImageSlot = useMemo(() => normalizeImageSlot(imageSlot), [imageSlot]);
  const routeImageType = useMemo(() => normalizeImageType(imageType), [imageType]);
  const routeSourceUri = useMemo(() => normalizeRouteText(sourceUri), [sourceUri]);
  const routeOldImageUri = useMemo(() => normalizeRouteText(oldImageUri), [oldImageUri]);
  const routeReviewRecordId = useMemo(() => normalizeRouteText(reviewRecordId), [reviewRecordId]);

  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [isImageSizeLoading, setIsImageSizeLoading] = useState(true);
  const [sourceImageSize, setSourceImageSize] = useState<ImageSize | null>(null);
  const [containerSize, setContainerSize] = useState<ImageSize | null>(null);
  const [cropBox, setCropBox] = useState<ImageRect | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [debugProbePreview, setDebugProbePreview] = useState<DebugProbePreview | null>(null);

  const isMountedRef = useRef(true);
  const cropBoxRef = useRef<ImageRect | null>(null);
  const displayedRectRef = useRef<ImageRect | null>(null);
  const isProcessingRef = useRef(false);
  const debugSessionIdRef = useRef(createCropDebugSessionId());
  const temporarySourceUriRef = useRef<string | null>(null);
  const debugProbeUriRef = useRef<string | null>(null);
  const moveStartRectRef = useRef<ImageRect | null>(null);
  const resizeStartRectRef = useRef<ImageRect | null>(null);

  useEffect(() => {
    cropBoxRef.current = cropBox;
  }, [cropBox]);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const cleanupDebugProbeUri = useCallback((uri: string | null | undefined) => {
    if (!uri) {
      return;
    }
    try {
      const file = new File(uri);
      if (file.exists) {
        file.delete();
      }
    } catch (error) {
      Logger.warn(PAGE_SCOPE, 'Failed to cleanup debug probe image.', {
        debugSessionId: debugSessionIdRef.current,
        probeUriShort: toShortUri(uri),
        error,
      });
    }
  }, []);

  useEffect(
    () => () => {
      const tempUri = temporarySourceUriRef.current;
      if (tempUri) {
        try {
          const tempFile = new File(tempUri);
          if (tempFile.exists) {
            tempFile.delete();
          }
        } catch (error) {
          Logger.warn(PAGE_SCOPE, 'Failed to cleanup temporary crop source image on unmount.', {
            debugSessionId: debugSessionIdRef.current,
            tempUriShort: toShortUri(tempUri),
            error,
          });
        }
      }

      cleanupDebugProbeUri(debugProbeUriRef.current);
    },
    [cleanupDebugProbeUri],
  );

  const displayedImageRect = useMemo(() => {
    if (!containerSize || !sourceImageSize) {
      return null;
    }
    return buildDisplayedImageRect(containerSize, sourceImageSize);
  }, [containerSize, sourceImageSize]);

  useEffect(() => {
    displayedRectRef.current = displayedImageRect;
  }, [displayedImageRect]);

  useEffect(() => {
    if (!displayedImageRect || state.kind !== 'success') {
      return;
    }

    setCropBox((current) => {
      if (!current) {
        return clampCropRect(buildDefaultCropRect(displayedImageRect, state.imageSlot), displayedImageRect);
      }
      return clampCropRect(current, displayedImageRect);
    });
  }, [displayedImageRect, state]);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      if (!routeMistakeId) {
        setState({
          kind: 'error',
          message: '页面参数无效，请返回重试。',
        });
        return;
      }

      const resolvedImageType = routeImageType ?? (routeImageSlot ? mapSlotToImageType(routeImageSlot) : null);
      if (!resolvedImageType) {
        setState({
          kind: 'error',
          message: '图片类型参数无效，请返回重试。',
        });
        return;
      }
      const isReviewImage = resolvedImageType === 'review_solution';
      if (isReviewImage && !routeReviewRecordId) {
        setState({
          kind: 'error',
          message: '复做记录参数无效，请返回重试。',
        });
        return;
      }

      const resolvedImageSlot = routeImageSlot ?? mapImageTypeToSlot(resolvedImageType);

      setState({ kind: 'loading' });
      Logger.info(PAGE_SCOPE, 'Enter crop image page.', {
        mistakeId: routeMistakeId,
        reviewRecordId: routeReviewRecordId,
        imageSlot: resolvedImageSlot,
        imageType: resolvedImageType,
        sourceUriShort: toShortUri(routeSourceUri),
        oldImageUriShort: toShortUri(routeOldImageUri),
      });

      const detailResult = await MistakeDetailService.getMistakeDetail(routeMistakeId);
      if (cancelled) {
        return;
      }

      if (!detailResult.ok || !detailResult.detail) {
        setState({
          kind: 'error',
          message: detailResult.errorMessage ?? '读取图片失败，请返回重试。',
        });
        return;
      }

      const detailUri =
        resolvedImageType === 'review_solution'
          ? (() => {
              const record = detailResult.detail.reviewRecords.find((item) => item.id === routeReviewRecordId);
              if (!record) {
                setState({
                  kind: 'error',
                  message: '复做记录不存在，请返回重试。',
                });
                return null;
              }
              const uri = typeof record.solutionImageUri === 'string' ? record.solutionImageUri.trim() : '';
              if (record.solutionImageExists === false && !routeSourceUri) {
                setState({
                  kind: 'error',
                  message: '图片文件不存在，请重新拍照。',
                });
                return null;
              }
              return uri;
            })()
          : (() => {
              const slot = detailResult.detail.imageSlots.find((item) => item.type === resolvedImageType);
              const uri = typeof slot?.uri === 'string' ? slot.uri.trim() : '';
              if (slot?.exists === false && !routeSourceUri) {
                setState({
                  kind: 'error',
                  message: '图片文件不存在，请重新拍照。',
                });
                return null;
              }
              return uri;
            })();
      if (detailUri === null) {
        return;
      }

      const nextSourceUri = routeSourceUri ?? detailUri;
      if (!nextSourceUri) {
        setState({
          kind: 'error',
          message: '请先拍照添加图片',
        });
        return;
      }

      const sourceExists = new File(nextSourceUri).exists;
      Logger.info(PAGE_SCOPE, 'Source image prepared for crop page.', {
        mistakeId: routeMistakeId,
        reviewRecordId: routeReviewRecordId,
        imageSlot: resolvedImageSlot,
        sourceUriShort: toShortUri(nextSourceUri),
        sourceExists,
      });

      if (!sourceExists) {
        setState({
          kind: 'error',
          message: '图片文件不存在，请重新拍照。',
        });
        return;
      }

      const preparedSource = await ImageProcessService.prepareCropSourceImage(nextSourceUri);
      if (cancelled) {
        if (preparedSource.isTemporary) {
          try {
            const preparedFile = new File(preparedSource.uri);
            if (preparedFile.exists) {
              preparedFile.delete();
            }
          } catch (error) {
            Logger.warn(PAGE_SCOPE, 'Failed to cleanup prepared source image after page cancellation.', {
              preparedUriShort: toShortUri(preparedSource.uri),
              error,
            });
          }
        }
        return;
      }

      const previousTemporaryUri = temporarySourceUriRef.current;
      if (previousTemporaryUri && previousTemporaryUri !== preparedSource.uri) {
        try {
          const previousFile = new File(previousTemporaryUri);
          if (previousFile.exists) {
            previousFile.delete();
          }
        } catch (error) {
          Logger.warn(PAGE_SCOPE, 'Failed to cleanup previous temporary crop source image.', {
            previousUriShort: toShortUri(previousTemporaryUri),
            error,
          });
        }
      }
      temporarySourceUriRef.current = preparedSource.isTemporary ? preparedSource.uri : null;

      Logger.info(PAGE_SCOPE, 'Prepared crop source image for crop page.', {
        mistakeId: routeMistakeId,
        reviewRecordId: routeReviewRecordId,
        imageSlot: resolvedImageSlot,
        sourceUriShort: toShortUri(nextSourceUri),
        preparedUriShort: toShortUri(preparedSource.uri),
        sourceWidth: preparedSource.width,
        sourceHeight: preparedSource.height,
        sourceIsTemporary: preparedSource.isTemporary,
      });

      setState({
        kind: 'success',
        mistakeId: routeMistakeId,
        imageSlot: resolvedImageSlot,
        imageType: resolvedImageType,
        reviewRecordId: resolvedImageType === 'review_solution' ? routeReviewRecordId : null,
        title: getImageTitle(resolvedImageSlot, resolvedImageType),
        sourceUri: preparedSource.uri,
        sourceWidth: preparedSource.width,
        sourceHeight: preparedSource.height,
        sourceIsTemporary: preparedSource.isTemporary,
        oldImageUri: routeOldImageUri ?? nextSourceUri,
      });
    }

    void loadState();

    return () => {
      cancelled = true;
    };
  }, [routeImageSlot, routeImageType, routeMistakeId, routeOldImageUri, routeReviewRecordId, routeSourceUri]);

  useEffect(() => {
    if (state.kind !== 'success') {
      cleanupDebugProbeUri(debugProbeUriRef.current);
      debugProbeUriRef.current = null;
      setDebugProbePreview(null);
      setSourceImageSize(null);
      setCropBox(null);
      setIsImageSizeLoading(false);
      return;
    }
    cleanupDebugProbeUri(debugProbeUriRef.current);
    debugProbeUriRef.current = null;
    setDebugProbePreview(null);
    setSourceImageSize({
      width: state.sourceWidth,
      height: state.sourceHeight,
    });
    setIsImageSizeLoading(false);
    setCropBox(null);
    Logger.info(PAGE_SCOPE, 'Use prepared source image size on crop page.', {
      mistakeId: state.mistakeId,
      imageSlot: state.imageSlot,
      sourceUriShort: toShortUri(state.sourceUri),
      width: state.sourceWidth,
      height: state.sourceHeight,
      sourceIsTemporary: state.sourceIsTemporary,
    });
  }, [cleanupDebugProbeUri, state]);

  const moveResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isProcessingRef.current,
      onMoveShouldSetPanResponder: () => !isProcessingRef.current,
      onPanResponderGrant: () => {
        moveStartRectRef.current = cropBoxRef.current;
      },
      onPanResponderMove: (_event, gestureState) => {
        const baseRect = moveStartRectRef.current;
        const bounds = displayedRectRef.current;
        if (!baseRect || !bounds) {
          return;
        }
        setCropBox(moveCropRect(baseRect, gestureState.dx, gestureState.dy, bounds));
      },
      onPanResponderRelease: () => {
        moveStartRectRef.current = null;
      },
      onPanResponderTerminate: () => {
        moveStartRectRef.current = null;
      },
    }),
  ).current;

  const topLeftResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isProcessingRef.current,
      onMoveShouldSetPanResponder: () => !isProcessingRef.current,
      onPanResponderGrant: () => {
        resizeStartRectRef.current = cropBoxRef.current;
      },
      onPanResponderMove: (_event, gestureState) => {
        const baseRect = resizeStartRectRef.current;
        const bounds = displayedRectRef.current;
        if (!baseRect || !bounds) {
          return;
        }
        setCropBox(resizeCropRect(baseRect, 'top_left', gestureState.dx, gestureState.dy, bounds));
      },
      onPanResponderRelease: () => {
        resizeStartRectRef.current = null;
      },
      onPanResponderTerminate: () => {
        resizeStartRectRef.current = null;
      },
    }),
  ).current;

  const topRightResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isProcessingRef.current,
      onMoveShouldSetPanResponder: () => !isProcessingRef.current,
      onPanResponderGrant: () => {
        resizeStartRectRef.current = cropBoxRef.current;
      },
      onPanResponderMove: (_event, gestureState) => {
        const baseRect = resizeStartRectRef.current;
        const bounds = displayedRectRef.current;
        if (!baseRect || !bounds) {
          return;
        }
        setCropBox(resizeCropRect(baseRect, 'top_right', gestureState.dx, gestureState.dy, bounds));
      },
      onPanResponderRelease: () => {
        resizeStartRectRef.current = null;
      },
      onPanResponderTerminate: () => {
        resizeStartRectRef.current = null;
      },
    }),
  ).current;

  const bottomLeftResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isProcessingRef.current,
      onMoveShouldSetPanResponder: () => !isProcessingRef.current,
      onPanResponderGrant: () => {
        resizeStartRectRef.current = cropBoxRef.current;
      },
      onPanResponderMove: (_event, gestureState) => {
        const baseRect = resizeStartRectRef.current;
        const bounds = displayedRectRef.current;
        if (!baseRect || !bounds) {
          return;
        }
        setCropBox(resizeCropRect(baseRect, 'bottom_left', gestureState.dx, gestureState.dy, bounds));
      },
      onPanResponderRelease: () => {
        resizeStartRectRef.current = null;
      },
      onPanResponderTerminate: () => {
        resizeStartRectRef.current = null;
      },
    }),
  ).current;

  const bottomRightResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isProcessingRef.current,
      onMoveShouldSetPanResponder: () => !isProcessingRef.current,
      onPanResponderGrant: () => {
        resizeStartRectRef.current = cropBoxRef.current;
      },
      onPanResponderMove: (_event, gestureState) => {
        const baseRect = resizeStartRectRef.current;
        const bounds = displayedRectRef.current;
        if (!baseRect || !bounds) {
          return;
        }
        setCropBox(resizeCropRect(baseRect, 'bottom_right', gestureState.dx, gestureState.dy, bounds));
      },
      onPanResponderRelease: () => {
        resizeStartRectRef.current = null;
      },
      onPanResponderTerminate: () => {
        resizeStartRectRef.current = null;
      },
    }),
  ).current;

  const updateMistakeImageSafely = useCallback(
    async (nextImageUri: string, nextFileSize: number) => {
      if (state.kind !== 'success') {
        throw new Error('Invalid page state.');
      }

      Logger.info(PAGE_SCOPE, 'Start database update for cropped image.', {
        mistakeId: state.mistakeId,
        reviewRecordId: state.reviewRecordId,
        imageSlot: state.imageSlot,
        imageType: state.imageType,
        newImageUriShort: toShortUri(nextImageUri),
        fileSize: nextFileSize,
      });

      if (state.imageType === 'review_solution') {
        if (!state.reviewRecordId) {
          throw new Error('复做记录参数无效，请返回重试。');
        }
        const updateResult = await ReviewRecordImageService.updateReviewRecordImage({
          mistakeId: state.mistakeId,
          reviewRecordId: state.reviewRecordId,
          imageUri: nextImageUri,
        });

        if (!updateResult.ok) {
          Logger.error(PAGE_SCOPE, 'Database update failed for cropped review image.', {
            mistakeId: state.mistakeId,
            reviewRecordId: state.reviewRecordId,
            imageSlot: state.imageSlot,
            errorMessage: updateResult.errorMessage ?? null,
          });
          throw new Error(updateResult.errorMessage ?? '数据库更新失败');
        }

        Logger.info(PAGE_SCOPE, 'Database update succeeded for cropped review image.', {
          mistakeId: state.mistakeId,
          reviewRecordId: state.reviewRecordId,
          imageSlot: state.imageSlot,
          imageId: updateResult.imageId ?? null,
        });
        return;
      }

      const updateResult = await MistakeDetailService.upsertMistakeDetailImage({
        mistakeId: state.mistakeId,
        imageType: state.imageType,
        imageUri: nextImageUri,
      });

      if (!updateResult.ok) {
        Logger.error(PAGE_SCOPE, 'Database update failed for cropped image.', {
          mistakeId: state.mistakeId,
          imageSlot: state.imageSlot,
          errorMessage: updateResult.errorMessage ?? null,
        });
        throw new Error(updateResult.errorMessage ?? '数据库更新失败');
      }

      Logger.info(PAGE_SCOPE, 'Database update succeeded for cropped image.', {
        mistakeId: state.mistakeId,
        imageSlot: state.imageSlot,
        imageId: updateResult.imageId ?? null,
      });
    },
    [state],
  );

  const cleanupNewImageIfNeeded = useCallback(async (uri: string) => {
    try {
      await ImageStorageService.deleteLocalImage(uri);
    } catch (error) {
      Logger.warn(PAGE_SCOPE, 'Failed to cleanup new image after database failure.', {
        uriShort: toShortUri(uri),
        error,
      });
    }
  }, []);

  const deleteOldImageAfterSuccess = useCallback(
    async (oldUri: string | null | undefined, newUri: string) => {
      const normalizedOldUri = typeof oldUri === 'string' ? oldUri.trim() : '';
      if (!normalizedOldUri || normalizedOldUri === newUri) {
        return;
      }

      try {
        const deleted = await ImageStorageService.deleteLocalImage(normalizedOldUri);
        if (deleted) {
          Logger.info(PAGE_SCOPE, 'Deleted old image after replacement.', {
            mistakeId: state.kind === 'success' ? state.mistakeId : null,
            imageSlot: state.kind === 'success' ? state.imageSlot : null,
            oldUriShort: toShortUri(normalizedOldUri),
          });
        } else {
          Logger.warn(PAGE_SCOPE, 'Failed to delete old image after replacement.', {
            mistakeId: state.kind === 'success' ? state.mistakeId : null,
            imageSlot: state.kind === 'success' ? state.imageSlot : null,
            oldUriShort: toShortUri(normalizedOldUri),
          });
        }
      } catch (error) {
        Logger.warn(PAGE_SCOPE, 'Unexpected error while deleting old image after replacement.', {
          mistakeId: state.kind === 'success' ? state.mistakeId : null,
          imageSlot: state.kind === 'success' ? state.imageSlot : null,
          oldUriShort: toShortUri(normalizedOldUri),
          error,
        });
      }
    },
    [state],
  );

  const collectCropDebugSnapshot = useCallback(
    async (cropRect: ImageProcessService.CropRect | null) => {
      if (state.kind !== 'success') {
        return null;
      }

      const sourceGeometry = await ImageProcessService.collectImageGeometryDiagnostics(state.sourceUri);
      const relativeRect = cropBox
        && displayedImageRect
        && displayedImageRect.width > 0
        && displayedImageRect.height > 0
        ? {
            x: (cropBox.x - displayedImageRect.x) / displayedImageRect.width,
            y: (cropBox.y - displayedImageRect.y) / displayedImageRect.height,
            width: cropBox.width / displayedImageRect.width,
            height: cropBox.height / displayedImageRect.height,
          }
        : null;

      return {
        debugSessionId: debugSessionIdRef.current,
        mistakeId: state.mistakeId,
        imageSlot: state.imageSlot,
        sourceUriShort: toShortUri(state.sourceUri),
        sourceImageSizeFromState: sourceImageSize,
        sourceWidthFromPageState: state.sourceWidth,
        sourceHeightFromPageState: state.sourceHeight,
        sourceIsTemporary: state.sourceIsTemporary,
        containerSize,
        displayedImageRect,
        cropBox,
        cropRectSource: cropRect,
        relativeRect,
        sourceGeometry,
      };
    },
    [containerSize, cropBox, displayedImageRect, sourceImageSize, state],
  );

  const processAndSaveImage = useCallback(
    async (cropRect: ImageProcessService.CropRect | undefined) => {
      if (state.kind !== 'success' || isProcessingRef.current) {
        return;
      }
      if (!sourceImageSize) {
        Alert.alert('提示', '读取图片尺寸失败，请返回重试。');
        return;
      }

      const startedAt = Date.now();
      isProcessingRef.current = true;
      setIsProcessing(true);

      try {
        Logger.info(PAGE_SCOPE, 'Start processing image from crop page.', {
          debugSessionId: debugSessionIdRef.current,
          mistakeId: state.mistakeId,
          imageSlot: state.imageSlot,
          sourceUriShort: toShortUri(state.sourceUri),
          sourceWidth: sourceImageSize.width,
          sourceHeight: sourceImageSize.height,
          cropRect: cropRect ?? null,
        });

        const processed = await ImageProcessService.cropAndCompressImage({
          sourceUri: state.sourceUri,
          cropRect,
          imageSlot: state.imageSlot,
          mistakeId: state.mistakeId,
          sourceSizeHint: sourceImageSize,
          debugSessionId: debugSessionIdRef.current,
        });

        const nextImageFile = new File(processed.uri);
        const nextImageInfo = nextImageFile.info();
        const nextFileSize = typeof nextImageInfo.size === 'number' ? nextImageInfo.size : 0;
        if (!nextImageInfo.exists || nextFileSize <= 0) {
          throw new Error('输出图片无效');
        }

        try {
          await updateMistakeImageSafely(processed.uri, nextFileSize);
        } catch (dbError) {
          await cleanupNewImageIfNeeded(processed.uri);
          throw dbError;
        }
        await deleteOldImageAfterSuccess(state.oldImageUri, processed.uri);

        Logger.info(PAGE_SCOPE, 'Crop page save flow completed.', {
          debugSessionId: debugSessionIdRef.current,
          mistakeId: state.mistakeId,
          imageSlot: state.imageSlot,
          outputUriShort: toShortUri(processed.uri),
          outputWidth: processed.width,
          outputHeight: processed.height,
          outputFileSize: processed.fileSize,
          durationMs: Date.now() - startedAt,
        });

        setTimeout(() => {
          if (isMountedRef.current) {
            router.back();
          }
        }, SAVE_DELAY_MS);
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Crop page save flow failed.', {
          debugSessionId: debugSessionIdRef.current,
          mistakeId: state.mistakeId,
          imageSlot: state.imageSlot,
          error,
          durationMs: Date.now() - startedAt,
        });
        const message = error instanceof Error ? error.message : '裁剪保存失败，请重试。';
        Alert.alert('保存失败', message || '裁剪保存失败，请重试。');
      } finally {
        isProcessingRef.current = false;
        if (isMountedRef.current) {
          setIsProcessing(false);
        }
      }
    },
    [
      cleanupNewImageIfNeeded,
      deleteOldImageAfterSuccess,
      router,
      sourceImageSize,
      state,
      updateMistakeImageSafely,
    ],
  );

  const handleSaveCrop = useCallback(async () => {
    if (state.kind !== 'success' || !cropBox || !displayedImageRect || !sourceImageSize) {
      Alert.alert('提示', '裁剪区域无效，请重新调整');
      return;
    }

    const cropRect = parseCropRectToSourceRect(cropBox, displayedImageRect, sourceImageSize);
    Logger.info(PAGE_SCOPE, 'Convert crop rect to source coordinates.', {
      debugSessionId: debugSessionIdRef.current,
      mistakeId: state.mistakeId,
      imageSlot: state.imageSlot,
      displayedImageRect,
      cropBoxScreenRect: cropBox,
      cropRectSource: cropRect ?? null,
    });

    if (!cropRect || cropRect.width <= 0 || cropRect.height <= 0) {
      Alert.alert('提示', '裁剪区域无效，请重新调整');
      return;
    }

    if (IS_CROP_DEBUG_ENABLED) {
      try {
        const debugSnapshot = await collectCropDebugSnapshot(cropRect);
        Logger.info(PAGE_SCOPE, '[CROP_DEBUG] Pre-save snapshot.', debugSnapshot);
      } catch (error) {
        Logger.warn(PAGE_SCOPE, '[CROP_DEBUG] Failed to collect pre-save snapshot.', {
          debugSessionId: debugSessionIdRef.current,
          error,
        });
      }
    }

    await processAndSaveImage(cropRect);
  }, [collectCropDebugSnapshot, cropBox, displayedImageRect, processAndSaveImage, sourceImageSize, state]);

  const handleUseFullImage = useCallback(async () => {
    if (state.kind !== 'success') {
      return;
    }
    await processAndSaveImage(undefined);
  }, [processAndSaveImage, state]);

  const handleDebugProbe = useCallback(async () => {
    if (!IS_CROP_DEBUG_ENABLED) {
      return;
    }
    if (state.kind !== 'success' || !cropBox || !displayedImageRect || !sourceImageSize) {
      Alert.alert('调试预演', '当前裁剪区域无效，请先调整后重试。');
      return;
    }
    if (isProcessingRef.current) {
      return;
    }

    const cropRect = parseCropRectToSourceRect(cropBox, displayedImageRect, sourceImageSize);
    if (!cropRect) {
      Alert.alert('调试预演', '无法解析裁剪坐标。');
      return;
    }

    const startedAt = Date.now();
    isProcessingRef.current = true;
    setIsProcessing(true);

    try {
      const preSnapshot = await collectCropDebugSnapshot(cropRect);
      Logger.info(PAGE_SCOPE, '[CROP_DEBUG] Start debug probe.', preSnapshot);

      const probe = await ImageProcessService.runCropDebugProbe({
        sourceUri: state.sourceUri,
        cropRect,
        sourceSizeHint: sourceImageSize,
        debugSessionId: debugSessionIdRef.current,
      });

      const previousProbeUri = debugProbeUriRef.current;
      if (previousProbeUri && previousProbeUri !== probe.uri) {
        cleanupDebugProbeUri(previousProbeUri);
      }
      debugProbeUriRef.current = probe.uri;
      setDebugProbePreview({
        uri: probe.uri,
        width: probe.width,
        height: probe.height,
        fileSize: probe.fileSize,
        sourceSizeMeasured: probe.sourceSizeMeasured,
        sourceSizeUsed: probe.sourceSizeUsed,
        normalizedCropRect: probe.normalizedCropRect,
        createdAt: new Date().toISOString(),
      });

      Logger.info(PAGE_SCOPE, '[CROP_DEBUG] Debug probe image ready.', {
        debugSessionId: debugSessionIdRef.current,
        outputUriShort: toShortUri(probe.uri),
        outputWidth: probe.width,
        outputHeight: probe.height,
        outputFileSize: probe.fileSize,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      Logger.error(PAGE_SCOPE, '[CROP_DEBUG] Debug probe failed.', {
        debugSessionId: debugSessionIdRef.current,
        error,
        durationMs: Date.now() - startedAt,
      });
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('调试预演失败', message || '请重试');
    } finally {
      isProcessingRef.current = false;
      if (isMountedRef.current) {
        setIsProcessing(false);
      }
    }
  }, [
    cleanupDebugProbeUri,
    collectCropDebugSnapshot,
    cropBox,
    displayedImageRect,
    sourceImageSize,
    state,
  ]);

  const handleCancel = useCallback(() => {
    if (isProcessingRef.current) {
      return;
    }
    router.back();
  }, [router]);

  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerSize({
      width,
      height,
    });
  }, []);

  if (state.kind === 'loading') {
    return (
      <ScreenContainer withPadding={false}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
          <Text style={styles.loadingText}>正在加载裁剪页面...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (state.kind === 'error') {
    return (
      <ScreenContainer withPadding={false}>
        <View style={styles.errorWrap}>
          <CardContainer style={styles.errorCard} padding={spacing.lg}>
            <Text style={styles.errorTitle}>图片裁剪不可用</Text>
            <Text style={styles.errorMessage}>{state.message}</Text>
            <Pressable style={styles.errorButton} onPress={() => router.back()}>
              <Text style={styles.errorButtonText}>返回详情页</Text>
            </Pressable>
          </CardContainer>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenContainer withPadding={false} safeAreaEdges={['top', 'bottom']} style={styles.screen}>
        <View style={[styles.topBar, { paddingTop: insets.top > 0 ? spacing.xs : spacing.md }]}>
          <Pressable
            disabled={isProcessing}
            onPress={handleCancel}
            style={({ pressed }) => [styles.topButton, pressed && styles.pressed, isProcessing && styles.disabled]}>
            <Text style={styles.topButtonText}>返回</Text>
          </Pressable>

          <Text style={styles.topTitle}>{state.title}</Text>

          <View style={styles.topButtonPlaceholder} />
        </View>

        <View style={styles.contentWrap}>
          <CardContainer style={styles.previewCard} padding={spacing.md}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>{state.title}</Text>
              <Text style={styles.previewHint}>拖动框体移动，拖动四角调整大小</Text>
              {IS_CROP_DEBUG_ENABLED ? (
                <View style={styles.debugRow}>
                  <Text numberOfLines={1} style={styles.debugSessionText}>
                    调试会话: {debugSessionIdRef.current}
                  </Text>
                  <Pressable
                    disabled={isProcessing}
                    onPress={() => {
                      void handleDebugProbe();
                    }}
                    style={({ pressed }) => [
                      styles.debugProbeButton,
                      pressed && styles.pressed,
                      isProcessing && styles.disabled,
                    ]}>
                    <Text style={styles.debugProbeButtonText}>调试预演</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <View style={styles.previewStage} onLayout={handleContainerLayout}>
              <Image source={{ uri: state.sourceUri }} style={styles.previewImage} resizeMode="contain" />

              {isImageSizeLoading ? (
                <View style={styles.previewLoadingMask}>
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                  <Text style={styles.previewLoadingText}>正在读取图片尺寸...</Text>
                </View>
              ) : null}

              {displayedImageRect && cropBox ? (
                <>
                  <View
                    pointerEvents="none"
                    style={[
                      styles.mask,
                      {
                        left: displayedImageRect.x,
                        top: displayedImageRect.y,
                        width: displayedImageRect.width,
                        height: Math.max(0, cropBox.y - displayedImageRect.y),
                      },
                    ]}
                  />
                  <View
                    pointerEvents="none"
                    style={[
                      styles.mask,
                      {
                        left: displayedImageRect.x,
                        top: cropBox.y + cropBox.height,
                        width: displayedImageRect.width,
                        height: Math.max(
                          0,
                          displayedImageRect.y + displayedImageRect.height - (cropBox.y + cropBox.height),
                        ),
                      },
                    ]}
                  />
                  <View
                    pointerEvents="none"
                    style={[
                      styles.mask,
                      {
                        left: displayedImageRect.x,
                        top: cropBox.y,
                        width: Math.max(0, cropBox.x - displayedImageRect.x),
                        height: cropBox.height,
                      },
                    ]}
                  />
                  <View
                    pointerEvents="none"
                    style={[
                      styles.mask,
                      {
                        left: cropBox.x + cropBox.width,
                        top: cropBox.y,
                        width: Math.max(0, displayedImageRect.x + displayedImageRect.width - (cropBox.x + cropBox.width)),
                        height: cropBox.height,
                      },
                    ]}
                  />

                  <View
                    style={[
                      styles.cropBox,
                      {
                        left: cropBox.x,
                        top: cropBox.y,
                        width: cropBox.width,
                        height: cropBox.height,
                      },
                    ]}>
                    <View style={styles.cropMoveArea} {...moveResponder.panHandlers} />
                    <View pointerEvents="none" style={styles.cropCenterGuide} />

                    <View
                      style={[styles.handle, styles.handleTopLeft]}
                      hitSlop={HANDLE_HIT_SLOP}
                      {...topLeftResponder.panHandlers}>
                      <View pointerEvents="none" style={[styles.cornerMark, styles.cornerMarkTopLeft]} />
                    </View>
                    <View
                      style={[styles.handle, styles.handleTopRight]}
                      hitSlop={HANDLE_HIT_SLOP}
                      {...topRightResponder.panHandlers}>
                      <View pointerEvents="none" style={[styles.cornerMark, styles.cornerMarkTopRight]} />
                    </View>
                    <View
                      style={[styles.handle, styles.handleBottomLeft]}
                      hitSlop={HANDLE_HIT_SLOP}
                      {...bottomLeftResponder.panHandlers}>
                      <View pointerEvents="none" style={[styles.cornerMark, styles.cornerMarkBottomLeft]} />
                    </View>
                    <View
                      style={[styles.handle, styles.handleBottomRight]}
                      hitSlop={HANDLE_HIT_SLOP}
                      {...bottomRightResponder.panHandlers}>
                      <View pointerEvents="none" style={[styles.cornerMark, styles.cornerMarkBottomRight]} />
                    </View>
                  </View>
                </>
              ) : null}
            </View>

            {IS_CROP_DEBUG_ENABLED && debugProbePreview ? (
              <View style={styles.debugPreviewBlock}>
                <Text style={styles.debugPreviewTitle}>调试预演输出（不入库）</Text>
                <Image source={{ uri: debugProbePreview.uri }} style={styles.debugPreviewImage} resizeMode="contain" />
                <Text style={styles.debugPreviewMeta}>
                  输出: {debugProbePreview.width}x{debugProbePreview.height} | 裁剪: {debugProbePreview.normalizedCropRect.originX},{' '}
                  {debugProbePreview.normalizedCropRect.originY},{' '}
                  {debugProbePreview.normalizedCropRect.width}x{debugProbePreview.normalizedCropRect.height}
                </Text>
              </View>
            ) : null}
          </CardContainer>
        </View>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Pressable
            disabled={isProcessing}
            onPress={handleCancel}
            style={({ pressed }) => [styles.bottomButtonSecondary, pressed && styles.pressed, isProcessing && styles.disabled]}>
            <Text style={styles.bottomButtonSecondaryText}>取消</Text>
          </Pressable>

          <Pressable
            disabled={isProcessing}
            onPress={() => {
              void handleUseFullImage();
            }}
            style={({ pressed }) => [styles.bottomButtonNeutral, pressed && styles.pressed, isProcessing && styles.disabled]}>
            <Text style={styles.bottomButtonNeutralText}>{isProcessing ? '处理中...' : '使用整张'}</Text>
          </Pressable>

          <Pressable
            disabled={isProcessing}
            onPress={() => {
              void handleSaveCrop();
            }}
            style={({ pressed }) => [styles.bottomButtonPrimary, pressed && styles.pressed, isProcessing && styles.disabled]}>
            <Text style={styles.bottomButtonPrimaryText}>{isProcessing ? '处理中...' : '保存裁剪'}</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    backgroundColor: colors.background,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorWrap: {
    flex: 1,
    paddingHorizontal: spacing.screenPadding,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  errorCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  errorTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
  },
  errorMessage: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorButton: {
    alignSelf: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  topBar: {
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topButton: {
    minWidth: 64,
    minHeight: 34,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  topButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  topTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  topButtonPlaceholder: {
    width: 64,
  },
  contentWrap: {
    flex: 1,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.md,
  },
  previewCard: {
    flex: 1,
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  previewHeader: {
    gap: spacing.xs,
  },
  debugRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  debugSessionText: {
    flex: 1,
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
  debugProbeButton: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  debugProbeButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 11,
    lineHeight: 14,
  },
  previewTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
  },
  previewHint: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  previewStage: {
    flex: 1,
    minHeight: PREVIEW_STAGE_MIN_HEIGHT,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewLoadingMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  previewLoadingText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  debugPreviewBlock: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  debugPreviewTitle: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  debugPreviewImage: {
    width: '100%',
    height: 120,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  debugPreviewMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(12, 16, 22, 0.45)',
  },
  cropBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: 'transparent',
  },
  cropMoveArea: {
    position: 'absolute',
    left: MOVE_AREA_INSET,
    top: MOVE_AREA_INSET,
    right: MOVE_AREA_INSET,
    bottom: MOVE_AREA_INSET,
  },
  cropCenterGuide: {
    ...StyleSheet.absoluteFillObject,
    borderColor: 'rgba(255,255,255,0.4)',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  cornerMark: {
    position: 'absolute',
    width: CORNER_MARK_SIZE,
    height: CORNER_MARK_SIZE,
    borderColor: colors.success,
  },
  cornerMarkTopLeft: {
    left: 4,
    top: 4,
    borderLeftWidth: CORNER_MARK_THICKNESS,
    borderTopWidth: CORNER_MARK_THICKNESS,
  },
  cornerMarkTopRight: {
    right: 4,
    top: 4,
    borderRightWidth: CORNER_MARK_THICKNESS,
    borderTopWidth: CORNER_MARK_THICKNESS,
  },
  cornerMarkBottomLeft: {
    left: 4,
    bottom: 4,
    borderLeftWidth: CORNER_MARK_THICKNESS,
    borderBottomWidth: CORNER_MARK_THICKNESS,
  },
  cornerMarkBottomRight: {
    right: 4,
    bottom: 4,
    borderRightWidth: CORNER_MARK_THICKNESS,
    borderBottomWidth: CORNER_MARK_THICKNESS,
  },
  handleTopLeft: {
    left: -HANDLE_SIZE / 4,
    top: -HANDLE_SIZE / 4,
  },
  handleTopRight: {
    right: -HANDLE_SIZE / 4,
    top: -HANDLE_SIZE / 4,
  },
  handleBottomLeft: {
    left: -HANDLE_SIZE / 4,
    bottom: -HANDLE_SIZE / 4,
  },
  handleBottomRight: {
    right: -HANDLE_SIZE / 4,
    bottom: -HANDLE_SIZE / 4,
  },
  bottomBar: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.screenPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  bottomButtonSecondary: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  bottomButtonSecondaryText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  bottomButtonNeutral: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  bottomButtonNeutralText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  bottomButtonPrimary: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.black,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  bottomButtonPrimaryText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.86,
  },
  disabled: {
    opacity: 0.5,
  },
});
