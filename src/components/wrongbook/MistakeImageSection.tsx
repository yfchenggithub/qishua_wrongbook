import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CardContainer } from '@/src/components/ui';
import { Logger } from '@/src/services/Logger';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const COMPONENT_SCOPE = 'MistakeImageSection';

export interface MistakeImageSectionProps {
  title: string;
  imageUri?: string | null;
  imageExists?: boolean;
  fileSize?: number | null;
  emptyText: string;
  loadErrorText?: string;
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

export function MistakeImageSection({
  title,
  imageUri,
  imageExists,
  fileSize,
  emptyText,
  loadErrorText = '图片加载失败',
  isBusy = false,
  isTakePhotoLoading = false,
  isDeleteLoading = false,
  onTakePhoto,
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

  useEffect(() => {
    setImageFailed(false);
  }, [normalizedUri]);

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

      <View style={[styles.previewBox, !hasImage && styles.previewBoxEmpty]}>
        {canShowImage ? (
          <>
            <Pressable style={styles.previewPressable} onPress={onPreview}>
              <Image
                source={{ uri: normalizedUri }}
                style={styles.image}
                resizeMode="contain"
                onError={() => setImageFailed(true)}
              />
            </Pressable>

            <Text style={styles.previewHint}>点击查看大图</Text>

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
    height: 220,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: spacing.md,
    position: 'relative',
  },
  previewBoxEmpty: {
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  previewPressable: {
    width: '100%',
    flex: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  previewHint: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.xs,
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.pill,
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
