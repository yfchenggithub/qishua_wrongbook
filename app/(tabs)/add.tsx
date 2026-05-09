import { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  BrandHeader,
  CardContainer,
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
  takePhotoAndSave,
} from '@/src/services/ImageService';
import { Logger } from '@/src/services/Logger';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'AddScreen';
const MAX_DRAFT_RETRY = 5;

type DraftImageField = 'questionImage' | 'mySolutionImage' | 'answerImage';
type CaptureCardVariant = 'primary' | 'compact';

type CaptureEntryConfig = {
  key: DraftImageField;
  type: LocalImageType;
  title: string;
  subtitle: string;
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

export default function AddScreen() {
  const [draft, setDraft] = useState<AddMistakeDraft>(() => createEmptyAddMistakeDraft());
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [activeImageAction, setActiveImageAction] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showOptionalInfo, setShowOptionalInfo] = useState(false);

  const isImageBusy = activeImageAction !== null;
  const isBusy = isImageBusy || isSaving;
  const missingQuestionImage = draft.questionImage === null;
  const missingModule = !hasValue(draft.module);
  const canSave = !isBusy && !missingQuestionImage && !missingModule;

  const saveHintText = isSaving
    ? '保存中，请稍候...'
    : isImageBusy
      ? '图片处理中，请稍候...'
      : missingQuestionImage
        ? '请先拍题目照片'
        : missingModule
          ? '请选择模块'
          : '可以保存并加入 7 刷';

  function updateDraft<K extends keyof AddMistakeDraft>(field: K, value: AddMistakeDraft[K]) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function updateDraftImage(field: DraftImageField, image: LocalImage | null) {
    setDraft((prev) => setDraftImageByField(prev, field, image));
  }

  async function runImageAction(actionKey: string, handler: () => Promise<void>) {
    if (isBusy) {
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
      const result = await takePhotoAndSave({
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

  async function handlePickImage(config: CaptureEntryConfig) {
    await runImageAction(`pick-${config.key}`, async () => {
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

  async function handleSaveDraft() {
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
        <CaptureEntryCard
          config={QUESTION_CAPTURE_ENTRY}
          image={getDraftImageByField(draft, QUESTION_CAPTURE_ENTRY.key)}
          busy={isBusy}
          onTakePhoto={() => {
            void handleTakePhoto(QUESTION_CAPTURE_ENTRY);
          }}
          onPickImage={() => {
            void handlePickImage(QUESTION_CAPTURE_ENTRY);
          }}
          onDeleteImage={() => handleDeleteImage(QUESTION_CAPTURE_ENTRY)}
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
            {saveHintText}
          </Text>
          <PrimaryButton
            title={isSaving ? '保存中...' : '保存并加入 7 刷'}
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
