import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Logger } from '@/src/services/Logger';
import { colors, radius, spacing } from '@/src/styles/tokens';

const COMPONENT_SCOPE = 'MistakeImageSection';
const PREVIEW_MIN_HEIGHT = 228;
const PREVIEW_MAX_HEIGHT = 280;

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

export type MistakeImageWorkspaceType = 'question' | 'my_solution' | 'answer';

export interface MistakeImageWorkspaceSlot {
  type: MistakeImageWorkspaceType;
  title: string;
  imageUri?: string | null;
  imageExists?: boolean;
  fileSize?: number | null;
  emptyText: string;
  emptyActionLabel?: string;
  loadErrorText?: string;
  isBusy?: boolean;
  isTakePhotoLoading?: boolean;
  isPickImageLoading?: boolean;
  isDeleteLoading?: boolean;
  onTakePhoto: () => void;
  onPickImage: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreview: () => void;
}

export interface MistakeImageSectionProps {
  slots: readonly MistakeImageWorkspaceSlot[];
  showManagementActions?: boolean;
}

function normalizeUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }
  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function formatFileSize(fileSize: number): string {
  if (fileSize < 1024) {
    return `${fileSize} B`;
  }
  if (fileSize < 1024 * 1024) {
    return `${Math.round(fileSize / 1024)} KB`;
  }
  return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
}

