import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Logger } from '@/src/services/Logger';
import { colors, radius, spacing } from '@/src/styles/tokens';

const COMPONENT_SCOPE = 'MistakeImageSection';
const TILE_WIDTH = 208;
const PREVIEW_HEIGHT = 156;

const palette = {
  surface: colors.surface,
  surfaceMuted: colors.pageBackground,
  text: colors.textPrimary,
  secondaryText: colors.textSecondary,
  mutedText: colors.textTertiary,
  green: colors.accent,
  border: colors.separator,
  danger: '#C9342E',
} as const;

export interface MistakeImageSectionProps {
  title: string;
  imageUri?: string | null;
  imageExists?: boolean;
  fileSize?: number | null;
  emptyText: string;
  emptyActionLabel?: string;
  imageCount?: number;
  loadErrorText?: string;
  width?: number | null;
  height?: number | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  isBusy?: boolean;
  isTakePhotoLoading?: boolean;
  isPickImageLoading?: boolean;
  isDeleteLoading?: boolean;
  showManagementActions?: boolean;
  onTakePhoto: () => void;
  onPickImage: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreview: () => void;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function calculateImagePreviewHeight(params: {
  containerWidth: number;
  imageWidth?: number;
  imageHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  fallbackHeight?: number;
}): number {
  const minHeight = isPositiveFinite(params.minHeight) ? params.minHeight : 72;
  const maxHeight = isPositiveFinite(params.maxHeight)
    ? Math.max(minHeight, params.maxHeight)
    : 280;
  const fallbackHeight = isPositiveFinite(params.fallbackHeight)
    ? Math.min(maxHeight, Math.max(minHeight, params.fallbackHeight))
    : Math.min(maxHeight, Math.max(minHeight, 160));

  if (
    !isPositiveFinite(params.containerWidth)
    || !isPositiveFinite(params.imageWidth)
    || !isPositiveFinite(params.imageHeight)
  ) {
    return fallbackHeight;
  }

  const scaledHeight = (params.containerWidth * params.imageHeight) / params.imageWidth;
  if (!Number.isFinite(scaledHeight) || scaledHeight <= 0) {
    return fallbackHeight;
  }
  return Math.min(maxHeight, Math.max(minHeight, scaledHeight));
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

function IconAction({
  icon,
  label,
  loading = false,
  disabled = false,
  danger = false,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={danger ? palette.danger : palette.text} />
      ) : (
        <MaterialIcons
          name={icon}
          size={18}
          color={danger ? palette.danger : palette.secondaryText}
        />
      )}
      <Text style={[styles.actionLabel, danger && styles.actionLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

export function MistakeImageSection({
  title,
  imageUri,
  imageExists,
  fileSize,
  emptyText,
  emptyActionLabel,
  imageCount = 0,
  loadErrorText = '图片加载失败',
  isBusy = false,
  isTakePhotoLoading = false,
  isPickImageLoading = false,
  isDeleteLoading = false,
  showManagementActions = false,
  onTakePhoto,
  onPickImage,
  onEdit,
  onDelete,
  onPreview,
}: MistakeImageSectionProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedUri = useMemo(() => normalizeUri(imageUri), [imageUri]);
  const hasImage = !!normalizedUri;
  const canShowImage = hasImage && imageExists === true && !imageFailed;
  const hasMissingImage = hasImage && imageExists === false;
  const canEdit = hasImage && imageExists !== false && !isBusy;
  const canDelete = hasImage && !isBusy;
  const count = Math.max(imageCount, hasImage ? 1 : 0);

  useEffect(() => {
    setImageFailed(false);
  }, [normalizedUri]);

  const openAddMenu = () => {
    if (isBusy) {
      return;
    }
    Alert.alert(`添加${title}`, '选择图片来源', [
      {
        text: '拍照',
        onPress: () => {
          Logger.info(COMPONENT_SCOPE, 'Tap compact take photo action.', { title });
          onTakePhoto();
        },
      },
      {
        text: '从相册选择',
        onPress: () => {
          Logger.info(COMPONENT_SCOPE, 'Tap compact album action.', { title });
          onPickImage();
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.tile}>
      <View style={styles.headerRow}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={styles.title}>{title}</Text>
        {count > 1 ? (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{count}</Text>
          </View>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hasImage ? `${title}，查看大图` : (emptyActionLabel ?? `添加${title}`)}
        disabled={isBusy && !canShowImage}
        onPress={canShowImage ? onPreview : openAddMenu}
        style={({ pressed }) => [
          styles.previewBox,
          !hasImage && styles.previewBoxEmpty,
          pressed && styles.pressed,
        ]}>
        {canShowImage ? (
          <Image
            source={{ uri: normalizedUri }}
            style={styles.previewImage}
            resizeMode="contain"
            onError={() => setImageFailed(true)}
          />
        ) : null}

        {!hasImage ? (
          <View style={styles.emptyContent}>
            <View style={styles.addIconCircle}>
              <MaterialIcons name="add-photo-alternate" size={24} color={palette.green} />
            </View>
            <Text numberOfLines={2} style={styles.emptyActionText}>
              {emptyActionLabel ?? emptyText}
            </Text>
          </View>
        ) : null}

        {hasMissingImage ? (
          <View style={styles.emptyContent}>
            <MaterialIcons name="image-not-supported" size={24} color={palette.mutedText} />
            <Text style={styles.errorText}>图片文件不存在</Text>
          </View>
        ) : null}

        {hasImage && imageExists === true && imageFailed ? (
          <View style={styles.emptyContent}>
            <MaterialIcons name="broken-image" size={24} color={palette.mutedText} />
            <Text style={styles.errorText}>{loadErrorText}</Text>
          </View>
        ) : null}

        {canShowImage ? (
          <View style={styles.previewHint}>
            <MaterialIcons name="fullscreen" size={16} color={palette.secondaryText} />
          </View>
        ) : null}
      </Pressable>

      {showManagementActions ? (
        <View style={styles.actionsRow}>
          <IconAction
            icon="photo-camera"
            label="拍照"
            loading={isTakePhotoLoading}
            disabled={isBusy}
            onPress={onTakePhoto}
          />
          <IconAction
            icon="photo-library"
            label="相册"
            loading={isPickImageLoading}
            disabled={isBusy}
            onPress={onPickImage}
          />
          <IconAction icon="tune" label="编辑" disabled={!canEdit} onPress={onEdit} />
          <IconAction
            icon="delete-outline"
            label="删除"
            danger
            loading={isDeleteLoading}
            disabled={!canDelete}
            onPress={onDelete}
          />
        </View>
      ) : (
        <Text numberOfLines={1} style={styles.metaText}>
          {hasImage && typeof fileSize === 'number'
            ? `${formatFileSize(fileSize)}${count > 1 ? ` · 共 ${count} 张` : ''}`
            : (hasImage ? '点击查看大图' : '拍照或从相册添加')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: TILE_WIDTH,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 12,
    gap: spacing.sm,
  },
  headerRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: palette.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: {
    color: palette.secondaryText,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  previewBox: {
    width: '100%',
    height: PREVIEW_HEIGHT,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBoxEmpty: {
    borderStyle: 'dashed',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  emptyContent: {
    maxWidth: 150,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  addIconCircle: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActionText: {
    color: palette.green,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorText: {
    color: palette.danger,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  previewHint: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 2,
  },
  actionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  actionButtonDisabled: {
    opacity: 0.35,
  },
  actionLabel: {
    color: palette.secondaryText,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
  },
  actionLabelDanger: {
    color: palette.danger,
  },
  metaText: {
    color: palette.mutedText,
    fontSize: 12,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.68,
  },
});
