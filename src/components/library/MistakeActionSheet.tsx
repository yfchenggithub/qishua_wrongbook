import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MistakeListItem } from '@/src/models/MistakeListItem';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

import { LibraryBottomSheet } from './LibraryBottomSheet';

interface MistakeActionSheetProps {
  item: MistakeListItem | null;
  onClose: () => void;
  onDelete: (item: MistakeListItem) => void;
  onJoinReviewPlan: (item: MistakeListItem) => void;
  onTogglePinned: (item: MistakeListItem) => void;
}

interface MistakeActionRowProps {
  danger?: boolean;
  icon: ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  onPress: () => void;
}

function MistakeActionRow({ danger = false, icon, label, onPress }: MistakeActionRowProps) {
  const color = danger ? colors.danger : colors.textPrimary;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, pressed ? styles.actionRowPressed : null]}>
      <MaterialIcons color={color} name={icon} size={23} />
      <Text style={[styles.actionLabel, danger ? styles.dangerLabel : null]}>{label}</Text>
      <MaterialIcons color={colors.textTertiary} name="chevron-right" size={22} />
    </Pressable>
  );
}

export function MistakeActionSheet({
  item,
  onClose,
  onDelete,
  onJoinReviewPlan,
  onTogglePinned,
}: MistakeActionSheetProps) {
  return (
    <LibraryBottomSheet
      footer={(
        <Pressable
          accessibilityLabel="取消题目操作"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.cancelButton, pressed ? styles.cancelButtonPressed : null]}>
          <Text style={styles.cancelButtonText}>取消</Text>
        </Pressable>
      )}
      onClose={onClose}
      title="题目操作"
      visible={item !== null}>
      {item ? (
        <View style={styles.content}>
          <Text numberOfLines={2} style={styles.itemTitle}>
            {item.questionCode ? `${item.questionCode} · ` : ''}{item.title}
          </Text>
          <View style={styles.actions}>
            {item.status === 'collected' ? (
              <MistakeActionRow
                icon="playlist-add"
                label="加入七刷"
                onPress={() => onJoinReviewPlan(item)}
              />
            ) : null}
            <MistakeActionRow
              icon="push-pin"
              label={item.isPinned ? '取消置顶' : '置顶题目'}
              onPress={() => onTogglePinned(item)}
            />
            <MistakeActionRow
              danger
              icon="delete-outline"
              label="删除题目"
              onPress={() => onDelete(item)}
            />
          </View>
        </View>
      ) : null}
    </LibraryBottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  itemTitle: {
    ...typography.bodySmall,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    color: colors.textSecondary,
  },
  actions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  actionRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  actionRowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  actionLabel: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  dangerLabel: {
    color: colors.danger,
  },
  cancelButton: {
    minHeight: layout.minimumTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  cancelButtonPressed: {
    opacity: 0.6,
  },
  cancelButtonText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
});
