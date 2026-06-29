import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  type GestureResponderEvent,
  Image,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BrandHeader,
  calculateImagePreviewHeight,
  CardContainer,
  FloatingBottomCta,
  ImagePreviewModal,
  type ImagePreviewModalImageActionItem,
  type ImagePreviewModalLongPressHelpers,
  PrimaryButton,
  ScreenContainer,
} from '@/src/components';
import {
  BOTTOM_RELEASE_DISTANCE,
  BOTTOM_TRIGGER_DISTANCE,
  EDGE_END_DRAG_VELOCITY_MIN,
  EDGE_PULL_TRIGGER_DISTANCE,
  TOP_PULL_RELEASE_DISTANCE,
  TOP_PULL_TRIGGER_DISTANCE,
} from '@/src/constants/edgePullNavigation';
import type { DetailImageSlot, DetailReviewRecordItem } from '@/src/models/MistakeDetailViewModel';
import type { LocalImage } from '@/src/models/LocalImage';
import type { ReviewResult } from '@/src/models/Mistake';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';
import * as ImageService from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import * as ReviewDraftImageEditService from '@/src/services/ReviewDraftImageEditService';
import type { ReviewSessionQueueItem } from '@/src/services/ReviewSessionService';
import * as ReviewSessionService from '@/src/services/ReviewSessionService';
import type { VoiceNoteEntity } from '@/src/services/VoiceNoteService';
import * as VoiceNoteService from '@/src/services/VoiceNoteService';
import { prewarmTodayReviewPrintEnhanceCache } from '@/src/services/export/PrintEnhancePrewarmService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'ReviewSessionPage';
const TOAST_DURATION_DEFAULT = 2000;
const TOAST_DURATION_LONG = 3200;
const TOAST_DURATION_SHORT = 1400;
const QUESTION_PREVIEW_MIN_HEIGHT = 112;
const QUESTION_PREVIEW_MAX_HEIGHT = 228;
const QUESTION_PREVIEW_EMPTY_HEIGHT = 148;
const QUESTION_PREVIEW_FALLBACK_HEIGHT = 148;
const VOICE_PLAYBACK_END_BUFFER_MS = 280;
const VOICE_RECORDING_MIN_DURATION_MS = 3000;
const VOICE_RECORDING_MAX_DURATION_MS = 30 * 60 * 1000;
const BUTTON_HINT_LIFT_DISTANCE = 4;
const INLINE_MODULE_FILTER_OPTION_LIMIT = 3;

type ToastType = 'success' | 'info' | 'error';
type SessionState = 'loading' | 'empty' | 'error' | 'ready';
type SessionResultKey = 'known' | 'fuzzy' | 'unknown';

interface SessionResultStats {
  known: number;
  fuzzy: number;
  unknown: number;
}

type ImageDimensions = {
  width: number;
  height: number;
};

type QuestionImageSizeState = ImageDimensions | null | 'unresolved';
type PreviewImageState = {
  uri: string;
  title: string;
};
type ReviewNavigationDirection = 'prev' | 'next';
type ScrollBoundary = 'top' | 'bottom';
type ModuleFilterValue = string | null;
type ReviewListStatusTone = 'pending' | 'completed' | ReviewResult;

interface ModuleFilterOption {
  key: string;
  value: ModuleFilterValue;
  label: string;
  count: number;
}

interface SubmittedReviewEntry {
  reviewRecordId: string;
  reviewIndex: number;
  result: ReviewResult;
  solutionImage: LocalImage | null;
  voiceNote: VoiceNoteEntity | null;
}

type SubmittedReviewEntriesByMistakeId = Record<string, SubmittedReviewEntry>;

const EMPTY_RESULT_STATS: SessionResultStats = {
  known: 0,
  fuzzy: 0,
  unknown: 0,
};

const REVIEW_ACTIONS: {
  label: string;
  value: ReviewResult;
  statsKey: SessionResultKey;
  tone: 'known' | 'fuzzy' | 'unknown';
}[] = [
  {
    label: '不会',
    value: 'wrong',
    statsKey: 'unknown',
    tone: 'unknown',
  },
  {
    label: '模糊',
    value: 'unsure',
    statsKey: 'fuzzy',
    tone: 'fuzzy',
  },
  {
    label: '会了',
    value: 'mastered',
    statsKey: 'known',
    tone: 'known',
  },
];

function getToastBackgroundColor(type: ToastType): string {
  if (type === 'success') {
    return 'rgba(24, 38, 30, 0.95)';
  }
  if (type === 'error') {
    return 'rgba(88, 28, 28, 0.95)';
  }
  return 'rgba(38, 44, 53, 0.95)';
}

function toShortErrorMessage(input?: string): string {
  const fallback = '读取失败，请稍后重试。';
  const normalized = typeof input === 'string' ? input.trim() : '';
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= 60) {
    return normalized;
  }
  return `${normalized.slice(0, 60)}...`;
}

function normalizeInitialMistakeId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function rotateQueueToInitialMistake(
  queue: ReviewSessionQueueItem[],
  initialMistakeId: string | null,
): ReviewSessionQueueItem[] {
  if (!initialMistakeId || queue.length <= 1) {
    return queue;
  }

  const initialIndex = queue.findIndex((item) => item.id === initialMistakeId);
  if (initialIndex <= 0) {
    return queue;
  }

  return [...queue.slice(initialIndex), ...queue.slice(0, initialIndex)];
}

function normalizeModuleFilterValue(moduleName: string | null | undefined): string {
  const normalized = typeof moduleName === 'string' ? moduleName.trim() : '';
  return normalized.length > 0 ? normalized : '未分类';
}

function isQueueItemInModuleFilter(
  item: ReviewSessionQueueItem,
  moduleFilter: ModuleFilterValue,
): boolean {
  if (moduleFilter === null) {
    return true;
  }
  return normalizeModuleFilterValue(item.module) === moduleFilter;
}

