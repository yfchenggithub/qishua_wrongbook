import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';

import {
  AddMistakeProgress,
  type AddMistakeStage,
  AppToast,
  type ErrorReasonOption,
  ImagePreviewModal,
  ModulePickerSheet,
  type ModulePickerOption,
  OptionalInfoSheet,
  PageHeader,
  PageShell,
  PhotoPickerSection,
  PrimaryButton,
  SectionHeader,
  SurfaceCard,
} from '@/src/components';
import { useAppToast } from '@/src/hooks/useAppToast';
import { ERROR_REASON_OPTIONS, MODULE_OPTIONS } from '@/src/constants/mistakeOptions';
import type { AddMistakeDraft } from '@/src/models/AddMistakeDraft';
import type { CustomErrorReason } from '@/src/models/CustomErrorReason';
import type { CustomModule } from '@/src/models/CustomModule';
import type { ImageBatchProgress, LocalImage, LocalImageType } from '@/src/models/LocalImage';
import { MistakeRepository } from '@/src/repositories/MistakeRepository';
import { createEmptyAddMistakeDraft, validateAddMistakeDraft } from '@/src/services/AddMistakeValidationService';
import { createMistakesFromDraft } from '@/src/services/CreateMistakeService';
import { CustomErrorReasonService } from '@/src/services/CustomErrorReasonService';
import { CustomModuleService } from '@/src/services/CustomModuleService';
import {
  deleteLocalImage,
  pickImagesAndSave,
  saveSharedImageToMistakeFolder,
  takePhotoAndSave,
} from '@/src/services/ImageService';
import { setAddScreenHasUnsavedPhotos } from '@/src/services/LeaveGuardService';
import { Logger } from '@/src/services/Logger';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'AddScreen';
const MAX_IMAGES_PER_TYPE = 20;

type SharedImageSearchParams = {
  sharedImageUri?: string | string[];
  sharedImageNonce?: string | string[];
  sharedImageError?: string | string[];
};

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function isCancelMessage(message?: string): boolean {
  const normalized = message?.toLocaleLowerCase() ?? '';
  return normalized.includes('cancel') || normalized.includes('取消');
}

