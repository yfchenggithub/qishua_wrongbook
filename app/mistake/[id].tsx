import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  type GestureResponderEvent,
  Image,
  Linking,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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
  BrandHeader,
  CardContainer,
  MistakeImageBrowser,
  MistakeImageSection,
  ProgressDots,
  ScreenContainer,
  SectionTitle,
  StatusPill,
} from '@/src/components';
import { useMistakeDetailImages } from '@/src/hooks/useMistakeDetailImages';
import type {
  DetailImageSlot,
  DetailImageSlotType,
  DetailReviewRecordItem,
  MistakeDetailViewModel,
} from '@/src/models/MistakeDetailViewModel';
import type { ReviewRecordVoiceNote } from '@/src/models/ReviewRecord';
import * as ImageService from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import * as ReviewRecordImageService from '@/src/services/ReviewRecordImageService';
import * as ReviewRecordVoiceService from '@/src/services/ReviewRecordVoiceService';
import type { VoiceNoteEntity } from '@/src/services/VoiceNoteService';
import * as VoiceNoteService from '@/src/services/VoiceNoteService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';
import { formatDateShort } from '@/src/utils/date';
import { resolveNextReviewAtText } from '@/src/utils/reviewSchedule';

const BRAND = {
  title: '七刷错题本',
  subtitle: '详情来自本地离线数据',
} as const;

const PAGE_SCOPE = 'MistakeDetailScreen';
const TOAST_DURATION_DEFAULT = 2000;
const TOAST_DURATION_LONG = 3200;
const TOAST_DURATION_SHORT = 1400;
const TITLE_DOUBLE_TAP_WINDOW_MS = 280;
const NOTE_DOUBLE_TAP_WINDOW_MS = 300;
const NOTE_SAVE_DEBOUNCE_MS = 800;
const NOTE_MAX_LENGTH = MistakeDetailService.MISTAKE_DETAIL_NOTE_MAX_LENGTH;
const NOTE_PLACEHOLDER = '点击输入备注，记录你的思考或重点...';
const VOICE_PLAYBACK_END_BUFFER_MS = 280;
const VOICE_RECORDING_MIN_DURATION_MS = 3000;
const VOICE_RECORDING_MAX_DURATION_MS = 3 * 60 * 1000;
const VOICE_FILE_MISSING_MESSAGE = '语音文件不存在，可能已被删除或未恢复';
const TOP_PULL_TRIGGER_DISTANCE = 2;
const TOP_PULL_RELEASE_DISTANCE = 20;
const BOTTOM_TRIGGER_DISTANCE = 20;
const BOTTOM_RELEASE_DISTANCE = 52;
const EDGE_PULL_TRIGGER_DISTANCE = 42;
const EDGE_END_DRAG_VELOCITY_MIN = 0.55;
const PAGE_SWITCH_ANIMATION_DISTANCE = 34;
const PAGE_SWITCH_ANIMATION_DURATION_MS = 180;

type ToastType = 'success' | 'info' | 'error';
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

function mapStatusToTone(status: MistakeDetailViewModel['status']): 'dark' | 'light' | 'success' {
  if (status === 'mastered') {
    return 'success';
  }
  if (status === 'archived') {
    return 'light';
  }
  return 'dark';
}