function getPreviewHeight(viewportWidth: number): number {
  const scaledHeight = Math.round(viewportWidth * 0.58);
  return Math.max(PREVIEW_MIN_HEIGHT, Math.min(PREVIEW_MAX_HEIGHT, scaledHeight));
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
  slots,
  showManagementActions = false,
}: MistakeImageSectionProps) {
  const { width: viewportWidth } = useWindowDimensions();
  const [activeType, setActiveType] = useState<MistakeImageWorkspaceType>('question');
  const [imageFailed, setImageFailed] = useState(false);
  const selectedSlot = useMemo(
    () => slots.find((slot) => slot.type === activeType) ?? slots[0] ?? null,
    [activeType, slots],
  );
  const mySolutionSlot = useMemo(
    () => slots.find((slot) => slot.type === 'my_solution') ?? null,
    [slots],
  );

  useEffect(() => {
    if (selectedSlot && !slots.some((slot) => slot.type === activeType)) {
      setActiveType(selectedSlot.type);
    }
  }, [activeType, selectedSlot, slots]);

  useEffect(() => {
    setImageFailed(false);
  }, [selectedSlot?.imageUri]);

  if (!selectedSlot) {
    return null;
  }

  const normalizedUri = normalizeUri(selectedSlot.imageUri);
  const hasImage = !!normalizedUri;
  const canShowImage = hasImage && selectedSlot.imageExists === true && !imageFailed;
  const hasMissingImage = hasImage && selectedSlot.imageExists === false;
  const canEdit = hasImage && selectedSlot.imageExists !== false && !selectedSlot.isBusy;
  const canDelete = hasImage && !selectedSlot.isBusy;
  const shouldShowSolutionShortcut =
    !showManagementActions
    && activeType !== 'my_solution'
    && !!mySolutionSlot
    && (!normalizeUri(mySolutionSlot.imageUri) || mySolutionSlot.imageExists === false);

  const openAddMenu = (slot: MistakeImageWorkspaceSlot) => {
    if (slot.isBusy) {
      return;
    }
    Alert.alert(`添加${slot.title}`, '选择图片来源', [
      {
        text: '拍照',
        onPress: () => {
          Logger.info(COMPONENT_SCOPE, 'Tap workspace take photo action.', { type: slot.type });
          slot.onTakePhoto();
        },
      },
      {
        text: '从相册选择',
        onPress: () => {
          Logger.info(COMPONENT_SCOPE, 'Tap workspace album action.', { type: slot.type });
          slot.onPickImage();
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const handlePreviewPress = () => {
    if (canShowImage) {
      selectedSlot.onPreview();
      return;
    }
    openAddMenu(selectedSlot);
  };

  return (
    <View style={styles.workspaceCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          canShowImage
            ? `${selectedSlot.title}，查看大图`
            : (selectedSlot.emptyActionLabel ?? `添加${selectedSlot.title}`)
        }
        disabled={selectedSlot.isBusy && !canShowImage}
        onPress={handlePreviewPress}
        style={({ pressed }) => [
          styles.previewBox,
          { height: getPreviewHeight(viewportWidth) },
          pressed && !selectedSlot.isBusy && styles.pressed,
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
              <MaterialIcons name="add" size={28} color={colors.white} />
            </View>
            <Text style={styles.emptyActionText}>
              {selectedSlot.emptyActionLabel ?? selectedSlot.emptyText}
            </Text>
            <Text style={styles.emptyHintText}>拍照或从相册添加</Text>
          </View>
        ) : null}

        {hasMissingImage ? (
          <View style={styles.emptyContent}>
            <MaterialIcons name="image-not-supported" size={28} color={palette.mutedText} />
            <Text style={styles.errorText}>图片文件不存在</Text>
            <Text style={styles.emptyHintText}>点击重新添加</Text>
          </View>
        ) : null}

        {hasImage && selectedSlot.imageExists === true && imageFailed ? (
          <View style={styles.emptyContent}>
            <MaterialIcons name="broken-image" size={28} color={palette.mutedText} />
            <Text style={styles.errorText}>{selectedSlot.loadErrorText ?? '图片加载失败'}</Text>
          </View>
        ) : null}

        {canShowImage ? (
          <View style={styles.previewHint}>
            <MaterialIcons name="fullscreen" size={18} color={palette.secondaryText} />
          </View>
        ) : null}
      </Pressable>

      {canShowImage && typeof selectedSlot.fileSize === 'number' ? (
        <Text numberOfLines={1} style={styles.metaText}>{formatFileSize(selectedSlot.fileSize)}</Text>
      ) : null}

      <View accessibilityRole="tablist" style={styles.tabList}>
        {slots.map((slot) => {
          const selected = slot.type === selectedSlot.type;
          return (
            <Pressable
              key={slot.type}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`显示${slot.title}`}
              onPress={() => setActiveType(slot.type)}
              style={({ pressed }) => [
                styles.tab,
                selected && styles.tabSelected,
                pressed && styles.pressed,
              ]}>
              <Text numberOfLines={1} style={[styles.tabText, selected && styles.tabTextSelected]}>
                {slot.title}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {showManagementActions ? (
        <View style={styles.actionsRow}>
          <IconAction
            icon="photo-camera"
            label="拍照"
            loading={selectedSlot.isTakePhotoLoading}
            disabled={selectedSlot.isBusy}
            onPress={selectedSlot.onTakePhoto}
          />
          <IconAction
            icon="photo-library"
            label="相册"
            loading={selectedSlot.isPickImageLoading}
            disabled={selectedSlot.isBusy}
            onPress={selectedSlot.onPickImage}
          />
          <IconAction icon="tune" label="编辑" disabled={!canEdit} onPress={selectedSlot.onEdit} />
          <IconAction
            icon="delete-outline"
            label="删除"
            danger
            loading={selectedSlot.isDeleteLoading}
            disabled={!canDelete}
            onPress={selectedSlot.onDelete}
          />
        </View>
      ) : null}

      {shouldShowSolutionShortcut && mySolutionSlot ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="添加我的做法"
          disabled={mySolutionSlot.isBusy}
          onPress={() => openAddMenu(mySolutionSlot)}
          style={({ pressed }) => [
            styles.solutionShortcut,
            mySolutionSlot.isBusy && styles.solutionShortcutDisabled,
            pressed && !mySolutionSlot.isBusy && styles.pressed,
          ]}>
          <View style={styles.solutionShortcutIcon}>
            <MaterialIcons name="add" size={24} color={colors.white} />
          </View>
          <View style={styles.solutionShortcutTextWrap}>
            <Text style={styles.solutionShortcutTitle}>添加我的做法</Text>
            <Text style={styles.solutionShortcutDescription}>拍照或从相册添加，记录你的解题思路</Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={palette.secondaryText} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  workspaceCard: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  previewBox: {
    width: '100%',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  emptyContent: {
    maxWidth: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  addIconCircle: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: palette.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActionText: {
    color: palette.green,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyHintText: {
    color: palette.mutedText,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorText: {
    color: palette.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  previewHint: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaText: {
    color: palette.mutedText,
    fontSize: 12,
    lineHeight: 16,
  },
  tabList: {
    minHeight: 52,
    borderRadius: radius.lg,
    backgroundColor: '#F0F1F4',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  tabSelected: {
    backgroundColor: palette.surface,
    shadowColor: colors.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  tabText: {
    color: palette.secondaryText,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  tabTextSelected: {
    color: palette.text,
    fontWeight: '700',
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
    borderRadius: radius.md,
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
  solutionShortcut: {
    minHeight: 82,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: '#FAFAFB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  solutionShortcutDisabled: {
    opacity: 0.5,
  },
  solutionShortcutIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: palette.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  solutionShortcutTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  solutionShortcutTitle: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  solutionShortcutDescription: {
    color: palette.mutedText,
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.68,
  },
});
