import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Pressable,
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
  ImagePreviewModal,
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
import * as ImageService from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import * as ReviewRecordImageService from '@/src/services/ReviewRecordImageService';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';
import { formatNextReviewAtText } from '@/src/utils/reviewSchedule';

const BRAND = {
  title: '七刷错题本',
  subtitle: '详情来自本地离线数据',
} as const;

const PAGE_SCOPE = 'MistakeDetailScreen';
const TOAST_DURATION_DEFAULT = 2000;

type ToastType = 'success' | 'info' | 'error';

type DetailPageState =
  | { kind: 'loading' }
  | { kind: 'success'; detail: MistakeDetailViewModel }
  | { kind: 'notFound'; message: string }
  | { kind: 'error'; message: string };

type PreviewImageState = {
  uri: string;
  title: string;
};

type ManagedDetailType = Exclude<DetailImageSlotType, 'review_solution'>;
type ReviewImageSource = 'camera' | 'album';

const MANAGED_IMAGE_ORDER: ManagedDetailType[] = ['question', 'my_solution', 'answer'];

function normalizeRouteId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function getToastBackgroundColor(type: ToastType): string {
  if (type === 'success') {
    return 'rgba(24, 38, 30, 0.95)';
  }
  if (type === 'error') {
    return 'rgba(88, 28, 28, 0.95)';
  }
  return 'rgba(38, 44, 53, 0.95)';
}

function getReviewPreviewTitle(record: DetailReviewRecordItem): string {
  if (Number.isFinite(record.reviewIndex) && record.reviewIndex > 0) {
    return `第 ${record.reviewIndex} 刷记录`;
  }
  return '复做记录';
}

