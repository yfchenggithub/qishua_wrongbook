import { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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
import { addMistakeMock } from '@/src/mocks/addMistake';
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
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'AddScreen';

type DraftImageField = 'questionImage' | 'mySolutionImage' | 'answerImage';

type CaptureEntryConfig = {
  key: DraftImageField;
  type: LocalImageType;
  title: string;
  subtitle: string;
};

const CAPTURE_ENTRIES: CaptureEntryConfig[] = [
  {
    key: 'questionImage',
    type: 'question',
    title: '题目照片',
    subtitle: '拍原题，建议只框住一道题',
  },
  {
    key: 'mySolutionImage',
    type: 'my_solution',
    title: '我的做法',
    subtitle: '拍自己的错误过程或订正过程',
  },
  {
    key: 'answerImage',
    type: 'answer',
    title: '答案 / 解析',
    subtitle: '拍标准答案、老师讲解或参考解析',
  },
];

function IntroIconPlaceholder() {
  return (
    <View style={styles.introIconBox}>
      <View style={styles.introDocShape}>
        <View style={styles.introDocLine} />
        <View style={styles.introDocLineShort} />
        <View style={styles.introDocLine} />
      </View>
      <View style={styles.introPlusCircle}>
        <Text style={styles.introPlusText}>+</Text>
      </View>
    </View>
  );
}

function CapturePlaceholder() {
  return (
    <View style={styles.capturePlaceholder}>
      <View style={styles.cameraBody}>
        <View style={styles.cameraLens} />
      </View>
      <Text style={styles.capturePlaceholderText}>点击拍照</Text>
    </View>
  );
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
  onTakePhoto,
  onPickImage,
  onDeleteImage,
}: {
  config: CaptureEntryConfig;
  image: LocalImage | null;
  busy: boolean;
  onTakePhoto: () => void;
  onPickImage: () => void;
  onDeleteImage: () => void;
}) {
  return (
    <CardContainer style={styles.captureCard} padding={spacing.lg}>
      <View style={styles.captureRow}>
        {image ? (
          <Image source={{ uri: image.uri }} style={styles.capturePreviewImage} resizeMode="cover" />
        ) : (
          <CapturePlaceholder />
        )}

        <View style={styles.captureMain}>
          <Text style={styles.captureTitle}>{config.title}</Text>
          <Text style={styles.captureSubtitle}>{config.subtitle}</Text>

          {image ? (
            <Text style={styles.imageMetaText}>已选择：{image.fileName}</Text>
          ) : (
            <Text style={styles.imageMetaText}>尚未选择图片</Text>
          )}

          <View style={styles.captureActionRow}>
            <Pressable
              onPress={onTakePhoto}
              disabled={busy}
              style={[styles.captureActionButton, styles.captureActionPrimary, busy && styles.disabledButton]}>
              <Text style={styles.captureActionPrimaryText}>拍照</Text>
            </Pressable>

            <Pressable
              onPress={onPickImage}
              disabled={busy}
              style={[styles.captureActionButton, styles.captureActionSecondary, busy && styles.disabledButton]}>
              <Text style={styles.captureActionSecondaryText}>从相册选择</Text>
            </Pressable>
          </View>

          {image ? (
            <Pressable
              onPress={onDeleteImage}
              disabled={busy}
              style={[styles.captureDeleteButton, busy && styles.disabledButton]}>
              <Text style={styles.captureDeleteText}>删除图片</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </CardContainer>
  );
}

export default function AddScreen() {
  const [draft, setDraft] = useState<AddMistakeDraft>(() => createEmptyAddMistakeDraft());
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [activeImageAction, setActiveImageAction] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isImageBusy = activeImageAction !== null;
  const isBusy = isImageBusy || isSaving;

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
            updateDraftImage(config.key, null);

            if (!removed) {
              Alert.alert('删除失败', '图片文件删除失败，但已从草稿中移除。');
            }
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
      setValidationErrors(result.errors);
      Alert.alert('校验未通过', result.errors.join('\n'));
      return;
    }

    setValidationErrors([]);
    setIsSaving(true);

    try {
      const saveResult = await createMistakeFromDraft(draft);
      if (!saveResult.ok) {
        const message = saveResult.errorMessage ?? '保存失败，请稍后重试。';
        Logger.error(PAGE_SCOPE, 'Failed to save draft.', {
          draftId: draft.draftId,
          message,
        });
        Alert.alert('保存失败', message);
        return;
      }

      Alert.alert(
        '保存成功',
        `错题已加入 7 刷计划。\nID: ${saveResult.mistakeId ?? draft.draftId}`,
      );
      setDraft(createEmptyAddMistakeDraft());
      setValidationErrors([]);
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected error while saving draft.', {
        draftId: draft.draftId,
        error,
      });
      Alert.alert('保存失败', error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ScreenContainer scroll contentStyle={styles.screenContent}>
      <BrandHeader title={addMistakeMock.brand.title} subtitle={addMistakeMock.brand.subtitle} />

      <View style={styles.sectionBlock}>
        <SectionTitle title={addMistakeMock.sectionTitle} />

        <CardContainer style={styles.introCard} padding={spacing.lg}>
          <View style={styles.introRow}>
            <IntroIconPlaceholder />
            <View style={styles.introTextWrap}>
              <Text style={styles.introTitle}>{addMistakeMock.introCard.title}</Text>
              <Text style={styles.introSubtitle}>{addMistakeMock.introCard.subtitle}</Text>
              <Text style={styles.draftIdText}>草稿ID：{draft.draftId}</Text>
            </View>
          </View>
        </CardContainer>

        <View style={styles.captureList}>
          {CAPTURE_ENTRIES.map((config) => {
            const image = getDraftImageByField(draft, config.key);
            return (
              <CaptureEntryCard
                key={config.key}
                config={config}
                image={image}
                busy={isBusy}
                onTakePhoto={() => {
                  void handleTakePhoto(config);
                }}
                onPickImage={() => {
                  void handlePickImage(config);
                }}
                onDeleteImage={() => handleDeleteImage(config)}
              />
            );
          })}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="模块" />
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
        <SectionTitle title="错因（可选）" />
        <View style={styles.tagsRow}>
          {ERROR_REASON_OPTIONS.map((item) => (
            <TagChip
              key={item.value}
              label={item.label}
              selected={draft.errorReason === item.value}
              onPress={() =>
                updateDraft('errorReason', draft.errorReason === item.value ? null : item.value)
              }
            />
          ))}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="难度" />
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

        <CardContainer padding={spacing.lg} style={styles.inputCard}>
          <Text style={styles.inputLabel}>标题（可选）</Text>
          <TextInput
            value={draft.title}
            onChangeText={(value) => updateDraft('title', value)}
            placeholder="例如：椭圆切线范围题"
            placeholderTextColor={colors.textMuted}
            style={styles.textInput}
          />

          <Text style={styles.inputLabel}>备注（可选）</Text>
          <TextInput
            value={draft.note}
            onChangeText={(value) => updateDraft('note', value)}
            placeholder="例如：老师强调第二问要先设参数"
            placeholderTextColor={colors.textMuted}
            style={[styles.textInput, styles.noteInput]}
            multiline
            textAlignVertical="top"
          />
        </CardContainer>
      </View>

      {validationErrors.length > 0 ? (
        <CardContainer style={styles.errorCard} padding={spacing.lg}>
          <Text style={styles.errorTitle}>校验提示</Text>
          {validationErrors.map((error) => (
            <Text key={error} style={styles.errorItemText}>
              - {error}
            </Text>
          ))}
        </CardContainer>
      ) : null}

      <PrimaryButton
        title={isSaving ? '保存中...' : isImageBusy ? '处理中...' : addMistakeMock.submitText}
        disabled={isBusy}
        onPress={() => {
          void handleSaveDraft();
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    gap: spacing.xl,
  },
  sectionBlock: {
    gap: spacing.md,
  },
  introCard: {
    borderRadius: radius.xl,
  },
  introRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  introIconBox: {
    width: 78,
    height: 78,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  introDocShape: {
    width: 40,
    height: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
  },
  introDocLine: {
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
  },
  introDocLineShort: {
    width: 22,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
  },
  introPlusCircle: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introPlusText: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 16,
    fontWeight: '700',
  },
  introTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  introTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  introSubtitle: {
    ...typography.body,
  },
  draftIdText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  captureList: {
    gap: spacing.md,
  },
  captureCard: {
    borderRadius: radius.xl,
    minHeight: 180,
    justifyContent: 'center',
  },
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  capturePlaceholder: {
    width: 102,
    height: 122,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#D9DCE1',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  capturePreviewImage: {
    width: 102,
    height: 122,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  cameraBody: {
    width: 40,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraLens: {
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.white,
  },
  capturePlaceholderText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  captureMain: {
    flex: 1,
    gap: spacing.xs,
  },
  captureTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  captureSubtitle: {
    ...typography.body,
  },
  imageMetaText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  captureActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  captureActionButton: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  captureDeleteButton: {
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#F0C3C3',
    backgroundColor: '#FFECEC',
    marginTop: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureDeleteText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.5,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
    minHeight: 48,
  },
  noteInput: {
    minHeight: 112,
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
});
