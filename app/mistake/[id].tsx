import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  type GestureResponderEvent,
  Image,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Linking,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppToast,
  type AppToastType,
  CardContainer,
  DetailBottomActionBar,
  DetailSectionHeader,
  DetailSectionNavigator,
  MistakeImageBrowser,
  MistakeDetailHeader,
  type MistakeDetailSectionId,
  type MistakeDetailSectionItem,
  type MistakeImageBrowserItem,
  type MistakeImageBrowserLongPressHelpers,
  MistakeImageSection,
  mistakeDetailPalette,
  ReviewProgressCard,
  ScreenContainer,
  TagChip,
  TextNoteEditorModal,
  TextNotePreview,
} from '@/src/components';
import { useAppToast } from '@/src/hooks/useAppToast';
import { useMistakeDetailImages } from '@/src/hooks/useMistakeDetailImages';
import {
  DIFFICULTY_OPTIONS,
  ERROR_REASON_OPTIONS,
  MODULE_OPTIONS,
} from '@/src/constants/mistakeOptions';
import { REVIEW_TEXT_NOTE_MAX_LENGTH } from '@/src/constants/review';
import {
  BOTTOM_RELEASE_DISTANCE,
  BOTTOM_TRIGGER_DISTANCE,
  EDGE_END_DRAG_VELOCITY_MIN,
  EDGE_PULL_TRIGGER_DISTANCE,
  TOP_PULL_RELEASE_DISTANCE,
  TOP_PULL_TRIGGER_DISTANCE,
} from '@/src/constants/edgePullNavigation';
import type {
  DetailImageSlot,
  DetailImageSlotType,
  DetailReviewRecordItem,
  MistakeDetailViewModel,
} from '@/src/models/MistakeDetailViewModel';
import type { CustomErrorReason } from '@/src/models/CustomErrorReason';
import type { CustomModule } from '@/src/models/CustomModule';
import type { MistakeTag } from '@/src/models/MistakeTag';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';
import type { TextHighlightRange } from '@/src/models/TextHighlight';
import { useMusicInterruption } from '@/src/music';
import { CustomErrorReasonService } from '@/src/services/CustomErrorReasonService';
import { CustomModuleService } from '@/src/services/CustomModuleService';
import * as ImageService from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import * as MistakeListService from '@/src/services/MistakeListService';
import * as MistakeTagService from '@/src/services/MistakeTagService';
import * as ReviewRecordImageService from '@/src/services/ReviewRecordImageService';
import * as ReviewRecordTextService from '@/src/services/ReviewRecordTextService';
import * as ReviewRecordVoiceService from '@/src/services/ReviewRecordVoiceService';
import type { VoiceNoteEntity } from '@/src/services/VoiceNoteService';
import * as VoiceNoteService from '@/src/services/VoiceNoteService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';
import { formatDateShort, isDueTodayOrBefore, parseLocalDateTime } from '@/src/utils/date';
import { resolveNextReviewAtText } from '@/src/utils/reviewSchedule';
import { areTextHighlightsEqual, normalizeTextHighlights } from '@/src/utils/textHighlights';

const PAGE_SCOPE = 'MistakeDetailScreen';
const TOAST_DURATION_DEFAULT = 2000;
const TOAST_DURATION_LONG = 3200;
const TOAST_DURATION_SHORT = 1400;
const TITLE_DOUBLE_TAP_WINDOW_MS = 280;
const NOTE_MAX_LENGTH = MistakeDetailService.MISTAKE_DETAIL_NOTE_MAX_LENGTH;
const NOTE_PLACEHOLDER = '点击输入备注，记录你的思考或重点...';
const VOICE_PLAYBACK_END_BUFFER_MS = 280;
const VOICE_RECORDING_MIN_DURATION_MS = 3000;
const VOICE_RECORDING_MAX_DURATION_MS = 3 * 60 * 1000;
const VOICE_FILE_MISSING_MESSAGE = '语音文件不存在，可能已被删除或未恢复';
const PAGE_SWITCH_ANIMATION_DISTANCE = 34;
const PAGE_SWITCH_ANIMATION_DURATION_MS = 180;

type ToastType = AppToastType;
type ScrollBoundary = 'top' | 'bottom';
type DetailSwitchFrom = 'top' | 'bottom' | null;

type DetailPageState =
  | { kind: 'loading' }
  | { kind: 'success'; detail: MistakeDetailViewModel }
  | { kind: 'notFound'; message: string }
  | { kind: 'error'; message: string };

type DetailImagePreviewItem = {
  id: string;
  uri: string;
  section: 'question' | 'solution' | 'answer' | 'review';
  title: string;
  subtitle?: string;
  reviewIndex?: number;
  reviewTotal?: number;
  imageIndexInSection?: number;
  imageTotalInSection?: number;
};

type ManagedDetailType = Exclude<DetailImageSlotType, 'review_solution'>;
type ReviewImageSource = 'camera' | 'album';
type DetailAnchorId = MistakeDetailSectionId;
type DetailModulePickerOption = {
  value: string;
  label: string;
};
type DetailErrorReasonOption = {
  id: string;
  label: string;
};
type DetailMetadataDraft = {
  errorReasonIds: string[];
  errorReasonLabels: string[];
  difficulty: number;
};
type MaybePreviewImage = {
  uri?: string | null;
  exists?: boolean;
};
type DetailImageSlotWithPreviewImages = DetailImageSlot & {
  previewImages?: MaybePreviewImage[];
};
type DetailReviewRecordWithImages = DetailReviewRecordItem & {
  solutionImages?: MaybePreviewImage[];
};

const MANAGED_IMAGE_ORDER: ManagedDetailType[] = ['question', 'my_solution', 'answer'];
const DETAIL_NAV_BAR_HEIGHT = 56;
const DETAIL_ANCHOR_ACTIVE_OFFSET = 116;
const DETAIL_ANCHOR_SCROLL_OFFSET = 64;
const DETAIL_ANCHOR_HIGHLIGHT_DURATION_MS = 1400;
const DETAIL_ANCHOR_LABELS: Record<DetailAnchorId, string> = {
  overview: '概览',
  images: '图片',
  reviews: '复做记录',
};
const EMPTY_BROWSE_CONTEXT: MistakeDetailService.DetailBrowseContext = {
  mode: 'none',
  ids: [],
  currentIndex: -1,
};

function normalizeRouteId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSwitchFrom(value: string | string[] | undefined): DetailSwitchFrom {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'top' || raw === 'bottom') {
    return raw;
  }
  return null;
}

function toBriefErrorMessage(message?: string): string {
  const fallback = '读取错题失败，请稍后重试。';
  const normalized = typeof message === 'string' ? message.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= 48) {
    return normalized;
  }
  return `${normalized.slice(0, 48)}...`;
}

function formatReviewResultLabel(result: DetailReviewRecordItem['result']): string {
  if (result === 'wrong' || result === 'unknown') {
    return '不会';
  }
  if (result === 'unsure' || result === 'vague') {
    return '模糊';
  }
  if (result === 'mastered' || result === 'known') {
    return '会了';
  }
  return '已完成';
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatReviewCreatedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }

  const year = parsed.getFullYear();
  const month = pad2(parsed.getMonth() + 1);
  const day = pad2(parsed.getDate());
  const hour = pad2(parsed.getHours());
  const minute = pad2(parsed.getMinutes());
  const second = pad2(parsed.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function formatReviewTimelineDate(iso: string, now = new Date()): string {
  const parsed = parseLocalDateTime(iso);
  if (!parsed) {
    return formatDateShort(iso);
  }

  if (
    parsed.getFullYear() === now.getFullYear()
    && parsed.getMonth() === now.getMonth()
    && parsed.getDate() === now.getDate()
  ) {
    return '今天';
  }

  if (parsed.getFullYear() === now.getFullYear()) {
    return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
  }

  return `${parsed.getFullYear()}年${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function formatNextReviewCompact(
  detail: MistakeDetailViewModel,
  nextReviewInfo: ReturnType<typeof resolveNextReviewAtText> | null,
): string {
  if (detail.status === 'mastered' || detail.reviewCount >= detail.maxReviewCount) {
    return '已完成';
  }
  if (detail.status === 'archived') {
    return '已归档';
  }
  if (detail.status === 'collected') {
    return '加入后安排';
  }
  if (nextReviewInfo?.tone === 'danger') {
    return nextReviewInfo.label;
  }

  const parsed = parseLocalDateTime(detail.nextReviewAt ?? null);
  if (!parsed) {
    return '待安排';
  }
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function countSlotImages(slot: DetailImageSlot): number {
  const previewCount = buildSlotPreviewImageUris(slot).length;
  return Math.max(previewCount, normalizePreviewUri(slot.uri) ? 1 : 0);
}

function formatDurationMs(durationMs: number): string {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(safeDurationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(minutes)}:${pad2(seconds)}`;
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

function normalizePreviewUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }
  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isManagedType(type: DetailImageSlotType): type is ManagedDetailType {
  return type === 'question' || type === 'my_solution' || type === 'answer';
}

function getSlotPreviewTitle(type: ManagedDetailType): string {
  if (type === 'question') {
    return '题目';
  }
  if (type === 'my_solution') {
    return '我的做法';
  }
  return '答案解析';
}

function getDeleteTypeName(type: ManagedDetailType): string {
  if (type === 'question') {
    return '题目';
  }
  if (type === 'my_solution') {
    return '我的做法';
  }
  return '答案解析';
}

function mapManagedTypeToImageSlot(type: ManagedDetailType): 'question' | 'solution' | 'answer' {
  if (type === 'question') {
    return 'question';
  }
  if (type === 'my_solution') {
    return 'solution';
  }
  return 'answer';
}

function sortManagedImageSlots(slots: DetailImageSlot[]): DetailImageSlot[] {
  const mapByType = new Map<ManagedDetailType, DetailImageSlot>();
  for (const slot of slots) {
    if (!isManagedType(slot.type)) {
      continue;
    }
    mapByType.set(slot.type, slot);
  }

  return MANAGED_IMAGE_ORDER.map((type) => mapByType.get(type)).filter(
    (slot): slot is DetailImageSlot => !!slot,
  );
}

function buildSlotPreviewImageUris(slot: DetailImageSlot): string[] {
  const normalizedUris: string[] = [];
  const slotWithImages = slot as DetailImageSlotWithPreviewImages;
  const previewImages = slotWithImages.previewImages;

  if (Array.isArray(previewImages) && previewImages.length > 0) {
    for (const image of previewImages) {
      const normalizedUri = normalizePreviewUri(image.uri);
      if (!normalizedUri || image.exists === false) {
        continue;
      }
      normalizedUris.push(normalizedUri);
    }
  }

  if (normalizedUris.length > 0) {
    return normalizedUris;
  }

  const fallbackUri = normalizePreviewUri(slot.uri);
  if (!fallbackUri || slot.exists === false) {
    return [];
  }
  return [fallbackUri];
}

function buildReviewPreviewImageUris(record: DetailReviewRecordItem): string[] {
  const normalizedUris: string[] = [];
  const recordWithImages = record as DetailReviewRecordWithImages;
  const solutionImages = recordWithImages.solutionImages;

  if (Array.isArray(solutionImages) && solutionImages.length > 0) {
    for (const image of solutionImages) {
      const normalizedUri = normalizePreviewUri(image.uri);
      if (!normalizedUri || image.exists === false) {
        continue;
      }
      normalizedUris.push(normalizedUri);
    }
  }

  if (normalizedUris.length > 0) {
    return normalizedUris;
  }

  const fallbackUri = normalizePreviewUri(record.solutionImageUri);
  if (!fallbackUri || record.solutionImageExists === false) {
    return [];
  }
  return [fallbackUri];
}

function normalizeReviewIndex(value: number, fallback: number, reviewTotal: number): number {
  if (Number.isFinite(value) && value > 0) {
    return Math.min(reviewTotal, Math.max(1, Math.floor(value)));
  }
  return Math.min(reviewTotal, Math.max(1, fallback));
}

function buildDetailImagePreviewItems(detail: MistakeDetailViewModel): DetailImagePreviewItem[] {
  const previewItems: DetailImagePreviewItem[] = [];
  const managedSlots = sortManagedImageSlots(detail.imageSlots);

  for (const slot of managedSlots) {
    if (!isManagedType(slot.type)) {
      continue;
    }

    const sectionUris = buildSlotPreviewImageUris(slot);
    if (sectionUris.length <= 0) {
      continue;
    }

    const sectionTitle = getSlotPreviewTitle(slot.type);
    const section = mapManagedTypeToImageSlot(slot.type);
    const imageTotalInSection = sectionUris.length;
    for (let index = 0; index < sectionUris.length; index += 1) {
      previewItems.push({
        id: `slot:${slot.type}:${index}`,
        uri: sectionUris[index],
        section,
        title: sectionTitle,
        subtitle: imageTotalInSection > 1 ? `图 ${index + 1}/${imageTotalInSection}` : undefined,
        imageIndexInSection: index + 1,
        imageTotalInSection,
      });
    }
  }

  const reviewTotal = Number.isFinite(detail.maxReviewCount) && detail.maxReviewCount > 0
    ? Math.floor(detail.maxReviewCount)
    : 7;
  const sortedReviewRecords = [...detail.reviewRecords].sort((left, right) => {
    if (left.reviewIndex !== right.reviewIndex) {
      return left.reviewIndex - right.reviewIndex;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });

  for (let recordIndex = 0; recordIndex < sortedReviewRecords.length; recordIndex += 1) {
    const record = sortedReviewRecords[recordIndex];
    const reviewIndex = normalizeReviewIndex(record.reviewIndex, recordIndex + 1, reviewTotal);
    const reviewTitle = `复做 ${reviewIndex}/${reviewTotal}`;
    const reviewUris = buildReviewPreviewImageUris(record);
    if (reviewUris.length <= 0) {
      continue;
    }

    const imageTotalInSection = reviewUris.length;
    for (let imageIndex = 0; imageIndex < reviewUris.length; imageIndex += 1) {
      previewItems.push({
        id: `review:${record.id}:${imageIndex}`,
        uri: reviewUris[imageIndex],
        section: 'review',
        title: reviewTitle,
        subtitle: imageTotalInSection > 1 ? `图 ${imageIndex + 1}/${imageTotalInSection}` : undefined,
        reviewIndex,
        reviewTotal,
        imageIndexInSection: imageIndex + 1,
        imageTotalInSection,
      });
    }
  }

  return previewItems;
}

function buildSwitchToastMessage(
  switchFrom: Exclude<DetailSwitchFrom, null>,
  currentIndex: number,
  total: number,
): string {
  const safeTotal = Math.max(1, Math.floor(total));
  const safeCurrentIndex =
    Number.isFinite(currentIndex) && currentIndex >= 0
      ? Math.min(safeTotal - 1, Math.floor(currentIndex))
      : 0;
  const displayIndex = safeCurrentIndex + 1;
  const positionText = `${displayIndex}/${safeTotal}`;

  if (switchFrom === 'bottom') {
    if (safeTotal > 1 && safeCurrentIndex === 0) {
      return `已回到第一题 · ${positionText}`;
    }
    return `已切到下一题 · ${positionText}`;
  }

  if (safeTotal > 1 && safeCurrentIndex === safeTotal - 1) {
    return `已到最后一题 · ${positionText}`;
  }
  return `已切到上一题 · ${positionText}`;
}

function normalizeErrorMessage(message?: string): string {
  if (typeof message !== 'string') {
    return '';
  }
  return message.replace(/\s+/g, ' ').trim();
}

function normalizeNoteDraft(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeModuleNameForPicker(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

function toModulePickerKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

const DETAIL_OTHER_MODULE_KEYS = new Set(
  ['其他', '英语', '未分类'].map((moduleName) => toModulePickerKey(moduleName)),
);

function appendModulePickerOption(
  options: DetailModulePickerOption[],
  seenKeys: Set<string>,
  value: string | null | undefined,
  label?: string,
) {
  const normalizedValue = normalizeModuleNameForPicker(value);
  if (!normalizedValue) {
    return;
  }

  const key = toModulePickerKey(normalizedValue);
  if (seenKeys.has(key)) {
    return;
  }

  seenKeys.add(key);
  options.push({
    value: normalizedValue,
    label: normalizeModuleNameForPicker(label) ?? normalizedValue,
  });
}

function buildDetailModulePickerOptions(
  customModules: CustomModule[],
  existingMistakeModules: string[],
  currentModule: string | null,
): DetailModulePickerOption[] {
  const options: DetailModulePickerOption[] = [];
  const seenKeys = new Set<string>();

  for (const option of MODULE_OPTIONS) {
    appendModulePickerOption(options, seenKeys, option.value, option.label);
  }
  for (const moduleItem of customModules) {
    appendModulePickerOption(options, seenKeys, moduleItem.name);
  }
  for (const moduleName of existingMistakeModules) {
    appendModulePickerOption(options, seenKeys, moduleName);
  }

  const normalizedCurrentModule = normalizeModuleNameForPicker(currentModule);
  if (normalizedCurrentModule && !seenKeys.has(toModulePickerKey(normalizedCurrentModule))) {
    options.unshift({
      value: normalizedCurrentModule,
      label: normalizedCurrentModule,
    });
  }

  return options;
}

function normalizeMetadataErrorReason(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

function appendErrorReasonOption(
  options: DetailErrorReasonOption[],
  seenKeys: Set<string>,
  id: string,
  value: string | null | undefined,
  label?: string,
) {
  const normalizedValue = normalizeMetadataErrorReason(value);
  if (!normalizedValue) {
    return;
  }

  const key = toModulePickerKey(normalizedValue);
  if (seenKeys.has(key)) {
    return;
  }

  seenKeys.add(key);
  options.push({
    id,
    label: label ?? normalizedValue,
  });
}

function buildDetailErrorReasonOptions(
  customErrorReasons: CustomErrorReason[],
  draft: DetailMetadataDraft,
): DetailErrorReasonOption[] {
  const options: DetailErrorReasonOption[] = [];
  const seenKeys = new Set<string>();

  for (const option of ERROR_REASON_OPTIONS) {
    appendErrorReasonOption(options, seenKeys, option.id, option.value, option.label);
  }
  for (const reasonItem of customErrorReasons) {
    const selectedIndex = draft.errorReasonLabels.findIndex(
      (label) => toModulePickerKey(label) === toModulePickerKey(reasonItem.name),
    );
    appendErrorReasonOption(
      options,
      seenKeys,
      selectedIndex >= 0 ? draft.errorReasonIds[selectedIndex] : `custom:${reasonItem.id}`,
      reasonItem.name,
    );
  }

  draft.errorReasonLabels.forEach((label, index) => {
    appendErrorReasonOption(options, seenKeys, draft.errorReasonIds[index] ?? `legacy:${label}`, label);
  });

  return options;
}

function normalizeMetadataDifficulty(value: number): number {
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized < 1 || normalized > 5) {
    return 3;
  }
  return normalized;
}

function buildMetadataDraft(detail: MistakeDetailViewModel): DetailMetadataDraft {
  const labels = normalizeMetadataErrorReason(detail.errorReason)?.split('、').map((label) => label.trim()).filter(Boolean) ?? [];
  const storedIds = Array.isArray(detail.errorReasonIds) ? detail.errorReasonIds : [];
  return {
    errorReasonIds: labels.map((label, index) => {
      const storedId = storedIds[index];
      if (storedId) return storedId;
      return ERROR_REASON_OPTIONS.find((option) => option.value === label)?.id ?? `legacy:${label}`;
    }),
    errorReasonLabels: labels,
    difficulty: normalizeMetadataDifficulty(detail.difficulty),
  };
}

function clampNoteDraft(value: string): string {
  if (value.length <= NOTE_MAX_LENGTH) {
    return value;
  }
  return value.slice(0, NOTE_MAX_LENGTH);
}

function isCancelLikeMessage(message?: string): boolean {
  const normalized = normalizeErrorMessage(message).toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes('cancel') || normalized.includes('取消');
}

function isCameraPermissionDenied(message?: string): boolean {
  const normalized = normalizeErrorMessage(message).toLowerCase();
  return normalized.includes('camera permission') || normalized.includes('相机权限');
}

function isMediaLibraryPermissionDenied(message?: string): boolean {
  const normalized = normalizeErrorMessage(message).toLowerCase();
  return (
    normalized.includes('media library permission')
    || normalized.includes('photo permission')
    || normalized.includes('相册权限')
  );
}

function shouldPromptOpenSettings(message?: string): boolean {
  const normalized = normalizeErrorMessage(message).toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('system settings')
    || normalized.includes('open settings')
    || normalized.includes('去设置')
    || normalized.includes('系统设置')
  );
}

function ReviewRecordCard({
  record,
  isBusy = false,
  isVoicePlaying = false,
  isVoiceBusy = false,
  isVoicePlaybackLocked = false,
  isVoiceRecording = false,
  recordingElapsedMs = 0,
  isVoiceLocked = false,
  isTextActionDisabled = false,
  onAddImage,
  onAddText,
  onOpenText,
  onPreview,
  onOpenImageActions,
  onToggleVoicePlayback,
  onStartVoiceRecording,
  onStopAndSaveVoiceRecording,
}: {
  record: DetailReviewRecordItem;
  isBusy?: boolean;
  isVoicePlaying?: boolean;
  isVoiceBusy?: boolean;
  isVoicePlaybackLocked?: boolean;
  isVoiceRecording?: boolean;
  recordingElapsedMs?: number;
  isVoiceLocked?: boolean;
  isTextActionDisabled?: boolean;
  onAddImage?: (record: DetailReviewRecordItem) => void;
  onAddText?: (record: DetailReviewRecordItem) => void;
  onOpenText?: (record: DetailReviewRecordItem) => void;
  onPreview?: (targetImageId: string) => void;
  onOpenImageActions?: (record: DetailReviewRecordItem) => void;
  onToggleVoicePlayback?: (record: DetailReviewRecordItem) => void;
  onStartVoiceRecording?: (record: DetailReviewRecordItem) => void;
  onStopAndSaveVoiceRecording?: (record: DetailReviewRecordItem) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [record.solutionImageExists, record.solutionImageUri]);

  const normalizedUri = normalizePreviewUri(record.solutionImageUri);
  const hasImage = !!normalizedUri;
  const imageExists = record.solutionImageExists !== false;
  const canShowImage = hasImage && imageExists && !imageFailed;
  const voiceNote = record.voiceNote ?? null;
  const reviewTextNote = typeof record.note === 'string' ? record.note.trim() : '';
  const voiceAddDisabled = isVoiceBusy || isVoiceLocked;
  const voiceAddButtonText = isVoiceLocked ? '其他录音中' : isVoiceBusy ? '处理中...' : '补充语音';

  return (
    <View style={styles.reviewTimelineItem}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`第 ${record.reviewIndex} 刷，${formatReviewResultLabel(record.result)}，${formatReviewTimelineDate(record.createdAt)}`}
        accessibilityState={{ expanded: isExpanded }}
        onPress={() => setIsExpanded((current) => !current)}
        style={({ pressed }) => [styles.reviewTimelineHeader, pressed && styles.timelinePressed]}>
        <View style={styles.timelineStatusIcon}>
          <MaterialIcons name="check" size={17} color={mistakeDetailPalette.green} />
        </View>
        <Text numberOfLines={2} style={styles.timelineSummaryText}>
          第 {record.reviewIndex} 刷 · {formatReviewResultLabel(record.result)} ·{' '}
          <Text style={styles.timelineDateText}>{formatReviewTimelineDate(record.createdAt)}</Text>
        </Text>
        <MaterialIcons
          name={isExpanded ? 'keyboard-arrow-down' : 'chevron-right'}
          size={22}
          color={mistakeDetailPalette.secondaryText}
        />
      </Pressable>

      {isExpanded ? (
      <View style={styles.reviewRecordRow}>
      <View style={styles.reviewRecordMain}>
        <Text style={styles.reviewRecordTitle}>第 {record.reviewIndex} 刷</Text>
        <Text style={styles.reviewRecordMeta}>时间：{formatReviewCreatedAt(record.createdAt)}</Text>
        <Text style={styles.reviewRecordMeta}>结果：{formatReviewResultLabel(record.result)}</Text>
        {voiceNote ? (
          <View style={styles.reviewRecordVoiceRow}>
            <Text style={styles.reviewRecordVoiceText}>
              {`有语音讲解 ${formatDurationMs(voiceNote.durationMs)}`}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isVoicePlaying ? '停止语音讲解' : '播放语音讲解'}
              disabled={isVoiceBusy || isVoicePlaybackLocked}
              onPress={() => {
                onToggleVoicePlayback?.(record);
              }}
              style={({ pressed }) => [
                styles.reviewRecordVoiceButton,
                (isVoiceBusy || isVoicePlaybackLocked) && styles.reviewRecordVoiceButtonDisabled,
                pressed && styles.previewTapPressed,
              ]}>
              <MaterialIcons
                name={isVoicePlaying ? 'stop-circle' : 'play-circle-filled'}
                size={16}
                color={colors.textPrimary}
              />
              <Text style={styles.reviewRecordVoiceButtonText}>{isVoicePlaying ? '停止' : '播放'}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.reviewRecordVoiceRow}>
            <Text style={styles.reviewRecordVoiceText}>
              {isVoiceRecording ? `正在录音 ${formatDurationMs(recordingElapsedMs)}` : '未添加语音讲解'}
            </Text>
            {isVoiceRecording ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="停止并保存语音讲解"
                disabled={isVoiceBusy}
                onPress={() => {
                  onStopAndSaveVoiceRecording?.(record);
                }}
                style={({ pressed }) => [
                  styles.reviewRecordVoiceButton,
                  styles.reviewRecordVoiceButtonDanger,
                  isVoiceBusy && styles.reviewRecordVoiceButtonDisabled,
                  pressed && styles.previewTapPressed,
                ]}>
                <MaterialIcons name="stop-circle" size={16} color={colors.white} />
                <Text style={styles.reviewRecordVoiceButtonTextLight}>
                  {isVoiceBusy ? '保存中...' : '停止并保存'}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="补充语音讲解"
                disabled={voiceAddDisabled}
                onPress={() => {
                  onStartVoiceRecording?.(record);
                }}
                style={({ pressed }) => [
                  styles.reviewRecordVoiceButton,
                  voiceAddDisabled && styles.reviewRecordVoiceButtonDisabled,
                  pressed && styles.previewTapPressed,
                ]}>
                <MaterialIcons name="keyboard-voice" size={16} color={colors.textPrimary} />
                <Text style={styles.reviewRecordVoiceButtonText}>{voiceAddButtonText}</Text>
              </Pressable>
            )}
          </View>
        )}
        {reviewTextNote ? (
          <View style={styles.reviewRecordTextNote}>
            <View style={styles.reviewRecordTextNoteHeader}>
              <View style={styles.reviewRecordTextNoteHeaderTitle}>
                <MaterialIcons name="edit-note" size={16} color="#7C3AED" />
                <Text style={styles.reviewRecordTextNoteLabel}>文字讲解</Text>
              </View>
            </View>
            <TextNotePreview
              value={reviewTextNote}
              emptyText="未添加文本讲解"
              maxLength={REVIEW_TEXT_NOTE_MAX_LENGTH}
              accessibilityLabel={`第 ${record.reviewIndex} 刷文字讲解`}
              onOpen={() => onOpenText?.(record)}
              highlights={record.noteHighlights}
              textStyle={styles.reviewRecordTextNoteContent}
            />
          </View>
        ) : (
          <View style={styles.reviewRecordTextEmptyRow}>
            <Text style={styles.reviewRecordTextEmptyText}>未添加文本讲解</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`为第 ${record.reviewIndex} 刷补充文本讲解`}
              disabled={isTextActionDisabled}
              onPress={() => onAddText?.(record)}
              style={({ pressed }) => [
                styles.reviewRecordTextAddButton,
                pressed && !isTextActionDisabled && styles.previewTapPressed,
                isTextActionDisabled && styles.reviewRecordVoiceButtonDisabled,
              ]}>
              <MaterialIcons name="edit-note" size={16} color={colors.textPrimary} />
              <Text style={styles.reviewRecordVoiceButtonText}>补充文本</Text>
            </Pressable>
          </View>
        )}
      </View>

      {canShowImage ? (
        <View style={styles.reviewRecordPreviewWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="复做图片，点击查看大图，长按可管理图片"
            onPress={() => {
              if (!normalizedUri || !onPreview) {
                return;
              }
              onPreview(`review:${record.id}:0`);
            }}
            onLongPress={() => {
              onOpenImageActions?.(record);
            }}
            delayLongPress={220}
            style={({ pressed }) => [styles.reviewRecordImageWrap, pressed && styles.previewTapPressed]}>
            <Image
              source={{ uri: normalizedUri }}
              style={styles.reviewRecordImage}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="复做图片操作"
              onPress={() => {
                onOpenImageActions?.(record);
              }}
              style={({ pressed }) => [
                styles.reviewRecordMoreButton,
                pressed && styles.reviewRecordMoreButtonPressed,
              ]}>
              <MaterialIcons name="more-horiz" size={16} color={colors.textPrimary} />
            </Pressable>
            {isBusy ? (
              <View style={styles.reviewRecordBusyMask}>
                <ActivityIndicator size="small" color={colors.textPrimary} />
              </View>
            ) : null}
          </Pressable>
          <Text style={styles.reviewRecordPreviewHint}>点击查看</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasImage ? '复做图片不可用，点击重新添加' : '添加复做图片'}
          onPress={() => {
            if (hasImage) {
              onOpenImageActions?.(record);
              return;
            }
            onAddImage?.(record);
          }}
          style={({ pressed }) => [
            styles.reviewRecordEmptyThumb,
            hasImage && styles.reviewRecordMissingThumb,
            pressed && styles.previewTapPressed,
          ]}>
          <MaterialIcons
            name={hasImage ? 'image-not-supported' : 'photo-camera'}
            size={18}
            color={colors.textMuted}
          />
          <Text style={styles.reviewRecordEmptyText}>{hasImage ? '图片不可用' : '补拍'}</Text>
          {isBusy ? (
            <View style={styles.reviewRecordBusyMask}>
              <ActivityIndicator size="small" color={colors.textPrimary} />
            </View>
          ) : null}
        </Pressable>
      )}
      </View>
      ) : null}
    </View>
  );
}