function normalizeErrorMessage(message?: string): string {
  if (typeof message !== 'string') {
    return '';
  }
  return message.replace(/\s+/g, ' ').trim();
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
  onAddImage,
  onPreview,
  onOpenImageActions,
}: {
  record: DetailReviewRecordItem;
  isBusy?: boolean;
  onAddImage?: (record: DetailReviewRecordItem) => void;
  onPreview?: (uri: string, title: string) => void;
  onOpenImageActions?: (record: DetailReviewRecordItem) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [record.solutionImageExists, record.solutionImageUri]);

  const normalizedUri = normalizePreviewUri(record.solutionImageUri);
  const hasImage = !!normalizedUri;
  const imageExists = record.solutionImageExists !== false;
  const canShowImage = hasImage && imageExists && !imageFailed;
  const previewTitle = getReviewPreviewTitle(record);

  return (
    <View style={styles.reviewRecordRow}>
      <View style={styles.reviewRecordMain}>
        <Text style={styles.reviewRecordTitle}>第 {record.reviewIndex} 刷</Text>
        <Text style={styles.reviewRecordMeta}>时间：{formatReviewCreatedAt(record.createdAt)}</Text>
        <Text style={styles.reviewRecordMeta}>结果：{formatReviewResultLabel(record.result)}</Text>
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
              onPreview(normalizedUri, previewTitle);
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
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = useMemo(() => normalizeRouteId(id), [id]);

  const [state, setState] = useState<DetailPageState>({ kind: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [previewImage, setPreviewImage] = useState<PreviewImageState | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [activeReviewRecordId, setActiveReviewRecordId] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const hasFocusedRef = useRef(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastBottomOffset = Math.max(layout.bottomTabHeight + spacing.sm, insets.bottom + spacing.lg);

  const handleBack = useCallback(() => {
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

  const handleClosePreview = useCallback(() => {
    setPreviewImage(null);
  }, []);

  const handleOpenPreview = useCallback((uri: string | null | undefined, title: string) => {
    const normalizedUri = normalizePreviewUri(uri);
    if (!normalizedUri) {
      return;
    }

    setPreviewImage({
      uri: normalizedUri,
      title,
    });
  }, []);

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

  const handleOpenReviewImageActions = useCallback(
    (record: DetailReviewRecordItem) => {
      Alert.alert('复做图片操作', '请选择操作', [
        { text: '取消', style: 'cancel' },
        {
          text: '查看大图',
          onPress: () => {
            const normalizedUri = normalizePreviewUri(record.solutionImageUri);
            if (!normalizedUri || record.solutionImageExists === false) {
              showToast('图片不可用，请重新添加。', 'info');
              return;
            }
            handleOpenPreview(normalizedUri, getReviewPreviewTitle(record));
          },
        },
        {
          text: '更多操作',
          onPress: () => {
            Alert.alert('更多操作', '请选择操作', [
              { text: '取消', style: 'cancel' },
              {
                text: '替换图片',
                onPress: () => {
                  openReviewImagePickerActionSheet(record, 'replace');
                },
              },
              {
                text: '删除图片',
                style: 'destructive',
                onPress: () => {
                  Alert.alert(
                    '删除复做图片？',
                    '只会删除这条复做记录的图片，不会删除复做记录。',
                    [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '删除',
                        style: 'destructive',
                        onPress: () => {
                          void handleDeleteReviewImage(record);
                        },
                      },
                    ],
                  );
                },
              },
            ]);
          },
        },
      ]);
    },
    [handleDeleteReviewImage, handleOpenPreview, openReviewImagePickerActionSheet, showToast],
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

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    },
    [],
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

  const detailSlots = state.kind === 'success' ? state.detail.imageSlots : [];

  const {
    orderedSlots,
    takePhotoType,
    deleteType,
    isTypeBusy,
    takePhotoForType,
    deleteImageForType,
  } = useMistakeDetailImages({
    mistakeId: state.kind === 'success' ? state.detail.id : null,
    imageSlots: detailSlots,
    refreshDetail,
    showToast,
  });

  const managedSlots = useMemo(() => sortManagedImageSlots(orderedSlots), [orderedSlots]);

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

  const handleStartTitleEdit = useCallback(() => {
    if (state.kind !== 'success') {
      return;
    }
    setTitleInput(state.detail.title);
    setIsTitleEditing(true);
  }, [state]);

  const handleCancelTitleEdit = useCallback(() => {
    if (state.kind === 'success') {
      setTitleInput(state.detail.title);
    }
    setIsTitleEditing(false);
  }, [state]);

  const handleSaveTitle = useCallback(async () => {
    if (state.kind !== 'success' || isSavingTitle) {
      return;
    }

    const normalizedTitle = titleInput.trim();
    if (!normalizedTitle) {
      showToast('题目名字不能为空。', 'error');
      return;
    }

    if (normalizedTitle === state.detail.title.trim()) {
      setIsTitleEditing(false);
      showToast('题目名字未变化。', 'info');
      return;
    }

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
      <ScreenContainer scroll contentStyle={styles.screenContent}>
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
              <Text style={styles.summaryMeta}>{state.detail.module}</Text>
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
                    onSubmitEditing={() => {
                      void handleSaveTitle();
                    }}
                  />
                ) : (
                  <Text style={styles.summaryTitle}>{state.detail.title}</Text>
                )}
                <Pressable
                  onPress={isTitleEditing ? handleCancelTitleEdit : handleStartTitleEdit}
                  disabled={isSavingTitle}
                  style={({ pressed }) => [
                    styles.titleEditButton,
                    pressed && styles.titleEditButtonPressed,
                    isSavingTitle && styles.titleEditButtonDisabled,
                  ]}>
                  <Text style={styles.titleEditButtonText}>
                    {isTitleEditing ? '取消' : '编辑'}
                  </Text>
                </Pressable>
              </View>
              {isTitleEditing ? (
                <View style={styles.summaryTitleActionRow}>
                  <Pressable
                    onPress={() => {
                      void handleSaveTitle();
                    }}
                    disabled={isSavingTitle}
                    style={({ pressed }) => [
                      styles.titleSaveButton,
                      pressed && styles.titleSaveButtonPressed,
                      isSavingTitle && styles.titleSaveButtonDisabled,
                    ]}>
                    <Text style={styles.titleSaveButtonText}>
                      {isSavingTitle ? '保存中...' : '保存题目名字'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              <Text style={styles.summarySubtitle}>{state.detail.subtitle}</Text>

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

              <View style={styles.summaryInfoList}>
                <Text style={styles.summaryInfoText}>难度：{state.detail.difficulty}</Text>
                {state.detail.errorReason ? (
                  <Text style={styles.summaryInfoText}>错因：{state.detail.errorReason}</Text>
                ) : null}
                {state.detail.note ? <Text style={styles.summaryInfoText}>备注：{state.detail.note}</Text> : null}
              </View>
            </CardContainer>

            <CardContainer style={styles.imagesSectionCard} padding={spacing.lg}>
              <View style={styles.imagesHeaderRow}>
                <SectionTitle title="图片管理" />
                <Pressable
                  onPress={() => void loadDetail({ keepCurrent: true })}
                  disabled={
                    isRefreshing
                    || takePhotoType !== null
                    || deleteType !== null
                    || activeReviewRecordId !== null
                  }
                  style={[
                    styles.refreshButton,
                    (isRefreshing
                      || takePhotoType !== null
                      || deleteType !== null
                      || activeReviewRecordId !== null)
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
                      isDeleteLoading={deleteType === slotType}
                      onTakePhoto={() => {
                        void takePhotoForType(slotType);
                      }}
                      onEdit={() => handlePressEdit(slot)}
                      onDelete={() => handlePressDelete(slotType)}
                      onPreview={() => handleOpenPreview(slot.uri, getSlotPreviewTitle(slotType))}
                    />
                  );
                })}
              </View>
            </CardContainer>

            <CardContainer style={styles.reviewRecordsCard} padding={spacing.lg}>
              <SectionTitle title="复做记录" />
              <Text style={styles.reviewRecordsNextReviewText}>
                下次复做：
                {formatNextReviewAtText({
                  reviewCount: state.detail.reviewCount,
                  maxReviewCount: state.detail.maxReviewCount,
                  nextReviewAt: state.detail.nextReviewAt ?? null,
                })}
              </Text>
              {state.detail.reviewRecords.length <= 0 ? (
                <Text style={styles.reviewRecordsEmptyText}>还没有复做记录</Text>
              ) : (
                <View style={styles.reviewRecordsList}>
                  {state.detail.reviewRecords.map((record) => (
                    <ReviewRecordCard
                      key={record.id}
                      record={record}
                      isBusy={isReviewRecordImageBusy(record.id)}
                      onAddImage={(targetRecord) => {
                        openReviewImagePickerActionSheet(targetRecord, 'add');
                      }}
                      onPreview={(uri, title) => handleOpenPreview(uri, title)}
                      onOpenImageActions={handleOpenReviewImageActions}
                    />
                  ))}
                </View>
              )}
            </CardContainer>

          </>
        ) : null}

        <ImagePreviewModal
          visible={previewImage !== null}
          uri={previewImage?.uri ?? null}
          title={previewImage?.title ?? ''}
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
  summaryMeta: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  summaryTitle: {
    ...typography.titleMedium,
    fontSize: 32,
    lineHeight: 40,
    flex: 1,
  },
  summaryTitleRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryTitleInput: {
    ...typography.titleMedium,
    flex: 1,
    fontSize: 28,
    lineHeight: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: colors.textPrimary,
  },
  titleEditButton: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  titleEditButtonPressed: {
    opacity: 0.86,
  },
  titleEditButtonDisabled: {
    opacity: 0.6,
  },
  titleEditButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  summaryTitleActionRow: {
    marginTop: spacing.sm,
  },
  titleSaveButton: {
    alignSelf: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.black,
    backgroundColor: colors.black,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  titleSaveButtonPressed: {
    opacity: 0.88,
  },
  titleSaveButtonDisabled: {
    opacity: 0.6,
  },
  titleSaveButtonText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  summarySubtitle: {
    ...typography.body,
    marginTop: spacing.sm,
  },
  summaryBottomRow: {
    marginTop: spacing.lg,
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
  reviewRecordsNextReviewText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
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


