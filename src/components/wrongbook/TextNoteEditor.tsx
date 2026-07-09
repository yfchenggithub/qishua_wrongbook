import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const DOUBLE_TAP_WINDOW_MS = 300;

export type TextNotePreviewProps = {
  value: string;
  emptyText: string;
  maxLength: number;
  accessibilityLabel: string;
  onOpen: () => void;
  disabled?: boolean;
  hintText?: string;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  emptyTextStyle?: StyleProp<TextStyle>;
  footerStyle?: StyleProp<ViewStyle>;
};

export function TextNotePreview({
  value,
  emptyText,
  maxLength,
  accessibilityLabel,
  onOpen,
  disabled = false,
  hintText = '双击查看和编辑',
  numberOfLines = 2,
  style,
  textStyle,
  emptyTextStyle,
  footerStyle,
}: TextNotePreviewProps) {
  const lastTapAtRef = useRef(0);
  const displayText = value.trim().length > 0 ? value : emptyText;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel}，双击查看和编辑`}
      disabled={disabled}
      onPress={() => {
        const now = Date.now();
        if (now - lastTapAtRef.current <= DOUBLE_TAP_WINDOW_MS) {
          lastTapAtRef.current = 0;
          onOpen();
          return;
        }
        lastTapAtRef.current = now;
      }}
      style={({ pressed }) => [
        styles.preview,
        style,
        pressed && !disabled && styles.previewPressed,
        disabled && styles.disabled,
      ]}>
      <Text
        ellipsizeMode="tail"
        numberOfLines={numberOfLines}
        style={[
          styles.previewText,
          textStyle,
          value.trim().length <= 0 && styles.previewEmptyText,
          value.trim().length <= 0 && emptyTextStyle,
        ]}>
        {displayText}
      </Text>
      <View style={[styles.previewFooter, footerStyle]}>
        <Text style={styles.previewHint}>{hintText}</Text>
        <Text style={styles.previewCounter}>{value.length}/{maxLength}</Text>
      </View>
    </Pressable>
  );
}

export type TextNoteEditorModalProps = {
  visible: boolean;
  title: string;
  value: string;
  maxLength: number;
  placeholder: string;
  onClose: () => void;
  onSave: (value: string) => boolean | Promise<boolean>;
  onDraftChange?: (value: string) => void;
  subtitle?: string;
  helperText?: string;
  errorMessage?: string | null;
  busy?: boolean;
  allowEmpty?: boolean;
  saveLabel?: string;
  initialMode?: 'view' | 'edit';
};

export function TextNoteEditorModal({
  visible,
  title,
  value,
  maxLength,
  placeholder,
  onClose,
  onSave,
  onDraftChange,
  subtitle,
  helperText,
  errorMessage,
  busy = false,
  allowEmpty = true,
  saveLabel = '保存',
  initialMode = 'view',
}: TextNoteEditorModalProps) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState(value);
  const [isAwaitingSave, setIsAwaitingSave] = useState(false);
  const wasVisibleRef = useRef(false);
  const keyboardVisibleRef = useRef(false);
  const effectiveBusy = busy || isAwaitingSave;
  const canSave = !effectiveBusy && (allowEmpty || draft.trim().length > 0);
  const displayText = value.trim().length > 0 ? value : '暂无内容';

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setDraft(value);
      setMode(initialMode);
      setIsAwaitingSave(false);
    }
    wasVisibleRef.current = visible;
  }, [initialMode, value, visible]);

  useEffect(() => {
    if (!visible) {
      keyboardVisibleRef.current = false;
      return;
    }

    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      keyboardVisibleRef.current = true;
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
      keyboardVisibleRef.current = false;
    };
  }, [visible]);

  const handleClose = () => {
    if (effectiveBusy) {
      return;
    }
    Keyboard.dismiss();
    onClose();
  };

  const handleRequestClose = () => {
    if (mode === 'edit' && (keyboardVisibleRef.current || Keyboard.isVisible())) {
      Keyboard.dismiss();
      return;
    }
    handleClose();
  };

  const handleStartEdit = () => {
    setDraft(value);
    setMode('edit');
    onDraftChange?.(value);
  };

  const handleCancelEdit = () => {
    Keyboard.dismiss();
    setDraft(value);
    setMode('view');
    onDraftChange?.(value);
  };

  const handleSave = async () => {
    if (!canSave) {
      return;
    }
    setIsAwaitingSave(true);
    const saved = await onSave(draft);
    setIsAwaitingSave(false);
    if (!saved) {
      return;
    }
    Keyboard.dismiss();
    setMode('view');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleRequestClose}>
      <KeyboardAvoidingView
        behavior="padding"
        style={[
          styles.modalOverlay,
          {
            paddingTop: Math.max(insets.top + spacing.xl, spacing.xxl),
            paddingBottom: Math.max(insets.bottom + spacing.xl, spacing.xxl),
          },
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`关闭${title}`}
          style={styles.modalBackdrop}
          onPress={handleClose}
        />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.modalTitle}>{title}</Text>
              <Text style={styles.modalSubtitle}>
                {subtitle ? `${subtitle} · ` : ''}
                {mode === 'edit' ? '编辑' : '查看'} · {mode === 'edit' ? draft.length : value.length}/{maxLength}
              </Text>
            </View>
            {effectiveBusy ? <ActivityIndicator size="small" color="#7C3AED" /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`关闭${title}`}
              disabled={effectiveBusy}
              onPress={handleClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && !effectiveBusy && styles.buttonPressed,
                effectiveBusy && styles.disabled,
              ]}>
              <MaterialIcons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          {mode === 'view' ? (
            <ScrollView
              style={styles.modalReadScroll}
              contentContainerStyle={styles.modalScrollContent}>
              <Text
                selectable
                style={[
                  styles.modalReadText,
                  value.trim().length <= 0 && styles.modalReadEmptyText,
                ]}>
                {displayText}
              </Text>
              {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
            </ScrollView>
          ) : (
            <ScrollView
              style={styles.modalEditorScroll}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}>
              <TextInput
                accessibilityLabel={`${title}内容`}
                autoFocus
                editable={!effectiveBusy}
                maxLength={maxLength}
                multiline
                onChangeText={(nextValue) => {
                  setDraft(nextValue);
                  onDraftChange?.(nextValue);
                }}
                placeholder={placeholder}
                placeholderTextColor={colors.textMuted}
                scrollEnabled
                style={styles.modalInput}
                textAlignVertical="top"
                value={draft}
              />
              {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
              {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
            </ScrollView>
          )}

          <View style={styles.modalFooter}>
            {mode === 'view' ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleClose}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.buttonPressed,
                  ]}>
                  <Text style={styles.secondaryButtonText}>关闭</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleStartEdit}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.buttonPressed,
                  ]}>
                  <Text style={styles.primaryButtonText}>编辑</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={effectiveBusy}
                  onPress={handleCancelEdit}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && !effectiveBusy && styles.buttonPressed,
                    effectiveBusy && styles.disabled,
                  ]}>
                  <Text style={styles.secondaryButtonText}>取消</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={!canSave}
                  onPress={() => {
                    void handleSave();
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && canSave && styles.buttonPressed,
                    !canSave && styles.disabled,
                  ]}>
                  <Text style={styles.primaryButtonText}>
                    {effectiveBusy ? '保存中...' : saveLabel}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  preview: {
    gap: spacing.xs,
  },
  previewPressed: {
    opacity: 0.78,
  },
  previewText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  previewEmptyText: {
    color: colors.textMuted,
  },
  previewFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  previewHint: {
    ...typography.caption,
    color: '#7C3AED',
    fontWeight: '700',
  },
  previewCounter: {
    ...typography.caption,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.screenPadding,
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    maxHeight: '92%',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  modalHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalHeaderText: {
    flex: 1,
    gap: 2,
  },
  modalTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  modalSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScrollContent: {
    gap: spacing.sm,
  },
  modalEditorScroll: {
    flexShrink: 1,
  },
  modalReadScroll: {
    flexGrow: 0,
    minHeight: 220,
  },
  modalReadText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 25,
  },
  modalReadEmptyText: {
    color: colors.textMuted,
  },
  modalInput: {
    minHeight: 220,
    maxHeight: 420,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: '#FAFAFF',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  helperText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  secondaryButton: {
    minWidth: 76,
    minHeight: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryButton: {
    minWidth: 90,
    minHeight: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#6D28D9',
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.52,
  },
  secondaryButtonText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  primaryButtonText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '800',
  },
});