function isCancelLikeMessage(input?: string): boolean {
  const normalized = typeof input === 'string' ? input.trim().toLowerCase() : '';
  return normalized.includes('cancel') || normalized.includes('取消');
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
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

function createReviewSolutionEditId(mistakeId: string): string {
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `review-solution-edit-${mistakeId}-${Date.now()}-${randomPart}`;
}

function getReviewActionSymbol(tone: 'known' | 'fuzzy' | 'unknown'): string {
  if (tone === 'known') {
    return '\u2713';
  }
  if (tone === 'fuzzy') {
    return '?';
  }
  return '\u00D7';
}

function getStatsKeyForReviewResult(result: ReviewResult): SessionResultKey {
  if (result === 'mastered') {
    return 'known';
  }
  if (result === 'unsure') {
    return 'fuzzy';
  }
  return 'unknown';
}

function getReviewResultLabel(result: ReviewResult | null | undefined): string {
  if (result === 'wrong') {
    return '不会';
  }
  if (result === 'unsure') {
    return '模糊';
  }
  if (result === 'mastered') {
    return '会了';
  }
  return '已完成';
}

function getQuestionListStatus(input: {
  item: ReviewSessionQueueItem;
  submittedIds: ReadonlySet<string>;
  submittedEntries: SubmittedReviewEntriesByMistakeId;
}): {
  label: string;
  tone: ReviewListStatusTone;
  completed: boolean;
} {
  if (!input.submittedIds.has(input.item.id)) {
    return {
      label: '未完成',
      tone: 'pending',
      completed: false,
    };
  }

  const result = input.submittedEntries[input.item.id]?.result ?? null;
  return {
    label: getReviewResultLabel(result),
    tone: result ?? 'completed',
    completed: true,
  };
}

function TodayQuestionListSheet({
  visible,
  title,
  items,
  currentMistakeId,
  submittedIds,
  submittedEntries,
  onClose,
  onSelectItem,
}: {
  visible: boolean;
  title: string;
  items: ReviewSessionQueueItem[];
  currentMistakeId: string | null;
  submittedIds: ReadonlySet<string>;
  submittedEntries: SubmittedReviewEntriesByMistakeId;
  onClose: () => void;
  onSelectItem: (item: ReviewSessionQueueItem) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.questionListOverlay}>
        <Pressable style={styles.questionListBackdrop} onPress={onClose} />
        <View style={styles.questionListSheet}>
          <View style={styles.questionListHandle} />
          <View style={styles.questionListHeader}>
            <View style={styles.questionListHeaderTextWrap}>
              <Text style={styles.questionListTitle}>今日题单</Text>
              <Text style={styles.questionListSubtitle}>{`${title} · ${items.length} 道`}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭今日题单"
              onPress={onClose}
              style={({ pressed }) => [
                styles.questionListCloseButton,
                pressed ? styles.questionListCloseButtonPressed : null,
              ]}>
              <MaterialIcons name="close" size={22} color="#0F172A" />
            </Pressable>
          </View>

          <ScrollView style={styles.questionListScroll} contentContainerStyle={styles.questionListContent}>
            {items.map((item) => {
              const status = getQuestionListStatus({
                item,
                submittedIds,
                submittedEntries,
              });
              const selected = currentMistakeId === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}，第 ${item.nextReviewIndex} 刷，${status.label}`}
                  onPress={() => onSelectItem(item)}
                  style={({ pressed }) => [
                    styles.questionListRow,
                    selected ? styles.questionListRowSelected : null,
                    pressed ? styles.questionListRowPressed : null,
                  ]}>
                  <View
                    style={[
                      styles.questionListCurrentMarker,
                      selected ? styles.questionListCurrentMarkerActive : null,
                    ]}
                  />
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.1}
                    style={[
                      styles.questionListItemTitle,
                      selected ? styles.questionListItemTitleSelected : null,
                    ]}>
                    {item.title}
                  </Text>
                  {selected ? (
                    <View style={styles.questionListCurrentBadge}>
                      <Text numberOfLines={1} style={styles.questionListCurrentBadgeText}>当前</Text>
                    </View>
                  ) : null}
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.1}
                    style={[
                      styles.questionListReviewText,
                      selected ? styles.questionListReviewTextSelected : null,
                    ]}>
                    {`第 ${item.nextReviewIndex} 刷`}
                  </Text>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.1}
                    style={[
                      styles.questionListStatusText,
                      status.tone === 'wrong'
                        ? styles.questionListStatusWrong
                        : status.tone === 'unsure'
                          ? styles.questionListStatusUnsure
                          : status.tone === 'mastered'
                            ? styles.questionListStatusMastered
                            : status.tone === 'completed'
                              ? styles.questionListStatusCompleted
                              : null,
                    ]}>
                    {status.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ModuleFilterSheet({
  visible,
  options,
  selectedValue,
  onClose,
  onSelectOption,
}: {
  visible: boolean;
  options: ModuleFilterOption[];
  selectedValue: ModuleFilterValue;
  onClose: () => void;
  onSelectOption: (value: ModuleFilterValue) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.questionListOverlay}>
        <Pressable style={styles.questionListBackdrop} onPress={onClose} />
        <View style={styles.questionListSheet}>
          <View style={styles.questionListHandle} />
          <View style={styles.questionListHeader}>
            <View style={styles.questionListHeaderTextWrap}>
              <Text style={styles.questionListTitle}>选择模块</Text>
              <Text style={styles.questionListSubtitle}>{`共 ${options.length} 个筛选项`}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭模块选择"
              onPress={onClose}
              style={({ pressed }) => [
                styles.questionListCloseButton,
                pressed ? styles.questionListCloseButtonPressed : null,
              ]}>
              <MaterialIcons name="close" size={22} color="#0F172A" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.moduleFilterSheetScroll}
            contentContainerStyle={styles.moduleFilterSheetContent}>
            {options.map((option) => {
              const selected = selectedValue === option.value;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityLabel={`筛选${option.label}模块，共${option.count}道`}
                  onPress={() => onSelectOption(option.value)}
                  style={({ pressed }) => [
                    styles.moduleFilterSheetChip,
                    selected ? styles.moduleFilterSheetChipSelected : null,
                    pressed ? styles.moduleFilterChipPressed : null,
                  ]}>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.1}
                    style={[
                      styles.moduleFilterChipText,
                      selected ? styles.moduleFilterChipTextSelected : null,
                    ]}>
                    {`${option.label} ${option.count}`}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function formatDurationMs(durationMs: number): string {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(safeDurationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function roundRecordingElapsedMs(durationMs: number): number {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return Math.floor(safeDurationMs / 1000) * 1000;
}

function toReviewRecordVoiceNote(value: VoiceNoteEntity | null): ReviewRecordVoiceNote | null {
  if (!value) {
    return null;
  }

  return {
    id: value.id,
    fileUri: value.fileUri,
    fileName: value.fileName,
    durationMs: value.durationMs,
    sizeBytes: value.sizeBytes,
    createdAt: value.createdAt,
  };
}

function isReviewResult(value: unknown): value is ReviewResult {
  return value === 'mastered' || value === 'unsure' || value === 'wrong';
}

function getFileNameFromUri(uri: string, fallback: string): string {
  const withoutQuery = uri.split('?')[0] ?? '';
  const lastSlashIndex = withoutQuery.lastIndexOf('/');
  const fileName = lastSlashIndex >= 0 ? withoutQuery.slice(lastSlashIndex + 1) : withoutQuery;
  return fileName.trim().length > 0 ? fileName : fallback;
}

function getDirectoryFromUri(uri: string): string {
  const withoutQuery = uri.split('?')[0] ?? '';
  const lastSlashIndex = withoutQuery.lastIndexOf('/');
  return lastSlashIndex >= 0 ? withoutQuery.slice(0, lastSlashIndex) : '';
}

function toVoiceNoteEntity(value: ReviewRecordVoiceNote | null | undefined): VoiceNoteEntity | null {
  if (!value) {
    return null;
  }

  return {
    id: value.id,
    fileUri: value.fileUri,
    fileName: value.fileName,
    durationMs: value.durationMs,
    sizeBytes: value.sizeBytes,
    createdAt: value.createdAt,
    updatedAt: value.createdAt,
  };
}

function toLocalReviewSolutionImage(
  record: DetailReviewRecordItem,
  mistakeId: string,
): LocalImage | null {
  const primaryImage =
    record.solutionImages?.find((item) => item.exists !== false)
    ?? record.solutionImages?.[0]
    ?? null;
  const uri = typeof primaryImage?.uri === 'string'
    ? primaryImage.uri.trim()
    : typeof record.solutionImageUri === 'string'
      ? record.solutionImageUri.trim()
      : '';
  if (!uri) {
    return null;
  }

  return {
    id: primaryImage?.id ?? record.solutionImageId ?? `review-solution-${record.id}`,
    mistakeId,
    type: 'review_solution',
    uri,
    fileName: getFileNameFromUri(uri, `${record.id}.jpg`),
    directory: getDirectoryFromUri(uri),
    createdAt: record.createdAt,
    fileSize: primaryImage?.fileSize ?? null,
  };
}

function buildSubmittedReviewEntryFromRecord(
  record: DetailReviewRecordItem | null | undefined,
  mistakeId: string,
): SubmittedReviewEntry | null {
  if (!record || !isReviewResult(record.result)) {
    return null;
  }

  return {
    reviewRecordId: record.id,
    reviewIndex: record.reviewIndex,
    result: record.result,
    solutionImage: toLocalReviewSolutionImage(record, mistakeId),
    voiceNote: toVoiceNoteEntity(record.voiceNote ?? null),
  };
}

function pickSlotImageDimensions(slot?: DetailImageSlot): ImageDimensions | null {
  const candidates: [number | null | undefined, number | null | undefined][] = [
    [slot?.imageWidth, slot?.imageHeight],
    [slot?.width, slot?.height],
  ];

  for (const [widthValue, heightValue] of candidates) {
    if (isPositiveFinite(widthValue) && isPositiveFinite(heightValue)) {
      return {
        width: widthValue,
        height: heightValue,
      };
    }
  }

  return null;
}

function findPendingReviewIndex(
  queue: ReviewSessionQueueItem[],
  submittedIds: ReadonlySet<string>,
  startIndex: number,
  direction: ReviewNavigationDirection,
  moduleFilter: ModuleFilterValue = null,
): number | null {
  if (queue.length <= 0) {
    return null;
  }

  const step = direction === 'prev' ? -1 : 1;
  let index = startIndex;
  while (index >= 0 && index < queue.length) {
    const item = queue[index];
    if (item && !submittedIds.has(item.id) && isQueueItemInModuleFilter(item, moduleFilter)) {
      return index;
    }
    index += step;
  }

  return null;
}

function findNextPendingReviewIndexAfterSubmit(
  queue: ReviewSessionQueueItem[],
  submittedIds: ReadonlySet<string>,
  currentIndex: number,
  moduleFilter: ModuleFilterValue = null,
): number | null {
  const forwardIndex = findPendingReviewIndex(
    queue,
    submittedIds,
    currentIndex + 1,
    'next',
    moduleFilter,
  );
  if (forwardIndex !== null) {
    return forwardIndex;
  }

  return findPendingReviewIndex(queue, submittedIds, 0, 'next', moduleFilter);
}

function QuestionImageCard({
  slot,
  onPreview,
}: {
  slot?: DetailImageSlot;
  onPreview?: (uri: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [measuredDimensions, setMeasuredDimensions] = useState<QuestionImageSizeState>('unresolved');

  const normalizedUri = useMemo(() => {
    const rawUri = typeof slot?.uri === 'string' ? slot.uri.trim() : '';
    return rawUri.length > 0 ? rawUri : null;
  }, [slot?.uri]);

  const providedDimensions = useMemo(
    () => pickSlotImageDimensions(slot),
    [slot],
  );

  const activeDimensions = useMemo(() => {
    if (providedDimensions) {
      return providedDimensions;
    }
    if (measuredDimensions && measuredDimensions !== 'unresolved') {
      return measuredDimensions;
    }
    return null;
  }, [measuredDimensions, providedDimensions]);

  useEffect(() => {
    setImageFailed(false);
    setMeasuredDimensions('unresolved');
  }, [normalizedUri]);

  useEffect(() => {
    if (!normalizedUri || providedDimensions || measuredDimensions !== 'unresolved') {
      return;
    }

    let cancelled = false;
    Image.getSize(
      normalizedUri,
      (nextWidth, nextHeight) => {
        if (cancelled) {
          return;
        }
        if (!isPositiveFinite(nextWidth) || !isPositiveFinite(nextHeight)) {
          setMeasuredDimensions(null);
          return;
        }
        setMeasuredDimensions({ width: nextWidth, height: nextHeight });
      },
      () => {
        if (cancelled) {
          return;
        }
        setMeasuredDimensions(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [measuredDimensions, normalizedUri, providedDimensions]);

  const computedPreviewHeight = useMemo(
    () =>
      calculateImagePreviewHeight({
        containerWidth: previewWidth,
        imageWidth: activeDimensions?.width,
        imageHeight: activeDimensions?.height,
        minHeight: QUESTION_PREVIEW_MIN_HEIGHT,
        maxHeight: QUESTION_PREVIEW_MAX_HEIGHT,
        fallbackHeight: QUESTION_PREVIEW_FALLBACK_HEIGHT,
      }),
    [activeDimensions?.height, activeDimensions?.width, previewWidth],
  );

  const handleQuestionImageLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (!isPositiveFinite(nextWidth)) {
      return;
    }

    setPreviewWidth((current) => {
      if (Math.abs(current - nextWidth) < 0.5) {
        return current;
      }
      return nextWidth;
    });
  }, []);

  const hasUri = !!normalizedUri;
  const canShowImage = hasUri && slot?.exists === true && !imageFailed;
  const fileMissing = hasUri && slot?.exists === false;
  const loadFailed = hasUri && slot?.exists === true && imageFailed;

  return (
    <CardContainer style={styles.questionCard} padding={spacing.lg}>
      <View style={styles.sectionHeaderRow}>
        <View style={styles.sectionIconWrap}>
          <MaterialIcons name="image" size={20} color="#16A34A" />
        </View>
        <Text style={styles.questionTitle}>题目图片</Text>
      </View>
      <View
        onLayout={handleQuestionImageLayout}
        style={[
          styles.questionImageWrap,
          hasUri ? { height: computedPreviewHeight } : styles.questionImageWrapEmpty,
          !hasUri ? { height: QUESTION_PREVIEW_EMPTY_HEIGHT } : null,
        ]}>
        {canShowImage ? (
          <View style={styles.questionImageFrame}>
            {onPreview ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="题目图片，点击查看大图"
                onPress={() => {
                  onPreview(normalizedUri!);
                }}
                style={({ pressed }) => [styles.questionImagePressable, pressed && styles.questionImagePressablePressed]}>
                <Image
                  source={{ uri: normalizedUri! }}
                  style={styles.questionImage}
                  resizeMode="contain"
                  onError={() => setImageFailed(true)}
                />
              </Pressable>
            ) : (
              <Image
                source={{ uri: normalizedUri! }}
                style={styles.questionImage}
                resizeMode="contain"
                onError={() => setImageFailed(true)}
              />
            )}
            {onPreview ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="查看题目大图"
                onPress={() => {
                  onPreview(normalizedUri!);
                }}
                style={styles.questionPreviewButton}>
                <Text style={styles.questionPreviewButtonText}>查看大图</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {!hasUri ? <Text style={styles.questionPlaceholderText}>还没有上传题目图片</Text> : null}
        {fileMissing ? <Text style={styles.questionErrorText}>题目图片文件不存在</Text> : null}
        {loadFailed ? <Text style={styles.questionErrorText}>题目图片加载失败</Text> : null}
      </View>
    </CardContainer>
  );
}

function ReviewSolutionImageCard({
  image,
  isBusy = false,
  onTakePhoto,
  onPickImage,
  onEdit,
  onDelete,
  onPreview,
}: {
  image?: LocalImage | null;
  isBusy?: boolean;
  onTakePhoto: () => void;
  onPickImage: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreview: (uri: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [measuredDimensions, setMeasuredDimensions] = useState<QuestionImageSizeState>('unresolved');

  const normalizedUri = useMemo(() => {
    const rawUri = typeof image?.uri === 'string' ? image.uri.trim() : '';
    return rawUri.length > 0 ? rawUri : null;
  }, [image?.uri]);

  const providedDimensions = useMemo(() => {
    if (isPositiveFinite(image?.width) && isPositiveFinite(image?.height)) {
      return {
        width: image.width,
        height: image.height,
      };
    }
    return null;
  }, [image?.height, image?.width]);

  const activeDimensions = useMemo(() => {
    if (providedDimensions) {
      return providedDimensions;
    }
    if (measuredDimensions && measuredDimensions !== 'unresolved') {
      return measuredDimensions;
    }
    return null;
  }, [measuredDimensions, providedDimensions]);

  useEffect(() => {
    setImageFailed(false);
    setMeasuredDimensions('unresolved');
  }, [normalizedUri]);

  useEffect(() => {
    if (!normalizedUri || providedDimensions || measuredDimensions !== 'unresolved') {
      return;
    }

    let cancelled = false;
    Image.getSize(
      normalizedUri,
      (nextWidth, nextHeight) => {
        if (cancelled) {
          return;
        }
        if (!isPositiveFinite(nextWidth) || !isPositiveFinite(nextHeight)) {
          setMeasuredDimensions(null);
          return;
        }
        setMeasuredDimensions({ width: nextWidth, height: nextHeight });
      },
      () => {
        if (cancelled) {
          return;
        }
        setMeasuredDimensions(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [measuredDimensions, normalizedUri, providedDimensions]);

  const computedPreviewHeight = useMemo(
    () =>
      calculateImagePreviewHeight({
        containerWidth: previewWidth,
        imageWidth: activeDimensions?.width,
        imageHeight: activeDimensions?.height,
        minHeight: QUESTION_PREVIEW_MIN_HEIGHT,
        maxHeight: QUESTION_PREVIEW_MAX_HEIGHT,
        fallbackHeight: QUESTION_PREVIEW_FALLBACK_HEIGHT,
      }),
    [activeDimensions?.height, activeDimensions?.width, previewWidth],
  );

  const handleImageLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (!isPositiveFinite(nextWidth)) {
      return;
    }

    setPreviewWidth((current) => {
      if (Math.abs(current - nextWidth) < 0.5) {
        return current;
      }
      return nextWidth;
    });
  }, []);

  const hasImage = !!normalizedUri;
  const canShowImage = hasImage && !imageFailed;
  const canEdit = hasImage && !imageFailed && !isBusy;

  return (
    <CardContainer style={styles.solutionCard} padding={spacing.lg}>
      <View style={styles.sectionHeaderRow}>
        <View style={styles.solutionIconWrap}>
          <MaterialIcons name="edit-note" size={21} color="#2563EB" />
        </View>
        <View style={styles.solutionHeaderTextWrap}>
          <Text style={styles.solutionTitle}>我的做法（可选）</Text>
          <Text style={styles.solutionDescription}>需要时拍，方便复盘错误过程</Text>
        </View>
      </View>

      <View
        onLayout={handleImageLayout}
        style={[
          styles.solutionImageWrap,
          hasImage ? { height: computedPreviewHeight } : styles.solutionImageWrapEmpty,
          !hasImage ? { height: QUESTION_PREVIEW_EMPTY_HEIGHT } : null,
        ]}>
        {canShowImage ? (
          <View style={styles.questionImageFrame}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="我的做法图片，点击查看大图"
              onPress={() => {
                onPreview(normalizedUri!);
              }}
              style={({ pressed }) => [styles.questionImagePressable, pressed && styles.questionImagePressablePressed]}>
              <Image
                source={{ uri: normalizedUri! }}
                style={styles.questionImage}
                resizeMode="contain"
                onError={() => setImageFailed(true)}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="查看我的做法大图"
              onPress={() => {
                onPreview(normalizedUri!);
              }}
              style={styles.questionPreviewButton}>
              <Text style={styles.questionPreviewButtonText}>查看大图</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="删除我的做法图片"
              disabled={isBusy}
              onPress={onDelete}
              style={({ pressed }) => [
                styles.solutionDeleteButton,
                pressed && !isBusy && styles.solutionDeleteButtonPressed,
                isBusy && styles.disabledControl,
              ]}>
              <MaterialIcons name="close" size={18} color="#475569" />
            </Pressable>
          </View>
        ) : null}

        {!hasImage ? (
          <View style={styles.solutionPlaceholder}>
            <MaterialIcons name="photo-camera" size={28} color="#64748B" />
            <Text style={styles.solutionPlaceholderText}>尚未选择图片</Text>
          </View>
        ) : null}
        {hasImage && imageFailed ? (
          <Text style={styles.questionErrorText}>我的做法图片加载失败</Text>
        ) : null}
      </View>

      <View style={styles.solutionActionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="拍照添加我的做法"
          disabled={isBusy}
          onPress={onTakePhoto}
          style={({ pressed }) => [
            styles.solutionActionButton,
            styles.solutionActionButtonPrimary,
            pressed && !isBusy && styles.solutionActionButtonPressed,
            isBusy && styles.disabledControl,
          ]}>
          <Text numberOfLines={1} style={styles.solutionActionButtonPrimaryText}>{isBusy ? '处理中...' : '拍照'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="从相册选择我的做法"
          disabled={isBusy}
          onPress={onPickImage}
          style={({ pressed }) => [
            styles.solutionActionButton,
            pressed && !isBusy && styles.solutionActionButtonPressed,
            isBusy && styles.disabledControl,
          ]}>
          <Text numberOfLines={1} style={styles.solutionActionButtonText}>{isBusy ? '处理中...' : '从相册选择'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="编辑我的做法"
          disabled={!canEdit}
          onPress={onEdit}
          style={({ pressed }) => [
            styles.solutionActionButton,
            pressed && canEdit && styles.solutionActionButtonPressed,
            !canEdit && styles.disabledControl,
          ]}>
          <Text numberOfLines={1} style={styles.solutionActionButtonText}>编辑</Text>
        </Pressable>
      </View>

      {hasImage && typeof image?.fileSize === 'number' ? (
        <Text style={styles.solutionFileSizeText}>大小：{formatFileSize(image.fileSize)}</Text>
      ) : null}
    </CardContainer>
  );
}

export default function ReviewSessionPage() {
  const router = useRouter();
  const navigation = useNavigation();
  const { initialMistakeId } = useLocalSearchParams<{
    initialMistakeId?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const routeInitialMistakeId = useMemo(
    () => normalizeInitialMistakeId(initialMistakeId),
    [initialMistakeId],
  );

  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [queue, setQueue] = useState<ReviewSessionQueueItem[]>([]);
  const [selectedModuleFilter, setSelectedModuleFilter] = useState<ModuleFilterValue>(null);
  const [submittedMistakeIds, setSubmittedMistakeIds] = useState<Set<string>>(() => new Set());
  const [submittedReviewEntries, setSubmittedReviewEntries] = useState<SubmittedReviewEntriesByMistakeId>({});
  const [questionListVisible, setQuestionListVisible] = useState(false);
  const [moduleFilterSheetVisible, setModuleFilterSheetVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [resultStats, setResultStats] = useState<SessionResultStats>(EMPTY_RESULT_STATS);
  const [currentErrorMessage, setCurrentErrorMessage] = useState<string | null>(null);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentReloadNonce, setCurrentReloadNonce] = useState(0);
  const [currentQuestionSlot, setCurrentQuestionSlot] = useState<DetailImageSlot | undefined>(undefined);
  const [currentMeta, setCurrentMeta] = useState<{
    mistakeId: string;
    module: string;
    title: string;
    nextReviewIndex: number;
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<PreviewImageState | null>(null);
  const [activePreviewImageAction, setActivePreviewImageAction] = useState<'save' | 'share' | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);
  const [voiceNote, setVoiceNote] = useState<VoiceNoteEntity | null>(null);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [isVoiceRecordingPaused, setIsVoiceRecordingPaused] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [isVoicePlaying, setIsVoicePlaying] = useState(false);
  const [isVoiceBusy, setIsVoiceBusy] = useState(false);
  const [reviewSolutionImage, setReviewSolutionImage] = useState<LocalImage | null>(null);
  const [isReviewSolutionImageBusy, setIsReviewSolutionImageBusy] = useState(false);
  const [actionBarHeight, setActionBarHeight] = useState(0);

  const queueRequestIdRef = useRef(0);
  const currentRequestIdRef = useRef(0);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonsHintAnim = useRef(new Animated.Value(0)).current;
  const isScrollDraggingRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const maxScrollYRef = useRef(0);
  const lastTouchYRef = useRef<number | null>(null);
  const touchMoveCountRef = useRef(0);
  const topEdgePullDistanceRef = useRef(0);
  const bottomEdgePullDistanceRef = useRef(0);
  const scrollBoundaryLockRef = useRef<ScrollBoundary | null>(null);
  const requestNavigateReviewItemRef = useRef<((direction: ReviewNavigationDirection) => void) | null>(null);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const voiceRecordingAccumulatedMsRef = useRef(0);
  const voicePlaybackResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceReplacePendingUriRef = useRef<string | null>(null);
  const voiceStopInProgressRef = useRef(false);
  const allowNextLeaveRef = useRef(false);
  const pendingReviewSolutionEditIdRef = useRef<string | null>(null);
  const currentIndexRef = useRef(0);

  const totalCount = queue.length;
  const allTodayItemsSubmitted =
    sessionState === 'ready' && totalCount > 0 && submittedMistakeIds.size >= totalCount;
  const isCompleted =
    allTodayItemsSubmitted && currentIndex >= totalCount;
  const hasRemaining = sessionState === 'ready' && currentIndex < totalCount;
  const currentQueueItem = hasRemaining ? queue[currentIndex] ?? null : null;
  const currentQueueItemId = currentQueueItem?.id ?? null;
  const currentSubmittedReviewEntry = currentQueueItem
    ? submittedReviewEntries[currentQueueItem.id] ?? null
    : null;
  const hasUnsubmittedReviewDraft =
    !currentSubmittedReviewEntry && (!!reviewSolutionImage || !!voiceNote || isVoiceRecording);

  const moduleFilterOptions = useMemo<ModuleFilterOption[]>(() => {
    const moduleCounts = new Map<string, number>();
    for (const item of queue) {
      const moduleName = normalizeModuleFilterValue(item.module);
      moduleCounts.set(moduleName, (moduleCounts.get(moduleName) ?? 0) + 1);
    }

    const options: ModuleFilterOption[] = [
      {
        key: 'all',
        value: null,
        label: '全部',
        count: queue.length,
      },
    ];

    for (const [moduleName, count] of moduleCounts) {
      options.push({
        key: `module:${moduleName}`,
        value: moduleName,
        label: moduleName,
        count,
      });
    }

    return options;
  }, [queue]);

  const inlineModuleFilterOptions = useMemo<ModuleFilterOption[]>(() => {
    if (moduleFilterOptions.length <= INLINE_MODULE_FILTER_OPTION_LIMIT) {
      return moduleFilterOptions;
    }

    const selectedOption = moduleFilterOptions.find((option) => option.value === selectedModuleFilter) ?? null;
    const inlineOptions: ModuleFilterOption[] = [];
    const addOption = (option: ModuleFilterOption | null | undefined) => {
      if (!option || inlineOptions.some((item) => item.key === option.key)) {
        return;
      }
      if (inlineOptions.length < INLINE_MODULE_FILTER_OPTION_LIMIT) {
        inlineOptions.push(option);
      }
    };

    addOption(moduleFilterOptions[0]);
    addOption(selectedOption);
    for (const option of moduleFilterOptions.slice(1)) {
      addOption(option);
    }

    return inlineOptions;
  }, [moduleFilterOptions, selectedModuleFilter]);

  const shouldShowModuleFilterMore = moduleFilterOptions.length > inlineModuleFilterOptions.length;

  const currentFilterQueue = useMemo(
    () => queue.filter((item) => isQueueItemInModuleFilter(item, selectedModuleFilter)),
    [queue, selectedModuleFilter],
  );

  const currentFilterTotal = currentFilterQueue.length;
  const currentFilterSubmittedCount = useMemo(
    () => currentFilterQueue.filter((item) => submittedMistakeIds.has(item.id)).length,
    [currentFilterQueue, submittedMistakeIds],
  );
  const selectedModuleLabel = selectedModuleFilter ?? '全部';
  const moduleFilterHintText =
    selectedModuleFilter === null
      ? `已筛选：显示全部 ${currentFilterTotal} 道今日复做题`
      : `已筛选：仅显示“${selectedModuleFilter}”模块 ${currentFilterTotal} 道复做题`;
  const currentFilterItemIndex = currentQueueItem
    ? currentFilterQueue.findIndex((item) => item.id === currentQueueItem.id)
    : -1;
  const hasActiveReviewItem =
    !!currentQueueItem
    && isQueueItemInModuleFilter(currentQueueItem, selectedModuleFilter);
  const canShowCurrentReviewContent = hasActiveReviewItem;

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateY, {
        toValue: 8,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToastVisible(false);
    });
  }, [toastOpacity, toastTranslateY]);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration = TOAST_DURATION_DEFAULT) => {
      const normalizedMessage = message.trim();
      if (!normalizedMessage) {
        return;
      }

      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }

      setToastMessage(normalizedMessage);
      setToastType(type);
      setToastVisible(true);
      toastOpacity.setValue(0);
      toastTranslateY.setValue(8);

      Animated.parallel([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();

      toastTimerRef.current = setTimeout(() => {
        hideToast();
        toastTimerRef.current = null;
      }, duration);
    },
    [hideToast, toastOpacity, toastTranslateY],
  );

  const resetEdgePullNavigationState = useCallback(() => {
    scrollBoundaryLockRef.current = null;
    topEdgePullDistanceRef.current = 0;
    bottomEdgePullDistanceRef.current = 0;
  }, []);

  const handleTouchStart = useCallback((event: GestureResponderEvent) => {
    lastTouchYRef.current = event.nativeEvent.pageY;
  }, []);

  const handleTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      const currentTouchY = event.nativeEvent.pageY;
      const previousTouchY = lastTouchYRef.current;
      lastTouchYRef.current = currentTouchY;
      touchMoveCountRef.current += 1;

      if (previousTouchY === null) {
        return;
      }
      if (!isScrollDraggingRef.current) {
        return;
      }
      if (sessionState !== 'ready' || isCompleted || previewImage !== null) {
        return;
      }

      const touchDeltaY = currentTouchY - previousTouchY;
      const y = lastScrollYRef.current;
      const maxScrollY = maxScrollYRef.current;
      const atTop = y <= TOP_PULL_TRIGGER_DISTANCE;
      const atBottom = maxScrollY > 0 && y >= maxScrollY - BOTTOM_TRIGGER_DISTANCE;

      if (atTop && touchDeltaY > 0) {
        topEdgePullDistanceRef.current += touchDeltaY;
      } else {
        topEdgePullDistanceRef.current = 0;
      }

      if (atBottom && touchDeltaY < 0) {
        bottomEdgePullDistanceRef.current += -touchDeltaY;
      } else {
        bottomEdgePullDistanceRef.current = 0;
      }

      if (
        topEdgePullDistanceRef.current >= EDGE_PULL_TRIGGER_DISTANCE
        && scrollBoundaryLockRef.current !== 'top'
      ) {
        scrollBoundaryLockRef.current = 'top';
        topEdgePullDistanceRef.current = 0;
        bottomEdgePullDistanceRef.current = 0;
        requestNavigateReviewItemRef.current?.('prev');
        return;
      }

      if (
        bottomEdgePullDistanceRef.current >= EDGE_PULL_TRIGGER_DISTANCE
        && scrollBoundaryLockRef.current !== 'bottom'
      ) {
        scrollBoundaryLockRef.current = 'bottom';
        topEdgePullDistanceRef.current = 0;
        bottomEdgePullDistanceRef.current = 0;
        requestNavigateReviewItemRef.current?.('next');
      }
    },
    [isCompleted, previewImage, sessionState],
  );

  const handleTouchEnd = useCallback(() => {
    lastTouchYRef.current = null;
  }, []);

  const handleScrollBeginDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const y = contentOffset.y;
    const maxScrollY = Math.max(0, contentSize.height - layoutMeasurement.height);
    isScrollDraggingRef.current = true;
    lastScrollYRef.current = y;
    maxScrollYRef.current = maxScrollY;
    touchMoveCountRef.current = 0;
    topEdgePullDistanceRef.current = 0;
    bottomEdgePullDistanceRef.current = 0;
    scrollBoundaryLockRef.current = null;
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const y = contentOffset.y;
      const maxOffsetY = Math.max(0, contentSize.height - layoutMeasurement.height);
      lastScrollYRef.current = y;
      maxScrollYRef.current = maxOffsetY;

      if (scrollBoundaryLockRef.current === 'top' && y > TOP_PULL_RELEASE_DISTANCE) {
        scrollBoundaryLockRef.current = null;
      }
      if (
        scrollBoundaryLockRef.current === 'bottom'
        && y < maxOffsetY - BOTTOM_RELEASE_DISTANCE
      ) {
        scrollBoundaryLockRef.current = null;
      }
    },
    [],
  );

  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const y = contentOffset.y;
      const maxOffsetY = Math.max(0, contentSize.height - layoutMeasurement.height);
      const velocityY = Number(event.nativeEvent.velocity?.y ?? 0);
      const atTop = y <= TOP_PULL_TRIGGER_DISTANCE;
      const atBottom = maxOffsetY > 0 && y >= maxOffsetY - BOTTOM_TRIGGER_DISTANCE;
      isScrollDraggingRef.current = false;
      lastTouchYRef.current = null;

      if (sessionState !== 'ready' || isCompleted || previewImage !== null) {
        return;
      }

      if (
        atTop
        && velocityY >= EDGE_END_DRAG_VELOCITY_MIN
        && scrollBoundaryLockRef.current !== 'top'
      ) {
        scrollBoundaryLockRef.current = 'top';
        requestNavigateReviewItemRef.current?.('prev');
        return;
      }

      if (
        atBottom
        && velocityY <= -EDGE_END_DRAG_VELOCITY_MIN
        && scrollBoundaryLockRef.current !== 'bottom'
      ) {
        scrollBoundaryLockRef.current = 'bottom';
        requestNavigateReviewItemRef.current?.('next');
      }
    },
    [isCompleted, previewImage, sessionState],
  );

  const clearVoicePlaybackResetTimer = useCallback(() => {
    if (voicePlaybackResetTimerRef.current) {
      clearTimeout(voicePlaybackResetTimerRef.current);
      voicePlaybackResetTimerRef.current = null;
    }
  }, []);

  const stopVoicePlayback = useCallback(
    async (showErrorToast = false) => {
      clearVoicePlaybackResetTimer();
      setIsVoicePlaying(false);

      const stopResult = await VoiceNoteService.stopPlaying();
      if (!stopResult.ok && showErrorToast) {
        showToast(toShortErrorMessage(stopResult.errorMessage), 'error', TOAST_DURATION_LONG);
      }
    },
    [clearVoicePlaybackResetTimer, showToast],
  );

  const startVoiceRecording = useCallback(
    async (isRerecord: boolean) => {
      if (isVoiceBusy || isVoiceRecording || isSubmitting || isLoadingCurrent || !!currentErrorMessage) {
        return;
      }

      setIsVoiceBusy(true);

      const permissionResult = await VoiceNoteService.requestPermission();
      if (!permissionResult.granted) {
        const friendlyMessage = '未获得麦克风权限，无法开始录音。';
        Logger.warn(PAGE_SCOPE, 'start_recording', {
          granted: false,
          canAskAgain: permissionResult.canAskAgain,
          status: permissionResult.status,
          permissionErrorMessage: permissionResult.errorMessage ?? null,
        });
        showToast(toShortErrorMessage(friendlyMessage), 'error', TOAST_DURATION_LONG);
        setIsVoiceBusy(false);
        return;
      }

      const existingUri = isRerecord && !currentSubmittedReviewEntry ? voiceNote?.fileUri ?? null : null;
      voiceReplacePendingUriRef.current = existingUri;

      const startResult = await VoiceNoteService.startRecording();
      if (!startResult.ok) {
        voiceReplacePendingUriRef.current = null;
        Logger.warn(PAGE_SCOPE, 'start_recording', {
          granted: true,
          ok: false,
          errorMessage: startResult.errorMessage ?? null,
        });
        showToast(toShortErrorMessage(startResult.errorMessage), 'error', TOAST_DURATION_LONG);
        setIsVoiceBusy(false);
        return;
      }

      await stopVoicePlayback(false);
      setIsVoiceRecording(true);
      setIsVoiceRecordingPaused(false);
      setRecordingElapsedMs(0);
      voiceRecordingStartedAtRef.current = Date.now();
      voiceRecordingAccumulatedMsRef.current = 0;
      voiceStopInProgressRef.current = false;
      setIsVoiceBusy(false);
    },
    [
      currentErrorMessage,
      currentSubmittedReviewEntry,
      isLoadingCurrent,
      isSubmitting,
      isVoiceBusy,
      isVoiceRecording,
      stopVoicePlayback,
      showToast,
      voiceNote?.fileUri,
    ],
  );

  const pauseVoiceRecording = useCallback(async () => {
    if (!isVoiceRecording || isVoiceRecordingPaused || isVoiceBusy || voiceStopInProgressRef.current) {
      return;
    }

    setIsVoiceBusy(true);
    const pauseResult = await VoiceNoteService.pauseRecording();
    if (!pauseResult.ok) {
      showToast(toShortErrorMessage(pauseResult.errorMessage), 'error', TOAST_DURATION_LONG);
      setIsVoiceBusy(false);
      return;
    }

    const startedAt = voiceRecordingStartedAtRef.current;
    const elapsedMs =
      voiceRecordingAccumulatedMsRef.current + (startedAt ? Math.max(0, Date.now() - startedAt) : 0);
    voiceRecordingAccumulatedMsRef.current = elapsedMs;
    voiceRecordingStartedAtRef.current = null;
    setRecordingElapsedMs(roundRecordingElapsedMs(elapsedMs));
    setIsVoiceRecordingPaused(true);
    setIsVoiceBusy(false);
  }, [isVoiceBusy, isVoiceRecording, isVoiceRecordingPaused, showToast]);

  const resumeVoiceRecording = useCallback(async () => {
    if (!isVoiceRecording || !isVoiceRecordingPaused || isVoiceBusy || voiceStopInProgressRef.current) {
      return;
    }

    setIsVoiceBusy(true);
    const resumeResult = await VoiceNoteService.resumeRecording();
    if (!resumeResult.ok) {
      showToast(toShortErrorMessage(resumeResult.errorMessage), 'error', TOAST_DURATION_LONG);
      setIsVoiceBusy(false);
      return;
    }

    voiceRecordingStartedAtRef.current = Date.now();
    setIsVoiceRecordingPaused(false);
    setIsVoiceBusy(false);
  }, [isVoiceBusy, isVoiceRecording, isVoiceRecordingPaused, showToast]);

  const stopAndSaveVoiceRecording = useCallback(
    async (trigger: 'manual' | 'auto_limit' = 'manual') => {
      if (!isVoiceRecording || isVoiceBusy || voiceStopInProgressRef.current) {
        return;
      }

      voiceStopInProgressRef.current = true;
      setIsVoiceBusy(true);
      const saveResult = await VoiceNoteService.stopAndSaveRecording();
      const replaceUri = voiceReplacePendingUriRef.current;

      voiceReplacePendingUriRef.current = null;
      voiceRecordingStartedAtRef.current = null;
      voiceRecordingAccumulatedMsRef.current = 0;
      setIsVoiceRecording(false);
      setIsVoiceRecordingPaused(false);
      setRecordingElapsedMs(0);

      if (!saveResult.ok) {
        Logger.warn(PAGE_SCOPE, 'stop_recording_failed', {
          trigger,
          reason: 'stop_and_save_failed',
          errorMessage: saveResult.errorMessage ?? null,
        });
        showToast(toShortErrorMessage(saveResult.errorMessage), 'error', TOAST_DURATION_LONG);
        setIsVoiceBusy(false);
        voiceStopInProgressRef.current = false;
        return;
      }

      const nextVoiceNote = saveResult.voiceNote;
      if (nextVoiceNote.durationMs < VOICE_RECORDING_MIN_DURATION_MS) {
        Logger.info(PAGE_SCOPE, 'stop_recording_failed', {
          trigger,
          reason: 'too_short',
          durationMs: nextVoiceNote.durationMs,
          minimumDurationMs: VOICE_RECORDING_MIN_DURATION_MS,
        });
        void VoiceNoteService.deleteVoiceNote(nextVoiceNote.fileUri);
        showToast('录音时间太短，请至少录3秒', 'info', TOAST_DURATION_LONG);
        setIsVoiceBusy(false);
        voiceStopInProgressRef.current = false;
        return;
      }

      setVoiceNote(nextVoiceNote);

      if (replaceUri && replaceUri !== nextVoiceNote.fileUri) {
        void VoiceNoteService.deleteVoiceNote(replaceUri);
      }

      if (trigger === 'auto_limit') {
        showToast('已达到30分钟上限，录音已保存', 'success', TOAST_DURATION_LONG);
      } else {
        showToast('语音讲解已保存', 'success');
      }
      setIsVoiceBusy(false);
      voiceStopInProgressRef.current = false;
    },
    [isVoiceBusy, isVoiceRecording, showToast],
  );

  const playVoiceNote = useCallback(async () => {
    if (!voiceNote || isVoiceBusy || isVoiceRecording) {
      return;
    }

    if (isVoicePlaying) {
      await stopVoicePlayback(true);
      return;
    }

    setIsVoiceBusy(true);
    const playResult = await VoiceNoteService.playVoiceNote(voiceNote.fileUri);
    if (!playResult.ok) {
      showToast(toShortErrorMessage(playResult.errorMessage), 'error', TOAST_DURATION_LONG);
      setIsVoiceBusy(false);
      return;
    }

    clearVoicePlaybackResetTimer();
    setIsVoicePlaying(true);
    voicePlaybackResetTimerRef.current = setTimeout(() => {
      setIsVoicePlaying(false);
      voicePlaybackResetTimerRef.current = null;
    }, Math.max(voiceNote.durationMs + VOICE_PLAYBACK_END_BUFFER_MS, 1000));
    setIsVoiceBusy(false);
  }, [
    clearVoicePlaybackResetTimer,
    isVoiceBusy,
    isVoicePlaying,
    isVoiceRecording,
    showToast,
    stopVoicePlayback,
    voiceNote,
  ]);

  const confirmRerecordVoiceNote = useCallback(() => {
    if (!voiceNote || isVoiceBusy || isVoiceRecording) {
      return;
    }

    Alert.alert(
      '确认重录',
      '重录将替换当前讲解，确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认重录',
          style: 'destructive',
          onPress: () => {
            void startVoiceRecording(true);
          },
        },
      ],
    );
  }, [isVoiceBusy, isVoiceRecording, startVoiceRecording, voiceNote]);

  const deleteCurrentVoiceNote = useCallback(async () => {
    if (!voiceNote || isVoiceBusy || isVoiceRecording) {
      return;
    }

    setIsVoiceBusy(true);
    await stopVoicePlayback(false);
    if (currentSubmittedReviewEntry) {
      setVoiceNote(null);
      setIsVoicePlaying(false);
      showToast('\u8bed\u97f3\u8bb2\u89e3\u5df2\u79fb\u9664\uff0c\u91cd\u65b0\u9009\u62e9\u7ed3\u679c\u540e\u4fdd\u5b58', 'info');
      setIsVoiceBusy(false);
      return;
    }
    const deleteResult = await VoiceNoteService.deleteVoiceNote(voiceNote.fileUri);
    if (!deleteResult.ok) {
      showToast(toShortErrorMessage(deleteResult.errorMessage), 'info');
      setIsVoiceBusy(false);
      return;
    }

    setVoiceNote(null);
    setIsVoicePlaying(false);
    showToast('语音讲解已删除', 'info');
    setIsVoiceBusy(false);
  }, [currentSubmittedReviewEntry, isVoiceBusy, isVoiceRecording, showToast, stopVoicePlayback, voiceNote]);

  const confirmDeleteVoiceNote = useCallback(() => {
    if (!voiceNote || isVoiceBusy || isVoiceRecording) {
      return;
    }

    Alert.alert('确认删除', '删除后将无法恢复，确定删除吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void deleteCurrentVoiceNote();
        },
      },
    ]);
  }, [deleteCurrentVoiceNote, isVoiceBusy, isVoiceRecording, voiceNote]);

  const cleanupReviewSolutionImage = useCallback(async (image: LocalImage | null) => {
    const imageUri = typeof image?.uri === 'string' ? image.uri.trim() : '';
    if (!imageUri) {
      return;
    }
    await ImageService.deleteLocalImage(imageUri);
  }, []);

  const discardUnsubmittedReviewDraft = useCallback(async () => {
    const imageToDelete = reviewSolutionImage;
    const voiceNoteToDelete = voiceNote;
    const shouldDiscardRecording = isVoiceRecording;

    setReviewSolutionImage(null);
    setVoiceNote(null);
    setIsVoicePlaying(false);
    setIsVoiceRecording(false);
    setIsVoiceRecordingPaused(false);
    setRecordingElapsedMs(0);
    voiceRecordingStartedAtRef.current = null;
    voiceRecordingAccumulatedMsRef.current = 0;
    voiceReplacePendingUriRef.current = null;
    voiceStopInProgressRef.current = false;

    await stopVoicePlayback(false);

    if (shouldDiscardRecording) {
      const discardResult = await VoiceNoteService.stopAndDiscardRecording();
      if (!discardResult.ok) {
        Logger.warn(PAGE_SCOPE, 'Failed to discard unsubmitted review recording.', {
          errorMessage: discardResult.errorMessage ?? null,
        });
      }
    }

    if (voiceNoteToDelete?.fileUri) {
      const deleteVoiceResult = await VoiceNoteService.deleteVoiceNote(voiceNoteToDelete.fileUri);
      if (!deleteVoiceResult.ok) {
        Logger.warn(PAGE_SCOPE, 'Failed to delete unsubmitted review voice note.', {
          voiceNoteId: voiceNoteToDelete.id,
          errorMessage: deleteVoiceResult.errorMessage ?? null,
        });
      }
    }

    if (imageToDelete) {
      await cleanupReviewSolutionImage(imageToDelete);
    }
  }, [
    cleanupReviewSolutionImage,
    isVoiceRecording,
    reviewSolutionImage,
    stopVoicePlayback,
    voiceNote,
  ]);

  const saveReviewSolutionImage = useCallback(
    async (source: 'camera' | 'album') => {
      if (
        !currentQueueItem ||
        isReviewSolutionImageBusy ||
        isSubmitting ||
        isLoadingCurrent ||
        !!currentErrorMessage ||
        isVoiceRecording ||
        isVoiceBusy
      ) {
        return;
      }

      setIsReviewSolutionImageBusy(true);
      try {
        const saveResult =
          source === 'camera'
            ? await ImageService.takePhotoAndSave({
                mistakeId: currentQueueItem.id,
                type: 'review_solution',
              })
            : await ImageService.pickImageAndSave({
                mistakeId: currentQueueItem.id,
                type: 'review_solution',
              });

        if (!saveResult.ok || !saveResult.image) {
          if (isCancelLikeMessage(saveResult.errorMessage)) {
            return;
          }

          showToast(toShortErrorMessage(saveResult.errorMessage ?? '图片保存失败，请重试。'), 'error', TOAST_DURATION_LONG);
          return;
        }

        const previousImage = reviewSolutionImage;
        setReviewSolutionImage(saveResult.image);
        if (!currentSubmittedReviewEntry && previousImage && previousImage.uri !== saveResult.image.uri) {
          void cleanupReviewSolutionImage(previousImage);
        }
        showToast('我的做法已添加', 'success');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to save review solution image.', {
          mistakeId: currentQueueItem.id,
          source,
          error,
        });
        showToast('图片保存失败，请稍后重试。', 'error', TOAST_DURATION_LONG);
      } finally {
        setIsReviewSolutionImageBusy(false);
      }
    },
    [
      cleanupReviewSolutionImage,
      currentErrorMessage,
      currentQueueItem,
      currentSubmittedReviewEntry,
      isLoadingCurrent,
      isReviewSolutionImageBusy,
      isSubmitting,
      isVoiceBusy,
      isVoiceRecording,
      reviewSolutionImage,
      showToast,
    ],
  );

  const deleteReviewSolutionImage = useCallback(async () => {
    if (!reviewSolutionImage || isReviewSolutionImageBusy || isSubmitting) {
      return;
    }

    const imageToDelete = reviewSolutionImage;
    setIsReviewSolutionImageBusy(true);
    setReviewSolutionImage(null);
    if (!currentSubmittedReviewEntry) {
      await cleanupReviewSolutionImage(imageToDelete);
    }
    setIsReviewSolutionImageBusy(false);
    showToast('我的做法图片已删除', 'info');
  }, [
    cleanupReviewSolutionImage,
    currentSubmittedReviewEntry,
    isReviewSolutionImageBusy,
    isSubmitting,
    reviewSolutionImage,
    showToast,
  ]);

  const handleEditReviewSolutionImage = useCallback(() => {
    if (
      !currentQueueItem ||
      !reviewSolutionImage ||
      isReviewSolutionImageBusy ||
      isSubmitting ||
      isLoadingCurrent ||
      !!currentErrorMessage ||
      isVoiceRecording ||
      isVoiceBusy
    ) {
      return;
    }

    const normalizedUri = typeof reviewSolutionImage.uri === 'string' ? reviewSolutionImage.uri.trim() : '';
    if (!normalizedUri) {
      showToast('请先拍照添加图片', 'info');
      return;
    }

    const editId = createReviewSolutionEditId(currentQueueItem.id);
    pendingReviewSolutionEditIdRef.current = editId;
    Logger.info(PAGE_SCOPE, 'Open review solution draft image edit page.', {
      mistakeId: currentQueueItem.id,
      editId,
      sourceUriLength: normalizedUri.length,
    });

    router.push(
      {
        pathname: '/mistake/[id]/image-edit',
        params: {
          id: currentQueueItem.id,
          imageType: 'review_solution',
          imageSlot: 'solution',
          sourceUri: normalizedUri,
          oldImageUri: normalizedUri,
          draftEditId: editId,
        },
      } as never,
    );
  }, [
    currentErrorMessage,
    currentQueueItem,
    isLoadingCurrent,
    isReviewSolutionImageBusy,
    isSubmitting,
    isVoiceBusy,
    isVoiceRecording,
    reviewSolutionImage,
    router,
    showToast,
  ]);

  const navigateHome = useCallback(() => {
    router.replace('/(tabs)' as never);
  }, [router]);

  const handleOpenQuestionPreview = useCallback((uri: string) => {
    const normalizedUri = uri.trim();
    if (!normalizedUri) {
      return;
    }
    setPreviewImage({
      uri: normalizedUri,
      title: '题目图片',
    });
  }, []);

  const handleOpenReviewSolutionPreview = useCallback((uri: string) => {
    const normalizedUri = uri.trim();
    if (!normalizedUri) {
      return;
    }
    setPreviewImage({
      uri: normalizedUri,
      title: '我的做法',
    });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewImage(null);
  }, []);

  const showPreviewActionToast = useCallback(
    (
      previewToast: ImagePreviewModalLongPressHelpers['showToast'] | undefined,
      message: string,
      type: ToastType = 'info',
      duration = TOAST_DURATION_DEFAULT,
    ) => {
      if (previewToast) {
        previewToast(message);
        return;
      }

      showToast(message, type, duration);
    },
    [showToast],
  );

  const handleSavePreviewImage = useCallback(
    (
      item: ImagePreviewModalImageActionItem,
      previewToast?: ImagePreviewModalLongPressHelpers['showToast'],
    ) => {
      if (activePreviewImageAction !== null) {
        showPreviewActionToast(
          previewToast,
          '正在处理图片，请稍后...',
          'info',
          TOAST_DURATION_SHORT,
        );
        return;
      }

      setActivePreviewImageAction('save');
      void (async () => {
        try {
          const result = await ImageService.saveLocalImageToGallery(item.uri);
          if (result.success) {
            showPreviewActionToast(previewToast, '保存成功', 'success');
            return;
          }

          showPreviewActionToast(
            previewToast,
            result.message || '保存图片失败，请稍后重试。',
            'error',
            TOAST_DURATION_LONG,
          );
        } catch (error) {
          Logger.error(PAGE_SCOPE, 'Unexpected error while saving preview image.', {
            title: item.title,
            error,
          });
          showPreviewActionToast(
            previewToast,
            '保存图片失败，请稍后重试。',
            'error',
            TOAST_DURATION_LONG,
          );
        } finally {
          setActivePreviewImageAction(null);
        }
      })();
    },
    [activePreviewImageAction, showPreviewActionToast],
  );

  const handleSharePreviewImage = useCallback(
    (
      item: ImagePreviewModalImageActionItem,
      previewToast?: ImagePreviewModalLongPressHelpers['showToast'],
    ) => {
      if (activePreviewImageAction !== null) {
        showPreviewActionToast(
          previewToast,
          '正在处理图片，请稍后...',
          'info',
          TOAST_DURATION_SHORT,
        );
        return;
      }

      setActivePreviewImageAction('share');
      void (async () => {
        try {
          const result = await ImageService.shareLocalImage(item.uri);
          if (result.success || result.reason === 'cancelled') {
            return;
          }

          showPreviewActionToast(
            previewToast,
            result.message || '分享图片失败，请稍后重试。',
            'error',
            TOAST_DURATION_LONG,
          );
        } catch (error) {
          Logger.error(PAGE_SCOPE, 'Unexpected error while sharing preview image.', {
            title: item.title,
            error,
          });
          showPreviewActionToast(
            previewToast,
            '分享图片失败，请稍后重试。',
            'error',
            TOAST_DURATION_LONG,
          );
        } finally {
          setActivePreviewImageAction(null);
        }
      })();
    },
    [activePreviewImageAction, showPreviewActionToast],
  );

  const handlePreviewImageLongPress = useCallback(
    (
      item: ImagePreviewModalImageActionItem,
      helpers: ImagePreviewModalLongPressHelpers,
    ) => {
      if (activePreviewImageAction !== null) {
        showPreviewActionToast(
          helpers.showToast,
          '正在处理图片，请稍后...',
          'info',
          TOAST_DURATION_SHORT,
        );
        return;
      }

      const title = item.title.trim().length > 0 ? item.title : '图片';
      Alert.alert(`${title}操作`, '请选择要对这张图片执行的操作。', [
        {
          text: '分享图片',
          onPress: () => handleSharePreviewImage(item, helpers.showToast),
        },
        {
          text: '保存图片',
          onPress: () => handleSavePreviewImage(item, helpers.showToast),
        },
        {
          text: '取消',
          style: 'cancel',
        },
      ], { cancelable: true });
    },
    [
      activePreviewImageAction,
      handleSavePreviewImage,
      handleSharePreviewImage,
      showPreviewActionToast,
    ],
  );

  const runAfterDiscardingDraft = useCallback(
    (
      message: string,
      confirmText: string,
      action: () => void,
      onCancel?: () => void,
    ) => {
      if (!hasUnsubmittedReviewDraft) {
        action();
        return;
      }

      Alert.alert('未提交内容', message, [
        {
          text: '取消',
          style: 'cancel',
          onPress: onCancel,
        },
        {
          text: confirmText,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await discardUnsubmittedReviewDraft();
              action();
            })();
          },
        },
      ]);
    },
    [discardUnsubmittedReviewDraft, hasUnsubmittedReviewDraft],
  );

  const handleSelectModuleFilter = useCallback(
    (nextModuleFilter: ModuleFilterValue) => {
      if (selectedModuleFilter === nextModuleFilter) {
        return;
      }
      if (sessionState !== 'ready' || isCompleted || previewImage !== null) {
        return;
      }
      if (isSubmitting || isReviewSolutionImageBusy || isVoiceBusy || activePreviewImageAction !== null) {
        showToast('正在处理，请稍后...', 'info', TOAST_DURATION_SHORT);
        return;
      }

      const currentItem = queue[currentIndex] ?? null;
      const keepCurrentIndex =
        currentItem !== null
        && isQueueItemInModuleFilter(currentItem, nextModuleFilter);
      const targetIndex = keepCurrentIndex
        ? currentIndex
        : findPendingReviewIndex(queue, submittedMistakeIds, 0, 'next', nextModuleFilter);
      const fallbackIndex = queue.findIndex((item) => isQueueItemInModuleFilter(item, nextModuleFilter));
      const resolvedTargetIndex = targetIndex ?? (fallbackIndex >= 0 ? fallbackIndex : null);
      runAfterDiscardingDraft(
        '当前题已添加内容但还没有选择结果，切换模块后这些内容不会保存。是否继续？',
        '继续切换',
        () => {
          setSelectedModuleFilter(nextModuleFilter);
          setCurrentIndex(resolvedTargetIndex ?? totalCount);
          resetEdgePullNavigationState();
        },
        resetEdgePullNavigationState,
      );
    },
    [
      activePreviewImageAction,
      currentIndex,
      isCompleted,
      isReviewSolutionImageBusy,
      isSubmitting,
      isVoiceBusy,
      previewImage,
      queue,
      resetEdgePullNavigationState,
      runAfterDiscardingDraft,
      selectedModuleFilter,
      sessionState,
      showToast,
      submittedMistakeIds,
      totalCount,
    ],
  );

  const handleSelectQuestionListItem = useCallback(
    (item: ReviewSessionQueueItem) => {
      const targetIndex = queue.findIndex((queueItem) => queueItem.id === item.id);
      if (targetIndex < 0) {
        showToast('未找到这道题，请刷新后重试', 'info', TOAST_DURATION_SHORT);
        return;
      }

      if (sessionState !== 'ready' || previewImage !== null) {
        return;
      }
      if (isSubmitting || isReviewSolutionImageBusy || isVoiceBusy || activePreviewImageAction !== null) {
        showToast('正在处理，请稍后...', 'info', TOAST_DURATION_SHORT);
        return;
      }

      runAfterDiscardingDraft(
        '当前题已添加内容但还没有选择结果，切换题目后这些内容不会保存。是否继续？',
        '继续切换',
        () => {
          setCurrentIndex(targetIndex);
          setQuestionListVisible(false);
          resetEdgePullNavigationState();
        },
        resetEdgePullNavigationState,
      );
    },
    [
      activePreviewImageAction,
      isReviewSolutionImageBusy,
      isSubmitting,
      isVoiceBusy,
      previewImage,
      queue,
      resetEdgePullNavigationState,
      runAfterDiscardingDraft,
      sessionState,
      showToast,
    ],
  );

  const requestNavigateReviewItem = useCallback(
    (direction: ReviewNavigationDirection) => {
      if (sessionState !== 'ready' || isCompleted || previewImage !== null) {
        resetEdgePullNavigationState();
        return;
      }

      if (isSubmitting || isReviewSolutionImageBusy || isVoiceBusy || activePreviewImageAction !== null) {
        showToast('正在处理，请稍后...', 'info', TOAST_DURATION_SHORT);
        resetEdgePullNavigationState();
        return;
      }

      if (isLoadingCurrent) {
        showToast('题目加载中，请稍后...', 'info', TOAST_DURATION_SHORT);
        resetEdgePullNavigationState();
        return;
      }

      const baseIndex = currentIndexRef.current;
      const targetIndex = findPendingReviewIndex(
        queue,
        submittedMistakeIds,
        direction === 'prev' ? baseIndex - 1 : baseIndex + 1,
        direction,
        selectedModuleFilter,
      );
      if (targetIndex === null && direction === 'prev') {
        showToast(selectedModuleFilter ? '当前模块已经是第一题' : '已经是第一题', 'info', TOAST_DURATION_SHORT);
        resetEdgePullNavigationState();
        return;
      }
      if (targetIndex === null) {
        showToast(selectedModuleFilter ? '当前模块已经是最后一题' : '已经是最后一题', 'info', TOAST_DURATION_SHORT);
        resetEdgePullNavigationState();
        return;
      }

      runAfterDiscardingDraft(
        '当前题已添加内容但还没有选择结果，切题后这些内容不会保存。是否继续？',
        '继续切题',
        () => {
          currentIndexRef.current = targetIndex;
          setCurrentIndex(targetIndex);
          resetEdgePullNavigationState();
        },
        resetEdgePullNavigationState,
      );
    },
    [
      activePreviewImageAction,
      isCompleted,
      isLoadingCurrent,
      isReviewSolutionImageBusy,
      isSubmitting,
      isVoiceBusy,
      previewImage,
      queue,
      resetEdgePullNavigationState,
      runAfterDiscardingDraft,
      selectedModuleFilter,
      sessionState,
      showToast,
      submittedMistakeIds,
    ],
  );

  useEffect(() => {
    requestNavigateReviewItemRef.current = requestNavigateReviewItem;
    return () => {
      requestNavigateReviewItemRef.current = null;
    };
  }, [requestNavigateReviewItem]);

  const handleRequestExit = useCallback(() => {
    if (isSubmitting || isReviewSolutionImageBusy || isVoiceBusy || activePreviewImageAction !== null) {
      showToast('正在处理，请稍后...', 'info', TOAST_DURATION_SHORT);
      return;
    }

    runAfterDiscardingDraft(
      '当前题已添加内容但还没有选择结果，退出后这些内容不会保存。是否继续？',
      '继续退出',
      () => {
        allowNextLeaveRef.current = true;
        navigateHome();
      },
    );
  }, [
    activePreviewImageAction,
    isReviewSolutionImageBusy,
    isSubmitting,
    isVoiceBusy,
    navigateHome,
    runAfterDiscardingDraft,
    showToast,
  ]);

  useFocusEffect(
    useCallback(() => {
      const editId = pendingReviewSolutionEditIdRef.current;
      if (!editId) {
        return;
      }

      pendingReviewSolutionEditIdRef.current = null;
      const editResult = ReviewDraftImageEditService.consumeReviewDraftImageEditResult(editId);
      if (!editResult) {
        return;
      }

      if (!currentQueueItemId || editResult.mistakeId !== currentQueueItemId) {
        void cleanupReviewSolutionImage(editResult.image);
        showToast('编辑结果已过期，请重新添加图片', 'info');
        Logger.warn(PAGE_SCOPE, 'Discarded stale review solution draft image edit result.', {
          editId,
          expectedMistakeId: currentQueueItemId,
          actualMistakeId: editResult.mistakeId,
        });
        return;
      }

      setReviewSolutionImage((previousImage) => {
        if (!currentSubmittedReviewEntry && previousImage && previousImage.uri !== editResult.image.uri) {
          void cleanupReviewSolutionImage(previousImage);
        }
        return editResult.image;
      });
      showToast('我的做法已更新', 'success');
    }, [cleanupReviewSolutionImage, currentQueueItemId, currentSubmittedReviewEntry, showToast]),
  );

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleRequestExit();
        return true;
      });

      return () => {
        subscription.remove();
      };
    }, [handleRequestExit]),
  );

  useFocusEffect(
    useCallback(
      () => () => {
        void stopVoicePlayback(false);
      },
      [stopVoicePlayback],
    ),
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowNextLeaveRef.current) {
        allowNextLeaveRef.current = false;
        return;
      }

      if (!hasUnsubmittedReviewDraft) {
        return;
      }

      event.preventDefault();
      if (isSubmitting || isReviewSolutionImageBusy || isVoiceBusy || activePreviewImageAction !== null) {
        showToast('正在处理，请稍后...', 'info', TOAST_DURATION_SHORT);
        return;
      }

      runAfterDiscardingDraft(
        '当前题已添加内容但还没有选择结果，退出后这些内容不会保存。是否继续？',
        '继续退出',
        () => {
          allowNextLeaveRef.current = true;
          navigation.dispatch(event.data.action);
        },
      );
    });

    return unsubscribe;
  }, [
    activePreviewImageAction,
    hasUnsubmittedReviewDraft,
    isReviewSolutionImageBusy,
    isSubmitting,
    isVoiceBusy,
    navigation,
    runAfterDiscardingDraft,
    showToast,
  ]);

  const loadQueue = useCallback(async () => {
    const requestId = queueRequestIdRef.current + 1;
    queueRequestIdRef.current = requestId;
    setSessionState('loading');
    setSessionErrorMessage(null);
    setCurrentErrorMessage(null);
    setCurrentMeta(null);
    setCurrentQuestionSlot(undefined);
    setQueue([]);
    setSelectedModuleFilter(null);
    setSubmittedMistakeIds(new Set());
    setSubmittedReviewEntries({});
    setQuestionListVisible(false);
    setModuleFilterSheetVisible(false);
    setCurrentIndex(0);
    setResultStats(EMPTY_RESULT_STATS);
    setVoiceNote(null);
    setIsVoiceRecording(false);
    setIsVoiceRecordingPaused(false);
    setRecordingElapsedMs(0);
    setIsVoicePlaying(false);
    setReviewSolutionImage(null);
    setIsReviewSolutionImageBusy(false);
    voiceRecordingStartedAtRef.current = null;
    voiceRecordingAccumulatedMsRef.current = 0;
    voiceReplacePendingUriRef.current = null;
    voiceStopInProgressRef.current = false;
    clearVoicePlaybackResetTimer();
    void VoiceNoteService.stopAndDiscardRecording();

    try {
      const todayQueue = await ReviewSessionService.getTodayReviewSessionQueue();
      if (requestId !== queueRequestIdRef.current) {
        return;
      }

      if (todayQueue.length <= 0) {
        setSessionState('empty');
        return;
      }

      const orderedQueue = rotateQueueToInitialMistake(todayQueue, routeInitialMistakeId);
      if (routeInitialMistakeId && orderedQueue[0]?.id !== routeInitialMistakeId) {
        Logger.warn(PAGE_SCOPE, 'Initial mistake is not in today review queue.', {
          initialMistakeId: routeInitialMistakeId,
          queueCount: todayQueue.length,
        });
      }

      setQueue(orderedQueue);
      setCurrentIndex(0);
      setSessionState('ready');
      void prewarmTodayReviewPrintEnhanceCache({ reason: 'review_session_ready' });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to load today review queue.', { error });
      if (requestId !== queueRequestIdRef.current) {
        return;
      }
      setSessionErrorMessage('读取今日复做队列失败，请稍后重试。');
      setSessionState('error');
    }
  }, [clearVoicePlaybackResetTimer, routeInitialMistakeId]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      clearVoicePlaybackResetTimer();
      void VoiceNoteService.stopPlaying();
      void VoiceNoteService.stopAndDiscardRecording();
    },
    [clearVoicePlaybackResetTimer],
  );

  useEffect(() => {
    if (!isVoiceRecording || isVoiceRecordingPaused) {
      return;
    }

    const updateTimer = () => {
      const startedAt = voiceRecordingStartedAtRef.current;
      if (!startedAt) {
        return;
      }
      const elapsedMs = voiceRecordingAccumulatedMsRef.current + Math.max(0, Date.now() - startedAt);
      const roundedElapsedMs = roundRecordingElapsedMs(elapsedMs);
      setRecordingElapsedMs((current) => (current === roundedElapsedMs ? current : roundedElapsedMs));

      if (elapsedMs >= VOICE_RECORDING_MAX_DURATION_MS && !voiceStopInProgressRef.current) {
        void stopAndSaveVoiceRecording('auto_limit');
      }
    };

    updateTimer();
    const intervalId = setInterval(updateTimer, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isVoiceRecording, isVoiceRecordingPaused, stopAndSaveVoiceRecording]);

  useEffect(() => {
    if (!currentQueueItemId) {
      setVoiceNote(null);
      setIsVoiceRecording(false);
      setIsVoiceRecordingPaused(false);
      setRecordingElapsedMs(0);
      setIsVoicePlaying(false);
      setReviewSolutionImage(null);
      setIsReviewSolutionImageBusy(false);
      voiceRecordingStartedAtRef.current = null;
      voiceRecordingAccumulatedMsRef.current = 0;
      voiceReplacePendingUriRef.current = null;
      voiceStopInProgressRef.current = false;
      clearVoicePlaybackResetTimer();
      void VoiceNoteService.stopAndDiscardRecording();
      return;
    }

    setVoiceNote(null);
    setIsVoiceRecording(false);
    setIsVoiceRecordingPaused(false);
    setRecordingElapsedMs(0);
    setIsVoicePlaying(false);
    setReviewSolutionImage(null);
    setIsReviewSolutionImageBusy(false);
    voiceRecordingStartedAtRef.current = null;
    voiceRecordingAccumulatedMsRef.current = 0;
    voiceReplacePendingUriRef.current = null;
    voiceStopInProgressRef.current = false;
    clearVoicePlaybackResetTimer();
    void stopVoicePlayback(false);
    void VoiceNoteService.stopAndDiscardRecording();
  }, [clearVoicePlaybackResetTimer, currentQueueItemId, stopVoicePlayback]);

  useEffect(() => {
    if (!currentQueueItem || sessionState !== 'ready' || isCompleted) {
      setCurrentMeta(null);
      setCurrentQuestionSlot(undefined);
      setCurrentErrorMessage(null);
      setIsLoadingCurrent(false);
      return;
    }

    if (!isQueueItemInModuleFilter(currentQueueItem, selectedModuleFilter)) {
      const nextPendingIndex = findPendingReviewIndex(
        queue,
        submittedMistakeIds,
        0,
        'next',
        selectedModuleFilter,
      );
      const fallbackIndex = queue.findIndex((item) => isQueueItemInModuleFilter(item, selectedModuleFilter));
      setCurrentIndex(nextPendingIndex ?? (fallbackIndex >= 0 ? fallbackIndex : totalCount));
      return;
    }

    const requestId = currentRequestIdRef.current + 1;
    currentRequestIdRef.current = requestId;
    setIsLoadingCurrent(true);
    setCurrentErrorMessage(null);
    setCurrentMeta(null);
    setCurrentQuestionSlot(undefined);

    const loadCurrent = async () => {
      const submittedEntry = submittedReviewEntries[currentQueueItem.id] ?? null;
      const result = await ReviewSessionService.loadTodayReviewItem(currentQueueItem.id, {
        allowSubmitted: submittedEntry !== null,
      });
      if (requestId !== currentRequestIdRef.current) {
        return;
      }

      if (result.ok) {
        const questionSlot = result.data.detail.imageSlots.find((slot) => slot.type === 'question');
        const submittedRecord = submittedEntry
          ? result.data.detail.reviewRecords.find((record) => record.id === submittedEntry.reviewRecordId)
            ?? result.data.detail.reviewRecords.find((record) => record.reviewIndex === submittedEntry.reviewIndex)
            ?? null
          : null;
        const hydratedSubmittedEntry = buildSubmittedReviewEntryFromRecord(
          submittedRecord,
          result.data.detail.id,
        );
        const effectiveSubmittedEntry = hydratedSubmittedEntry ?? submittedEntry;
        setCurrentMeta({
          mistakeId: result.data.detail.id,
          module: result.data.detail.module,
          title: result.data.detail.title,
          nextReviewIndex: effectiveSubmittedEntry?.reviewIndex ?? result.data.session.nextReviewIndex,
        });
        if (effectiveSubmittedEntry) {
          setReviewSolutionImage(effectiveSubmittedEntry.solutionImage);
          setVoiceNote(effectiveSubmittedEntry.voiceNote);
        }
        if (hydratedSubmittedEntry) {
          setSubmittedReviewEntries((previous) => {
            const current = previous[currentQueueItem.id] ?? null;
            const unchanged =
              current?.reviewRecordId === hydratedSubmittedEntry.reviewRecordId
              && current.reviewIndex === hydratedSubmittedEntry.reviewIndex
              && current.result === hydratedSubmittedEntry.result
              && current.solutionImage?.uri === hydratedSubmittedEntry.solutionImage?.uri
              && current.voiceNote?.fileUri === hydratedSubmittedEntry.voiceNote?.fileUri;
            if (unchanged) {
              return previous;
            }
            return {
              ...previous,
              [currentQueueItem.id]: hydratedSubmittedEntry,
            };
          });
        }
        setCurrentQuestionSlot(questionSlot);
        setCurrentErrorMessage(null);
        setIsLoadingCurrent(false);
        return;
      }

      if (result.canSkip) {
        setIsLoadingCurrent(false);
        showToast(`${toShortErrorMessage(result.errorMessage)} 已自动跳过`, 'info');
        setCurrentIndex((prev) => prev + 1);
        return;
      }

      setCurrentErrorMessage(toShortErrorMessage(result.errorMessage));
      setIsLoadingCurrent(false);
    };

    void loadCurrent();
  }, [
    currentIndex,
    currentQueueItem,
    currentReloadNonce,
    isCompleted,
    queue,
    selectedModuleFilter,
    sessionState,
    showToast,
    submittedReviewEntries,
    submittedMistakeIds,
    totalCount,
  ]);

  const incrementStats = useCallback((statsKey: SessionResultKey) => {
    setResultStats((previous) => ({
      ...previous,
      [statsKey]: previous[statsKey] + 1,
    }));
  }, []);

  const adjustStatsForResultChange = useCallback((previousResult: ReviewResult, nextResult: ReviewResult) => {
    if (previousResult === nextResult) {
      return;
    }

    const previousKey = getStatsKeyForReviewResult(previousResult);
    const nextKey = getStatsKeyForReviewResult(nextResult);
    setResultStats((previous) => ({
      ...previous,
      [previousKey]: Math.max(0, previous[previousKey] - 1),
      [nextKey]: previous[nextKey] + 1,
    }));
  }, []);

  const handleSelectResult = useCallback(
    async (result: ReviewResult, statsKey: SessionResultKey) => {
      if (
        !currentQueueItem ||
        !currentMeta ||
        isLoadingCurrent ||
        isSubmitting ||
        isCompleted ||
        isVoiceBusy ||
        isReviewSolutionImageBusy
      ) {
        return;
      }

      if (isVoiceRecording) {
        showToast('请先停止并保存语音讲解，再提交本题结果。', 'info');
        return;
      }

      if (isVoicePlaying) {
        await stopVoicePlayback(false);
      }

      setIsSubmitting(true);
      try {
        const existingSubmittedEntry = submittedReviewEntries[currentQueueItem.id] ?? null;
        if (existingSubmittedEntry) {
          const updateResult = await ReviewSessionService.updateTodayReviewResult({
            mistakeId: currentQueueItem.id,
            reviewRecordId: existingSubmittedEntry.reviewRecordId,
            result,
            solutionImageUri: reviewSolutionImage?.uri ?? null,
            voiceNote: toReviewRecordVoiceNote(voiceNote),
          });

          if (!updateResult.ok) {
            showToast(toShortErrorMessage(updateResult.errorMessage), 'error', TOAST_DURATION_LONG);
            return;
          }

          if (
            existingSubmittedEntry.solutionImage
            && existingSubmittedEntry.solutionImage.uri !== reviewSolutionImage?.uri
          ) {
            void cleanupReviewSolutionImage(existingSubmittedEntry.solutionImage);
          }
          if (
            existingSubmittedEntry.voiceNote
            && existingSubmittedEntry.voiceNote.fileUri !== voiceNote?.fileUri
          ) {
            void VoiceNoteService.deleteVoiceNote(existingSubmittedEntry.voiceNote.fileUri);
          }

          setSubmittedReviewEntries((previous) => ({
            ...previous,
            [currentQueueItem.id]: {
              ...existingSubmittedEntry,
              result,
              solutionImage: reviewSolutionImage,
              voiceNote,
            },
          }));
          adjustStatsForResultChange(existingSubmittedEntry.result, result);
          showToast(
            updateResult.warningMessage
              ? toShortErrorMessage(updateResult.warningMessage)
              : '\u5df2\u66f4\u65b0\u672c\u6b21\u590d\u505a\u7ed3\u679c',
            updateResult.warningMessage ? 'info' : 'success',
            updateResult.warningMessage ? TOAST_DURATION_LONG : TOAST_DURATION_DEFAULT,
          );
          return;
        }

        const submitResult = await ReviewSessionService.submitTodayReviewResult({
          mistakeId: currentQueueItem.id,
          reviewIndex: currentMeta.nextReviewIndex,
          result,
          solutionImageUri: reviewSolutionImage?.uri ?? null,
          voiceNote: toReviewRecordVoiceNote(voiceNote),
        });

        if (!submitResult.ok) {
          showToast(toShortErrorMessage(submitResult.errorMessage ?? '保存失败，请重试。'), 'error', TOAST_DURATION_LONG);
          return;
        }

        if (!submitResult.reviewRecordId) {
          showToast('淇濆瓨澶辫触锛岃閲嶈瘯', 'error', TOAST_DURATION_LONG);
          return;
        }

        const nextSubmittedMistakeIds = new Set(submittedMistakeIds);
        nextSubmittedMistakeIds.add(currentQueueItem.id);
        const submittedEntry: SubmittedReviewEntry = {
          reviewRecordId: submitResult.reviewRecordId,
          reviewIndex: currentMeta.nextReviewIndex,
          result,
          solutionImage: reviewSolutionImage,
          voiceNote,
        };
        const nextSubmittedReviewEntries = {
          ...submittedReviewEntries,
          [currentQueueItem.id]: submittedEntry,
        };
        const isAllSubmitted = nextSubmittedMistakeIds.size >= totalCount;
        const nextPendingIndex = isAllSubmitted
          ? null
          : findNextPendingReviewIndexAfterSubmit(
              queue,
              nextSubmittedMistakeIds,
              currentIndex,
              selectedModuleFilter,
            );
        const isCurrentModuleSubmitted =
          selectedModuleFilter !== null
          && findPendingReviewIndex(
            queue,
            nextSubmittedMistakeIds,
            0,
            'next',
            selectedModuleFilter,
          ) === null;

        setSubmittedMistakeIds(nextSubmittedMistakeIds);
        setSubmittedReviewEntries(nextSubmittedReviewEntries);
        incrementStats(statsKey);
        if (submitResult.warningMessage) {
          showToast(toShortErrorMessage(submitResult.warningMessage), 'info', TOAST_DURATION_LONG);
        } else {
          showToast(
            isAllSubmitted
              ? '已记录，今日复做完成'
              : isCurrentModuleSubmitted
                ? `已记录，“${selectedModuleFilter}”模块已完成`
                : '已记录，进入下一题',
            'success',
          );
        }
        setCurrentIndex(nextPendingIndex ?? currentIndex);
        if (nextPendingIndex !== null) {
          setReviewSolutionImage(null);
          setVoiceNote(null);
        }
        setIsVoicePlaying(false);
        setIsVoiceRecording(false);
        setIsVoiceRecordingPaused(false);
        setRecordingElapsedMs(0);
        voiceRecordingStartedAtRef.current = null;
        voiceRecordingAccumulatedMsRef.current = 0;
        voiceReplacePendingUriRef.current = null;
        voiceStopInProgressRef.current = false;
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to submit session review result.', {
          mistakeId: currentQueueItem.id,
          reviewIndex: currentMeta.nextReviewIndex,
          error,
        });
        showToast('保存失败，请稍后重试', 'error', TOAST_DURATION_LONG);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      currentIndex,
      currentMeta,
      currentQueueItem,
      adjustStatsForResultChange,
      cleanupReviewSolutionImage,
      incrementStats,
      isCompleted,
      isLoadingCurrent,
      isReviewSolutionImageBusy,
      isSubmitting,
      isVoicePlaying,
      isVoiceBusy,
      isVoiceRecording,
      queue,
      reviewSolutionImage,
      selectedModuleFilter,
      showToast,
      stopVoicePlayback,
      submittedReviewEntries,
      submittedMistakeIds,
      totalCount,
      voiceNote,
    ],
  );

  const progressCurrent =
    currentFilterTotal <= 0
      ? 0
      : currentFilterItemIndex >= 0
        ? currentFilterItemIndex + 1
        : Math.min(currentFilterSubmittedCount + 1, currentFilterTotal);
  const progressTotal = currentFilterTotal;
  const reviewRound = currentMeta?.nextReviewIndex ?? currentQueueItem?.nextReviewIndex ?? 1;
  const showResultActions =
    sessionState === 'ready'
    && !isCompleted
    && hasActiveReviewItem
    && !isLoadingCurrent
    && !currentErrorMessage;
  const actionBarBottomOffset = Math.max(insets.bottom + spacing.xs, spacing.xs);
  const fallbackActionBarHeight = 112;
  const effectiveActionBarHeight = actionBarHeight > 0 ? actionBarHeight : fallbackActionBarHeight;
  const contentBottomPadding = showResultActions
    ? actionBarBottomOffset + effectiveActionBarHeight + spacing.lg
    : spacing.xl;
  const toastBottomOffset = showResultActions
    ? actionBarBottomOffset + effectiveActionBarHeight + spacing.sm
    : insets.bottom + spacing.lg;
  const voiceIconName = isVoiceRecordingPaused ? 'pause' : isVoiceRecording ? 'mic' : 'record-voice-over';
  const voiceTitleText = isVoiceRecordingPaused ? '录音已暂停' : isVoiceRecording ? '正在录音' : '语音讲解';
  const voiceRecordingHintText = isVoiceRecordingPaused
    ? '已暂停，想好后点继续，当前录音不会丢'
    : '说出关键条件、解题思路和容易错的地方';
  const voiceRecordingToggleText = isVoiceBusy ? '处理中...' : isVoiceRecordingPaused ? '继续' : '暂停';

  return (
    <View style={styles.pageRoot}>
      <View pointerEvents="none" style={styles.pageGlowTop} />
      <View pointerEvents="none" style={styles.pageGlowBottom} />
      <ScreenContainer
        scroll
        style={styles.screenSafeArea}
        contentStyle={[styles.screenContent, { paddingBottom: contentBottomPadding }]}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}>
        <Pressable style={styles.exitButton} onPress={handleRequestExit}>
          <Text style={styles.exitButtonText}>退出今日复做</Text>
        </Pressable>

        <BrandHeader
          title="今日复做"
          subtitle=""
          style={styles.brandHeader}
          titleStyle={styles.brandHeaderTitle}
          subtitleStyle={styles.brandHeaderSubtitleHidden}
        />

        {sessionState === 'loading' ? (
          <CardContainer style={styles.stateCard} padding={spacing.lg}>
            <ActivityIndicator size="small" color={colors.textPrimary} />
            <Text style={styles.stateText}>正在加载今日复做队列...</Text>
          </CardContainer>
        ) : null}

        {sessionState === 'error' ? (
          <CardContainer style={styles.stateCard} padding={spacing.lg}>
            <Text style={styles.stateTitle}>加载失败</Text>
            <Text style={styles.stateText}>{sessionErrorMessage ?? '读取今日复做队列失败。'}</Text>
            <View style={styles.stateActionRow}>
              <PrimaryButton title="重试" onPress={() => void loadQueue()} style={styles.stateActionButton} />
              <PrimaryButton
                title="返回首页"
                onPress={navigateHome}
                style={styles.stateActionButtonLight}
                textStyle={styles.stateActionButtonLightText}
              />
            </View>
          </CardContainer>
        ) : null}

        {sessionState === 'empty' ? (
          <CardContainer style={styles.stateCard} padding={spacing.lg}>
            <Text style={styles.stateTitle}>今天没有需要复做的错题</Text>
            <Text style={styles.stateText}>可以先去新增错题，系统会自动安排下一次复做。</Text>
            <PrimaryButton title="返回首页" onPress={navigateHome} />
          </CardContainer>
        ) : null}

        {isCompleted ? (
          <CardContainer style={styles.completeCard} padding={spacing.xl}>
            <Text style={styles.completeTitle}>今日复做完成</Text>
            <Text style={styles.completeSubtitle}>今天一共完成 {totalCount} 道题</Text>
            <View style={styles.completeStatsRow}>
              <View style={styles.completeStatCell}>
                <Text style={styles.completeStatLabel}>会了</Text>
                <Text style={styles.completeStatValue}>{resultStats.known}</Text>
              </View>
              <View style={styles.completeStatCell}>
                <Text style={styles.completeStatLabel}>模糊</Text>
                <Text style={styles.completeStatValue}>{resultStats.fuzzy}</Text>
              </View>
              <View style={styles.completeStatCell}>
                <Text style={styles.completeStatLabel}>不会</Text>
                <Text style={styles.completeStatValue}>{resultStats.unknown}</Text>
              </View>
            </View>
            <PrimaryButton title="返回首页" onPress={navigateHome} />
          </CardContainer>
        ) : null}

        {sessionState === 'ready' && !isCompleted ? (
          <>
            <CardContainer style={styles.moduleFilterCard} padding={spacing.md}>
              <View style={styles.moduleFilterHeaderRow}>
                <MaterialIcons name="filter-list" size={20} color="#334155" />
                <Text style={styles.moduleFilterTitle}>模块筛选</Text>
              </View>
              <View style={styles.moduleFilterOptions}>
                {inlineModuleFilterOptions.map((option) => {
                  const selected = selectedModuleFilter === option.value;
                  return (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityLabel={`筛选${option.label}模块，共${option.count}道`}
                      onPress={() => handleSelectModuleFilter(option.value)}
                      style={({ pressed }) => [
                        styles.moduleFilterChip,
                        selected ? styles.moduleFilterChipSelected : null,
                        pressed ? styles.moduleFilterChipPressed : null,
                      ]}>
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.1}
                        style={[
                          styles.moduleFilterChipText,
                          selected ? styles.moduleFilterChipTextSelected : null,
                        ]}>
                        {`${option.label} ${option.count}`}
                      </Text>
                    </Pressable>
                  );
                })}
                {shouldShowModuleFilterMore ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="查看更多模块"
                    onPress={() => setModuleFilterSheetVisible(true)}
                    style={({ pressed }) => [
                      styles.moduleFilterMoreButton,
                      pressed ? styles.moduleFilterChipPressed : null,
                    ]}>
                    <MaterialIcons name="more-horiz" size={18} color="#334155" />
                    <Text numberOfLines={1} style={styles.moduleFilterMoreText}>更多</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.moduleFilterHint}>{moduleFilterHintText}</Text>
            </CardContainer>


            {canShowCurrentReviewContent ? (
            <CardContainer style={styles.progressCard} padding={spacing.lg}>
              <View style={styles.progressMainRow}>
                <View style={styles.progressNumberRow}>
                  <Text style={styles.progressNumberCurrent}>{progressCurrent}</Text>
                  <Text style={styles.progressNumberSlash}> / </Text>
                  <Text style={styles.progressNumberTotal}>{progressTotal}</Text>
                </View>
                <View style={styles.progressActionRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="打开今日题单"
                    onPress={() => setQuestionListVisible(true)}
                    style={({ pressed }) => [
                      styles.questionListEntryButton,
                      pressed ? styles.questionListEntryButtonPressed : null,
                    ]}>
                    <MaterialIcons name="format-list-bulleted" size={16} color="#334155" />
                    <Text style={styles.questionListEntryText}>题单</Text>
                  </Pressable>
                  <View style={styles.reviewPill}>
                    <Text style={styles.reviewPillText}>{`第 ${reviewRound} 刷`}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.progressDivider} />
              <Text style={styles.progressTitle} numberOfLines={2}>
                {currentMeta?.title ?? currentQueueItem?.title ?? '正在准备题目...'}
              </Text>
              <Text style={styles.progressModule}>{currentMeta?.module ?? currentQueueItem?.module ?? ''}</Text>
            </CardContainer>
            ) : null}


            {canShowCurrentReviewContent && isLoadingCurrent ? (
              <CardContainer style={styles.stateCard} padding={spacing.lg}>
                <ActivityIndicator size="small" color={colors.textPrimary} />
                <Text style={styles.stateText}>正在加载当前题目...</Text>
              </CardContainer>
            ) : null}

            {canShowCurrentReviewContent && !isLoadingCurrent && currentErrorMessage ? (
              <CardContainer style={styles.stateCard} padding={spacing.lg}>
                <Text style={styles.stateTitle}>当前题加载失败</Text>
                <Text style={styles.stateText}>{currentErrorMessage}</Text>
                <View style={styles.stateActionRow}>
                  <PrimaryButton
                    title="重试本题"
                    onPress={() => {
                      setCurrentErrorMessage(null);
                      setCurrentReloadNonce((prev) => prev + 1);
                    }}
                    style={styles.stateActionButton}
                  />
                  <PrimaryButton
                    title="退出会话"
                    onPress={handleRequestExit}
                    style={styles.stateActionButtonLight}
                    textStyle={styles.stateActionButtonLightText}
                  />
                </View>
              </CardContainer>
            ) : null}

            {canShowCurrentReviewContent && !isLoadingCurrent && !currentErrorMessage && currentQueueItem ? (
              <QuestionImageCard slot={currentQuestionSlot} onPreview={handleOpenQuestionPreview} />
            ) : null}

            {canShowCurrentReviewContent && !isLoadingCurrent && !currentErrorMessage && currentQueueItem ? (
              <ReviewSolutionImageCard
                image={reviewSolutionImage}
                isBusy={isReviewSolutionImageBusy || isSubmitting || isVoiceRecording || isVoiceBusy}
                onTakePhoto={() => {
                  void saveReviewSolutionImage('camera');
                }}
                onPickImage={() => {
                  void saveReviewSolutionImage('album');
                }}
                onEdit={handleEditReviewSolutionImage}
                onDelete={() => {
                  void deleteReviewSolutionImage();
                }}
                onPreview={handleOpenReviewSolutionPreview}
              />
            ) : null}

            {canShowCurrentReviewContent && !isLoadingCurrent && !currentErrorMessage && currentQueueItem ? (
              <CardContainer style={styles.voiceCard} padding={spacing.lg}>
                <View style={styles.voiceHeaderRow}>
                  <View style={styles.voiceIconWrap}>
                    <MaterialIcons name={voiceIconName} size={19} color="#0F766E" />
                  </View>
                  <View style={styles.voiceHeaderTextWrap}>
                    <Text style={styles.voiceTitle}>{voiceTitleText}</Text>
                    {!isVoiceRecording && !voiceNote ? (
                      <Text style={styles.voiceDescription}>
                        {'讲一遍你的思路，下次更容易想起来'}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {isVoiceRecording ? (
                  <>
                    <Text style={styles.voiceTimerText}>{formatDurationMs(recordingElapsedMs)}</Text>
                    <Text style={styles.voiceHintText}>{voiceRecordingHintText}</Text>
                    <View style={styles.voiceActionRow}>
                      <Pressable
                        disabled={isVoiceBusy}
                        onPress={() => {
                          if (isVoiceRecordingPaused) {
                            void resumeVoiceRecording();
                            return;
                          }
                          void pauseVoiceRecording();
                        }}
                        style={({ pressed }) => [
                          styles.voiceActionButton,
                          styles.voiceActionButtonPlay,
                          (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                        ]}>
                        <Text style={styles.voiceActionButtonText}>{voiceRecordingToggleText}</Text>
                      </Pressable>
                      <Pressable
                        disabled={isVoiceBusy}
                        onPress={() => {
                          void stopAndSaveVoiceRecording();
                        }}
                        style={({ pressed }) => [
                          styles.voiceActionButton,
                          styles.voiceActionButtonDanger,
                          (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                        ]}>
                        <Text style={styles.voiceActionButtonDangerText}>
                          {isVoiceBusy ? '处理中...' : '停止并保存'}
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}

                {!isVoiceRecording && !voiceNote ? (
                  <Pressable
                    disabled={isVoiceBusy}
                    onPress={() => {
                      void startVoiceRecording(false);
                    }}
                    style={({ pressed }) => [
                      styles.voiceMainButton,
                      (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                    ]}>
                    <Text style={styles.voiceMainButtonText}>
                      {isVoiceBusy ? '准备中...' : '录制讲解'}
                    </Text>
                  </Pressable>
                ) : null}

                {!isVoiceRecording && voiceNote ? (
                  <>
                    <Text style={styles.voiceDurationText}>
                      {`时长 ${formatDurationMs(voiceNote.durationMs)}`}
                    </Text>
                    <View style={styles.voiceActionRow}>
                      <Pressable
                        disabled={isVoiceBusy}
                        onPress={() => {
                          void playVoiceNote();
                        }}
                        style={({ pressed }) => [
                          styles.voiceActionButton,
                          styles.voiceActionButtonPlay,
                          (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                        ]}>
                        <Text style={styles.voiceActionButtonText}>
                          {isVoicePlaying ? '停止播放' : '播放'}
                        </Text>
                      </Pressable>
                      <Pressable
                        disabled={isVoiceBusy}
                        onPress={confirmRerecordVoiceNote}
                        style={({ pressed }) => [
                          styles.voiceActionButton,
                          (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                        ]}>
                        <Text style={styles.voiceActionButtonText}>重录</Text>
                      </Pressable>
                      <Pressable
                        disabled={isVoiceBusy}
                        onPress={confirmDeleteVoiceNote}
                        style={({ pressed }) => [
                          styles.voiceActionButton,
                          styles.voiceActionButtonDanger,
                          (pressed || isVoiceBusy) && styles.voiceButtonPressed,
                        ]}>
                        <Text style={styles.voiceActionButtonDangerText}>删除</Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}
              </CardContainer>
            ) : null}

          </>
        ) : null}
      </ScreenContainer>

      <TodayQuestionListSheet
        visible={questionListVisible}
        title={selectedModuleLabel}
        items={currentFilterQueue}
        currentMistakeId={currentQueueItemId}
        submittedIds={submittedMistakeIds}
        submittedEntries={submittedReviewEntries}
        onClose={() => setQuestionListVisible(false)}
        onSelectItem={handleSelectQuestionListItem}
      />

      <ModuleFilterSheet
        visible={moduleFilterSheetVisible}
        options={moduleFilterOptions}
        selectedValue={selectedModuleFilter}
        onClose={() => setModuleFilterSheetVisible(false)}
        onSelectOption={(value) => {
          setModuleFilterSheetVisible(false);
          handleSelectModuleFilter(value);
        }}
      />

      <ImagePreviewModal
        visible={previewImage !== null}
        uri={previewImage?.uri ?? null}
        title={previewImage?.title ?? ''}
        interactionMode="zoomable"
        logSource="review_session"
        onClose={handleClosePreview}
        onImageLongPress={handlePreviewImageLongPress}
      />

      {showResultActions ? (
        <FloatingBottomCta
          bottom={actionBarBottomOffset}
          hintText="顶部下拉上一题 · 底部上拉下一题 · 选择结果保存"
          onHeightChange={(nextHeight) => {
            setActionBarHeight((prev) => (prev === nextHeight ? prev : nextHeight));
          }}>
          <Animated.View
            style={[
              styles.actionRowAnimated,
              {
                transform: [
                  {
                    translateY: buttonsHintAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -BUTTON_HINT_LIFT_DISTANCE],
                    }),
                  },
                ],
              },
            ]}>
            <View style={styles.actionRow}>
              {REVIEW_ACTIONS.map((action) => (
                <Pressable
                  key={action.value}
                  onPress={() => void handleSelectResult(action.value, action.statsKey)}
                  disabled={isSubmitting || isReviewSolutionImageBusy}
                  style={[
                    styles.resultButton,
                    action.tone === 'known'
                      ? styles.resultButtonKnown
                      : action.tone === 'fuzzy'
                        ? styles.resultButtonFuzzy
                        : styles.resultButtonUnknown,
                    (isSubmitting || isReviewSolutionImageBusy) ? styles.disabledControl : null,
                  ]}>
                  <View style={styles.resultButtonContent}>
                    {isSubmitting || isReviewSolutionImageBusy ? null : (
                      <Text style={styles.resultButtonIcon}>{getReviewActionSymbol(action.tone)}</Text>
                    )}
                    <Text numberOfLines={1} style={styles.resultButtonText}>
                      {isSubmitting ? '记录中...' : isReviewSolutionImageBusy ? '图片中...' : action.label}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        </FloatingBottomCta>
      ) : null}

      {toastVisible ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastContainer,
            {
              bottom: toastBottomOffset,
              opacity: toastOpacity,
              transform: [{ translateY: toastTranslateY }],
            },
          ]}>
          <View style={[styles.toastBubble, { backgroundColor: getToastBackgroundColor(toastType) }]}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  pageGlowTop: {
    position: 'absolute',
    top: -140,
    right: -96,
    width: 320,
    height: 320,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(34, 197, 94, 0.09)',
  },
  pageGlowBottom: {
    position: 'absolute',
    bottom: 20,
    left: -120,
    width: 260,
    height: 260,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(14, 165, 233, 0.07)',
  },
  screenSafeArea: {
    backgroundColor: 'transparent',
  },
  screenContent: {
    paddingTop: spacing.md,
    gap: spacing.md,
    backgroundColor: 'transparent',
  },
  brandHeader: {
    gap: spacing.xs,
  },
  brandHeaderTitle: {
    ...typography.titleLarge,
    fontSize: 30,
    lineHeight: 36,
    color: '#0F172A',
    fontWeight: '800',
  },
  brandHeaderSubtitleHidden: {
    display: 'none',
  },
  exitButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    marginLeft: -spacing.xs,
  },
  exitButtonText: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: '#334155',
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCFCE7',
  },
  moduleFilterCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  moduleFilterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  moduleFilterTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
    color: '#1F2937',
    fontWeight: '800',
  },
  moduleFilterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  moduleFilterChip: {
    minWidth: 92,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  moduleFilterChipSelected: {
    borderColor: '#BBF7D0',
    backgroundColor: '#DCFCE7',
  },
  moduleFilterChipPressed: {
    opacity: 0.78,
  },
  moduleFilterChipText: {
    ...typography.bodySmall,
    color: '#64748B',
    fontWeight: '700',
    textAlign: 'center',
  },
  moduleFilterChipTextSelected: {
    color: colors.success,
    fontWeight: '800',
  },
  moduleFilterMoreButton: {
    height: 38,
    minWidth: 86,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.md,
  },
  moduleFilterMoreText: {
    ...typography.bodySmall,
    color: '#334155',
    fontWeight: '800',
  },
  moduleFilterSheetScroll: {
    maxHeight: 420,
  },
  moduleFilterSheetContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  moduleFilterSheetChip: {
    minWidth: 96,
    maxWidth: '48%',
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  moduleFilterSheetChipSelected: {
    borderColor: '#22C55E',
    backgroundColor: '#DCFCE7',
  },
  moduleFilterHint: {
    ...typography.caption,
    color: '#64748B',
    fontWeight: '600',
  },
  progressCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  progressMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  progressActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: 'auto',
  },
  questionListEntryButton: {
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  questionListEntryButtonPressed: {
    opacity: 0.78,
  },
  questionListEntryText: {
    ...typography.bodySmall,
    color: '#334155',
    fontWeight: '800',
  },
  progressNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  progressNumberCurrent: {
    ...typography.titleLarge,
    fontSize: 48,
    lineHeight: 54,
    color: '#059669',
    fontWeight: '800',
  },
  progressNumberSlash: {
    ...typography.titleMedium,
    marginHorizontal: spacing.xs,
    fontSize: 28,
    lineHeight: 34,
    color: '#059669',
    fontWeight: '700',
  },
  progressNumberTotal: {
    ...typography.titleLarge,
    fontSize: 40,
    lineHeight: 46,
    color: '#059669',
    fontWeight: '800',
  },
  reviewPill: {
    alignSelf: 'center',
    borderRadius: radius.pill,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  reviewPillText: {
    ...typography.bodySmall,
    color: '#166534',
    fontWeight: '700',
  },
  progressDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  progressTitle: {
    ...typography.sectionTitle,
    marginTop: 2,
    fontSize: 30,
    lineHeight: 36,
    color: colors.success,
    fontWeight: '800',
  },
  progressModule: {
    ...typography.body,
    color: colors.success,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  questionCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  questionTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
    color: '#1F2937',
  },
  questionImageWrap: {
    width: '100%',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#EEF2F7',
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  questionImageWrapEmpty: {
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
  },
  questionImageFrame: {
    width: '100%',
    height: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#F8FAFC',
  },
  questionImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  questionImagePressable: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionImagePressablePressed: {
    opacity: 0.92,
  },
  questionPreviewButton: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: 'rgba(248, 250, 252, 0.92)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  questionPreviewButtonText: {
    ...typography.caption,
    color: '#475569',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  questionPreviewHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
  },
  questionPlaceholderText: {
    ...typography.body,
    color: '#94A3B8',
    textAlign: 'center',
    fontWeight: '600',
  },
  questionErrorText: {
    ...typography.body,
    color: '#DC2626',
    textAlign: 'center',
    fontWeight: '600',
  },
  solutionCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  solutionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DBEAFE',
  },
  solutionHeaderTextWrap: {
    flex: 1,
    gap: 2,
  },
  solutionTitle: {
    ...typography.sectionTitle,
    fontSize: 21,
    lineHeight: 28,
    color: '#0F172A',
    fontWeight: '800',
  },
  solutionDescription: {
    ...typography.bodySmall,
    color: '#64748B',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
  solutionImageWrap: {
    width: '100%',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#EEF2F7',
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  solutionImageWrapEmpty: {
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  solutionPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  solutionPlaceholderText: {
    ...typography.bodySmall,
    color: '#64748B',
    fontWeight: '700',
  },
  solutionActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  solutionActionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  solutionActionButtonPrimary: {
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
  },
  solutionActionButtonPressed: {
    opacity: 0.78,
  },
  solutionActionButtonText: {
    ...typography.bodySmall,
    color: '#1F2937',
    fontWeight: '800',
    textAlign: 'center',
    flexShrink: 1,
  },
  solutionActionButtonPrimaryText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '800',
    textAlign: 'center',
    flexShrink: 1,
  },
  solutionDeleteButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: 'rgba(248, 250, 252, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  solutionDeleteButtonPressed: {
    opacity: 0.82,
  },
  solutionFileSizeText: {
    ...typography.caption,
    color: '#64748B',
    fontWeight: '700',
  },
  voiceCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  voiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  voiceIconWrap: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#CCFBF1',
  },
  voiceHeaderTextWrap: {
    flex: 1,
    gap: 2,
  },
  voiceTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 27,
    color: '#0F172A',
    fontWeight: '700',
  },
  voiceDescription: {
    ...typography.bodySmall,
    fontSize: 14,
    lineHeight: 19,
    color: '#64748B',
    fontWeight: '500',
  },
  voiceTimerText: {
    ...typography.titleMedium,
    fontSize: 28,
    lineHeight: 34,
    color: '#0F172A',
    fontWeight: '800',
  },
  voiceHintText: {
    ...typography.bodySmall,
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  voiceMainButton: {
    minHeight: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  voiceMainButtonDanger: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  voiceMainButtonText: {
    ...typography.bodySmall,
    color: '#1F2937',
    fontWeight: '700',
  },
  voiceDurationText: {
    ...typography.bodySmall,
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  voiceActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  voiceActionButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  voiceActionButtonPlay: {
    borderColor: '#99F6E4',
    backgroundColor: '#F0FDFA',
  },
  voiceActionButtonDanger: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  voiceActionButtonText: {
    ...typography.bodySmall,
    color: '#334155',
    fontWeight: '700',
  },
  voiceActionButtonDangerText: {
    ...typography.bodySmall,
    color: '#B91C1C',
    fontWeight: '700',
  },
  voiceButtonPressed: {
    opacity: 0.78,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionRowAnimated: {
    width: '100%',
  },
  resultButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  resultButtonKnown: {
    backgroundColor: '#22C55E',
    borderColor: '#16A34A',
  },
  resultButtonFuzzy: {
    backgroundColor: '#F59E0B',
    borderColor: '#D97706',
  },
  resultButtonUnknown: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  resultButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  resultButtonIcon: {
    ...typography.sectionTitle,
    fontSize: 16,
    lineHeight: 20,
    color: colors.white,
    fontWeight: '800',
  },
  resultButtonText: {
    ...typography.sectionTitle,
    fontSize: 17,
    lineHeight: 22,
    color: colors.white,
    fontWeight: '800',
    flexShrink: 1,
  },
  completeCard: {
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  completeTitle: {
    ...typography.titleMedium,
    fontSize: 34,
    lineHeight: 42,
  },
  completeSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  completeStatsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  completeStatCell: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  completeStatLabel: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  completeStatValue: {
    ...typography.sectionTitle,
    fontSize: 28,
    lineHeight: 34,
  },
  stateCard: {
    borderRadius: radius.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  stateTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
    textAlign: 'center',
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  stateActionRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stateActionButton: {
    flex: 1,
  },
  stateActionButtonLight: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stateActionButtonLightText: {
    color: colors.textPrimary,
  },
  questionListOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  questionListBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  questionListSheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    shadowColor: colors.black,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 10,
  },
  questionListHandle: {
    alignSelf: 'center',
    width: 52,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: '#CBD5E1',
    marginBottom: spacing.md,
  },
  questionListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  questionListHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  questionListTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
    color: '#0F172A',
    fontWeight: '800',
  },
  questionListSubtitle: {
    ...typography.caption,
    color: '#64748B',
    fontWeight: '700',
  },
  questionListCloseButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  questionListCloseButtonPressed: {
    opacity: 0.78,
  },
  questionListScroll: {
    maxHeight: 420,
  },
  questionListContent: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  questionListRow: {
    minHeight: 56,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  questionListRowSelected: {
    borderWidth: 1,
    borderColor: '#22C55E',
    backgroundColor: '#DCFCE7',
  },
  questionListRowPressed: {
    opacity: 0.78,
  },
  questionListCurrentMarker: {
    width: 4,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  questionListCurrentMarkerActive: {
    backgroundColor: '#16A34A',
  },
  questionListItemTitle: {
    ...typography.bodySmall,
    color: '#0F172A',
    fontWeight: '800',
    flex: 1,
    minWidth: 0,
  },
  questionListItemTitleSelected: {
    color: '#065F46',
  },
  questionListCurrentBadge: {
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  questionListCurrentBadgeText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '800',
  },
  questionListReviewText: {
    ...typography.bodySmall,
    color: '#475569',
    fontWeight: '700',
    width: 58,
    textAlign: 'center',
  },
  questionListReviewTextSelected: {
    color: '#065F46',
    fontWeight: '800',
  },
  questionListStatusText: {
    ...typography.bodySmall,
    color: '#475569',
    fontWeight: '800',
    width: 54,
    textAlign: 'right',
  },
  questionListStatusCompleted: {
    color: '#475569',
  },
  questionListStatusWrong: {
    color: '#DC2626',
  },
  questionListStatusUnsure: {
    color: '#F59E0B',
  },
  questionListStatusMastered: {
    color: '#16A34A',
  },
  disabledControl: {
    opacity: 0.6,
  },
  toastContainer: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
  toastBubble: {
    maxWidth: '86%',
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.black,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  toastText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '600',
    textAlign: 'center',
  },
});
