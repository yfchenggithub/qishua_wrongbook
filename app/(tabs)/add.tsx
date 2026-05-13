import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  BrandHeader,
  CardContainer,
  ImagePreviewModal,
  PrimaryButton,
  ScreenContainer,
  SectionTitle,
  TagChip,
} from '@/src/components';
import {
  DIFFICULTY_OPTIONS,
  ERROR_REASON_OPTIONS,
  MODULE_OPTIONS,
} from '@/src/constants/mistakeOptions';
import type { AddMistakeDraft } from '@/src/models/AddMistakeDraft';
import type { LocalImage, LocalImageType } from '@/src/models/LocalImage';
import {
  createEmptyAddMistakeDraft,
  validateAddMistakeDraft,
} from '@/src/services/AddMistakeValidationService';
import { createMistakeFromDraft } from '@/src/services/CreateMistakeService';
import {
  deleteLocalImage,
  pickImageAndSave,
  pickImagesAndSave,
  takePhotoAndSave,
} from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';
import { createMistakeId } from '@/src/utils/id';

const PAGE_SCOPE = 'AddScreen';
const MAX_DRAFT_RETRY = 5;
const MAX_PHOTO_QUEUE_SIZE = 20;
const DOUBLE_TAP_DELAY = 300;

type DraftImageField = 'questionImage' | 'mySolutionImage' | 'answerImage';
type CaptureCardVariant = 'primary' | 'compact';
type QueuePhotoSource = 'camera' | 'album';

type CaptureEntryConfig = {
  key: DraftImageField;
  type: LocalImageType;
  title: string;
  subtitle: string;
};

type QueuedPhoto = {
  id: string;
  image: LocalImage;
  source: QueuePhotoSource;
  createdAt: number;
};

type LastTapInfo = {
  id: string;
  time: number;
};

const QUESTION_CAPTURE_ENTRY: CaptureEntryConfig = {
  key: 'questionImage',
  type: 'question',
  title: '题目照片',
  subtitle: '拍原题，建议只框住一道题',
};

const OPTIONAL_CAPTURE_ENTRIES: CaptureEntryConfig[] = [
  {
    key: 'mySolutionImage',
    type: 'my_solution',
    title: '我的做法（可选）',
    subtitle: '需要时再拍，方便复盘错误过程',
  },
  {
    key: 'answerImage',
    type: 'answer',
    title: '答案/解析（可选）',
    subtitle: '需要时再拍，保存标准答案或讲解',
  },
];

function createNextDraft(previousDraftId: string): AddMistakeDraft {
  let nextDraft = createEmptyAddMistakeDraft();
  let retryCount = 0;

  while (nextDraft.draftId === previousDraftId && retryCount < MAX_DRAFT_RETRY) {
    nextDraft = createEmptyAddMistakeDraft();
    retryCount += 1;
  }

  return nextDraft;
}

function hasValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatDateTimeForTitle(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function getModuleLabel(moduleValue: string | null): string {
  if (!moduleValue) {
    return '数学';
  }

  const option = MODULE_OPTIONS.find((item) => item.value === moduleValue);
  return option?.label ?? moduleValue;
}

function isCancelLikeMessage(message?: string): boolean {
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase();
  return normalized.includes('cancel') || normalized.includes('取消');
}

function toShortUri(uri?: string | null): string | null {
  if (!uri) {
    return null;
  }
  const trimmed = uri.trim();
  if (trimmed.length <= 64) {
    return trimmed;
  }
  return `${trimmed.slice(0, 28)}...${trimmed.slice(-20)}`;
}

function normalizeValidationErrors(draft: AddMistakeDraft, errors: string[]): string[] {
  const normalized: string[] = [];

  if (!draft.questionImage) {
    normalized.push('请先拍题目照片');
  }
  if (!hasValue(draft.module)) {
    normalized.push('请选择模块');
  }

  if (normalized.length > 0) {
    return normalized;
  }

  const fallback = errors
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  return fallback.length > 0 ? fallback : ['校验未通过，请检查输入信息'];
}

function setDraftImageByField(
  draft: AddMistakeDraft,
  field: DraftImageField,
  image: LocalImage | null,
): AddMistakeDraft {
  switch (field) {
    case 'questionImage':
      return { ...draft, questionImage: image };
    case 'mySolutionImage':
      return { ...draft, mySolutionImage: image };
    case 'answerImage':
      return { ...draft, answerImage: image };
    default:
      return draft;
  }
}

function getDraftImageByField(draft: AddMistakeDraft, field: DraftImageField): LocalImage | null {
  switch (field) {
    case 'questionImage':
      return draft.questionImage;
    case 'mySolutionImage':
      return draft.mySolutionImage;
    case 'answerImage':
      return draft.answerImage;
    default:
      return null;
  }
}

function buildQueuedPhoto(image: LocalImage, source: QueuePhotoSource): QueuedPhoto {
  return {
    id: image.id,
    image,
    source,
    createdAt: Date.now(),
  };
}

function buildDraftForQueuedPhoto(
  baseDraft: AddMistakeDraft,
  photo: QueuedPhoto,
  index: number,
  totalCount: number,
): AddMistakeDraft {
  const isSingle = totalCount === 1;
  const now = new Date();
  const autoTitle = `${getModuleLabel(baseDraft.module)}错题 ${formatDateTimeForTitle(now)}`;
  const title = hasValue(baseDraft.title)
    ? baseDraft.title.trim()
    : totalCount > 1
      ? `${autoTitle} #${index + 1}`
      : autoTitle;

  return {
    ...baseDraft,
    draftId: totalCount > 1 ? createMistakeId() : baseDraft.draftId,
    title,
    questionImage: photo.image,
    mySolutionImage: isSingle ? baseDraft.mySolutionImage : null,
    answerImage: isSingle ? baseDraft.answerImage : null,
    note: isSingle ? baseDraft.note : '',
    createdAt: now.toISOString(),
  };
}

function createNextDraftKeepingModule(previousDraft: AddMistakeDraft): AddMistakeDraft {
  const nextDraft = createNextDraft(previousDraft.draftId);
  return {
    ...nextDraft,
    module: previousDraft.module,
  };
}

function CaptureEntryCard({
  config,
  image,
  busy,
  variant = 'primary',
  onTakePhoto,
  onPickImage,
  onDeleteImage,
}: {
  config: CaptureEntryConfig;
  image: LocalImage | null;
  busy: boolean;
  variant?: CaptureCardVariant;
  onTakePhoto: () => void;
  onPickImage: () => void;
  onDeleteImage: () => void;
}) {
  const isCompact = variant === 'compact';
  const canTapPreviewToTakePhoto = !image && !busy;
  const photoActionText = image ? '重新拍照' : '拍照';

  return (
    <CardContainer
      style={[styles.captureCard, isCompact && styles.captureCardCompact]}
      padding={isCompact ? spacing.sm : spacing.md}>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.1}
        style={[styles.captureTitle, isCompact && styles.captureTitleCompact]}>
        {config.title}
      </Text>
      <Text
        numberOfLines={isCompact ? 1 : 2}
        maxFontSizeMultiplier={1.1}
        style={[styles.captureSubtitle, isCompact && styles.captureSubtitleCompact]}>
        {config.subtitle}
      </Text>

      <Pressable
        accessibilityRole={canTapPreviewToTakePhoto ? 'button' : undefined}
        accessibilityLabel={canTapPreviewToTakePhoto ? 'Take photo' : undefined}
        onPress={canTapPreviewToTakePhoto ? onTakePhoto : undefined}
        disabled={!canTapPreviewToTakePhoto}
        style={({ pressed }) => [
          styles.capturePreviewWrap,
          isCompact && styles.capturePreviewWrapCompact,
          canTapPreviewToTakePhoto && pressed && styles.capturePreviewWrapPressed,
        ]}>
        {image ? (
          <Image source={{ uri: image.uri }} style={styles.capturePreviewImage} resizeMode="cover" />
        ) : (
          <View style={styles.capturePlaceholder}>
            <View style={styles.cameraBody}>
              <View style={styles.cameraLens} />
            </View>
            <Text maxFontSizeMultiplier={1.1} style={styles.capturePlaceholderText}>
              点击拍题
            </Text>
          </View>
        )}
      </Pressable>

      <View style={styles.captureActionRow}>
        <Pressable
          onPress={onTakePhoto}
          disabled={busy}
          style={[
            styles.captureActionButton,
            styles.captureActionPrimary,
            isCompact && styles.captureActionButtonCompact,
            busy && styles.disabledButton,
          ]}>
          <Text maxFontSizeMultiplier={1.1} style={styles.captureActionPrimaryText}>
            {photoActionText}
          </Text>
        </Pressable>

        <Pressable
          onPress={onPickImage}
          disabled={busy}
          style={[
            styles.captureActionButton,
            styles.captureActionSecondary,
            isCompact && styles.captureActionButtonCompact,
            busy && styles.disabledButton,
          ]}>
          <Text maxFontSizeMultiplier={1.1} style={styles.captureActionSecondaryText}>
            从相册选择
          </Text>
        </Pressable>
      </View>

      {image ? (
        <View style={styles.captureFooterRow}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.imageMetaText}>
            已选择：{image.fileName}
          </Text>
          <Pressable
            onPress={onDeleteImage}
            disabled={busy}
            style={[
              styles.captureDeleteButton,
              isCompact && styles.captureDeleteButtonCompact,
              busy && styles.disabledButton,
            ]}>
            <Text maxFontSizeMultiplier={1.1} style={styles.captureDeleteText}>
              删除
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.imageMetaText}>
          尚未选择图片
        </Text>
      )}
    </CardContainer>
  );
}

