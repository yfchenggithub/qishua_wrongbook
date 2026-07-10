import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputContentSizeChangeEvent,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const DOUBLE_TAP_WINDOW_MS = 300;
const TEXT_SCROLLBAR_MIN_THUMB_HEIGHT = 36;

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
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [editorViewportHeight, setEditorViewportHeight] = useState(0);
  const [editorContentHeight, setEditorContentHeight] = useState(0);
  const [editorScrollOffsetY, setEditorScrollOffsetY] = useState(0);
  const [editorTextHeight, setEditorTextHeight] = useState(0);
  const [readViewportHeight, setReadViewportHeight] = useState(0);
  const [readContentHeight, setReadContentHeight] = useState(0);
  const [readScrollOffsetY, setReadScrollOffsetY] = useState(0);
  const wasVisibleRef = useRef(false);
  const keyboardVisibleRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const effectiveBusy = busy || isAwaitingSave;
  const canSave = !effectiveBusy && (allowEmpty || draft.trim().length > 0);
  const shouldUseKeyboardLayout = mode === 'edit' && isKeyboardVisible;
  const editorFallbackInputHeight = shouldUseKeyboardLayout ? 180 : 280;
  const editorMinInputHeight = Math.max(editorFallbackInputHeight, editorViewportHeight);
  const editorInputHeight = Math.max(editorMinInputHeight, editorTextHeight);
  const editorIsScrollable = editorContentHeight > editorViewportHeight + 8;
  const editorScrollbarThumbHeight = editorIsScrollable
    ? Math.min(
      editorViewportHeight,
      Math.max(
        TEXT_SCROLLBAR_MIN_THUMB_HEIGHT,
        (editorViewportHeight * editorViewportHeight) / Math.max(editorContentHeight, 1),
      ),
    )
    : 0;
  const editorScrollbarMaxTop = Math.max(editorViewportHeight - editorScrollbarThumbHeight, 0);
  const editorScrollbarTop = editorIsScrollable
    ? Math.min(
      editorScrollbarMaxTop,
      (editorScrollOffsetY / Math.max(editorContentHeight - editorViewportHeight, 1))
        * editorScrollbarMaxTop,
    )
    : 0;
  const readIsScrollable = readContentHeight > readViewportHeight + 8;
  const readScrollbarThumbHeight = readIsScrollable
    ? Math.min(
      readViewportHeight,
      Math.max(
        TEXT_SCROLLBAR_MIN_THUMB_HEIGHT,
        (readViewportHeight * readViewportHeight) / Math.max(readContentHeight, 1),
      ),
    )
    : 0;
  const readScrollbarMaxTop = Math.max(readViewportHeight - readScrollbarThumbHeight, 0);
  const readScrollbarTop = readIsScrollable
    ? Math.min(
      readScrollbarMaxTop,
      (readScrollOffsetY / Math.max(readContentHeight - readViewportHeight, 1))
        * readScrollbarMaxTop,
    )
    : 0;
  const displayText = value.trim().length > 0 ? value : '暂无内容';

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setDraft(value);
      setMode(initialMode);
      setIsAwaitingSave(false);
      setEditorScrollOffsetY(0);
      setEditorContentHeight(0);
      setEditorViewportHeight(0);
      setEditorTextHeight(0);
      setReadScrollOffsetY(0);
      setReadContentHeight(0);
      setReadViewportHeight(0);
    }
    wasVisibleRef.current = visible;
  }, [initialMode, value, visible]);

  useEffect(() => {
    if (!visible) {
      keyboardVisibleRef.current = false;
      setIsKeyboardVisible(false);
      return;
    }

    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      keyboardVisibleRef.current = true;
      setIsKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
      setIsKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
      keyboardVisibleRef.current = false;
      setIsKeyboardVisible(false);
    };
  }, [visible]);

  const handleClose = () => {
    if (effectiveBusy) {
      return;
    }
    inputRef.current?.blur();
    onClose();
    requestAnimationFrame(() => {
      Keyboard.dismiss();
    });
  };

  const handleRequestClose = () => {
    if (mode === 'edit' && (keyboardVisibleRef.current || Keyboard.isVisible())) {
      Keyboard.dismiss();
      return;
    }
    handleClose();
  };

  const handleReadLayout = (event: LayoutChangeEvent) => {
    setReadViewportHeight(event.nativeEvent.layout.height);
  };

  const handleReadContentSizeChange = (_width: number, height: number) => {
    setReadContentHeight(height);
  };

  const handleReadScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    setReadScrollOffsetY(Math.max(contentOffset.y, 0));
    setReadContentHeight(contentSize.height);
    setReadViewportHeight(layoutMeasurement.height);
  };

  const handleEditorLayout = (event: LayoutChangeEvent) => {
    setEditorViewportHeight(event.nativeEvent.layout.height);
  };

  const handleEditorContentSizeChange = (_width: number, height: number) => {
    setEditorContentHeight(height);
  };

  const handleEditorScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    setEditorScrollOffsetY(Math.max(contentOffset.y, 0));
    setEditorContentHeight(contentSize.height);
    setEditorViewportHeight(layoutMeasurement.height);
  };

  const handleInputContentSizeChange = (event: TextInputContentSizeChangeEvent) => {
    setEditorTextHeight(Math.ceil(event.nativeEvent.contentSize.height) + spacing.sm);
  };

  const handleStartEdit = () => {
    setDraft(value);
    setEditorScrollOffsetY(0);
    setMode('edit');
    onDraftChange?.(value);
  };

  const handleCancelEdit = () => {
    inputRef.current?.blur();
    keyboardVisibleRef.current = false;
    setIsKeyboardVisible(false);
    setDraft(value);
    setMode('view');
    onDraftChange?.(value);
    requestAnimationFrame(() => {
      Keyboard.dismiss();
    });
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
    inputRef.current?.blur();
    keyboardVisibleRef.current = false;
    setIsKeyboardVisible(false);
    setMode('view');
    requestAnimationFrame(() => {
      Keyboard.dismiss();
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleRequestClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={mode === 'edit'}
        style={[
          styles.modalOverlay,
          shouldUseKeyboardLayout && styles.modalOverlayKeyboardVisible,
          {
            paddingTop: Math.max(insets.top + spacing.xl, spacing.xxl),
            paddingBottom: shouldUseKeyboardLayout
              ? Math.max(insets.bottom + spacing.sm, spacing.md)
              : Math.max(insets.bottom + spacing.xl, spacing.xxl),
          },
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`关闭${title}`}
          style={styles.modalBackdrop}
          onPress={handleClose}
        />
        <View style={[styles.modalCard, shouldUseKeyboardLayout && styles.modalCardKeyboardVisible]}>
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
            <View style={styles.modalReadScrollFrame}>
              <ScrollView
                style={styles.modalReadScroll}
                contentContainerStyle={[styles.modalScrollContent, styles.modalReadScrollContent]}
                decelerationRate="fast"
                onContentSizeChange={handleReadContentSizeChange}
                onLayout={handleReadLayout}
                onScroll={handleReadScroll}
                overScrollMode="always"
                persistentScrollbar
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}>
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
              {readIsScrollable ? (
                <View pointerEvents="none" style={styles.modalScrollbarTrack}>
                  <View
                    style={[
                      styles.modalScrollbarThumb,
                      {
                        height: readScrollbarThumbHeight,
                        transform: [{ translateY: readScrollbarTop }],
                      },
                    ]}
                  />
                </View>
              ) : null}
            </View>
          ) : (
            <View style={[styles.modalEditorBody, shouldUseKeyboardLayout && styles.modalEditorBodyKeyboardVisible]}>
              <View style={styles.modalEditorScrollFrame}>
                <ScrollView
                  style={styles.modalEditorScroll}
                  contentContainerStyle={styles.modalEditorScrollContent}
                  decelerationRate="fast"
                  keyboardShouldPersistTaps="always"
                  nestedScrollEnabled
                  onContentSizeChange={handleEditorContentSizeChange}
                  onLayout={handleEditorLayout}
                  onScroll={handleEditorScroll}
                  overScrollMode="always"
                  persistentScrollbar
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={false}>
                  <TextInput
                    ref={inputRef}
                    accessibilityLabel={`${title}内容`}
                    autoFocus
                    editable={!effectiveBusy}
                    maxLength={maxLength}
                    multiline
                    onChangeText={(nextValue) => {
                      setDraft(nextValue);
                      onDraftChange?.(nextValue);
                    }}
                    onContentSizeChange={handleInputContentSizeChange}
                    placeholder={placeholder}
                    placeholderTextColor={colors.textMuted}
                    scrollEnabled={false}
                    style={[
                      styles.modalInput,
                      shouldUseKeyboardLayout && styles.modalInputKeyboardVisible,
                      { height: editorInputHeight, minHeight: editorMinInputHeight },
                    ]}
                    textAlignVertical="top"
                    value={draft}
                  />
                </ScrollView>
                {editorIsScrollable ? (
                  <View pointerEvents="none" style={styles.modalScrollbarTrack}>
                    <View
                      style={[
                        styles.modalScrollbarThumb,
                        {
                          height: editorScrollbarThumbHeight,
                          transform: [{ translateY: editorScrollbarTop }],
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </View>
              {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
              {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
            </View>
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
  modalOverlayKeyboardVisible: {
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    width: '100%',
    height: '88%',
    maxHeight: '92%',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  modalCardKeyboardVisible: {
    height: undefined,
    maxHeight: '100%',
    minHeight: 0,
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
  modalEditorBody: {
    flex: 1,
    minHeight: 0,
    gap: spacing.sm,
  },
  modalEditorBodyKeyboardVisible: {
    minHeight: 180,
  },
  modalEditorScrollFrame: {
    flex: 1,
    minHeight: 180,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: '#FAFAFF',
    overflow: 'hidden',
  },
  modalEditorScroll: {
    flex: 1,
  },
  modalEditorScrollContent: {
    paddingRight: spacing.sm,
  },
  modalScrollbarTrack: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.xs,
    bottom: spacing.sm,
    width: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(124, 58, 237, 0.10)',
  },
  modalScrollbarThumb: {
    width: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(124, 58, 237, 0.62)',
  },
  modalReadScrollFrame: {
    flex: 1,
    minHeight: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#EEE7FF',
    backgroundColor: '#FAFAFF',
    overflow: 'hidden',
  },
  modalReadScroll: {
    flex: 1,
  },
  modalReadScrollContent: {
    padding: spacing.md,
    paddingRight: spacing.lg,
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
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  modalInputKeyboardVisible: {
    minHeight: 180,
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
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 'auto',
    marginHorizontal: -spacing.lg,
    marginBottom: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
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