function buildCurrentReviewIndex(detail: MistakeDetailViewModel): number | undefined {
  if (detail.reviewCount >= detail.maxReviewCount) {
    return undefined;
  }
  return Math.min(detail.maxReviewCount, detail.reviewCount + 1);
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

function getToastBackgroundColor(type: ToastType): string {
  if (type === 'success') {
    return 'rgba(24, 38, 30, 0.95)';
  }
  if (type === 'error') {
    return 'rgba(88, 28, 28, 0.95)';
  }
  return 'rgba(38, 44, 53, 0.95)';
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
  onAddImage,
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
  onAddImage?: (record: DetailReviewRecordItem) => void;
  onPreview?: (targetImageId: string) => void;
  onOpenImageActions?: (record: DetailReviewRecordItem) => void;
  onToggleVoicePlayback?: (record: DetailReviewRecordItem) => void;
  onStartVoiceRecording?: (record: DetailReviewRecordItem) => void;
  onStopAndSaveVoiceRecording?: (record: DetailReviewRecordItem) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [record.solutionImageExists, record.solutionImageUri]);

  const normalizedUri = normalizePreviewUri(record.solutionImageUri);
  const hasImage = !!normalizedUri;
  const imageExists = record.solutionImageExists !== false;
  const canShowImage = hasImage && imageExists && !imageFailed;
  const voiceNote = record.voiceNote ?? null;
  const voiceAddDisabled = isVoiceBusy || isVoiceLocked;
  const voiceAddButtonText = isVoiceLocked ? '其他录音中' : isVoiceBusy ? '处理中...' : '补充语音';

  return (
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

export default function MistakeDetailScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { id, switchFrom } = useLocalSearchParams<{
    id?: string | string[];
    switchFrom?: string | string[];
  }>();
  const routeId = useMemo(() => normalizeRouteId(id), [id]);
  const routeSwitchFrom = useMemo(() => normalizeSwitchFrom(switchFrom), [switchFrom]);

  const [state, setState] = useState<DetailPageState>({ kind: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [imageBrowserVisible, setImageBrowserVisible] = useState(false);
  const [imageBrowserInitialIndex, setImageBrowserInitialIndex] = useState(0);
  const [imageBrowserItems, setImageBrowserItems] = useState<DetailImagePreviewItem[]>([]);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [isNoteFocused, setIsNoteFocused] = useState(false);
  const [isNoteEditing, setIsNoteEditing] = useState(false);
  const [isNoteModalVisible, setIsNoteModalVisible] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isDeletingMistake, setIsDeletingMistake] = useState(false);
  const [activeReviewRecordId, setActiveReviewRecordId] = useState<string | null>(null);
  const [activeVoiceRecordId, setActiveVoiceRecordId] = useState<string | null>(null);
  const [isVoicePlaybackBusy, setIsVoicePlaybackBusy] = useState(false);
  const [activeVoiceRecordingRecordId, setActiveVoiceRecordingRecordId] = useState<string | null>(null);
  const [isVoiceRecordingBusy, setIsVoiceRecordingBusy] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [browseContext, setBrowseContext] =
    useState<MistakeDetailService.DetailBrowseContext>(EMPTY_BROWSE_CONTEXT);

  const requestIdRef = useRef(0);
  const browseRequestIdRef = useRef(0);
  const hasFocusedRef = useRef(false);
  const titleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteInputRef = useRef<TextInput | null>(null);
  const lastNoteReadTapAtRef = useRef(0);
  const latestNoteInputRef = useRef('');
  const syncedNoteInputRef = useRef('');
  const syncedNoteMistakeIdRef = useRef<string | null>(null);
  const lastNoteSaveFailedValueRef = useRef<string | null>(null);
  const voicePlaybackResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const voiceStopInProgressRef = useRef(false);
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
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allowNextLeaveRef = useRef(false);
  const switchToastKeyRef = useRef<string | null>(null);
  const [titleSelectAllOnFocus, setTitleSelectAllOnFocus] = useState(false);

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

  const clearNoteSaveTimer = useCallback(() => {
    if (noteSaveTimerRef.current) {
      clearTimeout(noteSaveTimerRef.current);
      noteSaveTimerRef.current = null;
    }
  }, []);

  const handleSaveNote = useCallback(
    async (nextValue?: string) => {
      if (state.kind !== 'success' || isSavingNote) {
        return;
      }

      const rawNextNote = typeof nextValue === 'string' ? nextValue : latestNoteInputRef.current;
      const normalizedNextNote = normalizeNoteDraft(rawNextNote);
      const normalizedCurrentNote = normalizeNoteDraft(state.detail.note ?? null);
      if (normalizedNextNote === normalizedCurrentNote) {
        return;
      }

      setIsSavingNote(true);
      try {
        const result = await MistakeDetailService.updateMistakeNote({
          mistakeId: state.detail.id,
          note: normalizedNextNote.length > 0 ? normalizedNextNote : null,
        });

        if (!result.ok || !result.detail) {
          lastNoteSaveFailedValueRef.current = normalizedNextNote;
          showToast(result.errorMessage ?? '备注保存失败，请重试。', 'error');
          return;
        }

        const updatedDetail = result.detail;
        lastNoteSaveFailedValueRef.current = null;
        setState((current) => {
          if (current.kind !== 'success' || current.detail.id !== updatedDetail.id) {
            return current;
          }
          return {
            kind: 'success',
            detail: updatedDetail,
          };
        });
      } catch (error) {
        lastNoteSaveFailedValueRef.current = normalizedNextNote;
        Logger.error(PAGE_SCOPE, 'Unexpected error while updating note.', {
          routeId,
          error,
        });
        showToast(
          error instanceof Error ? error.message : '备注保存失败，请重试。',
          'error',
        );
      } finally {
        setIsSavingNote(false);
      }
    },
    [isSavingNote, routeId, showToast, state],
  );

  const handleChangeNote = useCallback((value: string) => {
    const nextValue = clampNoteDraft(value);
    latestNoteInputRef.current = nextValue;
    const normalizedNextValue = normalizeNoteDraft(nextValue);
    if (lastNoteSaveFailedValueRef.current !== normalizedNextValue) {
      lastNoteSaveFailedValueRef.current = null;
    }
    setNoteInput(nextValue);
  }, []);

  const handleNoteBlur = useCallback(() => {
    setIsNoteFocused(false);
    clearNoteSaveTimer();
    void handleSaveNote(latestNoteInputRef.current);
  }, [clearNoteSaveTimer, handleSaveNote]);

  const handleStartNoteEdit = useCallback(() => {
    if (isDeletingMistake) {
      return;
    }

    setIsNoteModalVisible(false);
    setIsNoteEditing(true);
  }, [isDeletingMistake]);

  const handleFinishNoteEdit = useCallback(() => {
    setIsNoteEditing(false);
    setIsNoteFocused(false);
    noteInputRef.current?.blur();
    clearNoteSaveTimer();
    void handleSaveNote(latestNoteInputRef.current);
  }, [clearNoteSaveTimer, handleSaveNote]);

  const handleToggleNoteEdit = useCallback(() => {
    if (isNoteEditing) {
      handleFinishNoteEdit();
      return;
    }

    handleStartNoteEdit();
  }, [handleFinishNoteEdit, handleStartNoteEdit, isNoteEditing]);

  const handlePressNoteRead = useCallback(() => {
    if (isNoteEditing) {
      return;
    }

    const now = Date.now();
    if (now - lastNoteReadTapAtRef.current <= NOTE_DOUBLE_TAP_WINDOW_MS) {
      lastNoteReadTapAtRef.current = 0;
      setIsNoteModalVisible(true);
      return;
    }

    lastNoteReadTapAtRef.current = now;
  }, [isNoteEditing]);

  const handleCloseNoteModal = useCallback(() => {
    setIsNoteModalVisible(false);
  }, []);

  const handleClearNote = useCallback(() => {
    if (!isNoteEditing || isSavingNote) {
      return;
    }

    clearNoteSaveTimer();
    lastNoteSaveFailedValueRef.current = null;
    latestNoteInputRef.current = '';
    setNoteInput('');
    void handleSaveNote('');
  }, [clearNoteSaveTimer, handleSaveNote, isNoteEditing, isSavingNote]);

  const clearVoicePlaybackResetTimer = useCallback(() => {
    if (voicePlaybackResetTimerRef.current) {
      clearTimeout(voicePlaybackResetTimerRef.current);
      voicePlaybackResetTimerRef.current = null;
    }
  }, []);

  const stopVoicePlayback = useCallback(
    async (showErrorToast = false) => {
      clearVoicePlaybackResetTimer();
      setActiveVoiceRecordId(null);

      const stopResult = await VoiceNoteService.stopPlaying();
      if (!stopResult.ok) {
        Logger.warn(PAGE_SCOPE, 'Failed to stop detail review voice playback.', {
          errorMessage: stopResult.errorMessage ?? null,
        });
        if (showErrorToast) {
          showToast(toBriefErrorMessage(stopResult.errorMessage), 'error');
        }
      }
    },
    [clearVoicePlaybackResetTimer, showToast],
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
      return true;
    }

    const discardResult = await VoiceNoteService.stopAndDiscardRecording();
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
  }, [activeVoiceRecordingRecordId, clearVoiceRecordingState]);

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

      const startResult = await VoiceNoteService.startRecording();
      if (!startResult.ok) {
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

      const playResult = await VoiceNoteService.playVoiceNote(fileUri);
      if (!playResult.ok) {
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
      }, Math.max(voiceNote.durationMs + VOICE_PLAYBACK_END_BUFFER_MS, 1000));

      setIsVoicePlaybackBusy(false);
    },
    [
      activeVoiceRecordingRecordId,
      activeVoiceRecordId,
      clearVoicePlaybackResetTimer,
      isVoicePlaybackBusy,
      showToast,
      stopVoicePlayback,
    ],
  );

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
        void VoiceNoteService.stopPlaying();
        void VoiceNoteService.stopAndDiscardRecording();
      };
    }, [clearVoicePlaybackResetTimer, clearVoiceRecordingState]),
  );

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      if (titleTapTimerRef.current) {
        clearTimeout(titleTapTimerRef.current);
        titleTapTimerRef.current = null;
      }
      if (noteSaveTimerRef.current) {
        clearTimeout(noteSaveTimerRef.current);
        noteSaveTimerRef.current = null;
      }
      if (voicePlaybackResetTimerRef.current) {
        clearTimeout(voicePlaybackResetTimerRef.current);
        voicePlaybackResetTimerRef.current = null;
      }
      voiceRecordingStartedAtRef.current = null;
      voiceStopInProgressRef.current = false;
      void VoiceNoteService.stopPlaying();
      void VoiceNoteService.stopAndDiscardRecording();
    },
    [],
  );

  useEffect(() => {
    latestNoteInputRef.current = noteInput;
  }, [noteInput]);

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
      clearNoteSaveTimer();
      latestNoteInputRef.current = '';
      syncedNoteInputRef.current = '';
      syncedNoteMistakeIdRef.current = null;
      setNoteInput('');
      setIsNoteEditing(false);
      setIsNoteFocused(false);
      setIsNoteModalVisible(false);
      lastNoteSaveFailedValueRef.current = null;
      return;
    }

    if (isNoteEditing || isNoteFocused || isSavingNote) {
      return;
    }

    const nextNoteInput = state.detail.note ?? '';
    const previousSyncedNoteInput = syncedNoteInputRef.current;
    const isSameMistake = syncedNoteMistakeIdRef.current === state.detail.id;
    const isLocalNoteDirty =
      isSameMistake
      && normalizeNoteDraft(noteInput) !== normalizeNoteDraft(previousSyncedNoteInput);

    syncedNoteInputRef.current = nextNoteInput;
    syncedNoteMistakeIdRef.current = state.detail.id;
    if (isLocalNoteDirty) {
      return;
    }

    latestNoteInputRef.current = nextNoteInput;
    setNoteInput((current) => (current === nextNoteInput ? current : nextNoteInput));
    lastNoteSaveFailedValueRef.current = null;
  }, [clearNoteSaveTimer, isNoteEditing, isNoteFocused, isSavingNote, noteInput, state]);

  useEffect(() => {
    if (state.kind !== 'success' || isSavingNote) {
      return;
    }

    const normalizedNoteInput = normalizeNoteDraft(noteInput);
    const normalizedCurrentNote = normalizeNoteDraft(state.detail.note ?? null);
    if (normalizedNoteInput === normalizedCurrentNote) {
      lastNoteSaveFailedValueRef.current = null;
      return;
    }

    if (lastNoteSaveFailedValueRef.current === normalizedNoteInput) {
      return;
    }

    clearNoteSaveTimer();
    noteSaveTimerRef.current = setTimeout(() => {
      noteSaveTimerRef.current = null;
      void handleSaveNote(latestNoteInputRef.current);
    }, NOTE_SAVE_DEBOUNCE_MS);

    return () => {
      clearNoteSaveTimer();
    };
  }, [clearNoteSaveTimer, handleSaveNote, isSavingNote, noteInput, state]);

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
    || isRefreshing
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

    return browseContext.mode === 'today_due' && browseContext.ids.includes(state.detail.id);
  }, [browseContext.ids, browseContext.mode, state]);
  const isStartDetailReviewDisabled = isDeleteMistakeDisabled;
  const hasNoteContent = normalizeNoteDraft(noteInput).length > 0;
  const noteReadText = hasNoteContent ? noteInput : '暂无备注';
  const isNoteClearDisabled = !isNoteEditing || isSavingNote || noteInput.length <= 0;

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

    if (scrollBoundaryLockRef.current === 'bottom' && y < maxScrollY - BOTTOM_RELEASE_DISTANCE) {
      scrollBoundaryLockRef.current = null;
    }
    if (scrollBoundaryLockRef.current === 'top' && y > TOP_PULL_RELEASE_DISTANCE) {
      scrollBoundaryLockRef.current = null;
    }
  }, []);

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

  return (
    <View style={styles.pageRoot}>
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
          contentStyle={styles.screenContent}
          onScroll={handleDetailScroll}
          onScrollBeginDrag={handleDetailScrollBeginDrag}
          onScrollEndDrag={handleDetailScrollEndDrag}
          onTouchStart={handleDetailTouchStart}
          onTouchMove={handleDetailTouchMove}
          onTouchEnd={handleDetailTouchEnd}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backText}>← 返回今日任务</Text>
        </Pressable>

        <BrandHeader title={BRAND.title} subtitle={BRAND.subtitle} />

        {state.kind === 'loading' ? (
          <CardContainer style={styles.loadingCard} padding={spacing.lg}>
            <ActivityIndicator size="small" color={colors.textPrimary} />
            <Text style={styles.loadingText}>正在加载错题...</Text>
          </CardContainer>
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
            <CardContainer style={styles.summaryCard} padding={spacing.xl}>
              <View style={styles.summaryHeaderRow}>
                <View style={styles.summaryMetaRow}>
                  <Text style={styles.summaryMeta}>{state.detail.module}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="删除错题"
                  disabled={isDeleteMistakeDisabled}
                  onPress={handlePressDeleteMistake}
                  style={({ pressed }) => [
                    styles.deleteMistakeButton,
                    pressed && !isDeleteMistakeDisabled && styles.deleteMistakeButtonPressed,
                    isDeleteMistakeDisabled && styles.deleteMistakeButtonDisabled,
                  ]}>
                  {isDeletingMistake ? (
                    <ActivityIndicator size="small" color={colors.danger} />
                  ) : (
                    <MaterialIcons name="delete-outline" size={17} color={colors.danger} />
                  )}
                  <Text style={styles.deleteMistakeButtonText}>
                    {isDeletingMistake ? '删除中...' : '删除'}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.summaryTitleRow}>
                {isTitleEditing ? (
                  <TextInput
                    value={titleInput}
                    onChangeText={setTitleInput}
                    editable={!isSavingTitle}
                    placeholder="请输入题目名字"
                    placeholderTextColor={colors.textMuted}
                    style={styles.summaryTitleInput}
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
                    accessibilityLabel="点击编辑题目名字"
                    onPress={handlePressTitle}
                    disabled={isSavingTitle}
                    style={({ pressed }) => [
                      styles.summaryTitlePressable,
                      pressed && styles.summaryTitlePressablePressed,
                    ]}>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={styles.summaryTitle}>
                      {state.detail.title}
                    </Text>
                  </Pressable>
                )}
                {isSavingTitle ? (
                  <View style={styles.titleSavingWrap}>
                    <View style={styles.titleSavingDot} />
                    <Text style={styles.titleSavingText}>保存中...</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.summaryInfoRow}>
                <View style={styles.summaryDateWrap}>
                  <MaterialIcons name="calendar-month" size={18} color={colors.textMuted} />
                  <Text style={styles.summaryDateText}>{formatDateShort(state.detail.createdAt)}</Text>
                </View>
                <Text style={styles.summaryInfoDot}>·</Text>
                <Text style={styles.summaryDifficultyText}>难度 {state.detail.difficulty}</Text>
              </View>

              <View style={styles.summaryDivider} />

              <View style={styles.summaryBottomRow}>
                <View style={styles.progressLabelWrap}>
                  <Text style={styles.progressNumber}>{state.detail.reviewCount}</Text>
                  <Text style={styles.progressText}>/{state.detail.maxReviewCount}</Text>
                </View>

                <ProgressDots
                  total={state.detail.maxReviewCount}
                  current={buildCurrentReviewIndex(state.detail)}
                  completed={state.detail.reviewCount}
                  style={styles.summaryDots}
                />

                <StatusPill label={state.detail.statusLabel} tone={mapStatusToTone(state.detail.status)} />
              </View>

              {state.detail.errorReason ? (
                <View style={styles.summaryInfoList}>
                  <Text style={styles.summaryInfoText}>错因：{state.detail.errorReason}</Text>
                </View>
              ) : null}

              <View style={styles.noteEditorWrap}>
                <View style={styles.noteHeaderRow}>
                  <Text style={styles.noteTitleText}>备注</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={isNoteEditing ? '完成备注编辑' : '编辑备注'}
                    disabled={isDeletingMistake}
                    onPress={handleToggleNoteEdit}
                    style={({ pressed }) => [
                      styles.noteEditIconWrap,
                      isNoteEditing && styles.noteEditIconWrapActive,
                      pressed && !isDeletingMistake && styles.noteEditIconWrapPressed,
                      isDeletingMistake && styles.noteEditIconWrapDisabled,
                    ]}>
                    <MaterialIcons
                      name="edit"
                      size={20}
                      color={isNoteEditing ? colors.success : colors.textMuted}
                    />
                  </Pressable>
                </View>

                {isNoteEditing ? (
                  <>
                    <View style={[
                      styles.noteInputBox,
                      isNoteFocused && styles.noteInputBoxFocused,
                    ]}>
                      <TextInput
                        ref={noteInputRef}
                        value={noteInput}
                        onChangeText={handleChangeNote}
                        editable={!isDeletingMistake}
                        placeholder={NOTE_PLACEHOLDER}
                        placeholderTextColor={colors.textMuted}
                        multiline
                        autoFocus
                        maxLength={NOTE_MAX_LENGTH}
                        numberOfLines={4}
                        scrollEnabled
                        textAlignVertical="top"
                        style={styles.noteInput}
                        onFocus={() => {
                          setIsNoteFocused(true);
                        }}
                        onBlur={handleNoteBlur}
                      />
                      <Text style={styles.noteCounterText}>
                        {noteInput.length}/{NOTE_MAX_LENGTH}
                      </Text>
                    </View>

                    <View style={styles.noteFooterRow}>
                      <View style={styles.noteSaveStatusRow}>
                        {isSavingNote ? (
                          <ActivityIndicator size="small" color={colors.success} />
                        ) : (
                          <MaterialIcons name="check-circle" size={16} color={colors.success} />
                        )}
                        <Text style={styles.noteSaveStatusText}>
                          {isSavingNote ? '备注保存中...' : '备注将自动保存'}
                        </Text>
                      </View>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="清空备注"
                        disabled={isNoteClearDisabled}
                        onPress={handleClearNote}
                        style={({ pressed }) => [
                          styles.noteClearButton,
                          pressed && !isNoteClearDisabled && styles.noteClearButtonPressed,
                          isNoteClearDisabled && styles.noteClearButtonDisabled,
                        ]}>
                        <MaterialIcons
                          name="delete-outline"
                          size={16}
                          color={isNoteClearDisabled ? colors.textMuted : colors.textSecondary}
                        />
                        <Text
                          style={[
                            styles.noteClearButtonText,
                            isNoteClearDisabled && styles.noteClearButtonTextDisabled,
                          ]}>
                          清空
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="备注内容，双击查看全部"
                    onPress={handlePressNoteRead}
                    style={({ pressed }) => [
                      styles.noteReadBox,
                      pressed && styles.noteReadBoxPressed,
                    ]}>
                    <Text
                      numberOfLines={4}
                      style={[
                        styles.noteReadText,
                        !hasNoteContent && styles.noteReadPlaceholderText,
                      ]}>
                      {noteReadText}
                    </Text>
                    <View style={styles.noteReadFooterRow}>
                      <Text style={styles.noteReadHintText}>双击查看全部</Text>
                      <Text style={styles.noteReadCounterText}>
                        {noteInput.length}/{NOTE_MAX_LENGTH}
                      </Text>
                    </View>
                  </Pressable>
                )}
              </View>
            </CardContainer>

            <CardContainer style={styles.imagesSectionCard} padding={spacing.lg}>
              <View style={styles.imagesHeaderRow}>
                <SectionTitle title="图片管理" />
                <Pressable
                  onPress={() => void loadDetail({ keepCurrent: true })}
                  disabled={
                    isRefreshing
                    || isSavingNote
                    || takePhotoType !== null
                    || pickImageType !== null
                    || deleteType !== null
                    || activeReviewRecordId !== null
                    || activeVoiceRecordingRecordId !== null
                    || isVoiceRecordingBusy
                  }
                  style={[
                    styles.refreshButton,
                    (isRefreshing
                      || isSavingNote
                      || takePhotoType !== null
                      || pickImageType !== null
                      || deleteType !== null
                      || activeReviewRecordId !== null
                      || activeVoiceRecordingRecordId !== null
                      || isVoiceRecordingBusy)
                      && styles.refreshButtonDisabled,
                  ]}>
                  <Text style={styles.refreshButtonText}>{isRefreshing ? '刷新中...' : '刷新'}</Text>
                </Pressable>
              </View>

              <View style={styles.slotList}>
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
                      emptyText={slot.emptyText}
                      loadErrorText={slotType === 'question' ? '题目图片加载失败' : '图片加载失败'}
                      isBusy={isTypeBusy(slotType)}
                      isTakePhotoLoading={takePhotoType === slotType}
                      isPickImageLoading={pickImageType === slotType}
                      isDeleteLoading={deleteType === slotType}
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
              </View>
            </CardContainer>

            <CardContainer style={styles.reviewRecordsCard} padding={spacing.lg}>
              <SectionTitle title="复做记录" />
              <View style={styles.reviewRecordsNextReviewWrap}>
                <Text style={styles.reviewRecordsNextReviewLabel}>下一次复做</Text>
                <Text
                  style={[
                    styles.reviewRecordsNextReviewText,
                    nextReviewInfo?.tone === 'success' && styles.reviewRecordsNextReviewTextSuccess,
                    nextReviewInfo?.tone === 'muted' && styles.reviewRecordsNextReviewTextMuted,
                    nextReviewInfo?.tone === 'danger' && styles.reviewRecordsNextReviewTextDanger,
                  ]}>
                  {nextReviewInfo?.displayText ?? '⏳ 待安排（完成本次复做后自动生成）'}
                </Text>
              </View>
              {canStartDetailReview ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="立即复做这道错题"
                  disabled={isStartDetailReviewDisabled}
                  onPress={handleStartDetailReview}
                  style={({ pressed }) => [
                    styles.detailReviewButton,
                    pressed && !isStartDetailReviewDisabled && styles.detailReviewButtonPressed,
                    isStartDetailReviewDisabled && styles.detailReviewButtonDisabled,
                  ]}>
                  <View style={styles.detailReviewButtonContent}>
                    <MaterialIcons name="edit" size={22} color={colors.white} />
                    <Text style={styles.detailReviewButtonText}>立即复做</Text>
                  </View>
                </Pressable>
              ) : null}
              {state.detail.reviewRecords.length <= 0 ? (
                <Text style={styles.reviewRecordsEmptyText}>还没有复做记录</Text>
              ) : (
                <View style={styles.reviewRecordsList}>
                  {state.detail.reviewRecords.map((record) => (
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
                      onAddImage={(targetRecord) => {
                        openReviewImagePickerActionSheet(targetRecord, 'add');
                      }}
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
                  ))}
                </View>
              )}
              {browseSummaryText ? <Text style={styles.browseSummaryText}>{browseSummaryText}</Text> : null}
              {browseContext.ids.length > 1 ? (
                <Text style={styles.browseHintText}>
                  在边界快速拉动可切题：底部切下一题，顶部切上一题
                </Text>
              ) : null}
            </CardContainer>

          </>
        ) : null}

        <MistakeImageBrowser
          visible={imageBrowserVisible}
          items={imageBrowserItems}
          initialIndex={imageBrowserInitialIndex}
          onClose={handleCloseImageBrowser}
        />
        </ScreenContainer>
      </Animated.View>

      <Modal
        visible={isNoteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseNoteModal}>
        <View
          style={[
            styles.noteModalOverlay,
            {
              paddingTop: Math.max(insets.top + spacing.xl, spacing.xxl),
              paddingBottom: Math.max(insets.bottom + spacing.xl, spacing.xxl),
            },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭备注大窗口"
            style={styles.noteModalBackdrop}
            onPress={handleCloseNoteModal}
          />
          <View style={styles.noteModalCard}>
            <View style={styles.noteModalHeaderRow}>
              <View style={styles.noteModalTitleWrap}>
                <Text style={styles.noteModalTitle}>备注</Text>
                <Text style={styles.noteModalSubtitle}>
                  {noteInput.length}/{NOTE_MAX_LENGTH}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭备注大窗口"
                onPress={handleCloseNoteModal}
                style={({ pressed }) => [
                  styles.noteModalCloseButton,
                  pressed && styles.noteModalCloseButtonPressed,
                ]}>
                <MaterialIcons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.noteModalScroll}
              contentContainerStyle={styles.noteModalScrollContent}>
              <Text
                selectable
                style={[
                  styles.noteModalText,
                  !hasNoteContent && styles.noteReadPlaceholderText,
                ]}>
                {noteReadText}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

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
            <Text maxFontSizeMultiplier={1.1} style={styles.toastText}>
              {toastMessage}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
  },
  pageEnterLayer: {
    flex: 1,
  },
  screenContent: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl + layout.bottomTabHeight,
    gap: spacing.lg,
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
    borderRadius: radius.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
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
    fontSize: 22,
    lineHeight: 30,
    color: colors.success,
    fontWeight: '800',
    includeFontPadding: false,
  },
  summaryTitlePressable: {
    flex: 1,
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
  progressLabelWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  progressNumber: {
    ...typography.titleMedium,
    fontSize: 42,
    lineHeight: 46,
  },
  progressText: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 18,
    lineHeight: 24,
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
  noteEditIconWrapActive: {
    backgroundColor: colors.successBg,
  },
  noteEditIconWrapPressed: {
    opacity: 0.78,
  },
  noteEditIconWrapDisabled: {
    opacity: 0.56,
  },
  noteInputBox: {
    minHeight: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FCFCFD',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
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
  noteReadBoxPressed: {
    borderColor: colors.successBorder,
    backgroundColor: '#FBFFFC',
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
  noteReadFooterRow: {
    minHeight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  noteReadHintText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  noteReadCounterText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    fontWeight: '600',
  },
  noteInputBoxFocused: {
    borderColor: colors.successBorder,
    backgroundColor: '#FBFFFC',
  },
  noteInput: {
    ...typography.bodySmall,
    minHeight: 74,
    color: colors.textPrimary,
    padding: 0,
    includeFontPadding: false,
  },
  noteCounterText: {
    ...typography.caption,
    marginTop: spacing.xs,
    color: colors.textMuted,
    textAlign: 'right',
    fontWeight: '600',
  },
  noteFooterRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  noteSaveStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  noteSaveStatusText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  noteClearButton: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  noteClearButtonPressed: {
    opacity: 0.78,
  },
  noteClearButtonDisabled: {
    opacity: 0.56,
  },
  noteClearButtonText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '800',
  },
  noteClearButtonTextDisabled: {
    color: colors.textMuted,
  },
  noteModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.screenPadding,
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
  },
  noteModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  noteModalCard: {
    maxHeight: '100%',
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
  noteModalHeaderRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  noteModalTitleWrap: {
    flex: 1,
    gap: 2,
  },
  noteModalTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  noteModalSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  noteModalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteModalCloseButtonPressed: {
    opacity: 0.78,
  },
  noteModalScroll: {
    flexGrow: 0,
  },
  noteModalScrollContent: {
    paddingBottom: spacing.sm,
  },
  noteModalText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '500',
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
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: '#F5222D',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: '#F5222D',
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