function StateCard({
  title,
  message,
  onBack,
  onRetry,
  retryText = '重试',
}: {
  title: string;
  message: string;
  onBack: () => void;
  onRetry?: () => void;
  retryText?: string;
}) {
  return (
    <CardContainer style={styles.stateCard} padding={spacing.lg}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>

      <View style={styles.stateActions}>
        <Pressable style={styles.stateSecondaryButton} onPress={onBack}>
          <Text style={styles.stateSecondaryButtonText}>返回</Text>
        </Pressable>
        {onRetry ? (
          <Pressable style={styles.statePrimaryButton} onPress={onRetry}>
            <Text style={styles.statePrimaryButtonText}>{retryText}</Text>
          </Pressable>
        ) : null}
      </View>
    </CardContainer>
  );
}

function DetailModulePickerModal({
  visible,
  options,
  selectedModule,
  busy,
  message,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  options: DetailModulePickerOption[];
  selectedModule: string | null;
  busy: boolean;
  message?: string | null;
  onClose: () => void;
  onConfirm: (moduleName: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const normalizedSelectedModule = normalizeModuleNameForPicker(selectedModule);
  const [draftModule, setDraftModule] = useState<string | null>(normalizedSelectedModule);
  const groupedOptions = useMemo(() => {
    const mathOptions: DetailModulePickerOption[] = [];
    const otherOptions: DetailModulePickerOption[] = [];

    for (const option of options) {
      if (DETAIL_OTHER_MODULE_KEYS.has(toModulePickerKey(option.value))) {
        otherOptions.push(option);
      } else {
        mathOptions.push(option);
      }
    }

    return { mathOptions, otherOptions };
  }, [options]);

  useEffect(() => {
    if (visible) {
      setDraftModule(normalizedSelectedModule);
    }
  }, [normalizedSelectedModule, visible]);

  const renderOption = (option: DetailModulePickerOption) => {
    const selected =
      draftModule !== null
      && toModulePickerKey(draftModule) === toModulePickerKey(option.value);

    return (
      <Pressable
        key={option.value}
        accessibilityRole="button"
        accessibilityLabel={`选择模块：${option.label}`}
        accessibilityState={{ disabled: busy, selected }}
        disabled={busy}
        onPress={() => setDraftModule(option.value)}
        style={({ pressed }) => [
          styles.modulePickerOption,
          selected && styles.modulePickerOptionSelected,
          pressed && !busy && styles.modulePickerOptionPressed,
          busy && styles.modulePickerOptionDisabled,
        ]}>
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={1.1}
          style={[
            styles.modulePickerOptionText,
            selected && styles.modulePickerOptionTextSelected,
          ]}>
          {option.label}
        </Text>
        {selected ? (
          <MaterialIcons
            name="check"
            size={20}
            color={colors.white}
            style={styles.modulePickerOptionCheck}
          />
        ) : null}
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.modulePickerOverlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭模块选择"
          style={styles.modulePickerBackdrop}
          onPress={onClose}
        />
        <View
          style={[
            styles.modulePickerSheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
          ]}>
          <View style={styles.modulePickerHandle} />
          <View style={styles.modulePickerHeader}>
            <View style={styles.modulePickerHeaderTextWrap}>
              <Text style={styles.modulePickerTitle}>修改模块</Text>
              <Text style={styles.modulePickerSubtitle}>选择一个模块</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消修改模块"
              onPress={onClose}
              style={({ pressed }) => [
                styles.modulePickerCancelButton,
                pressed && styles.modulePickerCancelButtonPressed,
              ]}>
              <Text style={styles.modulePickerCancelText}>取消</Text>
            </Pressable>
          </View>

          {message ? (
            <Text maxFontSizeMultiplier={1.1} style={styles.modulePickerMessage}>
              {message}
            </Text>
          ) : null}

          <ScrollView
            style={styles.modulePickerScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.modulePickerContent}>
            <View style={styles.modulePickerSection}>
              <Text style={styles.modulePickerSectionTitle}>数学</Text>
              <View style={styles.modulePickerGrid}>
                {groupedOptions.mathOptions.map(renderOption)}
              </View>
            </View>

            {groupedOptions.otherOptions.length > 0 ? (
              <View style={styles.modulePickerSection}>
                <Text style={styles.modulePickerSectionTitle}>其他分类</Text>
                <View style={styles.modulePickerGrid}>
                  {groupedOptions.otherOptions.map(renderOption)}
                </View>
              </View>
            ) : null}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="完成模块修改"
            disabled={busy || draftModule === null}
            onPress={() => {
              if (draftModule) {
                onConfirm(draftModule);
              }
            }}
            style={({ pressed }) => [
              styles.modulePickerConfirmButton,
              pressed && !busy && draftModule !== null && styles.modulePickerConfirmButtonPressed,
              (busy || draftModule === null) && styles.modulePickerConfirmButtonDisabled,
            ]}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.modulePickerConfirmText}>完成</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function DetailMetadataEditorModal({
  visible,
  draft,
  customErrorReasons,
  busy,
  message,
  onClose,
  onChangeDraft,
  onSave,
}: {
  visible: boolean;
  draft: DetailMetadataDraft | null;
  customErrorReasons: CustomErrorReason[];
  busy: boolean;
  message?: string | null;
  onClose: () => void;
  onChangeDraft: (draft: DetailMetadataDraft) => void;
  onSave: () => void;
}) {
  const insets = useSafeAreaInsets();

  if (!draft) {
    return null;
  }

  const errorReasonOptions = buildDetailErrorReasonOptions(customErrorReasons, draft);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.metadataModalOverlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭错因难度编辑"
          style={styles.metadataModalBackdrop}
          onPress={onClose}
        />
        <View
          style={[
            styles.metadataModalSheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
          ]}>
          <View style={styles.metadataModalHandle} />
          <View style={styles.metadataModalHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消修改错因难度"
              onPress={onClose}
              disabled={busy}
              style={({ pressed }) => [
                styles.metadataModalHeaderAction,
                pressed && !busy && styles.metadataModalHeaderActionPressed,
                busy && styles.metadataModalButtonDisabled,
              ]}>
              <Text style={styles.metadataModalCancelText}>取消</Text>
            </Pressable>
            <Text numberOfLines={1} style={styles.metadataModalTitle}>
              修改错因与难度
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="保存错因难度"
              onPress={onSave}
              disabled={busy}
              style={({ pressed }) => [
                styles.metadataModalHeaderAction,
                styles.metadataModalSaveAction,
                pressed && !busy && styles.metadataModalHeaderActionPressed,
                busy && styles.metadataModalButtonDisabled,
              ]}>
              {busy ? (
                <ActivityIndicator size="small" color={colors.success} />
              ) : (
                <Text style={styles.metadataModalSaveText}>保存</Text>
              )}
            </Pressable>
          </View>
          <Text style={styles.metadataModalSubtitle}>修正录入时选择的信息</Text>

          {message ? (
            <Text maxFontSizeMultiplier={1.1} style={styles.metadataModalMessage}>
              {message}
            </Text>
          ) : null}

          <ScrollView
            style={styles.metadataModalScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.metadataModalContent}>
            <View style={styles.metadataSection}>
              <Text style={styles.metadataSectionTitle}>错因</Text>
              <View style={styles.metadataReasonGrid}>
                {errorReasonOptions.map((option) => {
                  const selectedIndex = draft.errorReasonIds.indexOf(option.id);
                  const selected = selectedIndex >= 0;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled: busy }}
                      accessibilityLabel={`选择错因：${option.label}`}
                      disabled={busy}
                      onPress={() => {
                        if (selected) {
                          onChangeDraft({
                            ...draft,
                            errorReasonIds: draft.errorReasonIds.filter(
                              (_, index) => index !== selectedIndex,
                            ),
                            errorReasonLabels: draft.errorReasonLabels.filter(
                              (_, index) => index !== selectedIndex,
                            ),
                          });
                          return;
                        }
                        onChangeDraft({
                          ...draft,
                          errorReasonIds: [...draft.errorReasonIds, option.id],
                          errorReasonLabels: [...draft.errorReasonLabels, option.label],
                        });
                      }}
                      style={({ pressed }) => [
                        styles.metadataReasonCard,
                        selected && styles.metadataReasonCardSelected,
                        pressed && !busy && styles.metadataReasonCardPressed,
                        busy && styles.metadataModalButtonDisabled,
                      ]}>
                      <Text
                        numberOfLines={2}
                        maxFontSizeMultiplier={1.1}
                        style={[
                          styles.metadataReasonCardText,
                          selected && styles.metadataReasonCardTextSelected,
                        ]}>
                        {option.label}
                      </Text>
                      {selected ? (
                        <View style={styles.metadataReasonCheck}>
                          <MaterialIcons name="check" size={16} color={colors.white} />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.metadataDivider} />

            <View style={styles.metadataSection}>
              <Text style={styles.metadataSectionTitle}>难度</Text>
              <View style={styles.metadataDifficultyControl}>
                {DIFFICULTY_OPTIONS.map((option) => {
                  const selected = draft.difficulty === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: busy }}
                      accessibilityLabel={`选择难度：${option.label}`}
                      disabled={busy}
                      onPress={() =>
                        onChangeDraft({
                          ...draft,
                          difficulty: option.value,
                        })
                      }
                      style={({ pressed }) => [
                        styles.metadataDifficultyOption,
                        selected && styles.metadataDifficultyOptionSelected,
                        pressed && !busy && styles.metadataDifficultyOptionPressed,
                        busy && styles.metadataModalButtonDisabled,
                      ]}>
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.05}
                        style={[
                          styles.metadataDifficultyText,
                          selected && styles.metadataDifficultyTextSelected,
                        ]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.metadataDifficultyHint}>用于安排后续复做优先级</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function MistakeDetailScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { pauseForInterruption, resumeAfterInterruption } = useMusicInterruption();
  const { id, switchFrom, relatedFromId, relatedFromTitle } = useLocalSearchParams<{
    id?: string | string[];
    switchFrom?: string | string[];
    relatedFromId?: string | string[];
    relatedFromTitle?: string | string[];
  }>();
  const routeId = useMemo(() => normalizeRouteId(id), [id]);
  const routeSwitchFrom = useMemo(() => normalizeSwitchFrom(switchFrom), [switchFrom]);
  const routeRelatedFromId = useMemo(() => normalizeRouteId(relatedFromId), [relatedFromId]);
  const routeRelatedFromTitle = useMemo(
    () => normalizeRouteId(relatedFromTitle),
    [relatedFromTitle],
  );

  const [state, setState] = useState<DetailPageState>({ kind: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [imageBrowserVisible, setImageBrowserVisible] = useState(false);
  const [imageBrowserInitialIndex, setImageBrowserInitialIndex] = useState(0);
  const [imageBrowserItems, setImageBrowserItems] = useState<DetailImagePreviewItem[]>([]);
  const [activeImageBrowserAction, setActiveImageBrowserAction] = useState<'save' | 'share' | null>(null);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [noteHighlightsInput, setNoteHighlightsInput] = useState<TextHighlightRange[]>([]);
  const [isNoteModalVisible, setIsNoteModalVisible] = useState(false);
  const [noteModalMessage, setNoteModalMessage] = useState<string | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isDeletingMistake, setIsDeletingMistake] = useState(false);
  const [isArchivingMistake, setIsArchivingMistake] = useState(false);
  const [isJoiningReviewPlan, setIsJoiningReviewPlan] = useState(false);
  const [customModules, setCustomModules] = useState<CustomModule[]>([]);
  const [customErrorReasons, setCustomErrorReasons] = useState<CustomErrorReason[]>([]);
  const [existingMistakeModules, setExistingMistakeModules] = useState<string[]>([]);
  const [isModulePickerVisible, setIsModulePickerVisible] = useState(false);
  const [isModuleOptionsLoading, setIsModuleOptionsLoading] = useState(false);
  const [isSavingModule, setIsSavingModule] = useState(false);
  const [modulePickerMessage, setModulePickerMessage] = useState<string | null>(null);
  const [isMetadataEditorVisible, setIsMetadataEditorVisible] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState<DetailMetadataDraft | null>(null);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [metadataEditorMessage, setMetadataEditorMessage] = useState<string | null>(null);
  const [isTagAddModalVisible, setIsTagAddModalVisible] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [tagModalMessage, setTagModalMessage] = useState<string | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [isSavingTag, setIsSavingTag] = useState(false);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);
  const [isTagManageMode, setIsTagManageMode] = useState(false);
  const [activeReviewRecordId, setActiveReviewRecordId] = useState<string | null>(null);
  const [reviewTextEditorRecordId, setReviewTextEditorRecordId] = useState<string | null>(null);
  const [reviewTextEditorMessage, setReviewTextEditorMessage] = useState<string | null>(null);
  const [isSavingReviewText, setIsSavingReviewText] = useState(false);
  const [activeVoiceRecordId, setActiveVoiceRecordId] = useState<string | null>(null);
  const [isVoicePlaybackBusy, setIsVoicePlaybackBusy] = useState(false);
  const [activeVoiceRecordingRecordId, setActiveVoiceRecordingRecordId] = useState<string | null>(null);
  const [isVoiceRecordingBusy, setIsVoiceRecordingBusy] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [browseContext, setBrowseContext] =
    useState<MistakeDetailService.DetailBrowseContext>(EMPTY_BROWSE_CONTEXT);
  const [activeAnchorId, setActiveAnchorId] = useState<DetailAnchorId>('overview');
  const [highlightedAnchorId, setHighlightedAnchorId] = useState<DetailAnchorId | null>(null);
  const [isFloatingAnchorVisible, setIsFloatingAnchorVisible] = useState(false);
  const [isImageManageMode, setIsImageManageMode] = useState(false);
  const [showAllReviewRecords, setShowAllReviewRecords] = useState(false);
  const [isMoreMenuVisible, setIsMoreMenuVisible] = useState(false);

  const requestIdRef = useRef(0);
  const browseRequestIdRef = useRef(0);
  const detailScrollRef = useRef<ScrollView | null>(null);
  const anchorNavLayoutRef = useRef<{ y: number; height: number } | null>(null);
  const anchorLayoutsRef = useRef<Partial<Record<DetailAnchorId, number>>>({});
  const hasFocusedRef = useRef(false);
  const titleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voicePlaybackResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const voiceStopInProgressRef = useRef(false);
  const voiceMusicInterruptionActiveRef = useRef(false);
  const isScrollDraggingRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const maxScrollYRef = useRef(0);
  const scrollBoundaryLockRef = useRef<ScrollBoundary | null>(null);
  const pendingAutoRouteIdRef = useRef<string | null>(null);
  const lastTouchYRef = useRef<number | null>(null);
  const touchMoveCountRef = useRef(0);
  const topEdgePullDistanceRef = useRef(0);
  const bottomEdgePullDistanceRef = useRef(0);
  const pageEnterTranslateY = useRef(new Animated.Value(0)).current;
  const pageEnterOpacity = useRef(new Animated.Value(1)).current;
  const anchorHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allowNextLeaveRef = useRef(false);
  const switchToastKeyRef = useRef<string | null>(null);
  const [titleSelectAllOnFocus, setTitleSelectAllOnFocus] = useState(false);
  const { props: toastProps, showToast } = useAppToast({ defaultDuration: TOAST_DURATION_DEFAULT });

  const toastBottomOffset = Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg);

  useEffect(() => {
    isScrollDraggingRef.current = false;
    scrollBoundaryLockRef.current = null;
    lastScrollYRef.current = 0;
    maxScrollYRef.current = 0;
    pendingAutoRouteIdRef.current = null;
    lastTouchYRef.current = null;
    touchMoveCountRef.current = 0;
    topEdgePullDistanceRef.current = 0;
    bottomEdgePullDistanceRef.current = 0;
    anchorNavLayoutRef.current = null;
    anchorLayoutsRef.current = {};
    setActiveAnchorId('overview');
    setHighlightedAnchorId(null);
    setIsFloatingAnchorVisible(false);
    setIsImageManageMode(false);
    setShowAllReviewRecords(false);
    setIsMoreMenuVisible(false);
  }, [routeId]);

  useEffect(() => {
    if (!routeSwitchFrom) {
      pageEnterTranslateY.setValue(0);
      pageEnterOpacity.setValue(1);
      return;
    }

    const fromOffset =
      routeSwitchFrom === 'bottom'
        ? PAGE_SWITCH_ANIMATION_DISTANCE
        : -PAGE_SWITCH_ANIMATION_DISTANCE;
    pageEnterTranslateY.setValue(fromOffset);
    pageEnterOpacity.setValue(0.96);
    Animated.parallel([
      Animated.timing(pageEnterTranslateY, {
        toValue: 0,
        duration: PAGE_SWITCH_ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }),
      Animated.timing(pageEnterOpacity, {
        toValue: 1,
        duration: PAGE_SWITCH_ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [pageEnterOpacity, pageEnterTranslateY, routeId, routeSwitchFrom]);

  const navigateBack = useCallback(() => {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/library' as never);
  }, [router]);

  const handleAnchorLayout = useCallback((anchorId: DetailAnchorId, event: LayoutChangeEvent) => {
    const nextY = Math.max(0, Math.round(event.nativeEvent.layout.y));
    if (anchorLayoutsRef.current[anchorId] === nextY) {
      return;
    }

    anchorLayoutsRef.current = {
      ...anchorLayoutsRef.current,
      [anchorId]: nextY,
    };
  }, []);

  const handleAnchorNavLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    anchorNavLayoutRef.current = {
      y: Math.max(0, Math.round(y)),
      height: Math.max(0, Math.round(height)),
    };
  }, []);

  const resolveActiveAnchorId = useCallback((scrollY: number, maxScrollY: number): DetailAnchorId => {
    if (maxScrollY > 0 && scrollY >= maxScrollY - spacing.lg) {
      return 'reviews';
    }

    const thresholdY = scrollY + DETAIL_ANCHOR_ACTIVE_OFFSET;
    let nextAnchorId: DetailAnchorId = 'overview';
    for (const anchorId of ['overview', 'images', 'reviews'] as const) {
      const anchorY = anchorLayoutsRef.current[anchorId];
      if (typeof anchorY === 'number' && thresholdY >= anchorY) {
        nextAnchorId = anchorId;
      }
    }

    return nextAnchorId;
  }, []);

  const handleAnchorPress = useCallback(
    (anchorId: DetailAnchorId) => {
      const targetY = anchorLayoutsRef.current[anchorId];
      const label = DETAIL_ANCHOR_LABELS[anchorId];
      if (typeof targetY !== 'number') {
        showToast(`${label}位置准备中，请稍后再试。`, 'anchor', TOAST_DURATION_SHORT);
        return;
      }

      const anchorNavLayout = anchorNavLayoutRef.current;
      const floatingTriggerY = anchorNavLayout
        ? anchorNavLayout.y + anchorNavLayout.height - spacing.md
        : Number.POSITIVE_INFINITY;
      const willShowFloatingAnchor =
        Math.max(0, targetY - DETAIL_ANCHOR_SCROLL_OFFSET) >= floatingTriggerY;

      const scrollOffset = isFloatingAnchorVisible || willShowFloatingAnchor
        ? DETAIL_ANCHOR_SCROLL_OFFSET
        : spacing.sm;

      detailScrollRef.current?.scrollTo({
        y: Math.max(0, targetY - scrollOffset),
        animated: true,
      });
      setActiveAnchorId(anchorId);
      setHighlightedAnchorId(anchorId);

      if (anchorHighlightTimerRef.current) {
        clearTimeout(anchorHighlightTimerRef.current);
      }
      anchorHighlightTimerRef.current = setTimeout(() => {
        setHighlightedAnchorId(null);
        anchorHighlightTimerRef.current = null;
      }, DETAIL_ANCHOR_HIGHLIGHT_DURATION_MS);

      showToast(`已跳转到 ${label}`, 'anchor', TOAST_DURATION_SHORT);
    },
    [isFloatingAnchorVisible, showToast],
  );

  const loadModuleOptionsForPicker = useCallback(async () => {
    setIsModuleOptionsLoading(true);
    setModulePickerMessage(null);
    const loadErrors: string[] = [];

    try {
      const modules = await CustomModuleService.listCustomModules();
      setCustomModules(modules);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to load custom modules for detail module picker.', {
        routeId,
        error,
      });
      loadErrors.push('自定义模块');
    }

    try {
      const moduleCounts = await MistakeListService.getMistakeModuleCounts({
        segment: 'all',
        keyword: '',
        module: null,
      });
      setExistingMistakeModules(moduleCounts.map((item) => item.module));
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to load existing mistake modules for detail module picker.', {
        routeId,
        error,
      });
      loadErrors.push('题库模块');
    } finally {
      if (loadErrors.length > 0) {
        setModulePickerMessage(`${loadErrors.join('、')}加载失败，已显示可用模块。`);
      }
      setIsModuleOptionsLoading(false);
    }
  }, [routeId]);

  const loadCustomErrorReasonsForMetadataEditor = useCallback(async () => {
    try {
      const reasons = await CustomErrorReasonService.listCustomErrorReasons();
      setCustomErrorReasons(reasons);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Failed to load custom error reasons for metadata editor.', {
        routeId,
        error,
      });
      setMetadataEditorMessage('自定义错因加载失败，已显示默认错因。');
    }
  }, [routeId]);

  const handleOpenNoteModal = useCallback(() => {
    if (state.kind !== 'success' || isDeletingMistake) {
      return;
    }
    setNoteInput(clampNoteDraft(state.detail.note ?? ''));
    setNoteHighlightsInput(normalizeTextHighlights(state.detail.noteHighlights ?? [], state.detail.note ?? ''));
    setNoteModalMessage(null);
    setIsNoteModalVisible(true);
  }, [isDeletingMistake, state]);

  const handleCloseNoteModal = useCallback(() => {
    if (isSavingNote) {
      return;
    }
    if (state.kind === 'success') {
      setNoteInput(clampNoteDraft(state.detail.note ?? ''));
      setNoteHighlightsInput(normalizeTextHighlights(state.detail.noteHighlights ?? [], state.detail.note ?? ''));
    }
    setNoteModalMessage(null);
    setIsNoteModalVisible(false);
  }, [isSavingNote, state]);

  const handleSaveNote = useCallback(async (
    value: string,
    highlights: TextHighlightRange[],
  ): Promise<boolean> => {
    if (state.kind !== 'success' || isSavingNote) {
      return false;
    }

    const normalizedNextNote = normalizeNoteDraft(value);
    const normalizedCurrentNote = normalizeNoteDraft(state.detail.note ?? null);
    const normalizedNextHighlights = normalizeTextHighlights(highlights, normalizedNextNote);
    if (
      normalizedNextNote === normalizedCurrentNote
      && areTextHighlightsEqual(
        normalizedNextHighlights,
        state.detail.noteHighlights ?? [],
        normalizedNextNote,
      )
    ) {
      return true;
    }

    setIsSavingNote(true);
    setNoteModalMessage(null);
    try {
      const result = await MistakeDetailService.updateMistakeNote({
        mistakeId: state.detail.id,
        note: normalizedNextNote.length > 0 ? normalizedNextNote : null,
        noteHighlights: normalizedNextHighlights,
      });

      if (!result.ok || !result.detail) {
        const message = result.errorMessage ?? '备注保存失败，请重试。';
        setNoteModalMessage(message);
        showToast(message, 'error');
        return false;
      }

      setState({ kind: 'success', detail: result.detail });
      setNoteInput(clampNoteDraft(result.detail.note ?? ''));
      setNoteHighlightsInput(normalizeTextHighlights(result.detail.noteHighlights ?? [], result.detail.note ?? ''));
      showToast('备注已保存', 'success');
      return true;
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected error while updating note.', {
        routeId,
        error,
      });
      const message = error instanceof Error ? error.message : '备注保存失败，请重试。';
      setNoteModalMessage(message);
      showToast(message, 'error');
      return false;
    } finally {
      setIsSavingNote(false);
    }
  }, [isSavingNote, routeId, showToast, state]);

  const handleSaveNoteHighlights = useCallback(async (
    highlights: TextHighlightRange[],
  ): Promise<boolean> => {
    if (state.kind !== 'success' || isSavingNote) {
      return false;
    }

    const currentNote = normalizeNoteDraft(state.detail.note ?? null);
    const normalizedHighlights = normalizeTextHighlights(highlights, currentNote);
    if (areTextHighlightsEqual(normalizedHighlights, state.detail.noteHighlights ?? [], currentNote)) {
      return true;
    }

    setIsSavingNote(true);
    setNoteModalMessage(null);
    try {
      const result = await MistakeDetailService.updateMistakeNote({
        mistakeId: state.detail.id,
        note: currentNote.length > 0 ? currentNote : null,
        noteHighlights: normalizedHighlights,
      });

      if (!result.ok || !result.detail) {
        const message = result.errorMessage ?? '高亮保存失败，请重试。';
        setNoteModalMessage(message);
        showToast(message, 'error');
        return false;
      }

      setState({ kind: 'success', detail: result.detail });
      setNoteInput(clampNoteDraft(result.detail.note ?? ''));
      setNoteHighlightsInput(normalizeTextHighlights(result.detail.noteHighlights ?? [], result.detail.note ?? ''));
      showToast('高亮已保存', 'success');
      return true;
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected error while updating note highlights.', {
        routeId,
        error,
      });
      const message = error instanceof Error ? error.message : '高亮保存失败，请重试。';
      setNoteModalMessage(message);
      showToast(message, 'error');
      return false;
    } finally {
      setIsSavingNote(false);
    }
  }, [isSavingNote, routeId, showToast, state]);

  const clearVoicePlaybackResetTimer = useCallback(() => {
    if (voicePlaybackResetTimerRef.current) {
      clearTimeout(voicePlaybackResetTimerRef.current);
      voicePlaybackResetTimerRef.current = null;
    }
  }, []);

  const beginVoiceMusicInterruption = useCallback(() => {
    if (voiceMusicInterruptionActiveRef.current) {
      return;
    }
    voiceMusicInterruptionActiveRef.current = true;
    pauseForInterruption();
  }, [pauseForInterruption]);

  const endVoiceMusicInterruption = useCallback(() => {
    if (!voiceMusicInterruptionActiveRef.current) {
      return;
    }
    voiceMusicInterruptionActiveRef.current = false;
    void resumeAfterInterruption();
  }, [resumeAfterInterruption]);

  const stopVoicePlayback = useCallback(
    async (showErrorToast = false) => {
      clearVoicePlaybackResetTimer();
      setActiveVoiceRecordId(null);

      const stopResult = await VoiceNoteService.stopPlaying();
      endVoiceMusicInterruption();
      if (!stopResult.ok) {
        Logger.warn(PAGE_SCOPE, 'Failed to stop detail review voice playback.', {
          errorMessage: stopResult.errorMessage ?? null,
        });
        if (showErrorToast) {
          showToast(toBriefErrorMessage(stopResult.errorMessage), 'error');
        }
      }
    },
    [clearVoicePlaybackResetTimer, endVoiceMusicInterruption, showToast],
  );

  const clearVoiceRecordingState = useCallback(() => {
    setActiveVoiceRecordingRecordId(null);
    setRecordingElapsedMs(0);
    setIsVoiceRecordingBusy(false);
    voiceRecordingStartedAtRef.current = null;
    voiceStopInProgressRef.current = false;
  }, []);

  const discardVoiceRecording = useCallback(async () => {
    if (!activeVoiceRecordingRecordId) {
      clearVoiceRecordingState();
      endVoiceMusicInterruption();
      return true;
    }

    const discardResult = await VoiceNoteService.stopAndDiscardRecording();
    endVoiceMusicInterruption();
    if (!discardResult.ok) {
      Logger.warn(PAGE_SCOPE, 'Failed to discard detail review voice recording.', {
        reviewRecordId: activeVoiceRecordingRecordId,
        errorMessage: discardResult.errorMessage ?? null,
      });
      clearVoiceRecordingState();
      return false;
    }

    clearVoiceRecordingState();
    return true;
  }, [
    activeVoiceRecordingRecordId,
    clearVoiceRecordingState,
    endVoiceMusicInterruption,
  ]);

  const confirmLeaveWhileRecording = useCallback(
    (onContinue: () => void) => {
      Alert.alert(
        '正在录音',
        '正在录音，离开后将放弃本次录音，是否继续？',
        [
          {
            text: '继续录音',
            style: 'cancel',
          },
          {
            text: '继续离开',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                const discarded = await discardVoiceRecording();
                if (discarded) {
                  showToast('已放弃本次录音', 'info', TOAST_DURATION_SHORT);
                }
                onContinue();
              })();
            },
          },
        ],
      );
    },
    [discardVoiceRecording, showToast],
  );

  const handleBack = useCallback(() => {
    if (!activeVoiceRecordingRecordId) {
      navigateBack();
      return;
    }

    confirmLeaveWhileRecording(() => {
      allowNextLeaveRef.current = true;
      navigateBack();
    });
  }, [activeVoiceRecordingRecordId, confirmLeaveWhileRecording, navigateBack]);

  const handleCloseImageBrowser = useCallback(() => {
    setImageBrowserVisible(false);
  }, []);

  const openImageBrowser = useCallback((targetImageId: string) => {
    if (state.kind !== 'success') {
      return;
    }

    const previewItems = buildDetailImagePreviewItems(state.detail);
    if (previewItems.length <= 0) {
      return;
    }

    const targetIndex = previewItems.findIndex((item) => item.id === targetImageId);
    setImageBrowserItems(previewItems);
    setImageBrowserInitialIndex(targetIndex >= 0 ? targetIndex : 0);
    setImageBrowserVisible(true);
  }, [state]);

  const showImageBrowserActionToast = useCallback(
    (
      browserToast: MistakeImageBrowserLongPressHelpers['showToast'] | undefined,
      message: string,
      type: ToastType = 'info',
      duration = TOAST_DURATION_DEFAULT,
    ) => {
      if (browserToast) {
        browserToast(message);
        return;
      }

      showToast(message, type, duration);
    },
    [showToast],
  );

  const handleSaveBrowserImage = useCallback(
    (
      item: MistakeImageBrowserItem,
      browserToast?: MistakeImageBrowserLongPressHelpers['showToast'],
    ) => {
      if (activeImageBrowserAction !== null) {
        showImageBrowserActionToast(
          browserToast,
          '正在处理图片，请稍后...',
          'info',
          TOAST_DURATION_SHORT,
        );
        return;
      }

      setActiveImageBrowserAction('save');
      void (async () => {
        try {
          const result = await ImageService.saveLocalImageToGallery(item.uri);
          if (result.success) {
            showImageBrowserActionToast(browserToast, '保存成功', 'success');
            return;
          }

          showImageBrowserActionToast(
            browserToast,
            result.message || '保存图片失败，请稍后重试。',
            'error',
            TOAST_DURATION_LONG,
          );
        } catch (error) {
          Logger.error(PAGE_SCOPE, 'Unexpected error while saving browser image.', {
            itemId: item.id,
            title: item.title,
            error,
          });
          showImageBrowserActionToast(
            browserToast,
            '保存图片失败，请稍后重试。',
            'error',
            TOAST_DURATION_LONG,
          );
        } finally {
          setActiveImageBrowserAction(null);
        }
      })();
    },
    [activeImageBrowserAction, showImageBrowserActionToast],
  );

  const handleShareBrowserImage = useCallback(
    (
      item: MistakeImageBrowserItem,
      browserToast?: MistakeImageBrowserLongPressHelpers['showToast'],
    ) => {
      if (activeImageBrowserAction !== null) {
        showImageBrowserActionToast(
          browserToast,
          '正在处理图片，请稍后...',
          'info',
          TOAST_DURATION_SHORT,
        );
        return;
      }

      setActiveImageBrowserAction('share');
      void (async () => {
        try {
          const result = await ImageService.shareLocalImage(item.uri);
          if (result.success) {
            return;
          }

          if (result.reason === 'cancelled') {
            return;
          }

          showImageBrowserActionToast(
            browserToast,
            result.message || '分享图片失败，请稍后重试。',
            'error',
            TOAST_DURATION_LONG,
          );
        } catch (error) {
          Logger.error(PAGE_SCOPE, 'Unexpected error while sharing browser image.', {
            itemId: item.id,
            title: item.title,
            error,
          });
          showImageBrowserActionToast(
            browserToast,
            '分享图片失败，请稍后重试。',
            'error',
            TOAST_DURATION_LONG,
          );
        } finally {
          setActiveImageBrowserAction(null);
        }
      })();
    },
    [activeImageBrowserAction, showImageBrowserActionToast],
  );

  const handleImageBrowserLongPress = useCallback(
    (
      item: MistakeImageBrowserItem,
      helpers: MistakeImageBrowserLongPressHelpers,
    ) => {
      if (activeImageBrowserAction !== null) {
        showImageBrowserActionToast(
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
          onPress: () => handleShareBrowserImage(item, helpers.showToast),
        },
        {
          text: '保存图片',
          onPress: () => handleSaveBrowserImage(item, helpers.showToast),
        },
        {
          text: '取消',
          style: 'cancel',
        },
      ], { cancelable: true });
    },
    [
      activeImageBrowserAction,
      handleSaveBrowserImage,
      handleShareBrowserImage,
      showImageBrowserActionToast,
    ],
  );

  const refreshDetail = useCallback(async () => {
    if (!routeId) {
      return;
    }

    const result = await MistakeDetailService.getMistakeDetail(routeId);
    if (result.ok && result.detail) {
      setState({
        kind: 'success',
        detail: result.detail,
      });
      return;
    }

    Logger.warn(PAGE_SCOPE, 'Skip updating detail snapshot because refresh failed.', {
      routeId,
      errorMessage: result.errorMessage ?? null,
    });
  }, [routeId]);

  const loadBrowseContext = useCallback(async (detail: MistakeDetailViewModel) => {
    const requestId = browseRequestIdRef.current + 1;
    browseRequestIdRef.current = requestId;

    const context = await MistakeDetailService.getDetailBrowseContext({
      mistakeId: detail.id,
      module: detail.module,
    });
    if (requestId !== browseRequestIdRef.current) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'detail_browse_context_loaded', {
      mistakeId: detail.id,
      module: detail.module,
      mode: context.mode,
      totalIds: context.ids.length,
      currentIndex: context.currentIndex,
    });
    setBrowseContext(context);
  }, []);

  useEffect(() => {
    if (state.kind !== 'success') {
      setBrowseContext(EMPTY_BROWSE_CONTEXT);
      return;
    }

    void loadBrowseContext(state.detail);
  }, [loadBrowseContext, state]);

  const promptOpenSettings = useCallback((source: ReviewImageSource) => {
    const message =
      source === 'camera'
        ? '需要相机权限才能拍照添加复做图片，请到系统设置中开启。'
        : '需要相册权限才能选择复做图片，请到系统设置中开启。';

    Alert.alert('权限受限', message, [
      { text: '取消', style: 'cancel' },
      {
        text: '去设置',
        onPress: () => {
          void Linking.openSettings();
        },
      },
    ]);
  }, []);

  const handlePickAndPersistReviewImage = useCallback(
    async (record: DetailReviewRecordItem, source: ReviewImageSource, successMessage: string) => {
      if (state.kind !== 'success') {
        return;
      }
      if (activeReviewRecordId !== null) {
        return;
      }

      setActiveReviewRecordId(record.id);
      try {
        const saveResult =
          source === 'camera'
            ? await ImageService.takePhotoAndSave({
                mistakeId: state.detail.id,
                type: 'review_solution',
              })
            : await ImageService.pickImageAndSave({
                mistakeId: state.detail.id,
                type: 'review_solution',
              });

        const savedUri = normalizePreviewUri(saveResult.image?.uri);
        const normalizedError = normalizeErrorMessage(saveResult.errorMessage);
        if (!saveResult.ok || !savedUri) {
          if (isCancelLikeMessage(normalizedError)) {
            Logger.info(PAGE_SCOPE, 'User canceled selecting review record image.', {
              mistakeId: state.detail.id,
              reviewRecordId: record.id,
              source,
            });
            return;
          }

          if (source === 'camera' && isCameraPermissionDenied(normalizedError)) {
            showToast('需要相机权限才能拍照添加复做图片。', 'error');
            if (shouldPromptOpenSettings(normalizedError)) {
              promptOpenSettings('camera');
            }
            return;
          }

          if (source === 'album' && isMediaLibraryPermissionDenied(normalizedError)) {
            showToast('需要相册权限才能选择复做图片。', 'error');
            if (shouldPromptOpenSettings(normalizedError)) {
              promptOpenSettings('album');
            }
            return;
          }

          if (shouldPromptOpenSettings(normalizedError)) {
            promptOpenSettings(source);
            return;
          }

          showToast('图片保存失败，请重试。', 'error');
          return;
        }

        const persistResult = await ReviewRecordImageService.updateReviewRecordImage({
          mistakeId: state.detail.id,
          reviewRecordId: record.id,
          imageUri: savedUri,
        });
        if (!persistResult.ok) {
          showToast(persistResult.errorMessage ?? '复做图片更新失败，请重试。', 'error');
          return;
        }

        await refreshDetail();
        showToast(successMessage, 'success');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to update review record image.', {
          mistakeId: state.kind === 'success' ? state.detail.id : null,
          reviewRecordId: record.id,
          source,
          error,
        });
        showToast('复做图片更新失败，请重试。', 'error');
      } finally {
        setActiveReviewRecordId(null);
      }
    },
    [activeReviewRecordId, promptOpenSettings, refreshDetail, showToast, state],
  );

  const handleAddReviewImage = useCallback(
    async (record: DetailReviewRecordItem, source: ReviewImageSource) => {
      await handlePickAndPersistReviewImage(record, source, '复做图片已添加');
    },
    [handlePickAndPersistReviewImage],
  );

  const handleReplaceReviewImage = useCallback(
    async (record: DetailReviewRecordItem, source: ReviewImageSource) => {
      await handlePickAndPersistReviewImage(record, source, '复做图片已更新');
    },
    [handlePickAndPersistReviewImage],
  );

  const handleDeleteReviewImage = useCallback(
    async (record: DetailReviewRecordItem) => {
      if (state.kind !== 'success') {
        return;
      }
      if (activeReviewRecordId !== null) {
        return;
      }

      setActiveReviewRecordId(record.id);
      try {
        const removeResult = await ReviewRecordImageService.removeReviewRecordImage({
          mistakeId: state.detail.id,
          reviewRecordId: record.id,
        });
        if (!removeResult.ok) {
          showToast(removeResult.errorMessage ?? '复做图片更新失败，请重试。', 'error');
          return;
        }

        await refreshDetail();
        showToast('复做图片已删除', 'info');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Failed to remove review record image.', {
          mistakeId: state.kind === 'success' ? state.detail.id : null,
          reviewRecordId: record.id,
          error,
        });
        showToast('复做图片更新失败，请重试。', 'error');
      } finally {
        setActiveReviewRecordId(null);
      }
    },
    [activeReviewRecordId, refreshDetail, showToast, state],
  );

  const openReviewImagePickerActionSheet = useCallback(
    (record: DetailReviewRecordItem, mode: 'add' | 'replace') => {
      const isAddMode = mode === 'add';
      Alert.alert(
        isAddMode ? '添加复做图片' : '替换复做图片',
        isAddMode ? '只会关联到这条复做记录。' : '只会替换这条复做记录的图片。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '拍照',
            onPress: () => {
              if (isAddMode) {
                void handleAddReviewImage(record, 'camera');
                return;
              }
              void handleReplaceReviewImage(record, 'camera');
            },
          },
          {
            text: '从相册选择',
            onPress: () => {
              if (isAddMode) {
                void handleAddReviewImage(record, 'album');
                return;
              }
              void handleReplaceReviewImage(record, 'album');
            },
          },
        ],
      );
    },
    [handleAddReviewImage, handleReplaceReviewImage],
  );

  const handleEditReviewImage = useCallback(
    (record: DetailReviewRecordItem) => {
      if (state.kind !== 'success') {
        return;
      }

      const normalizedUri = normalizePreviewUri(record.solutionImageUri);
      if (!normalizedUri || record.solutionImageExists === false) {
        showToast('图片不可用，请重新添加。', 'info');
        return;
      }

      Logger.info(PAGE_SCOPE, 'Edit review record image clicked.', {
        mistakeId: state.detail.id,
        reviewRecordId: record.id,
        reviewIndex: record.reviewIndex,
        sourceUriLength: normalizedUri.length,
      });

      router.push(
        {
          pathname: '/mistake/[id]/image-edit',
          params: {
            id: state.detail.id,
            imageType: 'review_solution',
            imageSlot: 'solution',
            sourceUri: normalizedUri,
            oldImageUri: normalizedUri,
            reviewRecordId: record.id,
          },
        } as never,
      );
    },
    [router, showToast, state],
  );

  const handleOpenReviewImageActions = useCallback(
    (record: DetailReviewRecordItem) => {
      Alert.alert('复做图片操作', '请选择操作', [
        { text: '取消', style: 'cancel' },
        {
          text: '编辑',
          onPress: () => {
            handleEditReviewImage(record);
          },
        },
        {
          text: '删除照片',
          style: 'destructive',
          onPress: () => {
            Alert.alert('删除复做图片？', '只会删除这条复做记录的图片，不会删除复做记录。', [
              { text: '取消', style: 'cancel' },
              {
                text: '删除',
                style: 'destructive',
                onPress: () => {
                  void handleDeleteReviewImage(record);
                },
              },
            ]);
          },
        },
      ]);
    },
    [handleDeleteReviewImage, handleEditReviewImage],
  );

  const handleStartReviewVoiceRecording = useCallback(
    async (record: DetailReviewRecordItem) => {
      if (state.kind !== 'success') {
        return;
      }
      if (record.voiceNote) {
        return;
      }
      if (
        isVoicePlaybackBusy
        || isVoiceRecordingBusy
        || !!activeVoiceRecordingRecordId
      ) {
        return;
      }

      setIsVoiceRecordingBusy(true);
      await stopVoicePlayback(false);

      const permissionResult = await VoiceNoteService.requestPermission();
      if (!permissionResult.granted) {
        Logger.warn(PAGE_SCOPE, 'start_recording', {
          granted: false,
          canAskAgain: permissionResult.canAskAgain,
          status: permissionResult.status,
          permissionErrorMessage: permissionResult.errorMessage ?? null,
          reviewRecordId: record.id,
        });
        showToast('未获得麦克风权限，无法开始录音。', 'error', TOAST_DURATION_LONG);
        setIsVoiceRecordingBusy(false);
        return;
      }

      beginVoiceMusicInterruption();
      const startResult = await VoiceNoteService.startRecording();
      if (!startResult.ok) {
        endVoiceMusicInterruption();
        Logger.warn(PAGE_SCOPE, 'start_recording', {
          granted: true,
          ok: false,
          reviewRecordId: record.id,
          errorMessage: startResult.errorMessage ?? null,
        });
        showToast(toBriefErrorMessage(startResult.errorMessage), 'error', TOAST_DURATION_LONG);
        setIsVoiceRecordingBusy(false);
        return;
      }

      setActiveVoiceRecordingRecordId(record.id);
      setRecordingElapsedMs(0);
      voiceRecordingStartedAtRef.current = Date.now();
      voiceStopInProgressRef.current = false;
      setIsVoiceRecordingBusy(false);
    },
    [
      activeVoiceRecordingRecordId,
      beginVoiceMusicInterruption,
      endVoiceMusicInterruption,
      isVoicePlaybackBusy,
      isVoiceRecordingBusy,
      showToast,
      state.kind,
      stopVoicePlayback,
    ],
  );

  const handleStopAndSaveReviewVoiceRecording = useCallback(
    async (
      record: DetailReviewRecordItem,
      trigger: 'manual' | 'auto_limit' = 'manual',
    ) => {
      if (state.kind !== 'success') {
        return;
      }
      if (activeVoiceRecordingRecordId !== record.id) {
        return;
      }
      if (isVoiceRecordingBusy || voiceStopInProgressRef.current) {
        return;
      }

      voiceStopInProgressRef.current = true;
      setIsVoiceRecordingBusy(true);

      const saveResult = await VoiceNoteService.stopAndSaveRecording();
      endVoiceMusicInterruption();
      const boundReviewRecordId = record.id;
      setActiveVoiceRecordingRecordId(null);
      setRecordingElapsedMs(0);
      voiceRecordingStartedAtRef.current = null;

      if (!saveResult.ok) {
        Logger.warn(PAGE_SCOPE, 'stop_recording_failed', {
          trigger,
          reason: 'stop_and_save_failed',
          reviewRecordId: boundReviewRecordId,
          errorMessage: saveResult.errorMessage ?? null,
        });
        showToast(toBriefErrorMessage(saveResult.errorMessage), 'error', TOAST_DURATION_LONG);
        setIsVoiceRecordingBusy(false);
        voiceStopInProgressRef.current = false;
        return;
      }

      const nextVoiceNote = saveResult.voiceNote;
      if (nextVoiceNote.durationMs < VOICE_RECORDING_MIN_DURATION_MS) {
        Logger.info(PAGE_SCOPE, 'stop_recording_failed', {
          trigger,
          reason: 'too_short',
          reviewRecordId: boundReviewRecordId,
          durationMs: nextVoiceNote.durationMs,
          minimumDurationMs: VOICE_RECORDING_MIN_DURATION_MS,
        });
        void VoiceNoteService.deleteVoiceNote(nextVoiceNote.fileUri);
        showToast('录音时间太短，请至少讲3秒', 'info', TOAST_DURATION_LONG);
        setIsVoiceRecordingBusy(false);
        voiceStopInProgressRef.current = false;
        return;
      }

      const reviewRecordVoiceNote = toReviewRecordVoiceNote(nextVoiceNote);
      if (!reviewRecordVoiceNote) {
        void VoiceNoteService.deleteVoiceNote(nextVoiceNote.fileUri);
        showToast('语音讲解保存失败，请重试。', 'error', TOAST_DURATION_LONG);
        setIsVoiceRecordingBusy(false);
        voiceStopInProgressRef.current = false;
        return;
      }

      const persistResult = await ReviewRecordVoiceService.upsertReviewRecordVoiceNote({
        mistakeId: state.detail.id,
        reviewRecordId: boundReviewRecordId,
        voiceNote: reviewRecordVoiceNote,
      });
      if (!persistResult.ok) {
        void VoiceNoteService.deleteVoiceNote(nextVoiceNote.fileUri);
        showToast(persistResult.errorMessage ?? '语音讲解保存失败，请重试。', 'error', TOAST_DURATION_LONG);
        setIsVoiceRecordingBusy(false);
        voiceStopInProgressRef.current = false;
        return;
      }

      await refreshDetail();
      if (trigger === 'auto_limit') {
        showToast('已达到3分钟上限，语音讲解已保存', 'success', TOAST_DURATION_LONG);
      } else {
        showToast('语音讲解已保存', 'success');
      }
      setIsVoiceRecordingBusy(false);
      voiceStopInProgressRef.current = false;
    },
    [
      activeVoiceRecordingRecordId,
      endVoiceMusicInterruption,
      isVoiceRecordingBusy,
      refreshDetail,
      showToast,
      state,
    ],
  );

  const handleToggleReviewVoicePlayback = useCallback(
    async (record: DetailReviewRecordItem) => {
      const voiceNote = record.voiceNote ?? null;
      if (!voiceNote || isVoicePlaybackBusy || !!activeVoiceRecordingRecordId) {
        return;
      }

      if (activeVoiceRecordId === record.id) {
        setIsVoicePlaybackBusy(true);
        await stopVoicePlayback(true);
        setIsVoicePlaybackBusy(false);
        return;
      }

      const fileUri = normalizePreviewUri(voiceNote.fileUri);
      if (!fileUri) {
        Logger.warn(PAGE_SCOPE, 'voice_note_file_missing', {
          reviewRecordId: record.id,
          reviewIndex: record.reviewIndex,
          voiceNoteId: voiceNote.id,
        });
        showToast(VOICE_FILE_MISSING_MESSAGE, 'info');
        return;
      }

      setIsVoicePlaybackBusy(true);

      const fileInfoResult = await VoiceNoteService.getVoiceNoteFileInfo(fileUri);
      if (!fileInfoResult.info.exists) {
        Logger.warn(PAGE_SCOPE, 'voice_note_file_missing', {
          reviewRecordId: record.id,
          reviewIndex: record.reviewIndex,
          voiceNoteId: voiceNote.id,
        });
        showToast(VOICE_FILE_MISSING_MESSAGE, 'info');
        setIsVoicePlaybackBusy(false);
        return;
      }

      if (!fileInfoResult.ok) {
        Logger.warn(PAGE_SCOPE, 'Voice file info read failed before detail review playback.', {
          reviewRecordId: record.id,
          reviewIndex: record.reviewIndex,
          voiceNoteId: voiceNote.id,
          errorMessage: fileInfoResult.errorMessage ?? null,
        });
      }

      beginVoiceMusicInterruption();
      const playResult = await VoiceNoteService.playVoiceNote(fileUri);
      if (!playResult.ok) {
        endVoiceMusicInterruption();
        setActiveVoiceRecordId(null);
        const isFileMissing = playResult.errorMessage?.includes('语音文件不存在');
        if (isFileMissing) {
          Logger.warn(PAGE_SCOPE, 'voice_note_file_missing', {
            reviewRecordId: record.id,
            reviewIndex: record.reviewIndex,
            voiceNoteId: voiceNote.id,
            fileUri,
          });
        }
        showToast(toBriefErrorMessage(playResult.errorMessage), 'error');
        setIsVoicePlaybackBusy(false);
        return;
      }

      clearVoicePlaybackResetTimer();
      setActiveVoiceRecordId(record.id);
      voicePlaybackResetTimerRef.current = setTimeout(() => {
        setActiveVoiceRecordId((current) => (current === record.id ? null : current));
        voicePlaybackResetTimerRef.current = null;
        endVoiceMusicInterruption();
      }, Math.max(voiceNote.durationMs + VOICE_PLAYBACK_END_BUFFER_MS, 1000));

      setIsVoicePlaybackBusy(false);
    },
    [
      activeVoiceRecordingRecordId,
      activeVoiceRecordId,
      beginVoiceMusicInterruption,
      clearVoicePlaybackResetTimer,
      endVoiceMusicInterruption,
      isVoicePlaybackBusy,
      showToast,
      stopVoicePlayback,
    ],
  );

  const handleOpenReviewTextEditor = useCallback(
    (record: DetailReviewRecordItem) => {
      if (state.kind !== 'success' || isSavingReviewText) {
        return;
      }
      if (activeVoiceRecordingRecordId !== null || isVoiceRecordingBusy) {
        showToast('正在录音，请先保存语音讲解后再补充文本。', 'info');
        return;
      }

      const belongsToCurrentDetail = state.detail.reviewRecords.some((item) => item.id === record.id);
      if (!belongsToCurrentDetail) {
        showToast('复做记录已变化，请刷新后重试。', 'info');
        return;
      }

      setReviewTextEditorRecordId(record.id);
      setReviewTextEditorMessage(null);
    },
    [
      activeVoiceRecordingRecordId,
      isSavingReviewText,
      isVoiceRecordingBusy,
      showToast,
      state,
    ],
  );

  const handleCloseReviewTextEditor = useCallback(() => {
    if (isSavingReviewText) {
      return;
    }
    setReviewTextEditorRecordId(null);
    setReviewTextEditorMessage(null);
  }, [isSavingReviewText]);

  const handleSaveReviewText = useCallback(async (
    value: string,
    highlights: TextHighlightRange[],
  ): Promise<boolean> => {
    if (state.kind !== 'success' || !reviewTextEditorRecordId || isSavingReviewText) {
      return false;
    }

    const note = value.trim();
    const normalizedHighlights = normalizeTextHighlights(highlights, note);
    if (note.length > REVIEW_TEXT_NOTE_MAX_LENGTH) {
      setReviewTextEditorMessage(`文本讲解不能超过 ${REVIEW_TEXT_NOTE_MAX_LENGTH} 字。`);
      return false;
    }

    const targetRecord = state.detail.reviewRecords.find(
      (record) => record.id === reviewTextEditorRecordId,
    );
    if (!targetRecord) {
      setReviewTextEditorMessage('复做记录不存在，请刷新后重试。');
      return false;
    }

    setIsSavingReviewText(true);
    setReviewTextEditorMessage(null);
    const saveResult = await ReviewRecordTextService.upsertReviewRecordText({
      mistakeId: state.detail.id,
      reviewRecordId: targetRecord.id,
      note,
      noteHighlights: normalizedHighlights,
    });

    if (!saveResult.ok) {
      setReviewTextEditorMessage(saveResult.errorMessage ?? '文本讲解保存失败，请重试。');
      setIsSavingReviewText(false);
      return false;
    }

    const savedNote = saveResult.note;
    const savedHighlights = saveResult.noteHighlights;
    setState((current) => {
      if (current.kind !== 'success' || current.detail.id !== state.detail.id) {
        return current;
      }
      return {
        kind: 'success',
        detail: {
          ...current.detail,
          reviewRecords: current.detail.reviewRecords.map((record) =>
            record.id === targetRecord.id
              ? { ...record, note: savedNote, noteHighlights: savedHighlights }
              : record,
          ),
        },
      };
    });
    setIsSavingReviewText(false);
    setReviewTextEditorMessage(null);
    showToast(savedNote ? '文本讲解已保存' : '文本讲解已清空', 'success');
    return true;
  }, [
    isSavingReviewText,
    reviewTextEditorRecordId,
    showToast,
    state,
  ]);

  const handleSaveReviewTextHighlights = useCallback(async (
    highlights: TextHighlightRange[],
  ): Promise<boolean> => {
    if (state.kind !== 'success' || !reviewTextEditorRecordId || isSavingReviewText) {
      return false;
    }

    const targetRecord = state.detail.reviewRecords.find(
      (record) => record.id === reviewTextEditorRecordId,
    );
    if (!targetRecord) {
      setReviewTextEditorMessage('复做记录不存在，请刷新后重试。');
      return false;
    }

    const note = typeof targetRecord.note === 'string' ? targetRecord.note.trim() : '';
    const normalizedHighlights = normalizeTextHighlights(highlights, note);
    if (areTextHighlightsEqual(normalizedHighlights, targetRecord.noteHighlights ?? [], note)) {
      return true;
    }

    setIsSavingReviewText(true);
    setReviewTextEditorMessage(null);
    const saveResult = await ReviewRecordTextService.upsertReviewRecordText({
      mistakeId: state.detail.id,
      reviewRecordId: targetRecord.id,
      note,
      noteHighlights: normalizedHighlights,
    });

    if (!saveResult.ok) {
      setReviewTextEditorMessage(saveResult.errorMessage ?? '高亮保存失败，请重试。');
      setIsSavingReviewText(false);
      return false;
    }

    setState((current) => {
      if (current.kind !== 'success' || current.detail.id !== state.detail.id) {
        return current;
      }
      return {
        kind: 'success',
        detail: {
          ...current.detail,
          reviewRecords: current.detail.reviewRecords.map((record) =>
            record.id === targetRecord.id
              ? { ...record, note: saveResult.note, noteHighlights: saveResult.noteHighlights }
              : record,
          ),
        },
      };
    });
    setIsSavingReviewText(false);
    setReviewTextEditorMessage(null);
    showToast('高亮已保存', 'success');
    return true;
  }, [
    isSavingReviewText,
    reviewTextEditorRecordId,
    showToast,
    state,
  ]);

  const isReviewRecordImageBusy = useCallback(
    (reviewRecordId: string) => activeReviewRecordId === reviewRecordId,
    [activeReviewRecordId],
  );

  const loadDetail = useCallback(
    async (options?: { keepCurrent?: boolean }) => {
      const keepCurrent = options?.keepCurrent ?? false;

      if (!routeId) {
        Logger.error(PAGE_SCOPE, 'Invalid route id while loading detail.', { id });
        setIsRefreshing(false);
        setState({
          kind: 'error',
          message: '错题 id 无效，请返回重试。',
        });
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (keepCurrent) {
        setIsRefreshing(true);
      } else {
        setIsRefreshing(false);
        setState({ kind: 'loading' });
      }

      let result: Awaited<ReturnType<typeof MistakeDetailService.getMistakeDetail>>;
      try {
        result = await MistakeDetailService.getMistakeDetail(routeId);
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setIsRefreshing(false);
        Logger.error(PAGE_SCOPE, 'Unexpected error while loading detail.', {
          id: routeId,
          error,
        });
        setState({
          kind: 'error',
          message: toBriefErrorMessage(error instanceof Error ? error.message : String(error)),
        });
        return;
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      setIsRefreshing(false);

      if (result.ok && result.detail) {
        setState({
          kind: 'success',
          detail: result.detail,
        });
        return;
      }

      if (result.notFound) {
        setState({
          kind: 'notFound',
          message: '没有找到这道错题。',
        });
        return;
      }

      Logger.error(PAGE_SCOPE, 'Failed to load mistake detail.', {
        id: routeId,
        errorMessage: result.errorMessage,
      });

      setState({
        kind: 'error',
        message: toBriefErrorMessage(result.errorMessage),
      });
    },
    [id, routeId],
  );

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!activeVoiceRecordingRecordId) {
      return;
    }

    const updateTimer = () => {
      const startedAt = voiceRecordingStartedAtRef.current;
      if (!startedAt) {
        return;
      }
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const roundedElapsedMs = Math.floor(elapsedMs / 1000) * 1000;
      setRecordingElapsedMs((current) => (current === roundedElapsedMs ? current : roundedElapsedMs));

      if (elapsedMs < VOICE_RECORDING_MAX_DURATION_MS || voiceStopInProgressRef.current) {
        return;
      }

      if (state.kind !== 'success') {
        return;
      }

      const targetRecord = state.detail.reviewRecords.find(
        (item) => item.id === activeVoiceRecordingRecordId,
      );
      if (!targetRecord) {
        return;
      }

      void handleStopAndSaveReviewVoiceRecording(targetRecord, 'auto_limit');
    };

    updateTimer();
    const intervalId = setInterval(updateTimer, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [
    activeVoiceRecordingRecordId,
    handleStopAndSaveReviewVoiceRecording,
    state,
  ]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBack();
        return true;
      });

      return () => {
        subscription.remove();
      };
    }, [handleBack]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return undefined;
      }

      void loadDetail({ keepCurrent: true });
      return undefined;
    }, [loadDetail]),
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowNextLeaveRef.current) {
        allowNextLeaveRef.current = false;
        return;
      }

      if (!activeVoiceRecordingRecordId) {
        return;
      }

      event.preventDefault();
      confirmLeaveWhileRecording(() => {
        allowNextLeaveRef.current = true;
        navigation.dispatch(event.data.action);
      });
    });

    return unsubscribe;
  }, [activeVoiceRecordingRecordId, confirmLeaveWhileRecording, navigation]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        clearVoicePlaybackResetTimer();
        setActiveVoiceRecordId(null);
        setIsVoicePlaybackBusy(false);
        clearVoiceRecordingState();
        void Promise.all([
          VoiceNoteService.stopPlaying(),
          VoiceNoteService.stopAndDiscardRecording(),
        ]).finally(endVoiceMusicInterruption);
      };
    }, [
      clearVoicePlaybackResetTimer,
      clearVoiceRecordingState,
      endVoiceMusicInterruption,
    ]),
  );

  useEffect(
    () => () => {
      if (titleTapTimerRef.current) {
        clearTimeout(titleTapTimerRef.current);
        titleTapTimerRef.current = null;
      }
      if (voicePlaybackResetTimerRef.current) {
        clearTimeout(voicePlaybackResetTimerRef.current);
        voicePlaybackResetTimerRef.current = null;
      }
      if (anchorHighlightTimerRef.current) {
        clearTimeout(anchorHighlightTimerRef.current);
        anchorHighlightTimerRef.current = null;
      }
      voiceRecordingStartedAtRef.current = null;
      voiceStopInProgressRef.current = false;
      void Promise.all([
        VoiceNoteService.stopPlaying(),
        VoiceNoteService.stopAndDiscardRecording(),
      ]).finally(endVoiceMusicInterruption);
    },
    [endVoiceMusicInterruption],
  );

  useEffect(() => {
    if (state.kind !== 'success') {
      return;
    }
    if (isTitleEditing) {
      return;
    }
    setTitleInput(state.detail.title);
  }, [isTitleEditing, state]);

  useEffect(() => {
    if (state.kind !== 'success') {
      setNoteInput('');
      setNoteHighlightsInput([]);
      setIsNoteModalVisible(false);
      setNoteModalMessage(null);
      return;
    }

    if (isNoteModalVisible || isSavingNote) {
      return;
    }

    const nextNoteInput = state.detail.note ?? '';
    setNoteInput((current) => (current === nextNoteInput ? current : nextNoteInput));
    const nextHighlights = normalizeTextHighlights(state.detail.noteHighlights ?? [], nextNoteInput);
    setNoteHighlightsInput((current) =>
      areTextHighlightsEqual(current, nextHighlights, nextNoteInput) ? current : nextHighlights,
    );
  }, [isNoteModalVisible, isSavingNote, state]);

  const detailSlots = state.kind === 'success' ? state.detail.imageSlots : [];

  const {
    orderedSlots,
    takePhotoType,
    pickImageType,
    deleteType,
    isTypeBusy,
    takePhotoForType,
    pickImageForType,
    deleteImageForType,
  } = useMistakeDetailImages({
    mistakeId: state.kind === 'success' ? state.detail.id : null,
    imageSlots: detailSlots,
    refreshDetail,
    showToast,
  });

  const managedSlots = useMemo(() => sortManagedImageSlots(orderedSlots), [orderedSlots]);
  const nextReviewInfo = useMemo(() => {
    if (state.kind !== 'success') {
      return null;
    }

    return resolveNextReviewAtText({
      reviewCount: state.detail.reviewCount,
      maxReviewCount: state.detail.maxReviewCount,
      nextReviewAt: state.detail.nextReviewAt ?? null,
    });
  }, [state]);

  const isDeleteMistakeDisabled =
    isDeletingMistake
    || isArchivingMistake
    || isJoiningReviewPlan
    || isRefreshing
    || isSavingModule
    || isSavingMetadata
    || isSavingTitle
    || isSavingNote
    || takePhotoType !== null
    || pickImageType !== null
    || deleteType !== null
    || activeReviewRecordId !== null
    || activeVoiceRecordingRecordId !== null
    || isVoiceRecordingBusy;
  const canStartDetailReview = useMemo(() => {
    if (state.kind !== 'success') {
      return false;
    }

    if (state.detail.status !== 'active') {
      return false;
    }

    if (browseContext.mode === 'today_due' && browseContext.ids.includes(state.detail.id)) {
      return true;
    }

    return isDueTodayOrBefore(state.detail.nextReviewAt);
  }, [browseContext.ids, browseContext.mode, state]);
  const isStartDetailReviewDisabled = isDeleteMistakeDisabled;
  const isJoinReviewPlanDisabled = isDeleteMistakeDisabled;
  const hasNoteContent = normalizeNoteDraft(noteInput).length > 0;
  const currentModule = state.kind === 'success' ? state.detail.module : null;
  const modulePickerOptions = useMemo(
    () => buildDetailModulePickerOptions(customModules, existingMistakeModules, currentModule),
    [customModules, existingMistakeModules, currentModule],
  );
  const isModulePickerBusy = isModuleOptionsLoading || isSavingModule;
  const isModuleChangeDisabled = isDeleteMistakeDisabled || isModulePickerBusy;
  const isMetadataChangeDisabled = isDeleteMistakeDisabled || isSavingMetadata;

  const handleOpenModulePicker = useCallback(() => {
    if (state.kind !== 'success') {
      return;
    }

    if (isModuleChangeDisabled) {
      if (activeVoiceRecordingRecordId !== null) {
        showToast('正在录音，请先结束或放弃录音后再修改模块。', 'info');
        return;
      }
      showToast('当前正在处理，请稍后再修改模块。', 'info');
      return;
    }

    setModulePickerMessage(null);
    setIsModulePickerVisible(true);
    void loadModuleOptionsForPicker();
  }, [
    activeVoiceRecordingRecordId,
    isModuleChangeDisabled,
    loadModuleOptionsForPicker,
    showToast,
    state,
  ]);

  const handleCloseModulePicker = useCallback(() => {
    if (isSavingModule) {
      return;
    }
    setIsModulePickerVisible(false);
  }, [isSavingModule]);

  const handleSelectModule = useCallback(
    async (moduleName: string) => {
      if (state.kind !== 'success' || isSavingModule) {
        return;
      }

      const nextModule = normalizeModuleNameForPicker(moduleName);
      if (!nextModule) {
        setModulePickerMessage('模块不能为空。');
        showToast('模块不能为空。', 'error');
        return;
      }

      const currentModuleName = normalizeModuleNameForPicker(state.detail.module);
      if (currentModuleName && toModulePickerKey(currentModuleName) === toModulePickerKey(nextModule)) {
        setIsModulePickerVisible(false);
        return;
      }

      setIsSavingModule(true);
      setModulePickerMessage(null);
      try {
        const result = await MistakeDetailService.updateMistakeModule({
          mistakeId: state.detail.id,
          module: nextModule,
        });

        if (!result.ok || !result.detail) {
          const message = result.errorMessage ?? '更新模块失败，请重试。';
          setModulePickerMessage(message);
          showToast(message, 'error', TOAST_DURATION_LONG);
          return;
        }

        const updatedDetail = result.detail;
        setState((current) => {
          if (current.kind !== 'success' || current.detail.id !== updatedDetail.id) {
            return current;
          }
          return {
            kind: 'success',
            detail: updatedDetail,
          };
        });
        setIsModulePickerVisible(false);
        showToast('模块已更新。', 'success');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'Unexpected error while updating module.', {
          routeId,
          module: nextModule,
          error,
        });
        const message = error instanceof Error ? error.message : '更新模块失败，请重试。';
        setModulePickerMessage(message);
        showToast(message, 'error', TOAST_DURATION_LONG);
      } finally {
        setIsSavingModule(false);
      }
    },
    [isSavingModule, routeId, showToast, state],
  );

  const handleOpenMetadataEditor = useCallback(() => {
    if (state.kind !== 'success') {
      return;
    }

    if (isMetadataChangeDisabled) {
      if (activeVoiceRecordingRecordId !== null) {
        showToast('正在录音，请先结束或放弃录音后再修改错因/难度。', 'info');
        return;
      }
      showToast('当前正在处理，请稍后再修改错因/难度。', 'info');
      return;
    }

    setMetadataDraft(buildMetadataDraft(state.detail));
    setMetadataEditorMessage(null);
    setIsMetadataEditorVisible(true);
    void loadCustomErrorReasonsForMetadataEditor();
  }, [
    activeVoiceRecordingRecordId,
    isMetadataChangeDisabled,
    loadCustomErrorReasonsForMetadataEditor,
    showToast,
    state,
  ]);

  const handleCloseMetadataEditor = useCallback(() => {
    if (isSavingMetadata) {
      return;
    }
    setIsMetadataEditorVisible(false);
    setMetadataEditorMessage(null);
    setMetadataDraft(null);
  }, [isSavingMetadata]);

  const handleSaveMetadata = useCallback(async () => {
    if (state.kind !== 'success' || !metadataDraft || isSavingMetadata) {
      return;
    }

    const nextDraft: DetailMetadataDraft = {
      errorReasonIds: [...metadataDraft.errorReasonIds],
      errorReasonLabels: metadataDraft.errorReasonLabels
        .map((label) => normalizeMetadataErrorReason(label))
        .filter((label): label is string => label !== null),
      difficulty: normalizeMetadataDifficulty(metadataDraft.difficulty),
    };
    const currentDraft = buildMetadataDraft(state.detail);
    if (
      nextDraft.errorReasonIds.join('|') === currentDraft.errorReasonIds.join('|')
      && nextDraft.errorReasonLabels.join('|') === currentDraft.errorReasonLabels.join('|')
      && nextDraft.difficulty === currentDraft.difficulty
    ) {
      handleCloseMetadataEditor();
      return;
    }

    setIsSavingMetadata(true);
    setMetadataEditorMessage(null);
    try {
      const result = await MistakeDetailService.updateMistakeMetadata({
        mistakeId: state.detail.id,
        errorReason: nextDraft.errorReasonLabels.join('、') || null,
        difficulty: nextDraft.difficulty,
      });

      if (!result.ok || !result.detail) {
        const message = result.errorMessage ?? '更新错因/难度失败，请重试。';
        setMetadataEditorMessage(message);
        showToast(message, 'error', TOAST_DURATION_LONG);
        return;
      }

      const updatedDetail = result.detail;
      setState((current) => {
        if (current.kind !== 'success' || current.detail.id !== updatedDetail.id) {
          return current;
        }
        return {
          kind: 'success',
          detail: updatedDetail,
        };
      });
      setIsMetadataEditorVisible(false);
      setMetadataDraft(null);
      showToast('错因/难度已更新。', 'success');
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected error while updating metadata.', {
        routeId,
        error,
      });
      const message = error instanceof Error ? error.message : '更新错因/难度失败，请重试。';
      setMetadataEditorMessage(message);
      showToast(message, 'error', TOAST_DURATION_LONG);
    } finally {
      setIsSavingMetadata(false);
    }
  }, [
    handleCloseMetadataEditor,
    isSavingMetadata,
    metadataDraft,
    routeId,
    showToast,
    state,
  ]);

  const updateDetailTags = useCallback((mistakeId: string, tags: MistakeTag[]) => {
    setState((current) => {
      if (current.kind !== 'success' || current.detail.id !== mistakeId) {
        return current;
      }
      return {
        kind: 'success',
        detail: {
          ...current.detail,
          tags,
        },
      };
    });
  }, []);

  const handleOpenTagAddModal = useCallback(() => {
    if (state.kind !== 'success') {
      return;
    }
    if (isDeletingMistake) {
      showToast('当前正在删除错题，请稍后再添加标签。', 'info');
      return;
    }

    setTagDraft('');
    setTagModalMessage(null);
    setTagSuggestions([]);
    setIsTagAddModalVisible(true);

    void MistakeTagService.getTagSuggestionsForMistake(state.detail.id).then((result) => {
      if (result.ok) {
        setTagSuggestions(result.suggestions ?? []);
      }
    });
  }, [isDeletingMistake, showToast, state]);

  const handleCloseTagAddModal = useCallback(() => {
    if (isSavingTag) {
      return;
    }
    setIsTagAddModalVisible(false);
    setTagDraft('');
    setTagModalMessage(null);
  }, [isSavingTag]);

  const handleSaveTag = useCallback(async () => {
    if (state.kind !== 'success' || isSavingTag) {
      return;
    }

    const tagName = MistakeTagService.normalizeMistakeTagName(tagDraft);
    const tagKey = MistakeTagService.normalizeMistakeTagKey(tagName);
    if (!tagName) {
      setTagModalMessage('标签不能为空。');
      return;
    }

    setIsSavingTag(true);
    setTagModalMessage(null);
    try {
      const result = await MistakeTagService.addMistakeTag({
        mistakeId: state.detail.id,
        name: tagName,
      });

      if (!result.ok || !result.tags) {
        const message = result.errorMessage ?? '添加标签失败，请重试。';
        setTagModalMessage(message);
        showToast(message, 'error', TOAST_DURATION_LONG);
        return;
      }

      updateDetailTags(state.detail.id, result.tags);
      setIsTagAddModalVisible(false);
      setTagDraft('');
      setTagSuggestions((current) =>
        current.filter(
          (item) =>
            MistakeTagService.normalizeMistakeTagKey(item)
            !== tagKey,
        ),
      );
      const existedBeforeSave = state.detail.tags.some((tag) => tag.normalized_name === tagKey);
      showToast(existedBeforeSave ? '标签已存在。' : '标签已添加。', 'success');
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected error while adding tag.', {
        routeId,
        error,
      });
      const message = error instanceof Error ? error.message : '添加标签失败，请重试。';
      setTagModalMessage(message);
      showToast(message, 'error', TOAST_DURATION_LONG);
    } finally {
      setIsSavingTag(false);
    }
  }, [
    isSavingTag,
    routeId,
    showToast,
    state,
    tagDraft,
    updateDetailTags,
  ]);

  const handleUseTagSuggestion = useCallback((tagName: string) => {
    setTagDraft(tagName);
    setTagModalMessage(null);
  }, []);

  const handleDeleteTag = useCallback(
    (tag: MistakeTag) => {
      if (state.kind !== 'success' || deletingTagId !== null || isSavingTag) {
        return;
      }

      Alert.alert('删除标签', `确认删除“${tag.name}”？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingTagId(tag.id);
              try {
                const result = await MistakeTagService.deleteMistakeTag({
                  mistakeId: state.detail.id,
                  tagId: tag.id,
                });
                if (!result.ok || !result.tags) {
                  showToast(result.errorMessage ?? '删除标签失败，请重试。', 'error', TOAST_DURATION_LONG);
                  return;
                }
                updateDetailTags(state.detail.id, result.tags);
                if (result.tags.length <= 0) {
                  setIsTagManageMode(false);
                }
                showToast('标签已删除。', 'success');
              } catch (error) {
                Logger.error(PAGE_SCOPE, 'Unexpected error while deleting tag.', {
                  routeId,
                  tagId: tag.id,
                  error,
                });
                const message = error instanceof Error ? error.message : '删除标签失败，请重试。';
                showToast(message, 'error', TOAST_DURATION_LONG);
              } finally {
                setDeletingTagId(null);
              }
            })();
          },
        },
      ]);
    },
    [
      deletingTagId,
      isSavingTag,
      routeId,
      showToast,
      state,
      updateDetailTags,
    ],
  );

  const handleStartDetailReview = useCallback(() => {
    if (state.kind !== 'success') {
      return;
    }

    if (!canStartDetailReview) {
      showToast('这道题当前不在今日待复做队列', 'info');
      return;
    }

    router.push({
      pathname: '/review/session',
      params: {
        initialMistakeId: state.detail.id,
      },
    } as never);
  }, [canStartDetailReview, router, showToast, state]);

  const handleJoinReviewPlanFromDetail = useCallback(() => {
    if (state.kind !== 'success' || state.detail.status !== 'collected' || isJoiningReviewPlan) {
      return;
    }

    setIsJoiningReviewPlan(true);
    void (async () => {
      try {
        const result = await MistakeDetailService.joinMistakeReviewPlan(state.detail.id);
        if (!result.ok || !result.detail) {
          showToast(result.errorMessage ?? '加入七刷失败，请稍后重试', 'error');
          return;
        }

        setState({
          kind: 'success',
          detail: result.detail,
        });
        showToast('已加入七刷，今天可复做', 'success');
      } catch (error) {
        Logger.error(PAGE_SCOPE, 'join review plan from detail failed.', {
          mistakeId: state.detail.id,
          error,
        });
        showToast('加入七刷失败，请稍后重试', 'error');
      } finally {
        setIsJoiningReviewPlan(false);
      }
    })();
  }, [isJoiningReviewPlan, showToast, state]);

  const handleOpenRelatedMistakes = useCallback(() => {
    if (state.kind !== 'success') {
      return;
    }

    router.push(`/mistake-related/${state.detail.id}` as never);
  }, [router, state]);

  const handleAddRelatedMistake = useCallback(() => {
    if (state.kind !== 'success') {
      return;
    }

    router.push(
      {
        pathname: '/mistake-related/add',
        params: {
          id: state.detail.id,
          mode: 'system',
        },
      } as never,
    );
  }, [router, state]);

  const handleOpenRelatedSourceMistake = useCallback(() => {
    if (!routeRelatedFromId || routeRelatedFromId === routeId) {
      return;
    }

    router.push(`/mistake/${routeRelatedFromId}` as never);
  }, [routeId, routeRelatedFromId, router]);

  const browseCurrentIndex = useMemo(() => {
    if (state.kind !== 'success') {
      return -1;
    }
    return browseContext.ids.indexOf(state.detail.id);
  }, [browseContext.ids, state]);

  const browseSummaryText = useMemo(() => {
    if (state.kind !== 'success') {
      return null;
    }

    const total = browseContext.ids.length;
    const currentDisplayIndex = browseCurrentIndex >= 0 ? browseCurrentIndex + 1 : 1;
    if (browseContext.mode === 'today_due') {
      return `当前按“今日待复做”顺序浏览（${currentDisplayIndex}/${Math.max(total, 1)}）`;
    }
    if (browseContext.mode === 'same_module') {
      return `当前不在今日待复做，按“同模块”顺序浏览（${currentDisplayIndex}/${Math.max(total, 1)}）`;
    }
    return '当前暂无可切换题目';
  }, [browseContext.ids.length, browseContext.mode, browseCurrentIndex, state]);

  useEffect(() => {
    if (!routeSwitchFrom || state.kind !== 'success') {
      return;
    }

    const total = browseContext.ids.length;
    if (total <= 1 || browseCurrentIndex < 0) {
      return;
    }

    const toastKey = [
      state.detail.id,
      routeSwitchFrom,
      browseContext.mode,
      browseCurrentIndex,
      total,
    ].join(':');
    if (switchToastKeyRef.current === toastKey) {
      return;
    }

    switchToastKeyRef.current = toastKey;
    showToast(
      buildSwitchToastMessage(routeSwitchFrom, browseCurrentIndex, total),
      'info',
      TOAST_DURATION_SHORT,
    );
  }, [
    browseContext.ids.length,
    browseContext.mode,
    browseCurrentIndex,
    routeSwitchFrom,
    showToast,
    state,
  ]);

  const navigateRelativeMistake = useCallback(
    (direction: 'next' | 'prev', trigger: 'scroll_top' | 'scroll_bottom') => {
      if (state.kind !== 'success') {
        Logger.info(PAGE_SCOPE, 'detail_auto_switch_skipped', {
          reason: 'state_not_success',
          trigger,
          direction,
          stateKind: state.kind,
        });
        return;
      }

      const ids = browseContext.ids;
      if (ids.length <= 1) {
        Logger.info(PAGE_SCOPE, 'detail_auto_switch_skipped', {
          reason: 'insufficient_candidates',
          trigger,
          direction,
          mode: browseContext.mode,
          totalIds: ids.length,
          currentMistakeId: state.detail.id,
        });
        return;
      }

      const currentIndex = ids.indexOf(state.detail.id);
      if (currentIndex < 0) {
        Logger.warn(PAGE_SCOPE, 'detail_auto_switch_skipped', {
          reason: 'current_not_in_candidates',
          trigger,
          direction,
          mode: browseContext.mode,
          totalIds: ids.length,
          currentMistakeId: state.detail.id,
        });
        return;
      }

      const targetIndex =
        direction === 'next'
          ? (currentIndex + 1) % ids.length
          : (currentIndex - 1 + ids.length) % ids.length;
      const targetId = ids[targetIndex];
      if (!targetId || targetId === state.detail.id) {
        Logger.warn(PAGE_SCOPE, 'detail_auto_switch_skipped', {
          reason: 'invalid_target',
          trigger,
          direction,
          mode: browseContext.mode,
          totalIds: ids.length,
          currentIndex,
          targetIndex,
          currentMistakeId: state.detail.id,
          targetId: targetId ?? null,
        });
        return;
      }

      Logger.info(PAGE_SCOPE, 'detail_auto_switch_start', {
        trigger,
        direction,
        mode: browseContext.mode,
        totalIds: ids.length,
        currentIndex,
        targetIndex,
        fromMistakeId: state.detail.id,
        toMistakeId: targetId,
      });
      pendingAutoRouteIdRef.current = targetId;
      router.replace(
        {
          pathname: '/mistake/[id]',
          params: {
            id: targetId,
            switchFrom: direction === 'next' ? 'bottom' : 'top',
          },
        } as never,
      );
    },
    [browseContext.ids, browseContext.mode, router, state],
  );

  const handleDetailScrollBeginDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const y = contentOffset.y;
    const maxScrollY = Math.max(0, contentSize.height - layoutMeasurement.height);
    isScrollDraggingRef.current = true;
    lastScrollYRef.current = y;
    maxScrollYRef.current = maxScrollY;
    touchMoveCountRef.current = 0;
    topEdgePullDistanceRef.current = 0;
    bottomEdgePullDistanceRef.current = 0;
    Logger.debug(PAGE_SCOPE, 'detail_scroll_begin_drag', {
      y,
      maxScrollY,
      routeId: routeId ?? null,
    });
  }, [routeId]);

  const handleDetailScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const y = contentOffset.y;
      const maxScrollY = Math.max(0, contentSize.height - layoutMeasurement.height);
      const velocityY = Number(event.nativeEvent.velocity?.y ?? 0);
      const atTop = y <= TOP_PULL_TRIGGER_DISTANCE;
      const atBottom = maxScrollY > 0 && y >= maxScrollY - BOTTOM_TRIGGER_DISTANCE;
      isScrollDraggingRef.current = false;
      lastTouchYRef.current = null;
      Logger.debug(PAGE_SCOPE, 'detail_scroll_end_drag', {
        y,
        maxScrollY,
        velocityY,
        atTop,
        atBottom,
        routeId: routeId ?? null,
        touchMoveCount: touchMoveCountRef.current,
        topEdgePullDistance: topEdgePullDistanceRef.current,
        bottomEdgePullDistance: bottomEdgePullDistanceRef.current,
      });

      if (pendingAutoRouteIdRef.current || state.kind !== 'success') {
        return;
      }

      if (
        atBottom
        && velocityY <= -EDGE_END_DRAG_VELOCITY_MIN
        && scrollBoundaryLockRef.current !== 'bottom'
      ) {
        scrollBoundaryLockRef.current = 'bottom';
        Logger.info(PAGE_SCOPE, 'detail_scroll_boundary_hit', {
          boundary: 'bottom',
          trigger: 'end_drag_velocity',
          y,
          maxScrollY,
          velocityY,
        });
        navigateRelativeMistake('next', 'scroll_bottom');
        return;
      }

      if (
        atTop
        && velocityY >= EDGE_END_DRAG_VELOCITY_MIN
        && scrollBoundaryLockRef.current !== 'top'
      ) {
        scrollBoundaryLockRef.current = 'top';
        Logger.info(PAGE_SCOPE, 'detail_scroll_boundary_hit', {
          boundary: 'top',
          trigger: 'end_drag_velocity',
          y,
          maxScrollY,
          velocityY,
        });
        navigateRelativeMistake('prev', 'scroll_top');
      }
    },
    [navigateRelativeMistake, routeId, state.kind],
  );

  const handleDetailTouchStart = useCallback((event: GestureResponderEvent) => {
    lastTouchYRef.current = event.nativeEvent.pageY;
  }, []);

  const handleDetailTouchEnd = useCallback(() => {
    lastTouchYRef.current = null;
  }, []);

  const handleDetailTouchMove = useCallback(
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
      if (pendingAutoRouteIdRef.current || state.kind !== 'success') {
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

      if (topEdgePullDistanceRef.current >= EDGE_PULL_TRIGGER_DISTANCE && scrollBoundaryLockRef.current !== 'top') {
        scrollBoundaryLockRef.current = 'top';
        Logger.info(PAGE_SCOPE, 'detail_scroll_boundary_hit', {
          boundary: 'top',
          trigger: 'touch_move_pull',
          y,
          maxScrollY,
          touchDeltaY,
          topEdgePullDistance: topEdgePullDistanceRef.current,
        });
        topEdgePullDistanceRef.current = 0;
        bottomEdgePullDistanceRef.current = 0;
        navigateRelativeMistake('prev', 'scroll_top');
        return;
      }

      if (bottomEdgePullDistanceRef.current >= EDGE_PULL_TRIGGER_DISTANCE && scrollBoundaryLockRef.current !== 'bottom') {
        scrollBoundaryLockRef.current = 'bottom';
        Logger.info(PAGE_SCOPE, 'detail_scroll_boundary_hit', {
          boundary: 'bottom',
          trigger: 'touch_move_pull',
          y,
          maxScrollY,
          touchDeltaY,
          bottomEdgePullDistance: bottomEdgePullDistanceRef.current,
        });
        topEdgePullDistanceRef.current = 0;
        bottomEdgePullDistanceRef.current = 0;
        navigateRelativeMistake('next', 'scroll_bottom');
      }
    },
    [navigateRelativeMistake, state.kind],
  );

  const handleDetailScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const y = contentOffset.y;
    const contentHeight = contentSize.height;
    const viewportHeight = layoutMeasurement.height;
    const maxScrollY = Math.max(0, contentHeight - viewportHeight);
    maxScrollYRef.current = maxScrollY;
    lastScrollYRef.current = y;
    const nextAnchorId = resolveActiveAnchorId(y, maxScrollY);
    setActiveAnchorId((current) => (current === nextAnchorId ? current : nextAnchorId));
    const anchorNavLayout = anchorNavLayoutRef.current;
    const nextFloatingAnchorVisible = anchorNavLayout
      ? y >= anchorNavLayout.y + anchorNavLayout.height - spacing.md
      : false;
    setIsFloatingAnchorVisible((current) =>
      current === nextFloatingAnchorVisible ? current : nextFloatingAnchorVisible);

    if (scrollBoundaryLockRef.current === 'bottom' && y < maxScrollY - BOTTOM_RELEASE_DISTANCE) {
      scrollBoundaryLockRef.current = null;
    }
    if (scrollBoundaryLockRef.current === 'top' && y > TOP_PULL_RELEASE_DISTANCE) {
      scrollBoundaryLockRef.current = null;
    }
  }, [resolveActiveAnchorId]);

  const handlePressDeleteMistake = useCallback(() => {
    if (state.kind !== 'success' || isDeletingMistake) {
      return;
    }

    if (isDeleteMistakeDisabled) {
      if (activeVoiceRecordingRecordId !== null) {
        showToast('正在录音，请先结束或放弃录音后再删除。', 'info');
        return;
      }
      showToast('当前正在处理，请稍后再删除。', 'info');
      return;
    }

    const mistakeId = state.detail.id;
    const title = state.detail.title.trim();
    const titlePreview = title.length > 18 ? `${title.slice(0, 18)}...` : title;

    Alert.alert(
      '删除这道错题？',
      `将删除「${titlePreview}」及其复做记录、图片和语音讲解，删除后无法恢复。`,
      [
        {
          text: '取消',
          style: 'cancel',
        },
        {
          text: '确认删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              let shouldResetDeleting = true;
              setIsDeletingMistake(true);
              try {
                await stopVoicePlayback(false);
                const result = await MistakeDetailService.deleteMistake(mistakeId);
                if (!result.ok) {
                  showToast(result.errorMessage ?? '删除错题失败，请重试。', 'error', TOAST_DURATION_LONG);
                  return;
                }

                shouldResetDeleting = false;
                allowNextLeaveRef.current = true;
                router.replace('/(tabs)/library' as never);
              } catch (error) {
                Logger.error(PAGE_SCOPE, 'Unexpected error while deleting mistake.', {
                  mistakeId,
                  error,
                });
                showToast(
                  error instanceof Error ? error.message : '删除错题失败，请重试。',
                  'error',
                  TOAST_DURATION_LONG,
                );
              } finally {
                if (shouldResetDeleting) {
                  setIsDeletingMistake(false);
                }
              }
            })();
          },
        },
      ],
    );
  }, [
    activeVoiceRecordingRecordId,
    isDeleteMistakeDisabled,
    isDeletingMistake,
    router,
    showToast,
    state,
    stopVoicePlayback,
  ]);

  const handlePressDelete = useCallback(
    (type: ManagedDetailType) => {
      Logger.info(PAGE_SCOPE, 'Delete image clicked.', {
        routeId,
        imageType: type,
      });

      Alert.alert('确认删除这张图片？', '删除后无法恢复。', [
        {
          text: '取消',
          style: 'cancel',
          onPress: () => {
            Logger.info(PAGE_SCOPE, 'Delete image canceled by user.', {
              routeId,
              imageType: type,
            });
          },
        },
        {
          text: '确认删除',
          style: 'destructive',
          onPress: () => {
            Logger.info(PAGE_SCOPE, 'Delete image confirmed by user.', {
              routeId,
              imageType: type,
            });
            void deleteImageForType(type);
          },
        },
      ]);
    },
    [deleteImageForType, routeId],
  );

  const handlePressEdit = useCallback(
    (slot: DetailImageSlot) => {
      if (state.kind !== 'success') {
        return;
      }
      if (!isManagedType(slot.type)) {
        return;
      }

      const normalizedUri = normalizePreviewUri(slot.uri);
      if (!normalizedUri || slot.exists === false) {
        showToast('请先拍照添加图片', 'info');
        Logger.warn(PAGE_SCOPE, 'Edit image blocked because source image is unavailable.', {
          mistakeId: state.detail.id,
          imageType: slot.type,
          hasUri: !!normalizedUri,
          exists: slot.exists ?? null,
        });
        return;
      }

      Logger.info(PAGE_SCOPE, 'Edit image clicked.', {
        mistakeId: state.detail.id,
        imageType: slot.type,
        imageSlot: mapManagedTypeToImageSlot(slot.type),
        sourceUriLength: normalizedUri.length,
      });

      router.push(
        {
          pathname: '/mistake/[id]/image-edit',
          params: {
            id: state.detail.id,
            imageType: slot.type,
            imageSlot: mapManagedTypeToImageSlot(slot.type),
            sourceUri: normalizedUri,
            oldImageUri: normalizedUri,
          },
        } as never,
      );
    },
    [router, showToast, state],
  );

  const handleStartTitleEdit = useCallback((options?: { selectAll?: boolean }) => {
    if (state.kind !== 'success' || isSavingTitle) {
      return;
    }
    const shouldSelectAll = options?.selectAll === true;
    setTitleInput(state.detail.title);
    setTitleSelectAllOnFocus(shouldSelectAll);
    setIsTitleEditing(true);
  }, [isSavingTitle, state]);

  const handlePressTitle = useCallback(() => {
    if (titleTapTimerRef.current) {
      clearTimeout(titleTapTimerRef.current);
      titleTapTimerRef.current = null;
      handleStartTitleEdit({ selectAll: true });
      return;
    }

    titleTapTimerRef.current = setTimeout(() => {
      titleTapTimerRef.current = null;
      handleStartTitleEdit({ selectAll: false });
    }, TITLE_DOUBLE_TAP_WINDOW_MS);
  }, [handleStartTitleEdit]);

  const handleSaveTitle = useCallback(async () => {
    if (state.kind !== 'success' || isSavingTitle) {
      return;
    }

    const currentTitle = state.detail.title;
    const normalizedTitle = titleInput.trim();
    if (!normalizedTitle) {
      setTitleInput(currentTitle);
      setIsTitleEditing(false);
      showToast('题目名字不能为空。', 'error');
      return;
    }

    if (normalizedTitle === currentTitle.trim()) {
      setTitleInput(currentTitle);
      setIsTitleEditing(false);
      return;
    }

    setIsTitleEditing(false);
    setIsSavingTitle(true);
    try {
      const result = await MistakeDetailService.updateMistakeTitle({
        mistakeId: state.detail.id,
        title: normalizedTitle,
      });

      if (!result.ok || !result.detail) {
        showToast(result.errorMessage ?? '更新题目名字失败，请重试。', 'error');
        return;
      }

      setState({
        kind: 'success',
        detail: result.detail,
      });
      setTitleInput(result.detail.title);
      setIsTitleEditing(false);
      showToast('题目名字已更新。', 'success');
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected error while updating title.', {
        routeId,
        error,
      });
      showToast(
        error instanceof Error ? error.message : '更新题目名字失败，请重试。',
        'error',
      );
    } finally {
      setIsSavingTitle(false);
    }
  }, [isSavingTitle, routeId, showToast, state, titleInput]);

  const handleEditMistakeFromChrome = useCallback(() => {
    if (state.kind !== 'success') {
      return;
    }
    setIsMoreMenuVisible(false);
    detailScrollRef.current?.scrollTo({ y: 0, animated: true });
    setTimeout(() => {
      handleStartTitleEdit({ selectAll: false });
    }, 180);
  }, [handleStartTitleEdit, state]);

  const handlePressArchiveMistake = useCallback(() => {
    if (state.kind !== 'success' || state.detail.status === 'archived' || isArchivingMistake) {
      return;
    }

    if (isDeleteMistakeDisabled) {
      showToast('当前正在处理，请稍后再归档。', 'info');
      return;
    }

    const mistakeId = state.detail.id;
    Alert.alert(
      '归档这道错题？',
      '归档后将停止后续复做安排，已有图片、复做记录、语音和文字讲解都会保留。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认归档',
          onPress: () => {
            void (async () => {
              setIsArchivingMistake(true);
              try {
                await stopVoicePlayback(false);
                const result = await MistakeDetailService.archiveMistake(mistakeId);
                if (!result.ok || !result.detail) {
                  showToast(result.errorMessage ?? '归档错题失败，请重试。', 'error', TOAST_DURATION_LONG);
                  return;
                }
                setState({ kind: 'success', detail: result.detail });
                showToast('错题已归档，原有学习记录均已保留。', 'success');
              } catch (error) {
                Logger.error(PAGE_SCOPE, 'Unexpected error while archiving mistake.', {
                  mistakeId,
                  error,
                });
                showToast(
                  error instanceof Error ? error.message : '归档错题失败，请重试。',
                  'error',
                  TOAST_DURATION_LONG,
                );
              } finally {
                setIsArchivingMistake(false);
              }
            })();
          },
        },
      ],
    );
  }, [
    isArchivingMistake,
    isDeleteMistakeDisabled,
    showToast,
    state,
    stopVoicePlayback,
  ]);

  const relatedFromHintTitle =
    routeRelatedFromId && routeRelatedFromId !== routeId
      ? routeRelatedFromTitle ?? '上一道相关错题'
      : null;
  const relatedSummary = state.kind === 'success'
    ? state.detail.relatedSummary
    : { total: 0, system: 0, manual: 0 };
  const activeReviewTextRecord =
    state.kind === 'success' && reviewTextEditorRecordId
      ? state.detail.reviewRecords.find((record) => record.id === reviewTextEditorRecordId) ?? null
      : null;
  const detailImageCount = managedSlots.reduce((total, slot) => total + countSlotImages(slot), 0);
  const detailSectionItems: readonly MistakeDetailSectionItem[] = [
    { id: 'overview', label: '概览' },
    { id: 'images', label: '图片', count: detailImageCount },
    {
      id: 'reviews',
      label: '复做记录',
      count: state.kind === 'success' ? state.detail.reviewRecords.length : 0,
    },
  ];
  const visibleReviewRecords = state.kind === 'success'
    ? (showAllReviewRecords ? state.detail.reviewRecords : state.detail.reviewRecords.slice(0, 3))
    : [];
  const detailIsMastered = state.kind === 'success'
    && (state.detail.status === 'mastered'
      || state.detail.reviewCount >= state.detail.maxReviewCount);
  const detailPrimaryLabel = state.kind !== 'success'
    ? ''
    : detailIsMastered
      ? '已掌握'
      : state.detail.status === 'archived'
        ? '已归档'
        : state.detail.status === 'collected'
          ? '加入七刷'
          : `开始第${Math.min(state.detail.maxReviewCount, state.detail.reviewCount + 1)}次复做`;
  const detailPrimaryDisabled = state.kind !== 'success'
    || detailIsMastered
    || state.detail.status === 'archived'
    || (state.detail.status === 'collected'
      ? isJoinReviewPlanDisabled
      : (!canStartDetailReview || isStartDetailReviewDisabled));
  const detailPrimaryBusy = isJoiningReviewPlan || isArchivingMistake || isDeletingMistake;
  const shouldShowFloatingAnchorNav = state.kind === 'success' && isFloatingAnchorVisible;
  const floatingAnchorTop = insets.top + DETAIL_NAV_BAR_HEIGHT;
  return (
    <View style={styles.pageRoot}>
      <MistakeDetailHeader
        topInset={insets.top}
        onBack={handleBack}
        onMore={() => setIsMoreMenuVisible(true)}
      />

      <Animated.View
        style={[
          styles.pageEnterLayer,
          {
            opacity: pageEnterOpacity,
            transform: [{ translateY: pageEnterTranslateY }],
          },
        ]}>
        <ScreenContainer
          scroll
          safeAreaEdges={[]}
          scrollRef={detailScrollRef}
          contentStyle={[
            styles.screenContent,
            {
              paddingBottom: 108 + Math.max(insets.bottom, spacing.sm),
            },
          ]}
          onScroll={handleDetailScroll}
          onScrollBeginDrag={handleDetailScrollBeginDrag}
          onScrollEndDrag={handleDetailScrollEndDrag}
          onTouchStart={handleDetailTouchStart}
          onTouchMove={handleDetailTouchMove}
          onTouchEnd={handleDetailTouchEnd}>
          {state.kind === 'loading' ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={mistakeDetailPalette.green} />
              <Text style={styles.loadingText}>正在加载错题...</Text>
            </View>
          ) : null}

          {state.kind === 'error' ? (
            <StateCard
              title="读取错题失败"
              message={state.message}
              onBack={handleBack}
              onRetry={routeId ? () => void loadDetail() : undefined}
            />
          ) : null}

          {state.kind === 'notFound' ? (
            <StateCard
              title="没有找到这道错题"
              message={state.message}
              onBack={handleBack}
              onRetry={routeId ? () => void loadDetail() : undefined}
              retryText="刷新"
            />
          ) : null}

          {state.kind === 'success' ? (
            <>
              <View style={styles.detailTitleSection}>
                {state.detail.questionCode ? (
                  <View
                    accessibilityLabel={`错题编号 ${state.detail.questionCode}`}
                    style={styles.detailQuestionCodeBadge}>
                    <Text selectable style={styles.detailQuestionCodeText}>
                      {state.detail.questionCode}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.detailTitleRow}>
                  {isTitleEditing ? (
                    <TextInput
                      value={titleInput}
                      onChangeText={setTitleInput}
                      editable={!isSavingTitle}
                      placeholder="请输入题目名字"
                      placeholderTextColor={mistakeDetailPalette.secondaryText}
                      style={styles.detailTitleInput}
                      maxLength={80}
                      autoFocus
                      returnKeyType="done"
                      blurOnSubmit
                      selectTextOnFocus={titleSelectAllOnFocus}
                      onFocus={() => {
                        if (titleSelectAllOnFocus) {
                          setTitleSelectAllOnFocus(false);
                        }
                      }}
                      onBlur={() => {
                        void handleSaveTitle();
                      }}
                      onSubmitEditing={() => {
                        void handleSaveTitle();
                      }}
                    />
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="编辑错题标题"
                      disabled={isSavingTitle}
                      onPress={handlePressTitle}
                      style={({ pressed }) => [
                        styles.detailTitlePressable,
                        pressed && styles.detailPressed,
                      ]}>
                      <Text numberOfLines={2} style={styles.detailTitleText}>
                        {state.detail.title}
                      </Text>
                    </Pressable>
                  )}

                  <View accessibilityLabel="本地离线数据" style={styles.offlineBadge}>
                    <MaterialIcons name="wifi-off" size={13} color={mistakeDetailPalette.green} />
                    <Text style={styles.offlineBadgeText}>离线</Text>
                  </View>
                </View>

                {isSavingTitle ? (
                  <View style={styles.titleSavingInline}>
                    <ActivityIndicator size="small" color={mistakeDetailPalette.green} />
                    <Text style={styles.titleSavingText}>保存中...</Text>
                  </View>
                ) : null}

                <View style={styles.detailMetadataRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`当前模块：${state.detail.module}，点击修改`}
                    disabled={isModuleChangeDisabled}
                    onPress={handleOpenModulePicker}
                    style={({ pressed }) => [
                      styles.metadataTextButton,
                      pressed && styles.detailPressed,
                    ]}>
                    <Text numberOfLines={1} style={styles.detailMetadataText}>
                      {state.detail.module}
                    </Text>
                  </Pressable>
                  <Text style={styles.metadataSeparator}>·</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`当前难度：${state.detail.difficulty}，点击修改`}
                    disabled={isMetadataChangeDisabled}
                    onPress={handleOpenMetadataEditor}
                    style={({ pressed }) => [
                      styles.metadataTextButton,
                      pressed && styles.detailPressed,
                    ]}>
                    <Text style={styles.detailMetadataText}>难度 {state.detail.difficulty}</Text>
                  </Pressable>
                  <Text style={styles.metadataSeparator}>·</Text>
                  <Text style={styles.detailMetadataText}>{formatDateShort(state.detail.createdAt)}</Text>
                </View>

                {state.detail.errorReason ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`错因：${state.detail.errorReason}，点击修改`}
                    disabled={isMetadataChangeDisabled}
                    onPress={handleOpenMetadataEditor}
                    style={({ pressed }) => [
                      styles.errorReasonButton,
                      pressed && styles.detailPressed,
                    ]}>
                    <Text numberOfLines={1} style={styles.errorReasonText}>
                      错因：{state.detail.errorReason}
                    </Text>
                    <MaterialIcons
                      name="chevron-right"
                      size={18}
                      color={mistakeDetailPalette.secondaryText}
                    />
                  </Pressable>
                ) : null}

                {relatedFromHintTitle ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`相关于：${relatedFromHintTitle}`}
                    onPress={handleOpenRelatedSourceMistake}
                    style={({ pressed }) => [
                      styles.relatedFromInline,
                      pressed && styles.detailPressed,
                    ]}>
                    <MaterialIcons
                      name="link"
                      size={16}
                      color={mistakeDetailPalette.secondaryText}
                    />
                    <Text numberOfLines={1} style={styles.relatedFromInlineText}>
                      相关于：{relatedFromHintTitle}
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              <ReviewProgressCard
                reviewCount={state.detail.reviewCount}
                maxReviewCount={state.detail.maxReviewCount}
                status={state.detail.status}
                nextReviewText={formatNextReviewCompact(state.detail, nextReviewInfo)}
              />

              <View onLayout={handleAnchorNavLayout}>
                <DetailSectionNavigator
                  items={detailSectionItems}
                  activeId={activeAnchorId}
                  onPress={handleAnchorPress}
                />
              </View>

              <View
                onLayout={(event) => handleAnchorLayout('overview', event)}
                style={[
                  styles.detailSection,
                  highlightedAnchorId === 'overview' && styles.anchorTargetHighlighted,
                ]}>
                <DetailSectionHeader title="概览" />
                <View style={styles.overviewGroup}>
                  <View style={styles.overviewRow}>
                    <Text style={styles.overviewLabel}>标签</Text>
                    <View style={styles.overviewValue}>
                      <View style={styles.overviewTagRow}>
                        {state.detail.tags.length > 0 ? (
                          state.detail.tags.map((tag) => {
                            if (!isTagManageMode) {
                              return (
                                <TagChip
                                  key={tag.id}
                                  label={tag.name}
                                  selected
                                  style={styles.overviewTagChip}
                                  textStyle={styles.overviewTagChipText}
                                />
                              );
                            }
                            const deleting = deletingTagId === tag.id;
                            return (
                              <Pressable
                                key={tag.id}
                                accessibilityRole="button"
                                accessibilityLabel={`删除标签：${tag.name}`}
                                disabled={deletingTagId !== null || isSavingTag}
                                onPress={() => handleDeleteTag(tag)}
                                style={({ pressed }) => [
                                  styles.overviewManagedTag,
                                  pressed && styles.detailPressed,
                                ]}>
                                <Text numberOfLines={1} style={styles.overviewManagedTagText}>
                                  {tag.name}
                                </Text>
                                {deleting ? (
                                  <ActivityIndicator size="small" color={mistakeDetailPalette.green} />
                                ) : (
                                  <MaterialIcons
                                    name="close"
                                    size={15}
                                    color={mistakeDetailPalette.secondaryText}
                                  />
                                )}
                              </Pressable>
                            );
                          })
                        ) : (
                          <Text style={styles.overviewEmptyText}>暂无</Text>
                        )}

                        {isTagManageMode ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="添加标签"
                            disabled={isSavingTag || deletingTagId !== null}
                            onPress={handleOpenTagAddModal}
                            style={({ pressed }) => [
                              styles.overviewAddTag,
                              pressed && styles.detailPressed,
                            ]}>
                            <MaterialIcons name="add" size={16} color={mistakeDetailPalette.green} />
                            <Text style={styles.overviewAddTagText}>添加</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={isTagManageMode ? '完成标签管理' : '管理标签'}
                      onPress={() => {
                        if (state.detail.tags.length <= 0) {
                          handleOpenTagAddModal();
                          return;
                        }
                        setIsTagManageMode((current) => !current);
                      }}
                      style={({ pressed }) => [
                        styles.overviewAction,
                        pressed && styles.detailPressed,
                      ]}>
                      <Text style={styles.overviewActionText}>
                        {isTagManageMode ? '完成' : '管理'}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.overviewDivider} />

                  <View style={[styles.overviewRow, styles.overviewNoteRow]}>
                    <Text style={styles.overviewLabel}>备注</Text>
                    <View style={styles.overviewValue}>
                      <TextNotePreview
                        value={hasNoteContent ? noteInput : ''}
                        emptyText="暂无备注"
                        maxLength={NOTE_MAX_LENGTH}
                        accessibilityLabel="错题备注"
                        disabled={isDeletingMistake}
                        onOpen={handleOpenNoteModal}
                        highlights={noteHighlightsInput}
                        style={styles.overviewNotePreview}
                        textStyle={styles.overviewNoteText}
                        emptyTextStyle={styles.overviewEmptyText}
                        openOnSinglePress
                        showFooter={false}
                        numberOfLines={2}
                      />
                    </View>
                    <MaterialIcons
                      name="chevron-right"
                      size={22}
                      color={mistakeDetailPalette.secondaryText}
                    />
                  </View>

                  <View style={styles.overviewDivider} />

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      relatedSummary.total > 0
                        ? `查看 ${relatedSummary.total} 道相关错题`
                        : '添加相关错题'
                    }
                    onPress={
                      relatedSummary.total > 0
                        ? handleOpenRelatedMistakes
                        : handleAddRelatedMistake
                    }
                    style={({ pressed }) => [
                      styles.overviewRow,
                      styles.relatedOverviewRow,
                      pressed && styles.overviewRowPressed,
                    ]}>
                    <Text style={styles.overviewLabel}>相关错题</Text>
                    <View style={styles.overviewValue} />
                    <Text style={styles.relatedCountInline}>
                      {relatedSummary.total > 0 ? `共 ${relatedSummary.total} 题` : '暂无'}
                    </Text>
                    <MaterialIcons
                      name="chevron-right"
                      size={22}
                      color={mistakeDetailPalette.secondaryText}
                    />
                  </Pressable>
                </View>
              </View>

              <View
                onLayout={(event) => handleAnchorLayout('images', event)}
                style={[
                  styles.detailSection,
                  highlightedAnchorId === 'images' && styles.anchorTargetHighlighted,
                ]}>
                <DetailSectionHeader
                  title="图片"
                  actionLabel={isImageManageMode ? '完成' : '管理'}
                  onAction={() => setIsImageManageMode((current) => !current)}
                />

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.compactImageList}>
                  {managedSlots.map((slot) => {
                    const slotType = slot.type;
                    if (!isManagedType(slotType)) {
                      return null;
                    }
                    return (
                      <MistakeImageSection
                        key={slotType}
                        title={slot.title || getDeleteTypeName(slotType)}
                        imageUri={slot.uri}
                        imageExists={slot.exists}
                        fileSize={slot.fileSize}
                        width={slot.width}
                        height={slot.height}
                        imageWidth={slot.imageWidth}
                        imageHeight={slot.imageHeight}
                        imageCount={countSlotImages(slot)}
                        emptyText={slot.emptyText}
                        emptyActionLabel={
                          slotType === 'my_solution' ? '添加我的做法' : `添加${getDeleteTypeName(slotType)}`
                        }
                        loadErrorText={slotType === 'question' ? '题目图片加载失败' : '图片加载失败'}
                        isBusy={isTypeBusy(slotType)}
                        isTakePhotoLoading={takePhotoType === slotType}
                        isPickImageLoading={pickImageType === slotType}
                        isDeleteLoading={deleteType === slotType}
                        showManagementActions={isImageManageMode}
                        onTakePhoto={() => {
                          void takePhotoForType(slotType);
                        }}
                        onPickImage={() => {
                          void pickImageForType(slotType);
                        }}
                        onEdit={() => handlePressEdit(slot)}
                        onDelete={() => handlePressDelete(slotType)}
                        onPreview={() => openImageBrowser(`slot:${slotType}:0`)}
                      />
                    );
                  })}
                </ScrollView>
                {state.detail.mySolutionText || state.detail.answerText ? (
                  <View style={styles.supplementTextList}>
                    {state.detail.mySolutionText ? (
                      <View style={styles.supplementTextRow}>
                        <Text style={styles.supplementTextTitle}>我的做法</Text>
                        <Text selectable style={styles.supplementTextBody}>{state.detail.mySolutionText}</Text>
                      </View>
                    ) : null}
                    {state.detail.answerText ? (
                      <View style={styles.supplementTextRow}>
                        <Text style={styles.supplementTextTitle}>答案／解析</Text>
                        <Text selectable style={styles.supplementTextBody}>{state.detail.answerText}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>

              <View
                onLayout={(event) => handleAnchorLayout('reviews', event)}
                style={[
                  styles.detailSection,
                  highlightedAnchorId === 'reviews' && styles.anchorTargetHighlighted,
                ]}>
                <DetailSectionHeader
                  title="复做记录"
                  actionLabel={
                    state.detail.reviewRecords.length > 3
                      ? (showAllReviewRecords ? '收起' : '查看全部')
                      : undefined
                  }
                  onAction={() => setShowAllReviewRecords((current) => !current)}
                />

                <View style={styles.reviewTimelineGroup}>
                  {state.detail.reviewRecords.length <= 0 ? (
                    <View style={styles.reviewTimelineEmpty}>
                      <View style={styles.reviewTimelineEmptyIcon}>
                        <MaterialIcons
                          name="history"
                          size={24}
                          color={mistakeDetailPalette.secondaryText}
                        />
                      </View>
                      <Text style={styles.reviewTimelineEmptyTitle}>还没有复做记录</Text>
                      <Text style={styles.reviewTimelineEmptyText}>
                        完成第一次复做后，记录会显示在这里
                      </Text>
                    </View>
                  ) : (
                    visibleReviewRecords.map((record) => (
                      <ReviewRecordCard
                        key={record.id}
                        record={record}
                        isBusy={isReviewRecordImageBusy(record.id)}
                        isVoicePlaying={activeVoiceRecordId === record.id}
                        isVoiceBusy={isVoicePlaybackBusy || isVoiceRecordingBusy}
                        isVoicePlaybackLocked={activeVoiceRecordingRecordId !== null}
                        isVoiceRecording={activeVoiceRecordingRecordId === record.id}
                        recordingElapsedMs={recordingElapsedMs}
                        isVoiceLocked={
                          !!activeVoiceRecordingRecordId && activeVoiceRecordingRecordId !== record.id
                        }
                        isTextActionDisabled={
                          isSavingReviewText
                          || activeVoiceRecordingRecordId !== null
                          || isVoiceRecordingBusy
                        }
                        onAddImage={(targetRecord) => {
                          openReviewImagePickerActionSheet(targetRecord, 'add');
                        }}
                        onAddText={handleOpenReviewTextEditor}
                        onOpenText={handleOpenReviewTextEditor}
                        onPreview={openImageBrowser}
                        onOpenImageActions={handleOpenReviewImageActions}
                        onToggleVoicePlayback={(targetRecord) => {
                          void handleToggleReviewVoicePlayback(targetRecord);
                        }}
                        onStartVoiceRecording={(targetRecord) => {
                          void handleStartReviewVoiceRecording(targetRecord);
                        }}
                        onStopAndSaveVoiceRecording={(targetRecord) => {
                          void handleStopAndSaveReviewVoiceRecording(targetRecord);
                        }}
                      />
                    ))
                  )}

                  {!showAllReviewRecords && state.detail.reviewRecords.length > visibleReviewRecords.length ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="显示全部复做记录"
                      onPress={() => setShowAllReviewRecords(true)}
                      style={({ pressed }) => [
                        styles.showMoreReviewsButton,
                        pressed && styles.detailPressed,
                      ]}>
                      <Text style={styles.showMoreReviewsText}>
                        还有 {state.detail.reviewRecords.length - visibleReviewRecords.length} 条记录
                      </Text>
                      <MaterialIcons
                        name="keyboard-arrow-down"
                        size={20}
                        color={mistakeDetailPalette.green}
                      />
                    </Pressable>
                  ) : null}
                </View>

                {browseSummaryText ? <Text style={styles.browseSummaryText}>{browseSummaryText}</Text> : null}
                {browseContext.ids.length > 1 ? (
                  <Text style={styles.browseHintText}>
                    在页面边界快速拉动可切换上一题或下一题
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}

          <MistakeImageBrowser
            visible={imageBrowserVisible}
            items={imageBrowserItems}
            initialIndex={imageBrowserInitialIndex}
            onClose={handleCloseImageBrowser}
            onImageLongPress={handleImageBrowserLongPress}
          />
        </ScreenContainer>
      </Animated.View>

      {shouldShowFloatingAnchorNav ? (
        <View
          pointerEvents="box-none"
          style={[styles.floatingAnchorWrap, { top: floatingAnchorTop }]}>
          <DetailSectionNavigator
            floating
            items={detailSectionItems}
            activeId={activeAnchorId}
            onPress={handleAnchorPress}
          />
        </View>
      ) : null}

      {state.kind === 'success' ? (
        <DetailBottomActionBar
          bottomInset={insets.bottom}
          primaryLabel={detailPrimaryLabel}
          primaryDisabled={detailPrimaryDisabled}
          primaryBusy={detailPrimaryBusy}
          mastered={detailIsMastered}
          onEdit={handleEditMistakeFromChrome}
          onPrimary={
            state.detail.status === 'collected'
              ? handleJoinReviewPlanFromDetail
              : handleStartDetailReview
          }
        />
      ) : null}

      <Modal
        visible={isMoreMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsMoreMenuVisible(false)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭更多操作"
          style={styles.moreMenuBackdrop}
          onPress={() => setIsMoreMenuVisible(false)}
        />
        <View style={[styles.moreMenuCard, { top: insets.top + 48 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="编辑错题"
            onPress={handleEditMistakeFromChrome}
            style={({ pressed }) => [
              styles.moreMenuAction,
              pressed && styles.moreMenuActionPressed,
            ]}>
            <MaterialIcons name="edit" size={20} color={mistakeDetailPalette.text} />
            <Text style={styles.moreMenuActionText}>编辑错题</Text>
          </Pressable>

          {state.kind === 'success' && state.detail.status !== 'archived' ? (
            <>
              <View style={styles.moreMenuDivider} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="归档错题"
                disabled={isArchivingMistake}
                onPress={() => {
                  setIsMoreMenuVisible(false);
                  setTimeout(handlePressArchiveMistake, 160);
                }}
                style={({ pressed }) => [
                  styles.moreMenuAction,
                  pressed && styles.moreMenuActionPressed,
                ]}>
                <MaterialIcons
                  name="archive"
                  size={20}
                  color={mistakeDetailPalette.secondaryText}
                />
                <Text style={styles.moreMenuActionText}>
                  {isArchivingMistake ? '归档中...' : '归档'}
                </Text>
              </Pressable>
            </>
          ) : null}

          <View style={styles.moreMenuDivider} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="删除错题"
            disabled={isDeleteMistakeDisabled}
            onPress={() => {
              setIsMoreMenuVisible(false);
              setTimeout(handlePressDeleteMistake, 160);
            }}
            style={({ pressed }) => [
              styles.moreMenuAction,
              pressed && styles.moreMenuActionPressed,
            ]}>
            <MaterialIcons name="delete-outline" size={20} color="#C9342E" />
            <Text style={styles.moreMenuDeleteText}>
              {isDeletingMistake ? '删除中...' : '删除错题'}
            </Text>
          </Pressable>
        </View>
      </Modal>

      <TextNoteEditorModal
        visible={isNoteModalVisible}
        title="错题备注"
        value={noteInput}
        maxLength={NOTE_MAX_LENGTH}
        placeholder={NOTE_PLACEHOLDER}
        highlights={noteHighlightsInput}
        busy={isSavingNote}
        errorMessage={noteModalMessage}
        onDraftChange={() => {
          setNoteModalMessage(null);
        }}
        onClose={handleCloseNoteModal}
        onSave={handleSaveNote}
        onHighlightsChange={handleSaveNoteHighlights}
      />

      <TextNoteEditorModal
        visible={reviewTextEditorRecordId !== null}
        title="文字讲解"
        subtitle={activeReviewTextRecord ? `第 ${activeReviewTextRecord.reviewIndex} 刷` : undefined}
        value={typeof activeReviewTextRecord?.note === 'string' ? activeReviewTextRecord.note : ''}
        maxLength={REVIEW_TEXT_NOTE_MAX_LENGTH}
        placeholder="写下本次复做的关键条件、解题思路和易错点……"
        highlights={activeReviewTextRecord?.noteHighlights ?? []}
        busy={isSavingReviewText}
        errorMessage={reviewTextEditorMessage}
        onDraftChange={() => {
          setReviewTextEditorMessage(null);
        }}
        onClose={handleCloseReviewTextEditor}
        onSave={handleSaveReviewText}
        onHighlightsChange={handleSaveReviewTextHighlights}
      />

      <Modal
        visible={isTagAddModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseTagAddModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.tagModalOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭添加标签"
            style={styles.tagModalBackdrop}
            onPress={handleCloseTagAddModal}
          />
          <View style={styles.tagModalSheet}>
            <View style={styles.tagModalHandle} />
            <View style={styles.tagModalHeader}>
              <View style={styles.tagModalHeaderTextWrap}>
                <Text style={styles.tagModalTitle}>添加标签</Text>
                <Text style={styles.tagModalSubtitle}>如：回文串、双指针、删除一个字符</Text>
              </View>
              {isSavingTag ? <ActivityIndicator size="small" color={colors.success} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭添加标签"
                disabled={isSavingTag}
                onPress={handleCloseTagAddModal}
                style={({ pressed }) => [
                  styles.tagModalCloseButton,
                  pressed && !isSavingTag ? styles.tagModalCloseButtonPressed : null,
                  isSavingTag ? styles.tagModalButtonDisabled : null,
                ]}>
                <MaterialIcons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.tagModalBodyScroll}
              contentContainerStyle={styles.tagModalBodyContent}>
              {tagModalMessage ? (
                <Text maxFontSizeMultiplier={1.1} style={styles.tagModalMessage}>
                  {tagModalMessage}
                </Text>
              ) : null}

              <View style={styles.tagInputWrap}>
                <MaterialIcons name="label-outline" size={20} color={colors.success} />
                <TextInput
                  value={tagDraft}
                  editable={!isSavingTag}
                  onChangeText={(value) => {
                    setTagDraft(value);
                    setTagModalMessage(null);
                  }}
                  placeholder="输入标签名称"
                  placeholderTextColor={colors.textMuted}
                  maxLength={MistakeTagService.MAX_MISTAKE_TAG_NAME_LENGTH}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    void handleSaveTag();
                  }}
                  style={styles.tagInput}
                />
              </View>

              {tagSuggestions.length > 0 ? (
                <View style={styles.tagSuggestionSection}>
                  <Text style={styles.tagSuggestionTitle}>最近使用</Text>
                  <View style={styles.tagSuggestionRow}>
                    {tagSuggestions.map((suggestion) => (
                      <TagChip
                        key={suggestion}
                        label={suggestion}
                        selected={false}
                        onPress={() => handleUseTagSuggestion(suggestion)}
                        style={styles.tagSuggestionChip}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.tagModalFooter}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="取消添加标签"
                disabled={isSavingTag}
                onPress={handleCloseTagAddModal}
                style={({ pressed }) => [
                  styles.tagSecondaryButton,
                  pressed && !isSavingTag ? styles.tagModalButtonPressed : null,
                  isSavingTag ? styles.tagModalButtonDisabled : null,
                ]}>
                <Text style={styles.tagSecondaryButtonText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="保存标签"
                disabled={
                  isSavingTag
                  || MistakeTagService.normalizeMistakeTagName(tagDraft).length <= 0
                }
                onPress={() => {
                  void handleSaveTag();
                }}
                style={({ pressed }) => [
                  styles.tagPrimaryButton,
                  pressed && !isSavingTag ? styles.tagModalButtonPressed : null,
                  (
                    isSavingTag
                    || MistakeTagService.normalizeMistakeTagName(tagDraft).length <= 0
                  )
                    ? styles.tagModalButtonDisabled
                    : null,
                ]}>
                <Text style={styles.tagPrimaryButtonText}>{isSavingTag ? '保存中...' : '保存'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <DetailModulePickerModal
        visible={isModulePickerVisible}
        options={modulePickerOptions}
        selectedModule={currentModule}
        busy={isModulePickerBusy}
        message={modulePickerMessage}
        onClose={handleCloseModulePicker}
        onConfirm={(moduleName) => {
          void handleSelectModule(moduleName);
        }}
      />

      <DetailMetadataEditorModal
        visible={isMetadataEditorVisible}
        draft={metadataDraft}
        customErrorReasons={customErrorReasons}
        busy={isSavingMetadata}
        message={metadataEditorMessage}
        onClose={handleCloseMetadataEditor}
        onChangeDraft={setMetadataDraft}
        onSave={() => {
          void handleSaveMetadata();
        }}
      />

      <AppToast
        {...toastProps}
        bottomOffset={toastBottomOffset}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: mistakeDetailPalette.background,
  },
  pageEnterLayer: {
    flex: 1,
  },
  screenContent: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl + layout.bottomTabHeight,
    gap: spacing.xl,
    backgroundColor: mistakeDetailPalette.background,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  backText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  loadingCard: {
    minHeight: 120,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mistakeDetailPalette.border,
    backgroundColor: mistakeDetailPalette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  floatingAnchorWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 30,
    elevation: 4,
  },
  anchorTargetHighlighted: {
    borderRadius: 20,
    backgroundColor: 'rgba(52, 199, 89, 0.05)',
  },
  detailPressed: {
    opacity: 0.62,
  },
  detailTitleSection: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  detailQuestionCodeBadge: {
    alignSelf: 'flex-start',
    minHeight: 30,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  detailQuestionCodeText: {
    color: mistakeDetailPalette.green,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  detailTitleRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  detailTitlePressable: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: 'center',
  },
  detailTitleText: {
    color: mistakeDetailPalette.text,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  detailTitleInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mistakeDetailPalette.border,
    backgroundColor: mistakeDetailPalette.surface,
    color: mistakeDetailPalette.text,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  offlineBadge: {
    flexShrink: 0,
    minHeight: 30,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 9,
    marginTop: 5,
  },
  offlineBadgeText: {
    color: mistakeDetailPalette.green,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  titleSavingInline: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailMetadataRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
  },
  metadataTextButton: {
    minHeight: 28,
    maxWidth: 144,
    justifyContent: 'center',
  },
  detailMetadataText: {
    color: mistakeDetailPalette.secondaryText,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  metadataSeparator: {
    color: '#AEAEB2',
    fontSize: 15,
    lineHeight: 21,
  },
  errorReasonButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    maxWidth: '100%',
    borderRadius: 12,
    backgroundColor: '#ECECF0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  errorReasonText: {
    flexShrink: 1,
    color: mistakeDetailPalette.secondaryText,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  relatedFromInline: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  relatedFromInlineText: {
    flexShrink: 1,
    color: mistakeDetailPalette.secondaryText,
    fontSize: 13,
    lineHeight: 18,
  },
  detailSection: {
    gap: spacing.sm,
  },
  overviewGroup: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mistakeDetailPalette.border,
    backgroundColor: mistakeDetailPalette.surface,
    overflow: 'hidden',
  },
  overviewRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  overviewNoteRow: {
    minHeight: 92,
  },
  relatedOverviewRow: {
    minHeight: 76,
  },
  overviewRowPressed: {
    backgroundColor: '#F7F7F9',
  },
  overviewDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg,
    backgroundColor: mistakeDetailPalette.border,
  },
  overviewLabel: {
    width: 66,
    flexShrink: 0,
    color: mistakeDetailPalette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  overviewValue: {
    flex: 1,
    minWidth: 0,
  },
  overviewTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  overviewTagChip: {
    maxWidth: 128,
    minHeight: 30,
    borderColor: 'transparent',
    backgroundColor: colors.accentSoft,
  },
  overviewTagChipText: {
    color: mistakeDetailPalette.green,
    fontSize: 13,
    fontWeight: '600',
  },
  overviewManagedTag: {
    maxWidth: 142,
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mistakeDetailPalette.border,
    backgroundColor: '#F5F5F7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  overviewManagedTagText: {
    flexShrink: 1,
    color: mistakeDetailPalette.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  overviewAddTag: {
    minHeight: 34,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
  },
  overviewAddTagText: {
    color: mistakeDetailPalette.green,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  overviewAction: {
    minWidth: 52,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  overviewActionText: {
    color: mistakeDetailPalette.green,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  overviewEmptyText: {
    color: mistakeDetailPalette.secondaryText,
    fontSize: 14,
    lineHeight: 20,
  },
  overviewNotePreview: {
    minHeight: 44,
    justifyContent: 'center',
  },
  overviewNoteText: {
    color: mistakeDetailPalette.text,
    fontSize: 14,
    lineHeight: 20,
  },
  relatedCountInline: {
    color: mistakeDetailPalette.secondaryText,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  compactImageList: {
    gap: spacing.md,
    paddingRight: spacing.xs,
    paddingBottom: spacing.xs,
  },
  supplementTextList: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  supplementTextRow: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  supplementTextTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  supplementTextBody: {
    marginTop: spacing.xs,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  reviewTimelineGroup: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mistakeDetailPalette.border,
    backgroundColor: mistakeDetailPalette.surface,
    overflow: 'hidden',
  },
  reviewTimelineItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: mistakeDetailPalette.border,
  },
  reviewTimelineHeader: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  timelinePressed: {
    backgroundColor: '#F7F7F9',
  },
  timelineStatusIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: mistakeDetailPalette.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineSummaryText: {
    flex: 1,
    minWidth: 0,
    color: mistakeDetailPalette.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  timelineDateText: {
    color: mistakeDetailPalette.secondaryText,
  },
  reviewTimelineEmpty: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  reviewTimelineEmptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: '#EFEFF2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewTimelineEmptyTitle: {
    color: mistakeDetailPalette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  reviewTimelineEmptyText: {
    color: mistakeDetailPalette.secondaryText,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  showMoreReviewsButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  showMoreReviewsText: {
    color: mistakeDetailPalette.green,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  moreMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.12)',
  },
  moreMenuCard: {
    position: 'absolute',
    right: spacing.screenPadding,
    width: 220,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mistakeDetailPalette.border,
    backgroundColor: mistakeDetailPalette.surface,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  moreMenuAction: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  moreMenuActionPressed: {
    backgroundColor: '#F1F1F4',
  },
  moreMenuActionText: {
    color: mistakeDetailPalette.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  moreMenuDeleteText: {
    color: '#C9342E',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  moreMenuDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 52,
    backgroundColor: mistakeDetailPalette.border,
  },
  stateCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  stateTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
  },
  stateMessage: {
    ...typography.body,
    color: colors.textSecondary,
  },
  stateActions: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statePrimaryButton: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.black,
    backgroundColor: colors.black,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statePrimaryButtonText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  stateSecondaryButton: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stateSecondaryButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  summaryCard: {
    borderRadius: radius.xl,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summaryMetaRow: {
    alignSelf: 'flex-start',
    borderRadius: radius.md,
    backgroundColor: '#EDF2EE',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  summaryMetaRowPressed: {
    opacity: 0.82,
  },
  summaryMetaRowDisabled: {
    opacity: 0.62,
  },
  summaryMeta: {
    ...typography.body,
    color: '#4E5A52',
    fontWeight: '700',
  },
  deleteMistakeButton: {
    minWidth: 78,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#F3C8C8',
    backgroundColor: '#FFF1F1',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  deleteMistakeButtonPressed: {
    opacity: 0.82,
  },
  deleteMistakeButtonDisabled: {
    opacity: 0.56,
  },
  deleteMistakeButtonText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '800',
  },
  summaryTitle: {
    ...typography.titleMedium,
    flexShrink: 1,
    fontSize: 22,
    lineHeight: 30,
    color: colors.success,
    fontWeight: '800',
    includeFontPadding: false,
  },
  summaryTitlePressable: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    justifyContent: 'center',
  },
  summaryTitlePressablePressed: {
    opacity: 0.86,
  },
  summaryTitleRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 36,
  },
  summaryTitleInput: {
    ...typography.titleMedium,
    flex: 1,
    fontSize: 22,
    lineHeight: 30,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: colors.success,
    fontWeight: '800',
    includeFontPadding: false,
  },
  titleSavingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  titleSavingDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
  },
  titleSavingText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  summaryInfoRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  summaryDateWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  summaryDateText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  summaryInfoDot: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '700',
  },
  summaryDifficultyText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  summaryMetadataPressable: {
    borderRadius: radius.sm,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  summaryMetadataPressablePressed: {
    opacity: 0.78,
  },
  summaryMetadataPressableDisabled: {
    opacity: 0.62,
  },
  summaryDivider: {
    marginTop: spacing.md,
    height: 1,
    backgroundColor: colors.border,
  },
  summaryBottomRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  reviewSummaryText: {
    ...typography.body,
    flexShrink: 0,
    color: colors.black,
    fontWeight: '800',
  },
  summaryDots: {
    flex: 1,
    justifyContent: 'center',
  },
  summaryInfoList: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  summaryInfoText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  tagSectionWrap: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  tagHeaderRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tagTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tagSubtitleText: {
    ...typography.caption,
    flexShrink: 1,
    color: colors.textMuted,
    fontWeight: '700',
  },
  tagHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagHeaderButton: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.xs,
    gap: 2,
  },
  tagHeaderButtonPressed: {
    backgroundColor: colors.successBg,
  },
  tagHeaderButtonDisabled: {
    opacity: 0.56,
  },
  tagHeaderButtonText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '900',
  },
  tagChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailTagChip: {
    maxWidth: 132,
  },
  detailTagChipText: {
    fontWeight: '800',
  },
  tagManageChip: {
    maxWidth: 148,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#F3C8C8',
    backgroundColor: '#FFF7F7',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 3,
  },
  tagManageChipPressed: {
    opacity: 0.82,
  },
  tagManageChipBusy: {
    opacity: 0.64,
  },
  tagManageChipText: {
    ...typography.bodySmall,
    minWidth: 0,
    color: colors.danger,
    fontWeight: '800',
  },
  tagEmptyText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '700',
  },
  addTagButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.successBorder,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 2,
  },
  addTagButtonPressed: {
    backgroundColor: colors.successBg,
  },
  addTagButtonDisabled: {
    opacity: 0.56,
  },
  addTagButtonText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '800',
  },
  noteEditorWrap: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  noteHeaderRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  noteTitleText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  noteEditIconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteEditIconWrapPressed: {
    opacity: 0.78,
  },
  noteEditIconWrapDisabled: {
    opacity: 0.56,
  },
  noteReadBox: {
    minHeight: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FCFCFD',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  noteReadText: {
    ...typography.bodySmall,
    minHeight: 74,
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  noteReadPlaceholderText: {
    color: colors.textMuted,
  },
  relatedFromPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    maxWidth: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  relatedFromPillPressed: {
    opacity: 0.82,
  },
  relatedFromText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '900',
  },
  relatedCard: {
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  relatedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  relatedTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  relatedSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  relatedHeaderAction: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    gap: 2,
  },
  relatedHeaderActionPressed: {
    backgroundColor: colors.successBg,
  },
  relatedHeaderActionText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '900',
  },
  relatedSummaryBox: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    gap: spacing.sm,
  },
  relatedSummaryBoxPressed: {
    opacity: 0.86,
  },
  relatedCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  relatedCountText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  relatedChipRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  relatedChipGreen: {
    maxWidth: 116,
    borderRadius: radius.pill,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  relatedChipGreenText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '800',
  },
  relatedChipBlue: {
    maxWidth: 112,
    borderRadius: radius.pill,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  relatedChipBlueText: {
    ...typography.caption,
    color: '#4F46E5',
    fontWeight: '800',
  },
  relatedChipOrange: {
    borderRadius: radius.pill,
    backgroundColor: '#FFF7ED',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  relatedChipOrangeText: {
    ...typography.caption,
    color: '#C2410C',
    fontWeight: '800',
  },
  relatedSourceLine: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  tagModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.screenPadding,
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
  },
  tagModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  tagModalSheet: {
    maxHeight: '86%',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  tagModalBodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  tagModalBodyContent: {
    gap: spacing.md,
  },
  tagModalHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  tagModalHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tagModalHeaderTextWrap: {
    flex: 1,
    gap: 2,
  },
  tagModalTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  tagModalSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  tagModalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagModalCloseButtonPressed: {
    opacity: 0.78,
  },
  tagModalMessage: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  tagInputWrap: {
    minHeight: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  tagInput: {
    ...typography.bodySmall,
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
    fontWeight: '700',
  },
  tagSuggestionSection: {
    gap: spacing.sm,
  },
  tagSuggestionTitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
  },
  tagSuggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tagSuggestionChip: {
    maxWidth: 132,
  },
  tagModalFooter: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  tagSecondaryButton: {
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
  tagPrimaryButton: {
    minWidth: 90,
    minHeight: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.black,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  tagModalButtonPressed: {
    opacity: 0.84,
  },
  tagModalButtonDisabled: {
    opacity: 0.56,
  },
  tagSecondaryButtonText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  tagPrimaryButtonText: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: '800',
  },
  modulePickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  modulePickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modulePickerSheet: {
    maxHeight: '88%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.screenPadding,
    gap: spacing.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  modulePickerHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: '#D1D1D6',
  },
  modulePickerHeader: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modulePickerHeaderTextWrap: {
    flex: 1,
    gap: 2,
  },
  modulePickerTitle: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  modulePickerSubtitle: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    fontWeight: '700',
  },
  modulePickerCancelButton: {
    minWidth: layout.minimumTouchSize,
    minHeight: layout.minimumTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modulePickerCancelButtonPressed: {
    opacity: 0.62,
  },
  modulePickerCancelText: {
    ...typography.body,
    color: colors.success,
    fontWeight: '600',
  },
  modulePickerMessage: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  modulePickerScroll: {
    flexGrow: 0,
  },
  modulePickerContent: {
    gap: spacing.xl,
    paddingBottom: spacing.sm,
  },
  modulePickerSection: {
    gap: spacing.md,
  },
  modulePickerSectionTitle: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    fontWeight: '700',
  },
  modulePickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  modulePickerOption: {
    width: '31.3%',
    minHeight: 64,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modulePickerOptionSelected: {
    borderColor: colors.success,
    backgroundColor: colors.success,
  },
  modulePickerOptionPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  modulePickerOptionDisabled: {
    opacity: 0.72,
  },
  modulePickerOptionText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '600',
    textAlign: 'center',
  },
  modulePickerOptionTextSelected: {
    color: colors.white,
  },
  modulePickerOptionCheck: {
    position: 'absolute',
    right: spacing.md,
  },
  modulePickerConfirmButton: {
    minHeight: layout.primaryButtonHeight,
    borderRadius: radius.control,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modulePickerConfirmButtonPressed: {
    backgroundColor: colors.accentPressed,
  },
  modulePickerConfirmButtonDisabled: {
    backgroundColor: colors.accentDisabled,
  },
  modulePickerConfirmText: {
    fontSize: 18,
    lineHeight: 24,
    color: colors.white,
    fontWeight: '800',
  },
  metadataModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  metadataModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  metadataModalSheet: {
    height: '78%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
    paddingTop: spacing.md,
    shadowColor: colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  metadataModalHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: '#D1D1D6',
  },
  metadataModalHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  metadataModalHeaderAction: {
    width: 52,
    minHeight: layout.minimumTouchSize,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  metadataModalSaveAction: {
    alignItems: 'flex-end',
  },
  metadataModalHeaderActionPressed: {
    opacity: 0.62,
  },
  metadataModalCancelText: {
    fontSize: 17,
    lineHeight: 24,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  metadataModalSaveText: {
    fontSize: 17,
    lineHeight: 24,
    color: colors.success,
    fontWeight: '700',
  },
  metadataModalTitle: {
    flex: 1,
    fontSize: 23,
    lineHeight: 30,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  metadataModalSubtitle: {
    ...typography.bodySmall,
    marginTop: spacing.xs,
    color: colors.textTertiary,
    fontWeight: '700',
    textAlign: 'center',
  },
  metadataModalMessage: {
    ...typography.caption,
    marginTop: spacing.md,
    marginHorizontal: spacing.xl,
    color: colors.danger,
    fontWeight: '700',
    textAlign: 'center',
  },
  metadataModalScroll: {
    flex: 1,
    marginTop: spacing.xl,
  },
  metadataModalContent: {
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  metadataSection: {
    gap: spacing.lg,
  },
  metadataSectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  metadataReasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metadataReasonCard: {
    minWidth: '29%',
    minHeight: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  metadataReasonCardSelected: {
    borderColor: colors.success,
    backgroundColor: colors.successBg,
  },
  metadataReasonCardPressed: {
    backgroundColor: colors.surface,
  },
  metadataReasonCardText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '700',
    textAlign: 'center',
  },
  metadataReasonCardTextSelected: {
    color: colors.success,
  },
  metadataReasonCheck: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metadataDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  metadataDifficultyControl: {
    minHeight: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  metadataDifficultyOption: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  metadataDifficultyOptionSelected: {
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  metadataDifficultyOptionPressed: {
    backgroundColor: colors.surface,
  },
  metadataDifficultyText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
    fontWeight: '700',
    textAlign: 'center',
  },
  metadataDifficultyTextSelected: {
    color: colors.success,
    fontWeight: '800',
  },
  metadataDifficultyHint: {
    ...typography.caption,
    color: colors.textTertiary,
    fontWeight: '600',
  },
  metadataModalButtonDisabled: {
    opacity: 0.56,
  },
  imagesSectionCard: {
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  imagesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  refreshButton: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  refreshButtonDisabled: {
    opacity: 0.6,
  },
  refreshButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  slotList: {
    gap: spacing.sm,
  },
  reviewRecordsCard: {
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  reviewRecordsNextReviewWrap: {
    gap: 2,
  },
  reviewRecordsNextReviewLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  reviewRecordsNextReviewText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  detailReviewButton: {
    marginTop: spacing.md,
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: colors.success,
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  detailReviewButtonPressed: {
    opacity: 0.86,
  },
  detailReviewButtonDisabled: {
    opacity: 0.58,
  },
  detailReviewButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  detailReviewButtonText: {
    ...typography.sectionTitle,
    color: colors.white,
    fontWeight: '800',
  },
  browseSummaryText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  browseHintText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  reviewRecordsNextReviewTextSuccess: {
    color: colors.success,
  },
  reviewRecordsNextReviewTextMuted: {
    color: colors.textMuted,
  },
  reviewRecordsNextReviewTextDanger: {
    color: colors.danger,
  },
  reviewRecordsEmptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  reviewRecordsList: {
    gap: spacing.sm,
  },
  reviewRecordRow: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  reviewRecordMain: {
    flex: 1,
    gap: spacing.xs,
  },
  reviewRecordTitle: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  reviewRecordMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  reviewRecordVoiceRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  reviewRecordVoiceText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  reviewRecordVoiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reviewRecordVoiceButtonDanger: {
    borderColor: colors.danger,
    backgroundColor: colors.danger,
  },
  reviewRecordVoiceButtonDisabled: {
    opacity: 0.6,
  },
  reviewRecordVoiceButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 11,
    lineHeight: 14,
  },
  reviewRecordVoiceButtonTextLight: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
    fontSize: 11,
    lineHeight: 14,
  },
  reviewRecordTextNote: {
    marginTop: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: '#FAFAFF',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 2,
  },
  reviewRecordTextNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  reviewRecordTextNoteHeaderTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  reviewRecordTextNoteLabel: {
    ...typography.caption,
    color: '#6D28D9',
    fontWeight: '700',
  },
  reviewRecordTextNoteContent: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  reviewRecordTextEmptyRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  reviewRecordTextEmptyText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  reviewRecordTextAddButton: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: '#FAFAFF',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reviewRecordPreviewWrap: {
    width: 72,
    alignItems: 'center',
    gap: 2,
  },
  reviewRecordImageWrap: {
    width: 68,
    height: 68,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    position: 'relative',
  },
  reviewRecordImage: {
    width: '100%',
    height: '100%',
  },
  previewTapPressed: {
    opacity: 0.84,
  },
  reviewRecordMoreButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewRecordMoreButtonPressed: {
    opacity: 0.86,
  },
  reviewRecordBusyMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.68)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewRecordPreviewHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 12,
  },
  reviewRecordEmptyThumb: {
    width: 68,
    height: 68,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    position: 'relative',
  },
  reviewRecordMissingThumb: {
    borderStyle: 'solid',
    backgroundColor: colors.surfaceMuted,
  },
  reviewRecordEmptyText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 10,
    lineHeight: 12,
  },
});
