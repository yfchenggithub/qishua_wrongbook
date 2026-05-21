import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { setAddScreenHasUnsavedPhotos } from '@/src/services/LeaveGuardService';
import { Logger } from '@/src/services/Logger';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';
import { createMistakeId } from '@/src/utils/id';
import { useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_SCOPE = 'AddScreen';
const MAX_DRAFT_RETRY = 5;
const MAX_PHOTO_QUEUE_SIZE = 20;
const DOUBLE_TAP_DELAY = 300;
const TOAST_DURATION_DEFAULT = 1800;
const TOAST_DURATION_LONG = 2400;

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

type ToastType = 'success' | 'info' | 'warning' | 'error';

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

function getModuleLabel(moduleValue: string | null): string {
  if (!moduleValue) {
    return '数学';
  }

  const option = MODULE_OPTIONS.find((item) => item.value === moduleValue);
  return option?.label ?? moduleValue;
}

function buildCanonicalQuestionTitle(moduleValue: string | null, questionNo: number): string {
  const normalizedQuestionNo = Number.isFinite(questionNo) && questionNo > 0
    ? Math.floor(questionNo)
    : 1;
  return `${getModuleLabel(moduleValue)} · 第 ${normalizedQuestionNo} 题`;
}

function getToastBackgroundColor(type: ToastType): string {
  switch (type) {
    case 'success':
      return 'rgba(27, 35, 48, 0.92)';
    case 'warning':
      return 'rgba(82, 58, 16, 0.94)';
    case 'error':
      return 'rgba(88, 28, 28, 0.94)';
    case 'info':
    default:
      return 'rgba(38, 44, 53, 0.92)';
  }
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
  const title = buildCanonicalQuestionTitle(baseDraft.module, index + 1);

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
            {/* <View style={styles.cameraBody}>
              <View style={styles.cameraLens} />
            </View> */}
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
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<AddMistakeDraft>(() => createEmptyAddMistakeDraft());
  const [photoQueue, setPhotoQueue] = useState<QueuedPhoto[]>([]);
  const [previewPhoto, setPreviewPhoto] = useState<QueuedPhoto | null>(null);
  const [lastTapInfo, setLastTapInfo] = useState<LastTapInfo | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [activeImageAction, setActiveImageAction] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showOptionalInfo, setShowOptionalInfo] = useState(false);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isImageBusy = activeImageAction !== null;
  const isBusy = isImageBusy || isSaving;
  const missingQuestionImage = photoQueue.length === 0;
  const missingModule = !hasValue(draft.module);
  const canSave = !isBusy && !missingQuestionImage && !missingModule;
  const queueCount = photoQueue.length;
  const toastBottomOffset = Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg);

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

  function hideToast() {
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
  }

  function showToast(message: string, type: ToastType = 'info', duration = TOAST_DURATION_DEFAULT) {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }

    setToastMessage(trimmed);
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
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setAddScreenHasUnsavedPhotos(photoQueue.length > 0);
  }, [photoQueue.length]);

  useEffect(() => {
    return () => {
      setAddScreenHasUnsavedPhotos(false);
    };
  }, []);

  useEffect(() => {
    const hasUnsavedChanges = photoQueue.length > 0;
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      Alert.alert(
        '确认离开',
        '当前还有未保存的题目，确定离开吗？',
        [
          { text: '继续编辑', style: 'cancel' },
          {
            text: '放弃离开',
            style: 'destructive',
            onPress: () => navigation.dispatch(event.data.action),
          },
        ],
      );
    });

    return unsubscribe;
  }, [navigation, photoQueue.length]);

  async function runImageAction(actionKey: string, handler: () => Promise<void>) {
    if (isBusy || isSaving) {
      return;
    }

    setActiveImageAction(actionKey);
    try {
      await handler();
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Image action failed.', { actionKey, error });
      showToast(error instanceof Error ? error.message : String(error), 'error', TOAST_DURATION_LONG);
    } finally {
      setActiveImageAction(null);
    }
  }

  function shouldPromptOpenSettings(message?: string): boolean {
    if (!message) {
      return false;
    }

    const normalized = message.toLowerCase();
    return (
      normalized.includes('system settings')
      || normalized.includes('open settings')
      || normalized.includes('去设置')
      || normalized.includes('系统设置')
    );
  }

  function promptOpenSettings(permissionName: 'camera' | 'album') {
    const message =
      permissionName === 'camera'
        ? '需要相机权限才能拍题，请到系统设置中开启。'
        : '需要相册权限才能选择图片，请到系统设置中开启。';

    Alert.alert('权限受限', message, [
      { text: '取消', style: 'cancel' },
      {
        text: '去设置',
        onPress: () => {
          void Linking.openSettings();
        },
      },
    ]);
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
          showToast('已达到 20 张上限，请先保存当前队列', 'warning');
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
        if (shouldPromptOpenSettings(message)) {
          promptOpenSettings('camera');
          return;
        }
        showToast('拍照失败，请重试', 'error', TOAST_DURATION_LONG);
        return;
      }

      if (!result.ok || !result.image) {
        const message = result.errorMessage?.trim();
        if (isCancelLikeMessage(message)) {
          return;
        }
        if (shouldPromptOpenSettings(message)) {
          promptOpenSettings('camera');
          return;
        }
        showToast(message ?? `${config.title}未完成`, 'error', TOAST_DURATION_LONG);
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
        showToast('已添加 1 张照片', 'success');
      } else {
        updateDraftImage(config.key, result.image);
        showToast(`${config.title}已更新`, 'success');
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
          showToast('已达到 20 张上限，请先保存当前队列', 'warning');
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
          showToast('已达到 20 张上限，请先保存当前队列', 'warning');
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
          showToast(`已添加 ${queueItems.length} 张照片`, 'success');
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
          if (shouldPromptOpenSettings(message)) {
            promptOpenSettings('album');
            return;
          }
          showToast('图片保存失败，请重试', 'error', TOAST_DURATION_LONG);
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
        const message = result.errorMessage?.trim();
        if (isCancelLikeMessage(message)) {
          return;
        }
        if (shouldPromptOpenSettings(message)) {
          promptOpenSettings('album');
          return;
        }
        showToast(message ?? `${config.title}未完成`, 'error', TOAST_DURATION_LONG);
        return;
      }

      updateDraftImage(config.key, result.image);
      setValidationErrors([]);
      setSaveErrorMessage(null);
      showToast(`${config.title}已更新`, 'success');
    });
  }

  function handleDeleteQueuedQuestionPhoto(photoId: string) {
    const target = photoQueue.find((item) => item.id === photoId);
    if (!target) {
      return;
    }

    Alert.alert('删除照片', '确认删除这张题目照片吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
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
            showToast('已删除照片', 'info');
          });
        },
      },
    ]);
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
              showToast('删除失败，请稍后重试', 'error', TOAST_DURATION_LONG);
              return;
            }

            updateDraftImage(config.key, null);
            setValidationErrors([]);
            setSaveErrorMessage(null);
            showToast('已删除照片', 'info');
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
      showToast(normalizedErrors[0] ?? '校验未通过', 'warning');
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
        showToast(
          successCount > 1 ? `已保存 ${successCount} 道题` : '保存成功，已加入题库',
          'success',
        );
        return true;
      }

      if (successCount > 0) {
        const partialMessage = `Saved ${successCount}, failed ${failedCount}. Please retry failed items.`;
        setPhotoQueue(failedPhotos);
        syncDraftQuestionImage(failedPhotos);
        if (previewPhoto && !failedPhotos.some((item) => item.id === previewPhoto.id)) {
          setPreviewPhoto(null);
        }
        if (lastTapInfo && !failedPhotos.some((item) => item.id === lastTapInfo.id)) {
          setLastTapInfo(null);
        }
        setSaveErrorMessage(partialMessage);
        showToast(`Saved ${successCount}, failed ${failedCount}. Please retry.`, 'warning', TOAST_DURATION_LONG);
        return true;
      }
        /*
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
        showToast(`已保存 ${successCount} 道，${failedCount} 道失败，请检查后重试`, 'warning', TOAST_DURATION_LONG);
        return true;
        showToast(`已保存 ${successCount} 道，${failedCount} 道失败，请检查后重试`, 'warning', TOAST_DURATION_LONG);
        return true;
      }

      const firstError = failedMessages[0] ?? '保存失败，请重试';
      */
      const firstError = failedMessages[0] ?? 'Save failed. Please retry.';
      setSaveErrorMessage(firstError);
      showToast(`Save failed: ${firstError}`, 'error', TOAST_DURATION_LONG);
      return true;
      /*
      showToast(`保存失败：${firstError}`, 'error', TOAST_DURATION_LONG);
      return true;
      showToast(`保存失败：${firstError}`, 'error', TOAST_DURATION_LONG);
      return true;
      */
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected error while batch saving draft.', {
        draftId: draft.draftId,
        error,
      });
      const message = error instanceof Error ? error.message : String(error);
      setSaveErrorMessage(message);
      showToast(`Save failed: ${message}`, 'error', TOAST_DURATION_LONG);
      return true;
      /*
      if (Date.now() >= 0) {
        return true;
      }
      showToast(`保存失败：${message}`, 'error', TOAST_DURATION_LONG);
      return true;
      showToast(`保存失败：${message}`, 'error', TOAST_DURATION_LONG);
      return true;
      */
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
    <View style={styles.pageRoot}>
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
        interactionMode="zoomable"
        logSource="add_screen"
        onClose={handleClosePreview}
      />
      </ScreenContainer>

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
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
  },
  captureActionSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  captureActionPrimaryText: {
    ...typography.caption,
    color: colors.success,
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
