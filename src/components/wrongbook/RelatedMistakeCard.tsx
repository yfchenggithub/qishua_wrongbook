import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { CardContainer } from '@/src/components/ui/CardContainer';
import { ProgressDots } from '@/src/components/wrongbook/ProgressDots';
import type { RelatedMistakeItem } from '@/src/models/RelatedMistake';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

export interface RelatedMistakeCardProps {
  item: RelatedMistakeItem;
  actionLabel?: string;
  actionTone?: 'add' | 'remove' | 'none';
  busy?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

function formatRelationSource(source: RelatedMistakeItem['relationSource']): string | null {
  if (source === 'system') {
    return '系统推荐';
  }
  if (source === 'manual') {
    return '手动添加';
  }
  return null;
}

function Thumbnail({
  uri,
}: {
  uri?: string | null;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        resizeMode="cover"
        style={styles.thumbnail}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View style={styles.thumbnailPlaceholder}>
      <MaterialIcons name="image-not-supported" size={24} color={colors.textMuted} />
    </View>
  );
}

export function RelatedMistakeCard({
  item,
  actionLabel,
  actionTone = 'none',
  busy = false,
  disabled = false,
  onPress,
  onAction,
  style,
}: RelatedMistakeCardProps) {
  const sourceLabel = formatRelationSource(item.relationSource);
  const hasAction = !!actionLabel && !!onAction;
  const progressText = `${item.reviewCount}/${item.maxReviewCount}`;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress || disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pressable,
        pressed && onPress && !disabled && !busy ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}>
      <CardContainer padding={spacing.md} style={styles.card}>
        <View style={styles.row}>
          <Thumbnail uri={item.thumbnailUri} />
          <View style={styles.main}>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.title}>
                {item.title}
              </Text>
              {sourceLabel ? (
                <Text
                  numberOfLines={1}
                  style={[
                    styles.sourceText,
                    item.relationSource === 'manual' ? styles.sourceTextManual : null,
                  ]}>
                  {sourceLabel}
                </Text>
              ) : null}
            </View>

            <View style={styles.chipRow}>
              <View style={styles.moduleChip}>
                <Text numberOfLines={1} style={styles.moduleChipText}>
                  {item.module}
                </Text>
              </View>
              {item.errorReason ? (
                <View style={styles.reasonChip}>
                  <Text numberOfLines={1} style={styles.reasonChipText}>
                    {item.errorReason}
                  </Text>
                </View>
              ) : null}
              <View style={styles.difficultyChip}>
                <Text numberOfLines={1} style={styles.difficultyChipText}>
                  难度 {item.difficulty}
                </Text>
              </View>
            </View>

            <View style={styles.matchRow}>
              <Text numberOfLines={1} style={styles.matchText}>
                匹配原因：{item.matchReasons.length > 0 ? item.matchReasons.join(' / ') : '已关联'}
              </Text>
            </View>

            <View style={styles.progressRow}>
              <Text style={styles.progressText}>进度 {progressText}</Text>
              <ProgressDots
                total={item.maxReviewCount}
                current={Math.min(item.maxReviewCount, item.reviewCount + 1)}
                completed={item.reviewCount}
                style={styles.progressDots}
              />
            </View>
          </View>

          <View style={styles.trailing}>
            {hasAction ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy || disabled}
                onPress={onAction}
                style={({ pressed }) => [
                  styles.actionButton,
                  actionTone === 'remove' ? styles.actionButtonRemove : styles.actionButtonAdd,
                  pressed && !busy && !disabled ? styles.actionPressed : null,
                  (busy || disabled) ? styles.actionDisabled : null,
                ]}>
                {busy ? (
                  <ActivityIndicator size="small" color={colors.success} />
                ) : (
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.actionText,
                      actionTone === 'remove' ? styles.actionTextRemove : styles.actionTextAdd,
                    ]}>
                    {actionLabel}
                  </Text>
                )}
              </Pressable>
            ) : (
              <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
            )}
          </View>
        </View>
      </CardContainer>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: radius.xl,
  },
  pressed: {
    opacity: 0.84,
  },
  disabled: {
    opacity: 0.72,
  },
  card: {
    borderRadius: radius.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  thumbnail: {
    width: 62,
    height: 62,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  thumbnailPlaceholder: {
    width: 62,
    height: 62,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  titleRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  sourceText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '800',
  },
  sourceTextManual: {
    color: '#EA580C',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  moduleChip: {
    maxWidth: 120,
    borderRadius: radius.pill,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  moduleChipText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '800',
  },
  reasonChip: {
    maxWidth: 110,
    borderRadius: radius.pill,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  reasonChipText: {
    ...typography.caption,
    color: '#4F46E5',
    fontWeight: '800',
  },
  difficultyChip: {
    borderRadius: radius.pill,
    backgroundColor: '#FFF7ED',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  difficultyChipText: {
    ...typography.caption,
    color: '#C2410C',
    fontWeight: '800',
  },
  matchRow: {
    minWidth: 0,
  },
  matchText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  progressText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  progressDots: {
    gap: 3,
    flexShrink: 1,
  },
  trailing: {
    minWidth: 42,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  actionButton: {
    minWidth: 54,
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actionButtonAdd: {
    borderColor: colors.successBorder,
    backgroundColor: colors.surface,
  },
  actionButtonRemove: {
    borderColor: '#F3C8C8',
    backgroundColor: '#FFF1F1',
  },
  actionPressed: {
    opacity: 0.78,
  },
  actionDisabled: {
    opacity: 0.58,
  },
  actionText: {
    ...typography.caption,
    fontWeight: '800',
  },
  actionTextAdd: {
    color: colors.success,
  },
  actionTextRemove: {
    color: colors.danger,
  },
});
