import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CardContainer } from '@/src/components/ui';
import { Logger } from '@/src/services/Logger';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const COMPONENT_SCOPE = 'MistakeImageSection';

const MIN_IMAGE_PREVIEW_HEIGHT = 72;
const MAX_IMAGE_PREVIEW_HEIGHT = 280;
const EMPTY_IMAGE_PLACEHOLDER_HEIGHT = 160;
const FALLBACK_IMAGE_PREVIEW_HEIGHT = 160;

type ImageDimensions = {
  width: number;
  height: number;
};

type ImageSizeCache = Record<string, ImageDimensions | null>;

export interface MistakeImageSectionProps {
  title: string;
  imageUri?: string | null;
  imageExists?: boolean;
  fileSize?: number | null;
  emptyText: string;
  loadErrorText?: string;
  width?: number | null;
  height?: number | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  isBusy?: boolean;
  isTakePhotoLoading?: boolean;
  isDeleteLoading?: boolean;
  onTakePhoto: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreview: () => void;
}

function normalizeUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }
  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatFileSize(fileSize: number): string {
  if (fileSize < 1024) {
    return `${fileSize} B`;
  }
  if (fileSize < 1024 * 1024) {
    return `${Math.round(fileSize / 1024)} KB`;
  }
  return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateImagePreviewHeight(params: {
  containerWidth: number;
  imageWidth?: number;
  imageHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  fallbackHeight?: number;
}): number {
  const minHeight = isPositiveFinite(params.minHeight)
    ? params.minHeight
    : MIN_IMAGE_PREVIEW_HEIGHT;
  const maxHeight = isPositiveFinite(params.maxHeight)
    ? Math.max(minHeight, params.maxHeight)
    : MAX_IMAGE_PREVIEW_HEIGHT;
  const fallbackHeight = isPositiveFinite(params.fallbackHeight)
    ? clamp(params.fallbackHeight, minHeight, maxHeight)
    : clamp(FALLBACK_IMAGE_PREVIEW_HEIGHT, minHeight, maxHeight);

  if (!isPositiveFinite(params.containerWidth)) {
    return fallbackHeight;
  }
  if (!isPositiveFinite(params.imageWidth) || !isPositiveFinite(params.imageHeight)) {
    return fallbackHeight;
  }

  const rawHeight = (params.containerWidth * params.imageHeight) / params.imageWidth;
  if (!Number.isFinite(rawHeight) || rawHeight <= 0) {
    return fallbackHeight;
  }
  return clamp(rawHeight, minHeight, maxHeight);
}

function pickImageDimensions(input: {
  width?: number | null;
  height?: number | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
}): ImageDimensions | null {
  const candidates: [number | null | undefined, number | null | undefined][] = [
    [input.imageWidth, input.imageHeight],
    [input.width, input.height],
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

function hasOwnCache(cache: ImageSizeCache, uri: string): boolean {
  return Object.prototype.hasOwnProperty.call(cache, uri);
}

export function MistakeImageSection({
  title,
  imageUri,
  imageExists,
  fileSize,
  emptyText,
  loadErrorText = '图片加载失败',
  width,
  height,
  imageWidth,
  imageHeight,
  isBusy = false,
  isTakePhotoLoading = false,
  isDeleteLoading = false,
  onTakePhoto,
  onEdit,
  onDelete,
  onPreview,
}: MistakeImageSectionProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [imageSizeCache, setImageSizeCache] = useState<ImageSizeCache>({});

  const normalizedUri = useMemo(() => normalizeUri(imageUri), [imageUri]);
  const hasImage = !!normalizedUri;
  const canShowImage = hasImage && imageExists === true && !imageFailed;
  const hasMissingImage = hasImage && imageExists === false;
  const canEdit = hasImage && imageExists !== false && !isBusy;
  const canDelete = hasImage && !isBusy;

  const providedDimensions = useMemo(
    () => pickImageDimensions({ width, height, imageWidth, imageHeight }),
    [width, height, imageWidth, imageHeight],
  );

  const hasCachedSize = useMemo(() => {
    if (!normalizedUri) {
      return false;
    }
    return hasOwnCache(imageSizeCache, normalizedUri);
  }, [imageSizeCache, normalizedUri]);

  const cachedDimensions = useMemo(() => {
    if (!normalizedUri || !hasCachedSize) {
      return null;
    }
    return imageSizeCache[normalizedUri];
  }, [imageSizeCache, normalizedUri, hasCachedSize]);

  const activeDimensions = providedDimensions ?? cachedDimensions ?? null;

  useEffect(() => {
    setImageFailed(false);
  }, [normalizedUri]);

  useEffect(() => {
    if (!normalizedUri || !hasImage || providedDimensions || hasCachedSize) {
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
          setImageSizeCache((current) => {
            if (hasOwnCache(current, normalizedUri)) {
              return current;
            }
            return {
              ...current,
              [normalizedUri]: null,
            };
          });
          return;
        }

        setImageSizeCache((current) => ({
          ...current,
          [normalizedUri]: { width: nextWidth, height: nextHeight },
        }));
      },
      () => {
        if (cancelled) {
          return;
        }

        setImageSizeCache((current) => {
          if (hasOwnCache(current, normalizedUri)) {
            return current;
          }
          return {
            ...current,
            [normalizedUri]: null,
          };
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [hasCachedSize, hasImage, normalizedUri, providedDimensions]);

  const computedPreviewHeight = useMemo(
    () =>
      calculateImagePreviewHeight({
        containerWidth: previewWidth,
        imageWidth: activeDimensions?.width,
        imageHeight: activeDimensions?.height,
        minHeight: MIN_IMAGE_PREVIEW_HEIGHT,
        maxHeight: MAX_IMAGE_PREVIEW_HEIGHT,
        fallbackHeight: FALLBACK_IMAGE_PREVIEW_HEIGHT,
      }),
    [activeDimensions?.height, activeDimensions?.width, previewWidth],
  );

  const handlePreviewBoxLayout = useCallback((event: LayoutChangeEvent) => {
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

  return (
    <CardContainer style={styles.card} padding={spacing.md}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => {
              Logger.info(COMPONENT_SCOPE, 'Tap take photo button.', { title });
              onTakePhoto();
            }}
            disabled={isBusy}
            style={[styles.pillButton, isBusy && styles.pillButtonDisabled]}>
            <Text style={styles.pillButtonText}>{isTakePhotoLoading ? '处理中' : '拍照'}</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              Logger.info(COMPONENT_SCOPE, 'Tap edit button.', { title, hasImage });
              onEdit();
            }}
            disabled={!canEdit}
            style={[styles.pillButton, !canEdit && styles.pillButtonDisabled]}>
            <Text style={styles.pillButtonText}>编辑</Text>
          </Pressable>
        </View>
      </View>

      <View
        onLayout={handlePreviewBoxLayout}
        style={[
          styles.previewBox,
          hasImage
            ? { height: computedPreviewHeight }
            : [styles.previewBoxEmpty, { height: EMPTY_IMAGE_PLACEHOLDER_HEIGHT }],
        ]}>
        {canShowImage ? (
          <>
            <Pressable style={styles.previewPressable} onPress={onPreview}>
              <Image
                source={{ uri: normalizedUri }}
                style={styles.previewImage}
                resizeMode="contain"
                onError={() => setImageFailed(true)}
              />
            </Pressable>

            <Pressable onPress={onPreview} style={styles.viewLargeButton}>
              <Text style={styles.viewLargeButtonText}>查看大图</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                Logger.info(COMPONENT_SCOPE, 'Tap delete image button.', { title });
                onDelete();
              }}
              disabled={!canDelete}
              style={[styles.deleteButton, !canDelete && styles.deleteButtonDisabled]}>
              {isDeleteLoading ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.deleteButtonText}>X</Text>
              )}
            </Pressable>
          </>
        ) : null}

        {!hasImage ? <Text style={styles.emptyText}>{emptyText}</Text> : null}
        {hasMissingImage ? <Text style={styles.errorText}>图片文件不存在</Text> : null}
        {hasImage && imageExists === true && imageFailed ? (
          <Text style={styles.errorText}>{loadErrorText}</Text>
        ) : null}
      </View>

      {hasImage && typeof fileSize === 'number' ? (
        <Text style={styles.fileSizeText}>大小：{formatFileSize(fileSize)}</Text>
      ) : null}
    </CardContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pillButton: {
    minWidth: 58,
    minHeight: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  pillButtonDisabled: {
    opacity: 0.45,
  },
  pillButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  previewBox: {
    width: '100%',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBoxEmpty: {
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  previewPressable: {
    width: '100%',
    height: '100%',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  viewLargeButton: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  viewLargeButtonText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  deleteButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(200, 36, 36, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
  fileSizeText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