function QuestionPhotoQueueCard({
  config,
  queue,
  busy,
  onTakePhoto,
  onPickImage,
  onDeletePhoto,
  onPhotoPress,
}: {
  config: CaptureEntryConfig;
  queue: QueuedPhoto[];
  busy: boolean;
  onTakePhoto: () => void;
  onPickImage: () => void;
  onDeletePhoto: (photoId: string) => void;
  onPhotoPress: (photo: QueuedPhoto) => void;
}) {
  const hasPhotos = queue.length > 0;
  const canAddMore = queue.length < MAX_PHOTO_QUEUE_SIZE;
  const addPhotoHint = canAddMore
    ? '请点击下方“拍照”按钮添加'
    : '已达到 20 张上限，请先保存当前队列';

  return (
    <CardContainer style={styles.captureCard} padding={spacing.md}>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.captureTitle}>
        {config.title}
      </Text>
      <Text numberOfLines={2} maxFontSizeMultiplier={1.1} style={styles.captureSubtitle}>
        {config.subtitle}
      </Text>

      <View style={styles.capturePreviewWrap}>
        {hasPhotos ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.questionQueueContent}>
            {queue.map((item, index) => (
              <View key={item.id} style={styles.questionThumbItem}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`题目缩略图 ${index + 1}`}
                  onPress={() => onPhotoPress(item)}
                  style={({ pressed }) => [
                    styles.questionThumbPressable,
                    pressed ? styles.questionThumbPressablePressed : null,
                  ]}>
                  <Image source={{ uri: item.image.uri }} style={styles.questionThumbImage} resizeMode="cover" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除第 ${index + 1} 题`}
                  onPress={() => onDeletePhoto(item.id)}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.questionThumbDeleteButton,
                    pressed && !busy ? styles.questionThumbDeleteButtonPressed : null,
                    busy ? styles.disabledButton : null,
                  ]}>
                  <Text maxFontSizeMultiplier={1.1} style={styles.questionThumbDeleteText}>
                    ×
                  </Text>
                </Pressable>
                <View style={styles.questionThumbOrderBadge}>
                  <Text maxFontSizeMultiplier={1.1} style={styles.questionThumbOrderText}>
                    第 {index + 1} 题
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.capturePlaceholder}>
            <View style={styles.cameraBody}>
              <View style={styles.cameraLens} />
            </View>
            <Text maxFontSizeMultiplier={1.1} style={styles.capturePlaceholderText}>
              暂无题目照片
            </Text>
            <Text maxFontSizeMultiplier={1.1} style={styles.capturePlaceholderHintText}>
              {addPhotoHint}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.captureActionRow}>
        <Pressable
          onPress={onTakePhoto}
          disabled={busy || !canAddMore}
          style={[
            styles.captureActionButton,
            styles.captureActionPrimary,
            (busy || !canAddMore) && styles.disabledButton,
          ]}>
          <Text maxFontSizeMultiplier={1.1} style={styles.captureActionPrimaryText}>
            拍照
          </Text>
        </Pressable>

        <Pressable
          onPress={onPickImage}
          disabled={busy || !canAddMore}
          style={[
            styles.captureActionButton,
            styles.captureActionSecondary,
            (busy || !canAddMore) && styles.disabledButton,
          ]}>
          <Text maxFontSizeMultiplier={1.1} style={styles.captureActionSecondaryText}>
            从相册选择
          </Text>
        </Pressable>
      </View>

      {hasPhotos ? (
        <View style={styles.questionQueueHintWrap}>
          <Text maxFontSizeMultiplier={1.1} style={styles.imageMetaText}>
            已选择 {queue.length} 道题
          </Text>
          <Text maxFontSizeMultiplier={1.1} style={styles.imageMetaText}>
            每张照片将保存为一道错题
          </Text>
        </View>
      ) : (
        <Text maxFontSizeMultiplier={1.1} style={styles.imageMetaText}>
          请先拍题目照片
        </Text>
      )}
    </CardContainer>
  );
}

export default function AddScreen() {
  const [draft, setDraft] = useState<AddMistakeDraft>(() => createEmptyAddMistakeDraft());
  const [photoQueue, setPhotoQueue] = useState<QueuedPhoto[]>([]);
  const [previewPhoto, setPreviewPhoto] = useState<QueuedPhoto | null>(null);
  const [lastTapInfo, setLastTapInfo] = useState<LastTapInfo | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [activeImageAction, setActiveImageAction] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showOptionalInfo, setShowOptionalInfo] = useState(false);

  const isImageBusy = activeImageAction !== null;
  const isBusy = isImageBusy || isSaving;
  const missingQuestionImage = photoQueue.length === 0;
  const missingModule = !hasValue(draft.module);
  const canSave = !isBusy && !missingQuestionImage && !missingModule;
  const queueCount = photoQueue.length;

  const saveHintTextV2 = isSaving
    ? '正在保存...'
    : isImageBusy
      ? '图片处理中，请稍候...'
      : missingQuestionImage
        ? '请先拍题目照片'
        : missingModule
          ? '请选择模块'
          : queueCount > 1
            ? `将保存 ${queueCount} 道错题`
            : '可以保存并加入 7 刷';

  const saveButtonTitle = isSaving
    ? '正在保存...'
    : queueCount > 1
      ? `保存 ${queueCount} 道并加入 7 刷`
      : '保存并加入 7 刷';

  const _legacySaveHintText = isSaving
    ? '保存中，请稍候...'
    : isImageBusy
      ? '图片处理中，请稍候...'
      : missingQuestionImage
        ? '请先拍题目照片'
        : missingModule
          ? '请选择模块'
          : '可以保存并加入 7 刷';

  void _legacySaveHintText;

  function updateDraft<K extends keyof AddMistakeDraft>(field: K, value: AddMistakeDraft[K]) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function updateDraftImage(field: DraftImageField, image: LocalImage | null) {
    setDraft((prev) => setDraftImageByField(prev, field, image));
  }

  function syncDraftQuestionImage(queue: QueuedPhoto[]) {
    updateDraftImage('questionImage', queue[0]?.image ?? null);
  }

  function handleQueuePhotoPress(photo: QueuedPhoto) {
    const now = Date.now();

    if (lastTapInfo && lastTapInfo.id === photo.id && now - lastTapInfo.time < DOUBLE_TAP_DELAY) {
      Logger.info(PAGE_SCOPE, 'Question thumbnail double tapped for preview.', {
        draftId: draft.draftId,
        photoId: photo.id,
        photoQueueSize: photoQueue.length,
        uriShort: toShortUri(photo.image.uri),
      });
      setPreviewPhoto(photo);
      setLastTapInfo(null);
      return;
    }

    setLastTapInfo({
      id: photo.id,
      time: now,
    });
  }

  function handleClosePreview() {
    setPreviewPhoto(null);
  }

  async function runImageAction(actionKey: string, handler: () => Promise<void>) {
    if (isBusy || isSaving) {
      return;
    }

    setActiveImageAction(actionKey);
    try {
      await handler();
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Image action failed.', { actionKey, error });
      Alert.alert('操作失败', error instanceof Error ? error.message : String(error));
    } finally {
      setActiveImageAction(null);
    }
  }

  async function handleTakePhoto(config: CaptureEntryConfig) {
    await runImageAction(`take-${config.key}`, async () => {
      if (config.key === 'questionImage') {
        Logger.info(PAGE_SCOPE, 'Question camera button pressed.', {
          draftId: draft.draftId,
          photoQueueSize: photoQueue.length,
        });

        if (photoQueue.length >= MAX_PHOTO_QUEUE_SIZE) {
          Logger.warn(PAGE_SCOPE, 'Question photo queue reached max size before capture.', {
            draftId: draft.draftId,
            photoQueueSize: photoQueue.length,
          });
          Alert.alert('提示', '一次最多添加 20 道题，请先保存当前队列');
          return;
        }
      }

      const result = await takePhotoAndSave({
        mistakeId: draft.draftId,
        type: config.type,
      });

      if ((!result.ok || !result.image) && config.key === 'questionImage') {
        const message = result.errorMessage?.trim();

        if (isCancelLikeMessage(message)) {
          Logger.info(PAGE_SCOPE, 'Question photo capture canceled by user.', {
            draftId: draft.draftId,
            photoQueueSize: photoQueue.length,
          });
          return;
        }

        Logger.error(PAGE_SCOPE, 'Question photo capture failed.', {
          draftId: draft.draftId,
          message: message ?? null,
        });
        Alert.alert('提示', '拍照失败，请重试');
        return;
      }

      if (!result.ok || !result.image) {
        Alert.alert('未完成', result.errorMessage ?? `${config.title}未完成`);
        return;
      }

      if (config.key === 'questionImage') {
        Logger.info(PAGE_SCOPE, 'Question photo captured successfully.', {
          draftId: draft.draftId,
          uriShort: toShortUri(result.image.uri),
        });

        const queueItem = buildQueuedPhoto(result.image, 'camera');
        const nextQueue = [...photoQueue, queueItem];
        setPhotoQueue(nextQueue);
        syncDraftQuestionImage(nextQueue);
        Logger.info(PAGE_SCOPE, 'Question photo appended into queue.', {
          draftId: draft.draftId,
          photoId: queueItem.id,
          photoQueueSize: nextQueue.length,
        });
      } else {
        updateDraftImage(config.key, result.image);
      }
      setValidationErrors([]);
      setSaveErrorMessage(null);
    });
  }

  async function handlePickImage(config: CaptureEntryConfig) {
    await runImageAction(`pick-${config.key}`, async () => {
      if (config.key === 'questionImage') {
        Logger.info(PAGE_SCOPE, 'Question album button pressed.', {
          draftId: draft.draftId,
          photoQueueSize: photoQueue.length,
        });

        if (photoQueue.length >= MAX_PHOTO_QUEUE_SIZE) {
          Alert.alert('提示', '一次最多添加 20 道题，请先保存当前队列');
          return;
        }

        const availableSlots = MAX_PHOTO_QUEUE_SIZE - photoQueue.length;
        const batchResult = await pickImagesAndSave({
          mistakeId: draft.draftId,
          type: config.type,
          index: photoQueue.length + 1,
          maxSelection: availableSlots,
        });

        const acceptedImages = batchResult.images.slice(0, availableSlots);
        const overflowImages = batchResult.images.slice(availableSlots);
        if (overflowImages.length > 0) {
          Logger.warn(PAGE_SCOPE, 'Album selection overflowed available slots, cleaning extras.', {
            draftId: draft.draftId,
            availableSlots,
            overflowCount: overflowImages.length,
          });
          await Promise.all(overflowImages.map(async (image) => {
            await deleteLocalImage(image.uri);
          }));
          Alert.alert('提示', '一次最多添加 20 道题，请先保存当前队列');
        }

        if (acceptedImages.length > 0) {
          const queueItems = acceptedImages.map((image) => buildQueuedPhoto(image, 'album'));
          const nextQueue = [...photoQueue, ...queueItems];
          Logger.info(PAGE_SCOPE, 'Picked images from album and appended to queue.', {
            draftId: draft.draftId,
            pickedCount: queueItems.length,
            photoQueueSize: nextQueue.length,
          });
          setPhotoQueue(nextQueue);
          syncDraftQuestionImage(nextQueue);
        }

        if (!batchResult.ok) {
          const message = batchResult.errorMessage?.trim();
          if (isCancelLikeMessage(message)) {
            Logger.info(PAGE_SCOPE, 'Album selection canceled by user.', {
              draftId: draft.draftId,
              photoQueueSize: photoQueue.length,
            });
            return;
          }

          Logger.error(PAGE_SCOPE, 'Album multi-pick failed for question photos.', {
            draftId: draft.draftId,
            message: message ?? null,
            appendedCount: batchResult.images.length,
          });
          Alert.alert('提示', '图片保存失败，请重试');
          return;
        }

        setValidationErrors([]);
        setSaveErrorMessage(null);
        return;
      }

      const result = await pickImageAndSave({
        mistakeId: draft.draftId,
        type: config.type,
      });

      if (!result.ok || !result.image) {
        Alert.alert('未完成', result.errorMessage ?? `${config.title}未完成`);
        return;
      }

      updateDraftImage(config.key, result.image);
      setValidationErrors([]);
      setSaveErrorMessage(null);
    });
  }

  function handleDeleteQueuedQuestionPhoto(photoId: string) {
    const target = photoQueue.find((item) => item.id === photoId);
    if (!target) {
      return;
    }

    void runImageAction(`delete-question-${photoId}`, async () => {
      const removed = await deleteLocalImage(target.image.uri);
      if (!removed) {
        Logger.warn(PAGE_SCOPE, 'Failed to delete queue image file, but removed from queue.', {
          draftId: draft.draftId,
          photoId,
          uri: target.image.uri,
        });
      }

      setPhotoQueue((prev) => {
        const next = prev.filter((item) => item.id !== photoId);
        syncDraftQuestionImage(next);
        return next;
      });
      if (previewPhoto?.id === photoId) {
        setPreviewPhoto(null);
      }
      if (lastTapInfo?.id === photoId) {
        setLastTapInfo(null);
      }
      setValidationErrors([]);
      setSaveErrorMessage(null);
    });
  }

  function handleDeleteImage(config: CaptureEntryConfig) {
    const image = getDraftImageByField(draft, config.key);
    if (!image) {
      return;
    }

    Alert.alert('删除图片', `确认删除${config.title}？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void runImageAction(`delete-${config.key}`, async () => {
            const removed = await deleteLocalImage(image.uri);
            if (!removed) {
              Logger.error(PAGE_SCOPE, 'Failed to delete selected image.', {
                draftId: draft.draftId,
                imageType: config.type,
                uri: image.uri,
              });
              Alert.alert('删除失败', '图片文件删除失败，请稍后重试。');
              return;
            }

            updateDraftImage(config.key, null);
            setValidationErrors([]);
            setSaveErrorMessage(null);
          });
        },
      },
    ]);
  }

  async function handleSaveDraftBatch(): Promise<boolean> {
    if (isBusy || isSaving) {
      return true;
    }

    const validationInput: AddMistakeDraft = {
      ...draft,
      questionImage: photoQueue[0]?.image ?? null,
    };
    const validation = validateAddMistakeDraft(validationInput);
    if (!validation.ok) {
      const normalizedErrors = normalizeValidationErrors(validationInput, validation.errors);
      setValidationErrors(normalizedErrors);
      setSaveErrorMessage(null);
      Alert.alert('校验未通过', normalizedErrors.join('\n'));
      return true;
    }

    setValidationErrors([]);
    setSaveErrorMessage(null);
    setIsSaving(true);

    try {
      const startedAt = Date.now();
      const totalCount = photoQueue.length;
      let successCount = 0;
      const failedPhotos: QueuedPhoto[] = [];
      const failedMessages: string[] = [];

      Logger.info(PAGE_SCOPE, 'Start batch saving queued photos.', {
        draftId: draft.draftId,
        totalCount,
        module: draft.module,
      });

      for (let index = 0; index < totalCount; index += 1) {
        const photo = photoQueue[index];
        const saveDraft = buildDraftForQueuedPhoto(draft, photo, index, totalCount);
        const saveResult = await createMistakeFromDraft(saveDraft);

        if (saveResult.ok) {
          successCount += 1;
          Logger.info(PAGE_SCOPE, 'Saved one queued photo as mistake successfully.', {
            draftId: draft.draftId,
            sourcePhotoId: photo.id,
            sourcePhotoUriShort: toShortUri(photo.image.uri),
            mistakeId: saveResult.mistakeId ?? null,
            index,
            successCount,
            totalCount,
          });
          continue;
        }

        failedPhotos.push(photo);
        failedMessages.push(saveResult.errorMessage ?? '保存失败，请重试');
        Logger.error(PAGE_SCOPE, 'Failed to save one queued photo as mistake.', {
          draftId: draft.draftId,
          sourcePhotoId: photo.id,
          sourcePhotoUriShort: toShortUri(photo.image.uri),
          index,
          successCount,
          totalCount,
          errorMessage: saveResult.errorMessage ?? null,
        });
      }

      const failedCount = failedPhotos.length;
      const elapsedMs = Date.now() - startedAt;
      Logger.info(PAGE_SCOPE, 'Batch save finished.', {
        draftId: draft.draftId,
        totalCount,
        successCount,
        failedCount,
        elapsedMs,
      });

      if (failedCount === 0) {
        const nextDraft = createNextDraftKeepingModule(draft);
        setDraft(nextDraft);
        setPhotoQueue([]);
        setPreviewPhoto(null);
        setLastTapInfo(null);
        setValidationErrors([]);
        setSaveErrorMessage(null);
        setShowOptionalInfo(false);
        Alert.alert('保存成功', `已保存 ${successCount} 道错题`);
        return true;
      }

      if (successCount > 0) {
        const partialMessage = `成功 ${successCount} 道，失败 ${failedCount} 道`;
        setPhotoQueue(failedPhotos);
        syncDraftQuestionImage(failedPhotos);
        if (previewPhoto && !failedPhotos.some((item) => item.id === previewPhoto.id)) {
          setPreviewPhoto(null);
        }
        if (lastTapInfo && !failedPhotos.some((item) => item.id === lastTapInfo.id)) {
          setLastTapInfo(null);
        }
        setSaveErrorMessage(partialMessage);
        Alert.alert('部分保存成功', `${partialMessage}，请重试失败项`);
        return true;
      }

      const firstError = failedMessages[0] ?? '保存失败，请重试';
      setSaveErrorMessage(firstError);
      Alert.alert('保存失败', firstError);
      return true;
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected error while batch saving draft.', {
        draftId: draft.draftId,
        error,
      });
      const message = error instanceof Error ? error.message : String(error);
      setSaveErrorMessage(message);
      Alert.alert('保存失败', message);
      return true;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveDraft() {
    const handled = await handleSaveDraftBatch();
    if (handled) {
      return;
    }

    if (isBusy) {
      return;
    }

    const result = validateAddMistakeDraft(draft);
    if (!result.ok) {
      const normalizedErrors = normalizeValidationErrors(draft, result.errors);
      setValidationErrors(normalizedErrors);
      setSaveErrorMessage(null);
      Alert.alert('校验未通过', normalizedErrors.join('\n'));
      return;
    }

    setValidationErrors([]);
    setSaveErrorMessage(null);
    setIsSaving(true);

    try {
      const saveResult = await createMistakeFromDraft(draft);
      if (!saveResult.ok) {
        const message = saveResult.errorMessage ?? '保存失败，请稍后重试。';
        Logger.error(PAGE_SCOPE, 'Failed to save draft.', {
          draftId: draft.draftId,
          message,
        });
        setSaveErrorMessage(message);
        Alert.alert('保存失败', message);
        return;
      }

      const previousDraftId = draft.draftId;
      Alert.alert(
        '保存成功',
        `错题已加入 7 刷计划!`,
      );
      setDraft(createNextDraft(previousDraftId));
      setPhotoQueue([]);
      setPreviewPhoto(null);
      setLastTapInfo(null);
      setValidationErrors([]);
      setSaveErrorMessage(null);
      setShowOptionalInfo(false);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected error while saving draft.', {
        draftId: draft.draftId,
        error,
      });
      const message = error instanceof Error ? error.message : String(error);
      setSaveErrorMessage(message);
      Alert.alert('保存失败', message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ScreenContainer scroll safeAreaEdges={['top']} contentStyle={styles.screenContent}>
      <BrandHeader title="新增错题" subtitle="拍题目，选模块，保存到 7 刷计划" />

      <View style={styles.sectionBlock}>
        <SectionTitle title="题目照片" />
        <QuestionPhotoQueueCard
          config={QUESTION_CAPTURE_ENTRY}
          queue={photoQueue}
          busy={isBusy}
          onTakePhoto={() => {
            void handleTakePhoto(QUESTION_CAPTURE_ENTRY);
          }}
          onPickImage={() => {
            void handlePickImage(QUESTION_CAPTURE_ENTRY);
          }}
          onDeletePhoto={handleDeleteQueuedQuestionPhoto}
          onPhotoPress={handleQueuePhotoPress}
        />
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="选择模块" />
        <View style={styles.tagsRow}>
          {MODULE_OPTIONS.map((item) => (
            <TagChip
              key={item.value}
              label={item.label}
              selected={draft.module === item.value}
              onPress={() => updateDraft('module', draft.module === item.value ? null : item.value)}
            />
          ))}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <CardContainer style={styles.saveCard} padding={spacing.md}>
          <Text
            maxFontSizeMultiplier={1.1}
            style={[styles.saveHint, canSave ? styles.saveHintReady : null]}>
            {saveHintTextV2}
          </Text>
          <PrimaryButton
            title={saveButtonTitle}
            disabled={!canSave}
            onPress={() => {
              void handleSaveDraft();
            }}
          />
        </CardContainer>
      </View>

      {validationErrors.length > 0 ? (
        <CardContainer style={styles.errorCard} padding={spacing.md}>
          <Text style={styles.errorTitle}>校验提示</Text>
          {validationErrors.map((error) => (
            <Text key={error} style={styles.errorItemText}>
              - {error}
            </Text>
          ))}
        </CardContainer>
      ) : null}

      {saveErrorMessage ? (
        <CardContainer style={styles.errorCard} padding={spacing.md}>
          <Text style={styles.errorTitle}>保存失败</Text>
          <Text style={styles.errorItemText}>- {saveErrorMessage}</Text>
        </CardContainer>
      ) : null}

      <View style={styles.optionalSection}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowOptionalInfo((prev) => !prev)}
          style={styles.optionalToggle}>
          <View style={styles.optionalTextWrap}>
            <Text maxFontSizeMultiplier={1.1} style={styles.optionalTitle}>
              可选信息
            </Text>
            <Text maxFontSizeMultiplier={1.1} style={styles.optionalSubtitle}>
              想记录更多再展开
            </Text>
          </View>
          <Text maxFontSizeMultiplier={1.1} style={styles.optionalActionText}>
            {showOptionalInfo ? '收起' : '展开'}
          </Text>
        </Pressable>
      </View>

      {showOptionalInfo ? (
        <>
          <View style={styles.sectionBlock}>
            <SectionTitle title="可选照片" />
            <View style={styles.captureListCompact}>
              {OPTIONAL_CAPTURE_ENTRIES.map((config) => (
                <CaptureEntryCard
                  key={config.key}
                  config={config}
                  image={getDraftImageByField(draft, config.key)}
                  busy={isBusy}
                  variant="compact"
                  onTakePhoto={() => {
                    void handleTakePhoto(config);
                  }}
                  onPickImage={() => {
                    void handlePickImage(config);
                  }}
                  onDeleteImage={() => handleDeleteImage(config)}
                />
              ))}
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <SectionTitle title="错因（可选）" />
            <View style={styles.tagsRow}>
              {ERROR_REASON_OPTIONS.map((item) => (
                <TagChip
                  key={item.value}
                  label={item.label}
                  selected={draft.errorReason === item.value}
                  onPress={() =>
                    updateDraft(
                      'errorReason',
                      draft.errorReason === item.value ? null : item.value,
                    )
                  }
                />
              ))}
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <SectionTitle title="难度（可选）" />
            <Text maxFontSizeMultiplier={1.1} style={styles.optionalHint}>
              默认 3 中等，不选也能保存
            </Text>
            <View style={styles.tagsRow}>
              {DIFFICULTY_OPTIONS.map((item) => (
                <TagChip
                  key={item.value}
                  label={item.label}
                  selected={draft.difficulty === item.value}
                  onPress={() => updateDraft('difficulty', item.value)}
                />
              ))}
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <SectionTitle title="补充信息（可选）" />
            <CardContainer padding={spacing.md} style={styles.inputCard}>
              <Text style={styles.inputLabel}>标题</Text>
              <TextInput
                value={draft.title}
                onChangeText={(value) => updateDraft('title', value)}
                placeholder="例如：椭圆切线范围题"
                placeholderTextColor={colors.textMuted}
                style={styles.textInput}
                maxFontSizeMultiplier={1.2}
              />

              <Text style={styles.inputLabel}>备注</Text>
              <TextInput
                value={draft.note}
                onChangeText={(value) => updateDraft('note', value)}
                placeholder="例如：第二问要先设参数"
                placeholderTextColor={colors.textMuted}
                style={[styles.textInput, styles.noteInput]}
                multiline
                maxFontSizeMultiplier={1.2}
                textAlignVertical="top"
              />
            </CardContainer>
          </View>
        </>
      ) : null}

      <ImagePreviewModal
        visible={previewPhoto !== null}
        uri={previewPhoto?.image.uri ?? null}
        title="题目照片预览"
        onClose={handleClosePreview}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    paddingBottom: layout.bottomTabHeight + spacing.lg,
    gap: spacing.md,
  },
  sectionBlock: {
    gap: spacing.sm,
  },
  captureCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  captureCardCompact: {
    gap: spacing.xs,
  },
  captureTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
  },
  captureTitleCompact: {
    fontSize: 16,
    lineHeight: 22,
  },
  captureSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  captureSubtitleCompact: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  capturePreviewWrap: {
    height: 126,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  capturePreviewWrapCompact: {
    height: 106,
  },
  capturePreviewWrapPressed: {
    opacity: 0.85,
  },
  capturePreviewImage: {
    width: '100%',
    height: '100%',
  },
  questionQueueContent: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  questionThumbItem: {
    width: 108,
    height: 108,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    position: 'relative',
  },
  questionThumbPressable: {
    width: '100%',
    height: '100%',
  },
  questionThumbPressablePressed: {
    opacity: 0.92,
  },
  questionThumbImage: {
    width: '100%',
    height: '100%',
  },
  questionThumbDeleteButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionThumbDeleteButtonPressed: {
    opacity: 0.8,
  },
  questionThumbDeleteText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
    lineHeight: 16,
  },
  questionThumbOrderBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.66)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  questionThumbOrderText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  capturePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#D9DCE1',
    margin: spacing.sm,
    borderRadius: radius.md,
  },
  cameraBody: {
    width: 36,
    height: 24,
    borderRadius: radius.sm,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraLens: {
    width: 13,
    height: 13,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.white,
  },
  capturePlaceholderText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  capturePlaceholderHintText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  captureActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  captureActionButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureActionButtonCompact: {
    minHeight: 34,
  },
  captureActionPrimary: {
    backgroundColor: colors.black,
    borderColor: colors.black,
  },
  captureActionSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  captureActionPrimaryText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  captureActionSecondaryText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  captureFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  questionQueueHintWrap: {
    gap: 2,
  },
  imageMetaText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  captureDeleteButton: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#F0C3C3',
    backgroundColor: '#FFECEC',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  captureDeleteButtonCompact: {
    paddingVertical: 2,
  },
  captureDeleteText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  saveCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  saveHint: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  saveHintReady: {
    color: colors.success,
  },
  optionalSection: {
    marginTop: spacing.xs,
  },
  optionalToggle: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  optionalTextWrap: {
    flex: 1,
    gap: 2,
  },
  optionalTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  optionalSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  optionalActionText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  captureListCompact: {
    gap: spacing.sm,
  },
  optionalHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: -2,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  inputCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  textInput: {
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 42,
  },
  noteInput: {
    minHeight: 88,
  },
  errorCard: {
    borderRadius: radius.xl,
    borderColor: '#F2C9C9',
    backgroundColor: '#FFF5F5',
    gap: spacing.xs,
  },
  errorTitle: {
    ...typography.body,
    color: colors.danger,
    fontWeight: '700',
  },
  errorItemText: {
    ...typography.caption,
    color: colors.danger,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
