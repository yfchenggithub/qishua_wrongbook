import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Clipboard from 'expo-clipboard';
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
  type TextInputSelectionChangeEventData,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TextHighlightColor, TextHighlightRange } from '@/src/models/TextHighlight';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';
import {
  applyTextHighlightSelection,
  clearTextHighlightSelection,
  normalizeTextHighlights,
  TEXT_HIGHLIGHT_BACKGROUND,
  type TextHighlightSelection,
} from '@/src/utils/textHighlights';

const DOUBLE_TAP_WINDOW_MS = 300;
const TEXT_SCROLLBAR_MIN_THUMB_HEIGHT = 36;
const TEXT_ACTIVE_SELECTION_BACKGROUND = 'rgba(124, 58, 237, 0.26)';
const TEXT_HIGHLIGHT_OPTIONS: {
  color: TextHighlightColor;
  label: string;
  iconColor: string;
}[] = [
  { color: 'red', label: '红色', iconColor: '#B91C1C' },
  { color: 'yellow', label: '黄色', iconColor: '#A16207' },
  { color: 'green', label: '绿色', iconColor: '#15803D' },
];

type TextNoteMode = 'view' | 'edit';

type HighlightedTextSegment = {
  text: string;
  color?: TextHighlightColor;
  isSelected: boolean;
};

type HighlightedTextProps = {
  value: string;
  emptyText: string;
  highlights?: TextHighlightRange[];
  selection?: TextHighlightSelection | null;
  selectable?: boolean;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  emptyTextStyle?: StyleProp<TextStyle>;
};

function normalizeDisplaySelection(
  selection: TextHighlightSelection | null | undefined,
  textLength: number,
): TextHighlightSelection | null {
  if (!selection || textLength <= 0) {
    return null;
  }

  const start = Math.max(0, Math.min(Math.min(selection.start, selection.end), textLength));
  const end = Math.max(0, Math.min(Math.max(selection.start, selection.end), textLength));
  return end > start ? { start, end } : null;
}

function buildHighlightedTextSegments(
  value: string,
  highlights: TextHighlightRange[],
  selection: TextHighlightSelection | null | undefined,
): HighlightedTextSegment[] {
  if (value.length <= 0) {
    return [];
  }

  const normalizedHighlights = normalizeTextHighlights(highlights, value);
  const normalizedSelection = normalizeDisplaySelection(selection, value.length);
  const boundaries = new Set<number>([0, value.length]);

  for (const highlight of normalizedHighlights) {
    boundaries.add(highlight.start);
    boundaries.add(highlight.end);
  }

  if (normalizedSelection) {
    boundaries.add(normalizedSelection.start);
    boundaries.add(normalizedSelection.end);
  }

  const sortedBoundaries = Array.from(boundaries).sort((left, right) => left - right);
  const segments: HighlightedTextSegment[] = [];

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index];
    const end = sortedBoundaries[index + 1];
    if (end <= start) {
      continue;
    }

    const color = normalizedHighlights.find(
      (highlight) => start >= highlight.start && start < highlight.end,
    )?.color;
    const isSelected = normalizedSelection
      ? start < normalizedSelection.end && normalizedSelection.start < end
      : false;

    segments.push({
      text: value.slice(start, end),
      color,
      isSelected,
    });
  }

  return segments;
}

function HighlightedText({
  value,
  emptyText,
  highlights,
  selection,
  selectable = false,
  numberOfLines,
  style,
  emptyTextStyle,
}: HighlightedTextProps) {
  const hasValue = value.trim().length > 0;
  const displayText = hasValue ? value : emptyText;
  const segments = hasValue ? buildHighlightedTextSegments(value, highlights ?? [], selection) : [];

  return (
    <Text
      ellipsizeMode="tail"
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[style, !hasValue && emptyTextStyle]}>
      {hasValue
        ? segments.map((segment, index) => (
          <Text
            key={`${index}-${segment.text.length}-${segment.color ?? 'plain'}-${segment.isSelected ? 'selected' : 'free'}`}
            style={[
              segment.color ? { backgroundColor: TEXT_HIGHLIGHT_BACKGROUND[segment.color] } : null,
              segment.isSelected ? { backgroundColor: TEXT_ACTIVE_SELECTION_BACKGROUND } : null,
            ]}>
            {segment.text}
          </Text>
        ))
        : displayText}
    </Text>
  );
}

