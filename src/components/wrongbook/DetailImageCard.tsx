import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { CardContainer } from '@/src/components/ui';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

export interface DetailImageCardProps {
  title: string;
  uri?: string | null;
  exists?: boolean;
  fileSize?: number | null;
  emptyText: string;
  height?: number;
  loadErrorText?: string;
  compactEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionText?: string;
  onEmptyActionPress?: () => void;
  isEmptyActionLoading?: boolean;
  emptyActionDisabled?: boolean;
}

function shortenUri(uri: string): string {
  if (uri.length <= 52) {
    return uri;
  }
  return `...${uri.slice(-49)}`;
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

export function DetailImageCard({
  title,
  uri,
  exists,
  fileSize,
  emptyText,
  height = 220,
  loadErrorText = '图片加载失败',
  compactEmpty = false,
  emptyTitle,
  emptyDescription,
  emptyActionText,
  onEmptyActionPress,
  isEmptyActionLoading = false,
  emptyActionDisabled = false,
}: DetailImageCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  const normalizedUri = useMemo(() => {
    if (typeof uri !== 'string') {
      return null;
    }
    const trimmed = uri.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [uri]);

  useEffect(() => {
    setImageFailed(false);
  }, [normalizedUri]);

  const hasUri = !!normalizedUri;
  const canShowImage = hasUri && exists === true && !imageFailed;
  const isFileMissing = hasUri && exists === false;
  const isLoadFailed = hasUri && exists === true && imageFailed;
  const hasEmptyAction = !!emptyActionText && typeof onEmptyActionPress === 'function';
  const isCompactEmptyState = !hasUri && compactEmpty;
  const boxStyles = [
    styles.previewBox,
    !isCompactEmptyState ? { height } : undefined,
    !hasUri && !isCompactEmptyState ? styles.previewBoxEmpty : undefined,
    isCompactEmptyState ? styles.previewBoxCompact : undefined,
  ];

  return (
    <CardContainer style={styles.card} padding={spacing.md}>
      <Text style={styles.title}>{title}</Text>

      <View style={boxStyles}>
        {canShowImage ? (
          <Image
            source={{ uri: normalizedUri! }}
            style={styles.image}
            resizeMode="contain"
            onError={() => {
              console.warn('[DetailImageCard] Failed to load image.', normalizedUri);
              setImageFailed(true);
            }}
          />
        ) : null}

        {isFileMissing ? (
          <View style={styles.messageWrap}>
            <Text style={styles.errorText}>图片文件不存在</Text>
            <Text style={styles.uriText}>{shortenUri(normalizedUri!)}</Text>
          </View>
        ) : null}

        {isLoadFailed ? (
          <View style={styles.messageWrap}>
            <Text style={styles.errorText}>{loadErrorText}</Text>
            <Text style={styles.uriText}>{shortenUri(normalizedUri!)}</Text>
          </View>
        ) : null}

        {!hasUri && !isCompactEmptyState ? <Text style={styles.emptyText}>{emptyText}</Text> : null}

        {isCompactEmptyState ? (
          <View style={styles.compactEmptyContent}>
            <View style={styles.compactEmptyTextWrap}>
              <Text style={styles.compactEmptyTitle}>{emptyTitle ?? emptyText}</Text>
              {emptyDescription ? (
                <Text style={styles.compactEmptyDescription}>{emptyDescription}</Text>
              ) : null}
            </View>

            {hasEmptyAction ? (
              <Pressable
                style={[
                  styles.compactEmptyAction,
                  (isEmptyActionLoading || emptyActionDisabled) && styles.compactEmptyActionDisabled,
                ]}
                onPress={onEmptyActionPress}
                disabled={isEmptyActionLoading || emptyActionDisabled}>
                <Text style={styles.compactEmptyActionText}>
                  {isEmptyActionLoading ? '保存中...' : emptyActionText}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {canShowImage && fileSize !== undefined && fileSize !== null ? (
        <Text style={styles.fileSize}>大小：{formatFileSize(fileSize)}</Text>
      ) : null}
    </CardContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
  },
  title: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
  },
  previewBox: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
    overflow: 'hidden',
  },
  previewBoxEmpty: {
    borderStyle: 'dashed',
  },
  previewBoxCompact: {
    borderStyle: 'solid',
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  compactEmptyContent: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  compactEmptyTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  compactEmptyTitle: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  compactEmptyDescription: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  compactEmptyAction: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  compactEmptyActionDisabled: {
    opacity: 0.5,
  },
  compactEmptyActionText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  messageWrap: {
    gap: spacing.xs,
    alignItems: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
  uriText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  fileSize: {
    marginTop: spacing.xs,
    ...typography.caption,
    color: colors.textMuted,
  },
});