function shouldOpenSettings(message?: string): boolean {
  const normalized = message?.toLocaleLowerCase() ?? '';
  return normalized.includes('settings') || normalized.includes('设置');
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function customModuleOption(item: CustomModule): ModulePickerOption {
  return { id: `custom:${item.id}`, label: item.name, isCustom: true };
}

function customReasonOption(item: CustomErrorReason): ErrorReasonOption {
  return { id: `custom:${item.id}`, label: item.name, isCustom: true };
}

function allOptionalImages(draft: AddMistakeDraft): LocalImage[] {
  return [...draft.mySolutionImages, ...draft.answerImages];
}

export default function AddScreen() {
  const navigation = useNavigation();
  const params = useLocalSearchParams<SharedImageSearchParams>();
  const [draft, setDraft] = useState<AddMistakeDraft>(() => createEmptyAddMistakeDraft());
  const [stage, setStage] = useState<AddMistakeStage>('QUESTION');
  const [moduleSheetVisible, setModuleSheetVisible] = useState(false);
  const [optionalSheetVisible, setOptionalSheetVisible] = useState(false);
  const [stageBeforeOptional, setStageBeforeOptional] = useState<AddMistakeStage>('QUESTION');
  const [customModules, setCustomModules] = useState<CustomModule[]>([]);
  const [customReasons, setCustomReasons] = useState<CustomErrorReason[]>([]);
  const [recentModuleNames, setRecentModuleNames] = useState<string[]>([]);
  const [activeImageAction, setActiveImageAction] = useState<string | null>(null);
  const [imageBatchProgress, setImageBatchProgress] = useState<ImageBatchProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [bottomBarHeight, setBottomBarHeight] = useState(
    layout.primaryButtonHeight + layout.minimumTouchSize,
  );
  const [preview, setPreview] = useState<{ image: LocalImage; title: string } | null>(null);
  const lastSharedKeyRef = useRef<string | null>(null);
  const lastSharedErrorKeyRef = useRef<string | null>(null);
  const optionalSessionUrisRef = useRef<Set<string>>(new Set());
  const { props: toastProps, showToast } = useAppToast({ defaultDuration: 1900 });

  const imageBusy = activeImageAction !== null;
  const busy = imageBusy || saving;
  const hasQuestion = draft.questionImages.length > 0;
  const canProceed = hasQuestion && !busy;
  const validationHint = !hasQuestion
    ? '请先添加题目照片'
    : imageBusy
      ? '图片处理中，请稍候'
      : '可直接保存，模块和其他信息可稍后补充';

  const moduleOptions = useMemo<ModulePickerOption[]>(() => [
    ...MODULE_OPTIONS.map((item) => ({ id: item.id, label: item.label })),
    ...customModules.map(customModuleOption),
  ], [customModules]);
  const reasonOptions = useMemo<ErrorReasonOption[]>(() => [
    ...ERROR_REASON_OPTIONS.map((item) => ({ id: item.id, label: item.label })),
    ...customReasons.map(customReasonOption),
  ], [customReasons]);
  const recentModuleIds = recentModuleNames
    .map((name) => moduleOptions.find((item) => item.label === name)?.id)
    .filter((id): id is string => !!id);
  const optionalSummary = useMemo(() => {
    const parts: string[] = [];
    if (draft.mySolutionImages.length > 0 || draft.mySolutionText.trim()) parts.push('做法已添加');
    if (draft.answerImages.length > 0 || draft.answerText.trim()) parts.push('解析已添加');
    if (draft.errorReasonIds.length > 0) parts.push(`${draft.errorReasonIds.length} 个错因`);
    parts.push(`${draft.difficulty} ${['', '简单', '偏易', '中等', '较难', '很难'][draft.difficulty]}`);
    if (draft.title.trim() || draft.note.trim()) parts.push('标题备注已填写');
    return parts.join(' · ');
  }, [draft]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      CustomModuleService.listCustomModules(),
      CustomErrorReasonService.listCustomErrorReasons(),
      MistakeRepository.listRecentMistakes(12),
    ]).then(([modules, reasons, recentMistakes]) => {
      if (!mounted) return;
      setCustomModules(modules);
      setCustomReasons(reasons);
      setRecentModuleNames(Array.from(new Set(recentMistakes.map((item) => item.module))).slice(0, 3));
    }).catch((error) => {
      Logger.error(PAGE_SCOPE, 'Failed to load add-screen options.', { error });
      if (mounted) showToast('部分自定义选项加载失败', 'warning');
    });
    return () => { mounted = false; };
  }, [showToast]);

  useEffect(() => {
    setAddScreenHasUnsavedPhotos(draft.questionImages.length > 0);
  }, [draft.questionImages.length]);

  useEffect(() => {
    if (!optionalSheetVisible) {
      setStage(hasQuestion ? 'READY_TO_SAVE' : 'QUESTION');
    }
  }, [hasQuestion, optionalSheetVisible]);

  useEffect(() => () => setAddScreenHasUnsavedPhotos(false), []);

  useEffect(() => {
    const hasUnsaved = draft.questionImages.length > 0;
    return navigation.addListener('beforeRemove', (event) => {
      if (!hasUnsaved) return;
      event.preventDefault();
      Alert.alert('确认离开', '当前还有未保存的题目，确定离开吗？', [
        { text: '继续编辑', style: 'cancel' },
        { text: '放弃离开', style: 'destructive', onPress: () => navigation.dispatch(event.data.action) },
      ]);
    });
  }, [draft.questionImages.length, navigation]);

  const runImageAction = useCallback(async function runImageAction<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T | null> {
    if (busy) return null;
    setActiveImageAction(key);
    try {
      return await action();
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Image action failed.', { key, error });
      showToast('图片处理失败，请重试', 'error', 2400);
      return null;
    } finally {
      setActiveImageAction(null);
    }
  }, [busy, showToast]);

  function handleImageFailure(message: string | undefined, source: 'camera' | 'album') {
    if (isCancelMessage(message)) return;
    if (shouldOpenSettings(message)) {
      Alert.alert('权限受限', source === 'camera' ? '需要相机权限才能拍题，请到系统设置中开启。' : '需要相册权限才能选择图片，请到系统设置中开启。', [
        { text: '取消', style: 'cancel' },
        { text: '去设置', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    showToast(source === 'camera' ? '拍照失败，请重试' : '图片保存失败，请重试', 'error', 2400);
  }

  async function takeImage(type: LocalImageType, index: number, session = false): Promise<LocalImage | null> {
    const result = await runImageAction(`take-${type}`, () => takePhotoAndSave({ mistakeId: draft.draftId, type, index }));
    if (!result?.ok || !result.image) {
      handleImageFailure(result?.errorMessage, 'camera');
      return null;
    }
    if (session) optionalSessionUrisRef.current.add(result.image.uri);
    return result.image;
  }

  async function pickImages(type: LocalImageType, index: number, maxSelection: number, session = false): Promise<LocalImage[]> {
    setImageBatchProgress(null);
    try {
      const result = await runImageAction(`pick-${type}`, () => pickImagesAndSave({
        mistakeId: draft.draftId,
        type,
        index,
        maxSelection,
        onProgress: setImageBatchProgress,
      }));
      if (!result) return [];
      if (!result.ok) handleImageFailure(result.errorMessage, 'album');
      if (session) result.images.forEach((image) => optionalSessionUrisRef.current.add(image.uri));
      return result.images;
    } finally {
      setImageBatchProgress(null);
    }
  }

  async function handleTakeQuestion() {
    if (draft.questionImages.length >= MAX_IMAGES_PER_TYPE) {
      showToast('最多添加 20 张题目照片', 'warning');
      return;
    }
    const image = await takeImage('question', draft.questionImages.length);
    if (!image) return;
    setDraft((current) => {
      const questionImages = [...current.questionImages, image];
      return { ...current, questionImages, questionImage: questionImages[0] ?? null };
    });
    showToast('已添加题目照片', 'success');
  }

  async function handlePickQuestion() {
    const available = MAX_IMAGES_PER_TYPE - draft.questionImages.length;
    if (available <= 0) {
      showToast('最多添加 20 张题目照片', 'warning');
      return;
    }
    const images = await pickImages('question', draft.questionImages.length, available);
    if (images.length === 0) return;
    setDraft((current) => {
      const questionImages = [...current.questionImages, ...images].slice(0, MAX_IMAGES_PER_TYPE);
      return { ...current, questionImages, questionImage: questionImages[0] ?? null };
    });
    showToast(`已添加 ${images.length} 张照片`, 'success');
  }

  function handleDeleteQuestion(image: LocalImage) {
    Alert.alert('删除照片', '确认删除这张题目照片吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive', onPress: () => {
          void runImageAction(`delete-question-${image.id}`, async () => {
            await deleteLocalImage(image.uri);
            setDraft((current) => {
              const questionImages = current.questionImages.filter((item) => item.id !== image.id);
              return { ...current, questionImages, questionImage: questionImages[0] ?? null };
            });
            if (preview?.image.id === image.id) setPreview(null);
            showToast('已删除照片', 'info');
            return true;
          });
        },
      },
    ]);
  }

  function openOptionalSheet() {
    optionalSessionUrisRef.current = new Set();
    setStageBeforeOptional(stage);
    setStage('SUPPLEMENT');
    setOptionalSheetVisible(true);
  }

  function cleanupUris(uris: Iterable<string>) {
    void Promise.all(Array.from(uris).map(async (uri) => deleteLocalImage(uri))).catch((error) => {
      Logger.warn(PAGE_SCOPE, 'Failed to clean draft image.', { error });
    });
  }

  function handleOptionalCancel() {
    cleanupUris(optionalSessionUrisRef.current);
    optionalSessionUrisRef.current = new Set();
    setOptionalSheetVisible(false);
    setStage(stageBeforeOptional);
  }

  function handleOptionalComplete(working: AddMistakeDraft) {
    const keptUris = new Set(allOptionalImages(working).map((image) => image.uri));
    const removedCommitted = allOptionalImages(draft)
      .map((image) => image.uri)
      .filter((uri) => !keptUris.has(uri));
    const abandonedNew = Array.from(optionalSessionUrisRef.current).filter((uri) => !keptUris.has(uri));
    cleanupUris([...removedCommitted, ...abandonedNew]);
    optionalSessionUrisRef.current = new Set();
    setDraft({
      ...working,
      mySolutionImage: working.mySolutionImages[0] ?? null,
      answerImage: working.answerImages[0] ?? null,
    });
    setOptionalSheetVisible(false);
    setStage('READY_TO_SAVE');
  }

  async function handleCreateModule(name: string): Promise<ModulePickerOption | null> {
    const result = await CustomModuleService.createCustomModule(name);
    if (!result.ok || !result.module) {
      showToast(result.errorMessage ?? '创建模块失败', 'warning', 2400);
      return null;
    }
    if (result.modules) setCustomModules(result.modules);
    showToast('已创建自定义模块', 'success');
    return customModuleOption(result.module);
  }

  async function handleCreateReason(name: string): Promise<ErrorReasonOption | null> {
    const result = await CustomErrorReasonService.createCustomErrorReason(name);
    if (!result.ok || !result.reason) {
      showToast(result.errorMessage ?? '创建错因失败', 'warning', 2400);
      return null;
    }
    if (result.reasons) setCustomReasons(result.reasons);
    showToast('已创建自定义错因', 'success');
    return customReasonOption(result.reason);
  }

  async function handleSave() {
    if (busy) return;
    const saveDraft = {
      ...draft,
      questionImage: draft.questionImages[0] ?? null,
      errorReason: draft.errorReasonLabels.join('、') || null,
    };
    const validation = validateAddMistakeDraft(saveDraft);
    if (!validation.ok) {
      showToast(validation.errors[0] ?? '请检查必填信息', 'warning', 2400);
      return;
    }
    setSaving(true);
    try {
      const result = await createMistakesFromDraft(saveDraft, { joinReviewPlan: saveDraft.joinReviewPlan });
      if (!result.ok) {
        showToast(result.errorMessage ?? '保存失败，请稍后重试', 'error', 2600);
        return;
      }
      const count = result.mistakeIds?.length ?? 1;
      const moduleName = saveDraft.module?.trim();
      if (moduleName) setRecentModuleNames((current) => [moduleName, ...current.filter((item) => item !== moduleName)].slice(0, 3));
      setDraft(createEmptyAddMistakeDraft());
      setStage('QUESTION');
      setPreview(null);
      showToast(
        count > 1
          ? `已保存 ${count} 道${saveDraft.joinReviewPlan ? '并加入七刷' : '到题库'}`
          : saveDraft.joinReviewPlan ? '保存成功，已加入七刷' : '保存成功，已加入题库',
        'success',
        2400,
      );
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected save error.', { error });
      showToast('保存失败，请稍后重试', 'error', 2600);
    } finally {
      setSaving(false);
    }
  }

  const sharedUri = firstParam(params.sharedImageUri);
  const sharedNonce = firstParam(params.sharedImageNonce);
  const sharedError = firstParam(params.sharedImageError);

  useEffect(() => {
    if (!sharedError) return;
    const key = `${sharedNonce ?? 'none'}:${sharedError}`;
    if (lastSharedErrorKeyRef.current === key) return;
    lastSharedErrorKeyRef.current = key;
    showToast('从其他应用导入图片失败，请重试', 'warning', 2400);
  }, [sharedError, sharedNonce, showToast]);

  useEffect(() => {
    if (!sharedUri || busy || draft.questionImages.length >= MAX_IMAGES_PER_TYPE) return;
    const key = `${sharedNonce ?? 'none'}:${sharedUri}`;
    if (lastSharedKeyRef.current === key) return;
    lastSharedKeyRef.current = key;
    void runImageAction('shared-question', () => saveSharedImageToMistakeFolder({
      mistakeId: draft.draftId,
      type: 'question',
      sourceUri: sharedUri,
      index: draft.questionImages.length,
    })).then((result) => {
      if (!result?.ok || !result.image) {
        showToast('图片读取失败，请重试', 'error', 2400);
        return;
      }
      setDraft((current) => {
        const questionImages = [...current.questionImages, result.image as LocalImage];
        return { ...current, questionImages, questionImage: questionImages[0] ?? null };
      });
      showToast('已从其他应用导入图片', 'success');
    });
  }, [busy, draft.draftId, draft.questionImages.length, runImageAction, sharedNonce, sharedUri, showToast]);

  return (
    <PageShell hasBottomTab safeAreaEdges={['top']} withPadding={false} style={styles.root}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: bottomBarHeight + spacing.xl }]}>
        <PageHeader title="新增错题" />
        <AddMistakeProgress stage={stage} />

        <View style={styles.sectionHeading}>
          <SectionHeader title="题目照片" />
          <Text style={styles.sectionHelp}>先添加题目照片，其他信息稍后再补</Text>
        </View>
        <PhotoPickerSection
          busy={busy}
          images={draft.questionImages}
          processingProgress={imageBatchProgress}
          emptyTitle="拍摄题目"
          emptySubtitle="支持多张，稍后可调整顺序"
          onTakePhoto={() => void handleTakeQuestion()}
          onPickImages={() => void handlePickQuestion()}
          onDelete={handleDeleteQuestion}
          onMove={(from, to) => setDraft((current) => {
            const questionImages = moveItem(current.questionImages, from, to);
            return { ...current, questionImages, questionImage: questionImages[0] ?? null };
          })}
          onPreview={(image, index) => setPreview({ image, title: `题目照片 ${index + 1}/${draft.questionImages.length}` })}
        />
        {draft.questionImages.length > 1 ? <Text style={styles.batchHint}>当前按原有批量规则保存为 {draft.questionImages.length} 道错题，顺序决定题号。</Text> : null}

        <SurfaceCard padding={0} style={styles.infoList}>
          <InfoRow
            icon="layers"
            title="所属模块（可选）"
            value={draft.module ?? '稍后补充'}
            active={!!draft.module}
            onPress={() => setModuleSheetVisible(true)}
          />
          <InfoRow
            border
            icon="list-alt"
            title="可选信息"
            subtitle="做法、解析、错因、难度和备注"
            value={optionalSummary}
            onPress={openOptionalSheet}
          />
          <View style={[styles.infoRow, styles.infoBorder]}>
            <View style={styles.infoIcon}><MaterialIcons name="event-available" size={layout.iconSize} color={draft.joinReviewPlan ? colors.accent : colors.textSecondary} /></View>
            <View style={styles.infoCopy}>
              <Text style={styles.infoTitle}>同时加入七刷</Text>
              <Text style={styles.infoSubtitle}>按复做节奏加入今日计划</Text>
            </View>
            <Switch
              accessibilityLabel="同时加入七刷"
              disabled={busy}
              onValueChange={(joinReviewPlan) => setDraft((current) => ({ ...current, joinReviewPlan }))}
              thumbColor="#FFFFFF"
              trackColor={{ false: '#D1D1D6', true: colors.accent }}
              value={draft.joinReviewPlan}
            />
          </View>
        </SurfaceCard>
      </ScrollView>

      <View
        onLayout={(event) => {
          const nextHeight = Math.ceil(event.nativeEvent.layout.height);
          setBottomBarHeight((current) => (current === nextHeight ? current : nextHeight));
        }}
        style={styles.bottomBar}>
        <Text style={[styles.saveHint, !canProceed && styles.saveHintWarning]}>{validationHint}</Text>
        <PrimaryButton
          disabled={!canProceed}
          onPress={() => void handleSave()}
          title={saving ? '正在保存…' : '保存到题库'}
        />
      </View>

      <ModulePickerSheet
        visible={moduleSheetVisible}
        selectedId={draft.moduleId}
        options={moduleOptions}
        recentIds={recentModuleIds}
        busy={busy}
        onCancel={() => setModuleSheetVisible(false)}
        onComplete={(option) => {
          setDraft((current) => ({ ...current, moduleId: option?.id ?? null, module: option?.label ?? null }));
          setModuleSheetVisible(false);
        }}
        onCreateCustom={handleCreateModule}
      />
      <OptionalInfoSheet
        visible={optionalSheetVisible}
        draft={draft}
        reasonOptions={reasonOptions}
        imageBusy={imageBusy}
        imageProgress={imageBatchProgress}
        onTakePhoto={(type, index) => takeImage(type, index, true)}
        onPickImages={async (type, index) => ({ images: await pickImages(type, index, MAX_IMAGES_PER_TYPE - index, true), ok: true })}
        onCreateCustomReason={handleCreateReason}
        onCancel={() => handleOptionalCancel()}
        onComplete={handleOptionalComplete}
      />
      <ImagePreviewModal
        visible={!!preview}
        uri={preview?.image.uri ?? null}
        title={preview?.title ?? '题目照片'}
        interactionMode="zoomable"
        logSource="add-question"
        onClose={() => setPreview(null)}
      />
      <AppToast {...toastProps} bottomOffset={bottomBarHeight + 12} />
    </PageShell>
  );
}