export type TextNotePreviewProps = {
  value: string;
  emptyText: string;
  maxLength: number;
  accessibilityLabel: string;
  onOpen: () => void;
  highlights?: TextHighlightRange[];
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
  highlights,
  disabled = false,
  hintText = '双击查看和编辑',
  numberOfLines = 2,
  style,
  textStyle,
  emptyTextStyle,
  footerStyle,
}: TextNotePreviewProps) {
  const lastTapAtRef = useRef(0);
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
      <HighlightedText
        value={value}
        emptyText={emptyText}
        highlights={highlights}
        numberOfLines={numberOfLines}
        style={[
          styles.previewText,
          textStyle,
        ]}
        emptyTextStyle={[
          styles.previewEmptyText,
          emptyTextStyle,
        ]}
      />
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
  highlights?: TextHighlightRange[];
  onClose: () => void;
  onSave: (value: string, highlights: TextHighlightRange[]) => boolean | Promise<boolean>;
  onHighlightsChange?: (highlights: TextHighlightRange[]) => boolean | Promise<boolean>;
  onDraftChange?: (value: string) => void;
  subtitle?: string;
  helperText?: string;
  errorMessage?: string | null;
  busy?: boolean;
  allowEmpty?: boolean;
  saveLabel?: string;
  initialMode?: TextNoteMode;
};

