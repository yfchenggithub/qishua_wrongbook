import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/src/styles/tokens';

export interface BulkDeleteConfirmSheetProps {
  visible: boolean;
  count: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function BulkDeleteConfirmSheet({
  visible,
  count,
  deleting,
  onCancel,
  onConfirm,
}: BulkDeleteConfirmSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="slide"
      onRequestClose={deleting ? undefined : onCancel}
      statusBarTranslucent
      transparent
      visible={visible}>
      <View style={styles.layer}>
        <Pressable
          accessibilityLabel="取消删除"
          accessibilityRole="button"
          disabled={deleting}
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.copy}>
            <Text style={styles.title}>删除 {count} 道题？</Text>
            <Text style={styles.description}>所选题目将从错题库中移除。</Text>
          </View>
          <View style={styles.divider} />
          <Pressable
            accessibilityLabel={`删除${count}道题`}
            accessibilityRole="button"
            accessibilityState={{ disabled: deleting }}
            disabled={deleting}
            onPress={onConfirm}
            style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}>
            {deleting ? (
              <ActivityIndicator color={colors.danger} size="small" />
            ) : (
              <Text style={styles.deleteText}>删除 {count} 道题</Text>
            )}
          </Pressable>
          <View style={styles.actionSeparator} />
          <Pressable
            accessibilityRole="button"
            disabled={deleting}
            onPress={onCancel}
            style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 17, 17, 0.32)',
  },
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  copy: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  title: {
    ...typography.sectionTitle,
    fontSize: 19,
    lineHeight: 25,
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  action: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  actionSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.separator,
  },
  deleteText: {
    color: colors.danger,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
  },
  cancelText: {
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
});
