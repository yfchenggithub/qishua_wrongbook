import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/src/styles/tokens';

interface LibraryBottomSheetProps {
  visible: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  headerActionLabel?: string;
  onHeaderAction?: () => void;
  footer?: ReactNode;
}

export function LibraryBottomSheet({
  visible,
  title,
  children,
  onClose,
  headerActionLabel,
  onHeaderAction,
  footer,
}: LibraryBottomSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.layer}>
        <Pressable
          accessibilityLabel={`关闭${title}`}
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Pressable
              accessibilityLabel={`关闭${title}`}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.headerButton, pressed ? styles.pressed : null]}>
              <MaterialIcons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            {headerActionLabel && onHeaderAction ? (
              <Pressable
                accessibilityRole="button"
                onPress={onHeaderAction}
                style={({ pressed }) => [styles.headerButton, pressed ? styles.pressed : null]}>
                <Text style={styles.headerAction}>{headerActionLabel}</Text>
              </Pressable>
            ) : (
              <View style={styles.headerButton} />
            )}
          </View>
          <View style={styles.content}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
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
    maxHeight: '84%',
    minHeight: 320,
    overflow: 'hidden',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  handle: {
    width: 36,
    height: 5,
    alignSelf: 'center',
    marginTop: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: '#D2D3D5',
  },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerButton: {
    width: 52,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  title: {
    ...typography.sectionTitle,
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    lineHeight: 24,
  },
  headerAction: {
    ...typography.body,
    color: colors.success,
    fontWeight: '700',
  },
  content: {
    flexShrink: 1,
    minHeight: 0,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.55,
    backgroundColor: colors.surfaceMuted,
  },
});