export function TextNoteEditorModal({
  visible,
  title,
  value,
  maxLength,
  placeholder,
  highlights = [],
  onClose,
  onSave,
  onHighlightsChange,
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
  const [mode, setMode] = useState<TextNoteMode>('view');
  const [draft, setDraft] = useState(value);
  const [draftHighlights, setDraftHighlights] = useState<TextHighlightRange[]>(() =>
    normalizeTextHighlights(highlights, value),
  );
  const [highlightSelection, setHighlightSelection] = useState<TextHighlightSelection | null>(null);
  const [highlightMessage, setHighlightMessage] = useState<string | null>(null);
  const [isAwaitingSave, setIsAwaitingSave] = useState(false);
  const [isAwaitingHighlightSave, setIsAwaitingHighlightSave] = useState(false);
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
  const readInputRef = useRef<TextInput>(null);
  const effectiveBusy = busy || isAwaitingSave || isAwaitingHighlightSave;
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
  const normalizedValueHighlights = normalizeTextHighlights(draftHighlights, value);
  const selectedTextLength = highlightSelection
    ? Math.abs(highlightSelection.end - highlightSelection.start)
    : 0;
  const selectedText = highlightSelection
    ? value.slice(
      Math.min(highlightSelection.start, highlightSelection.end),
      Math.max(highlightSelection.start, highlightSelection.end),
    )
    : '';

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setDraft(value);
      setDraftHighlights(normalizeTextHighlights(highlights, value));
      setHighlightSelection(null);
      setHighlightMessage(null);
      setMode(initialMode);
      setIsAwaitingSave(false);
      setIsAwaitingHighlightSave(false);
      setEditorScrollOffsetY(0);
      setEditorContentHeight(0);
      setEditorViewportHeight(0);
      setEditorTextHeight(0);
      setReadScrollOffsetY(0);
      setReadContentHeight(0);
      setReadViewportHeight(0);
    }
    wasVisibleRef.current = visible;
  }, [highlights, initialMode, value, visible]);

  useEffect(() => {
    setHighlightSelection((current) => {
      if (!current) {
        return current;
      }

      const selectionEnd = Math.max(current.start, current.end);
      return selectionEnd <= value.length ? current : null;
    });
  }, [value.length]);

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
    readInputRef.current?.blur();
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
    readInputRef.current?.blur();
    setHighlightSelection(null);
    setHighlightMessage(null);
    setDraft(value);
    setDraftHighlights(normalizeTextHighlights(draftHighlights, value));
    setEditorScrollOffsetY(0);
    setMode('edit');
    onDraftChange?.(value);
  };

  const handleCancelEdit = () => {
    inputRef.current?.blur();
    keyboardVisibleRef.current = false;
    setIsKeyboardVisible(false);
    setDraft(value);
    setDraftHighlights(normalizeTextHighlights(highlights, value));
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
    const nextHighlights = normalizeTextHighlights(draftHighlights, draft);
    const saved = await onSave(draft, nextHighlights);
    setIsAwaitingSave(false);
    if (!saved) {
      return;
    }
    setDraftHighlights(nextHighlights);
    inputRef.current?.blur();
    keyboardVisibleRef.current = false;
    setIsKeyboardVisible(false);
    setMode('view');
    requestAnimationFrame(() => {
      Keyboard.dismiss();
    });
  };

  const handleReadSelectionChange = (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    const { start, end } = event.nativeEvent.selection;
    if (start === end) {
      return;
    }
    setHighlightSelection({ start, end });
    setHighlightMessage(null);
  };

  const persistHighlights = async (nextHighlights: TextHighlightRange[]): Promise<boolean> => {
    setIsAwaitingHighlightSave(true);
    const normalizedHighlights = normalizeTextHighlights(nextHighlights, value);
    const saved = onHighlightsChange
      ? await onHighlightsChange(normalizedHighlights)
      : true;
    setIsAwaitingHighlightSave(false);

    if (!saved) {
      setHighlightMessage('高亮保存失败，请重试。');
      return false;
    }

    setDraftHighlights(normalizedHighlights);
    setHighlightSelection(null);
    setHighlightMessage(null);
    return true;
  };

  const handleApplyHighlight = async (color: TextHighlightColor) => {
    if (!highlightSelection || selectedTextLength <= 0) {
      setHighlightMessage('请先选中一段文字。');
      return;
    }

    const nextHighlights = applyTextHighlightSelection(
      draftHighlights,
      value,
      highlightSelection,
      color,
    );
    await persistHighlights(nextHighlights);
  };

  const handleClearHighlight = async () => {
    if (!highlightSelection || selectedTextLength <= 0) {
      setHighlightMessage('请先选中一段文字。');
      return;
    }

    const nextHighlights = clearTextHighlightSelection(draftHighlights, value, highlightSelection);
    await persistHighlights(nextHighlights);
  };

  const handleCopySelection = async () => {
    if (!selectedText) {
      setHighlightMessage('请先选中一段文字。');
      return;
    }

    try {
      await Clipboard.setStringAsync(selectedText);
      setHighlightMessage('已复制');
    } catch {
      setHighlightMessage('复制失败，请重试。');
    }
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
                contentContainerStyle={[
                  styles.modalScrollContent,
                  styles.modalReadScrollContent,
                  selectedTextLength > 0 && styles.modalReadScrollContentWithSelectionToolbar,
                ]}
                decelerationRate="fast"
                keyboardShouldPersistTaps="always"
                onContentSizeChange={handleReadContentSizeChange}
                onLayout={handleReadLayout}
                onScroll={handleReadScroll}
                overScrollMode="always"
                persistentScrollbar
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}>
                <View style={styles.selectableReadTextWrap}>
                  <HighlightedText
                    value={value}
                    emptyText="暂无内容"
                    highlights={normalizedValueHighlights}
                    selection={highlightSelection}
                    style={styles.modalReadText}
                    emptyTextStyle={styles.modalReadEmptyText}
                  />
                  <TextInput
                    ref={readInputRef}
                    accessibilityLabel={`${title}内容，选中文字后可标记颜色`}
                    caretHidden
                    contextMenuHidden
                    editable={!effectiveBusy && value.trim().length > 0}
                    multiline
                    onChangeText={() => {}}
                    onSelectionChange={handleReadSelectionChange}
                    scrollEnabled={false}
                    selectionColor="rgba(124, 58, 237, 0.24)"
                    showSoftInputOnFocus={false}
                    style={[
                      styles.modalReadSelectionInput,
                      value.trim().length <= 0 && styles.modalReadSelectionInputDisabled,
                    ]}
                    textAlignVertical="top"
                    value={displayText}
                  />
                </View>
                {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
              </ScrollView>
              {selectedTextLength > 0 ? (
                <View style={styles.selectionToolbar}>
                  {TEXT_HIGHLIGHT_OPTIONS.map((option) => (
                    <Pressable
                      key={option.color}
                      accessibilityRole="button"
                      accessibilityLabel={`标记为${option.label}`}
                      disabled={effectiveBusy}
                      onPress={() => {
                        void handleApplyHighlight(option.color);
                      }}
                      style={({ pressed }) => [
                        styles.selectionToolbarButton,
                        pressed && !effectiveBusy && styles.buttonPressed,
                        effectiveBusy && styles.disabled,
                      ]}>
                      <View
                        style={[
                          styles.selectionToolbarSwatch,
                          { backgroundColor: TEXT_HIGHLIGHT_BACKGROUND[option.color] },
                        ]}
                      />
                      <Text style={[styles.selectionToolbarButtonText, { color: option.iconColor }]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="复制所选文字"
                    disabled={effectiveBusy}
                    onPress={() => {
                      void handleCopySelection();
                    }}
                    style={({ pressed }) => [
                      styles.selectionToolbarButton,
                      pressed && !effectiveBusy && styles.buttonPressed,
                      effectiveBusy && styles.disabled,
                    ]}>
                    <MaterialIcons name="content-copy" size={16} color={colors.textPrimary} />
                    <Text style={styles.selectionToolbarButtonText}>复制</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="清除所选文字格式"
                    disabled={effectiveBusy}
                    onPress={() => {
                      void handleClearHighlight();
                    }}
                    style={({ pressed }) => [
                      styles.selectionToolbarButton,
                      pressed && !effectiveBusy && styles.buttonPressed,
                      effectiveBusy && styles.disabled,
                    ]}>
                    <MaterialIcons name="format-color-reset" size={16} color={colors.textPrimary} />
                    <Text style={styles.selectionToolbarButtonText}>清除格式</Text>
                  </Pressable>
                  {isAwaitingHighlightSave ? (
                    <ActivityIndicator size="small" color="#7C3AED" />
                  ) : null}
                  {highlightMessage ? <Text style={styles.selectionToolbarMessage}>{highlightMessage}</Text> : null}
                </View>
              ) : null}
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
  modalReadScrollContentWithSelectionToolbar: {
    paddingBottom: 76,
  },
  selectableReadTextWrap: {
    minHeight: 120,
    position: 'relative',
  },
  modalReadText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 25,
  },
  modalReadEmptyText: {
    color: colors.textMuted,
  },
  modalReadSelectionInput: {
    ...StyleSheet.absoluteFillObject,
    ...typography.body,
    color: 'transparent',
    lineHeight: 25,
    padding: 0,
    backgroundColor: 'transparent',
  },
  modalReadSelectionInputDisabled: {
    opacity: 0,
  },
  selectionToolbar: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    shadowColor: colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  selectionToolbarButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  selectionToolbarSwatch: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  selectionToolbarButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  selectionToolbarMessage: {
    ...typography.caption,
    flexBasis: '100%',
    color: '#6D28D9',
    fontWeight: '700',
  },
  modalHighlightBody: {
    flex: 1,
    minHeight: 0,
    gap: spacing.sm,
  },
  modalHighlightInput: {
    ...typography.body,
    minHeight: 240,
    color: colors.textPrimary,
    lineHeight: 25,
    padding: 0,
  },
  highlightToolbar: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: '#FAFAFF',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  highlightToolbarHeader: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  highlightToolbarTitle: {
    ...typography.caption,
    color: '#6D28D9',
    fontWeight: '800',
  },
  highlightColorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  highlightColorButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  highlightColorButtonText: {
    ...typography.caption,
    fontWeight: '800',
  },
  highlightClearButton: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightMessage: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
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
  fullWidthButton: {
    flex: 1,
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