function InfoRow({ icon, title, subtitle, value, active = false, border = false, onPress }: { icon: keyof typeof MaterialIcons.glyphMap; title: string; subtitle?: string; value: string; active?: boolean; border?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.infoRow, border && styles.infoBorder, pressed && styles.rowPressed]}>
      <View style={styles.infoIcon}><MaterialIcons name={icon} size={layout.iconSize} color={active ? colors.accent : colors.textSecondary} /></View>
      <View style={styles.infoCopy}><Text style={styles.infoTitle}>{title}</Text>{subtitle ? <Text style={styles.infoSubtitle}>{subtitle}</Text> : null}</View>
      <Text numberOfLines={2} style={[styles.infoValue, active && styles.infoValueActive]}>{value}</Text>
      <MaterialIcons name="chevron-right" size={layout.chevronSize} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.pageBackground },
  content: { paddingTop: layout.headerTopPadding, paddingHorizontal: spacing.screenPadding },
  sectionHeading: { marginBottom: spacing.md, gap: spacing.xs },
  sectionHelp: { ...typography.pageSubtitle },
  batchHint: { ...typography.meta, marginTop: spacing.sm },
  infoList: { overflow: 'hidden', marginTop: spacing.xl },
  infoRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.md },
  infoBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  infoIcon: { width: layout.featureIconSize, height: layout.featureIconSize, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  infoCopy: { flex: 1 },
  infoTitle: { ...typography.cardTitle },
  infoSubtitle: { ...typography.meta, marginTop: spacing.xs },
  infoValue: { maxWidth: 112, color: colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'right' },
  infoValueActive: { color: colors.accent, fontWeight: '600' },
  rowPressed: { opacity: 0.55 },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screenPadding, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, backgroundColor: colors.pageBackground },
  saveHint: { ...typography.meta, marginBottom: spacing.sm, textAlign: 'center' },
  saveHintWarning: { color: '#C76D00' },
});
