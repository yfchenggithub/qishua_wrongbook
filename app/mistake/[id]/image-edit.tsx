import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardContainer, ScreenContainer, SegmentControl } from '@/src/components';
import { Logger } from '@/src/services/Logger';
import { saveTempImageToMistakeFolder } from '@/src/services/ImageStorageService';
import * as MistakeDetailService from '@/src/services/MistakeDetailService';
import { scanEnhanceImage } from '@/src/services/imageEnhancement/scanEnhanceImage';
import { ImageEnhancementError } from '@/src/services/imageEnhancement/types';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'MistakeImageEditorPage';
const TOAST_DURATION_DEFAULT = 2200;
const TOAST_DURATION_LONG = 3000;

type ToastType = 'success' | 'info' | 'error';
type ManagedImageType = 'question' | 'my_solution' | 'answer';
type CompareMode = 'original' | 'enhanced';

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'success';
      mistakeId: string;
      imageType: ManagedImageType;
      title: string;
      originalUri: string;
    };

function normalizeRouteId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeImageType(value: string | string[] | undefined): ManagedImageType | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'question' || raw === 'my_solution' || raw === 'answer') {
    return raw;
  }
  return null;
}

function getImageTitle(type: ManagedImageType): string {
  if (type === 'question') {
    return '题目';
  }
  if (type === 'my_solution') {
    return '我的做法';
  }
  return '答案解析';
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

export default function MistakeImageEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, imageType } = useLocalSearchParams<{ id?: string | string[]; imageType?: string | string[] }>();

  const routeId = useMemo(() => normalizeRouteId(id), [id]);
  const managedType = useMemo(() => normalizeImageType(imageType), [imageType]);

  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [enhancedPreviewUri, setEnhancedPreviewUri] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<CompareMode>('original');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastVisible, setToastVisible] = useState(false);

  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(8)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const toastBottomOffset = insets.bottom + spacing.lg;

  useEffect(
    () => () => {
      isMountedRef.current = false;
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    },
    [],
  );

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
      const normalized = message.trim();
      if (!normalized) {
        return;
      }

      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }

      setToastMessage(normalized);
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

  useEffect(() => {
    let cancelled = false;

    async function loadPageData() {
      if (!routeId || !managedType) {
        setState({
          kind: 'error',
          message: '页面参数无效，请返回重试。',
        });
        return;
      }

      setState({ kind: 'loading' });
      Logger.info(PAGE_SCOPE, 'Start loading image editor data.', {
        mistakeId: routeId,
        imageType: managedType,
      });

      const detailResult = await MistakeDetailService.getMistakeDetail(routeId);
      if (cancelled) {
        return;
      }

      if (!detailResult.ok || !detailResult.detail) {
        setState({
          kind: 'error',
          message: detailResult.errorMessage ?? '读取图片失败，请返回重试。',
        });
        return;
      }

      const slot = detailResult.detail.imageSlots.find((item) => item.type === managedType);
      const uri = typeof slot?.uri === 'string' ? slot.uri.trim() : '';
      if (!slot || !uri) {
        setState({
          kind: 'error',
          message: `${getImageTitle(managedType)}图片不存在，请先拍照。`,
        });
        return;
      }

      if (slot.exists === false) {
        setState({
          kind: 'error',
          message: '图片文件不存在，请重新拍照。',
        });
        return;
      }

      setState({
        kind: 'success',
        mistakeId: detailResult.detail.id,
        imageType: managedType,
        title: getImageTitle(managedType),
        originalUri: uri,
      });
    }

    void loadPageData();

    return () => {
      cancelled = true;
    };
  }, [managedType, routeId]);

  const previewUri = useMemo(() => {
    if (state.kind !== 'success') {
      return null;
    }
    if (compareMode === 'enhanced' && enhancedPreviewUri) {
      return enhancedPreviewUri;
    }
    return state.originalUri;
  }, [compareMode, enhancedPreviewUri, state]);

  const handleCancel = useCallback(() => {
    if (state.kind === 'success' && enhancedPreviewUri) {
      Logger.info(PAGE_SCOPE, 'User canceled enhanced image.', {
        mistakeId: state.mistakeId,
        imageType: state.imageType,
      });
    }
    router.back();
  }, [enhancedPreviewUri, router, state]);

  const handleEnhance = useCallback(async () => {
    if (state.kind !== 'success') {
      return;
    }
    if (isEnhancing || isSaving) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'Enhance button clicked.', {
      mistakeId: state.mistakeId,
      imageType: state.imageType,
    });

    setIsEnhancing(true);
    try {
      Logger.info(PAGE_SCOPE, 'Enhancement started.', {
        mistakeId: state.mistakeId,
        imageType: state.imageType,
      });
      const result = await scanEnhanceImage(state.originalUri);
      if (!isMountedRef.current) {
        return;
      }

      setEnhancedPreviewUri(result.enhancedUri);
      setCompareMode('enhanced');
      Logger.info(PAGE_SCOPE, 'Enhancement succeeded.', {
        mistakeId: state.mistakeId,
        imageType: state.imageType,
      });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Enhancement failed.', {
        mistakeId: state.mistakeId,
        imageType: state.imageType,
        error,
      });
      if (error instanceof ImageEnhancementError) {
        showToast('图片增强失败，已保留原图', 'error', TOAST_DURATION_LONG);
      } else {
        showToast('图片增强失败，已保留原图', 'error', TOAST_DURATION_LONG);
      }
    } finally {
      if (isMountedRef.current) {
        setIsEnhancing(false);
      }
    }
  }, [isEnhancing, isSaving, showToast, state]);

  const handleSave = useCallback(async () => {
    if (state.kind !== 'success') {
      return;
    }
    if (!enhancedPreviewUri || isEnhancing || isSaving) {
      return;
    }

    setIsSaving(true);
    try {
      Logger.info(PAGE_SCOPE, 'User applies enhanced image.', {
        mistakeId: state.mistakeId,
        imageType: state.imageType,
      });

      const persistedImage = await saveTempImageToMistakeFolder({
        mistakeId: state.mistakeId,
        type: state.imageType,
        tempUri: enhancedPreviewUri,
      });
      if (!persistedImage.ok || !persistedImage.image?.uri) {
        Logger.error(PAGE_SCOPE, 'Persist enhanced image file failed.', {
          mistakeId: state.mistakeId,
          imageType: state.imageType,
          errorMessage: persistedImage.errorMessage ?? null,
        });
        showToast('图片保存失败，已保留原图', 'error', TOAST_DURATION_LONG);
        return;
      }

      const upsertResult = await MistakeDetailService.upsertMistakeDetailImage({
        mistakeId: state.mistakeId,
        imageType: state.imageType,
        imageUri: persistedImage.image.uri,
      });
      if (!upsertResult.ok) {
        Logger.error(PAGE_SCOPE, 'Persist enhanced image to database failed.', {
          mistakeId: state.mistakeId,
          imageType: state.imageType,
          errorMessage: upsertResult.errorMessage ?? null,
        });
        showToast('图片保存失败，已保留原图', 'error', TOAST_DURATION_LONG);
        return;
      }

      showToast('图片已更新', 'success');
      setTimeout(() => {
        router.back();
      }, 220);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Save enhanced image failed unexpectedly.', {
        mistakeId: state.mistakeId,
        imageType: state.imageType,
        error,
      });
      showToast('图片保存失败，已保留原图', 'error', TOAST_DURATION_LONG);
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [enhancedPreviewUri, isEnhancing, isSaving, router, showToast, state]);

  if (state.kind === 'loading') {
    return (
      <ScreenContainer scroll contentStyle={styles.screenContent}>
        <CardContainer style={styles.loadingCard} padding={spacing.lg}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
          <Text style={styles.loadingText}>正在加载图片...</Text>
        </CardContainer>
      </ScreenContainer>
    );
  }

  if (state.kind === 'error') {
    return (
      <ScreenContainer scroll contentStyle={styles.screenContent}>
        <CardContainer style={styles.errorCard} padding={spacing.lg}>
          <Text style={styles.errorTitle}>图片编辑不可用</Text>
          <Text style={styles.errorMessage}>{state.message}</Text>
          <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
            <Text style={styles.secondaryButtonText}>返回</Text>
          </Pressable>
        </CardContainer>
      </ScreenContainer>
    );
  }

  const canSave = !!enhancedPreviewUri && !isSaving && !isEnhancing;

  return (
    <View style={styles.pageRoot}>
      <ScreenContainer scroll contentStyle={styles.screenContent}>
        <View style={styles.topBar}>
          <Pressable style={styles.topActionButton} onPress={handleCancel}>
            <Text style={styles.topActionButtonText}>取消</Text>
          </Pressable>

          <Text style={styles.topTitle}>图片编辑</Text>

          <Pressable
            style={[styles.topActionButton, !canSave && styles.topActionButtonDisabled]}
            disabled={!canSave}
            onPress={() => void handleSave()}>
            <Text style={styles.topActionButtonText}>{isSaving ? '保存中' : '保存'}</Text>
          </Pressable>
        </View>

        <CardContainer style={styles.previewCard} padding={spacing.md}>
          <Text style={styles.previewTitle}>{state.title}</Text>
          <View style={styles.previewWrap}>
            <Image source={{ uri: previewUri ?? state.originalUri }} style={styles.previewImage} resizeMode="contain" />
          </View>

          {enhancedPreviewUri ? (
            <SegmentControl
              options={[
                { label: '原图', value: 'original' },
                { label: '增强后', value: 'enhanced' },
              ]}
              value={compareMode}
              onChange={(value) => {
                if (value === 'original' || value === 'enhanced') {
                  setCompareMode(value);
                }
              }}
            />
          ) : null}

          {isEnhancing ? (
            <View style={styles.enhancingRow}>
              <ActivityIndicator size="small" color={colors.textPrimary} />
              <Text style={styles.enhancingText}>正在优化图片，让打印更清晰...</Text>
            </View>
          ) : null}
        </CardContainer>

        <CardContainer style={styles.toolsCard} padding={spacing.md}>
          <Text style={styles.toolsTitle}>工具</Text>

          <View style={styles.toolActionsRow}>
            <Pressable
              style={[styles.toolButton, (isSaving || isEnhancing) && styles.toolButtonDisabled]}
              disabled={isSaving || isEnhancing}
              onPress={() => void handleEnhance()}>
              <Text style={styles.toolButtonText}>{isEnhancing ? '增强中...' : '增强'}</Text>
            </Pressable>
          </View>

          <Text style={styles.toolHint}>裁剪 / 旋转 / 滤镜将在后续版本提供</Text>
        </CardContainer>
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
    paddingBottom: spacing.xl,
    gap: spacing.lg,
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
  errorCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  errorTitle: {
    ...typography.sectionTitle,
    fontSize: 22,
    lineHeight: 30,
  },
  errorMessage: {
    ...typography.body,
    color: colors.textSecondary,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  topActionButton: {
    minWidth: 60,
    minHeight: 34,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  topActionButtonDisabled: {
    opacity: 0.45,
  },
  topActionButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  previewCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  previewTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
  },
  previewWrap: {
    minHeight: 380,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  enhancingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  enhancingText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  toolsCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
  },
  toolsTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
  },
  toolActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toolButton: {
    minWidth: 78,
    minHeight: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.black,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  toolButtonDisabled: {
    opacity: 0.5,
  },
  toolButtonText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
  },
  toolHint: {
    ...typography.caption,
    color: colors.textMuted,
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
