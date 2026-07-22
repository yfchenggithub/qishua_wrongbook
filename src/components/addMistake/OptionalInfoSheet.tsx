import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ADD_MISTAKE_NOTE_MAX_LENGTH,
  DIFFICULTY_OPTIONS,
  MISTAKE_TITLE_MAX_LENGTH,
  SUPPLEMENT_TEXT_MAX_LENGTH,
} from '@/src/constants/mistakeOptions';
import type { AddMistakeDraft } from '@/src/models/AddMistakeDraft';
import type { ImageBatchProgress, LocalImage, LocalImageType } from '@/src/models/LocalImage';
import { MAX_CUSTOM_ERROR_REASON_NAME_LENGTH } from '@/src/services/CustomErrorReasonService';
import { colors } from '@/src/styles/tokens';
import { PhotoPickerSection } from './PhotoPickerSection';

const GREEN = colors.accent;
const TEXT = '#1C1C1E';
const SECONDARY = '#8E8E93';
const BORDER = '#E5E5EA';
const BACKGROUND = '#F2F2F7';

export interface ErrorReasonOption {
  id: string;
  label: string;
  isCustom?: boolean;
}

type OptionalScreen = 'overview' | 'solution' | 'answer' | 'reasons' | 'difficulty' | 'titleNotes' | 'newReason';

interface ImageActionResult {
  images: LocalImage[];
  ok: boolean;
}

export interface OptionalInfoSheetProps {
  visible: boolean;
  draft: AddMistakeDraft;
  reasonOptions: ErrorReasonOption[];
  imageBusy: boolean;
  imageProgress?: ImageBatchProgress | null;
  onTakePhoto: (type: LocalImageType, index: number) => Promise<LocalImage | null>;
  onPickImages: (type: LocalImageType, index: number) => Promise<ImageActionResult>;
  onCreateCustomReason: (name: string) => Promise<ErrorReasonOption | null>;
  onCancel: (workingDraft: AddMistakeDraft) => void;
  onComplete: (workingDraft: AddMistakeDraft) => void;
}

function cloneDraft(draft: AddMistakeDraft): AddMistakeDraft {
  return {
    ...draft,
    questionImages: [...draft.questionImages],
    mySolutionImages: [...draft.mySolutionImages],
    answerImages: [...draft.answerImages],
    errorReasonIds: [...draft.errorReasonIds],
    errorReasonLabels: [...draft.errorReasonLabels],
  };
}

export function OptionalInfoSheet({
  visible,
  draft,
  reasonOptions,
  imageBusy,
  imageProgress = null,
  onTakePhoto,
  onPickImages,
  onCreateCustomReason,
  onCancel,
  onComplete,
}: OptionalInfoSheetProps) {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<OptionalScreen>('overview');
  const [working, setWorking] = useState<AddMistakeDraft>(() => cloneDraft(draft));
  const [reasonName, setReasonName] = useState('');
  const [reasonMessage, setReasonMessage] = useState<string | null>(null);
  const [creatingReason, setCreatingReason] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setWorking(cloneDraft(draft));
    setScreen('overview');
    setReasonName('');
    setReasonMessage(null);
  }, [draft, visible]);

  const screenTitle = useMemo(() => {
    if (screen === 'solution') return '我的做法';
    if (screen === 'answer') return '答案／解析';
    if (screen === 'reasons') return '选择错因';
    if (screen === 'difficulty') return '选择难度';
    if (screen === 'titleNotes') return '标题与备注';
    if (screen === 'newReason') return '新建错因';
    return '可选信息';
  }, [screen]);

  function updateWorking(patch: Partial<AddMistakeDraft>) {
    setWorking((current) => ({ ...current, ...patch }));
  }

  function handleBack() {
    if (screen === 'newReason') {
      setScreen('reasons');
      return;
    }
    setScreen('overview');
  }

  function handleRequestClose() {
    if (screen !== 'overview') {
      handleBack();
      return;
    }
    onCancel(working);
  }

  async function addPhoto(type: 'my_solution' | 'answer', field: 'mySolutionImages' | 'answerImages') {
    const current = working[field];
    const image = await onTakePhoto(type, current.length);
    if (!image) return;
    const next = [...current, image];
    updateWorking({ [field]: next, [field === 'mySolutionImages' ? 'mySolutionImage' : 'answerImage']: next[0] ?? null });
  }

  async function addFromAlbum(type: 'my_solution' | 'answer', field: 'mySolutionImages' | 'answerImages') {
    const current = working[field];
    const result = await onPickImages(type, current.length);
    if (result.images.length === 0) return;
    const next = [...current, ...result.images];
    updateWorking({ [field]: next, [field === 'mySolutionImages' ? 'mySolutionImage' : 'answerImage']: next[0] ?? null });
  }

  function removeImage(field: 'mySolutionImages' | 'answerImages', image: LocalImage) {
    const next = working[field].filter((item) => item.id !== image.id);
    updateWorking({ [field]: next, [field === 'mySolutionImages' ? 'mySolutionImage' : 'answerImage']: next[0] ?? null });
  }

  function moveImage(field: 'mySolutionImages' | 'answerImages', from: number, to: number) {
    const next = [...working[field]];
    if (to < 0 || to >= next.length || from === to) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateWorking({ [field]: next, [field === 'mySolutionImages' ? 'mySolutionImage' : 'answerImage']: next[0] ?? null });
  }

  function toggleReason(option: ErrorReasonOption) {
    const selected = working.errorReasonIds.includes(option.id);
    const ids = selected
      ? working.errorReasonIds.filter((id) => id !== option.id)
      : [...working.errorReasonIds, option.id];
    const labels = ids
      .map((id) => reasonOptions.find((item) => item.id === id)?.label)
      .filter((label): label is string => !!label);
    updateWorking({ errorReasonIds: ids, errorReasonLabels: labels, errorReason: labels.join('、') || null });
  }

  async function handleCreateReason() {
    if (creatingReason) return;
    const name = reasonName.trim();
    if (!name) {
      setReasonMessage('请输入错因名称。');
      return;
    }
    setCreatingReason(true);
    setReasonMessage(null);
    try {
      const created = await onCreateCustomReason(name);
      if (!created) return;
      const ids = working.errorReasonIds.includes(created.id)
        ? working.errorReasonIds
        : [...working.errorReasonIds, created.id];
      const labels = Array.from(new Set([...working.errorReasonLabels, created.label]));
      updateWorking({ errorReasonIds: ids, errorReasonLabels: labels, errorReason: labels.join('、') });
      setScreen('reasons');
      setReasonName('');
    } finally {
      setCreatingReason(false);
    }
  }

  return (
    <Modal transparent statusBarTranslucent animationType="slide" visible={visible} onRequestClose={handleRequestClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.layer}>
        <Pressable accessibilityLabel="关闭可选信息" onPress={handleRequestClose} style={styles.backdrop} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.handle} />
          <SheetHeader
            overview={screen === 'overview'}
            title={screenTitle}
            onLeft={screen === 'overview' ? () => onCancel(working) : handleBack}
            onRight={screen === 'overview' ? () => onComplete(working) : screen === 'newReason' ? () => void handleCreateReason() : handleBack}
            rightLabel={screen === 'overview' ? '完成' : screen === 'newReason' ? (creatingReason ? '创建中' : '创建') : '保存'}
          />
          {screen === 'overview' ? (
            <Overview draft={working} onNavigate={setScreen} />
          ) : screen === 'solution' ? (
            <SupplementContentEditor
              title="我的做法"
              helpText="记录当时的解题过程，图片和文字可以同时添加"
              imageSectionTitle="做法图片（可选）"
              emptyTitle="添加做法图片"
              textSectionTitle="文字说明（可选）"
              placeholder="写下解题思路、关键步骤或公式…"
              images={working.mySolutionImages}
              text={working.mySolutionText}
              busy={imageBusy}
              processingProgress={imageProgress}
              onChangeText={(value) => updateWorking({ mySolutionText: value })}
              onTakePhoto={() => void addPhoto('my_solution', 'mySolutionImages')}
              onPickImages={() => void addFromAlbum('my_solution', 'mySolutionImages')}
              onDelete={(image) => removeImage('mySolutionImages', image)}
              onMove={(from, to) => moveImage('mySolutionImages', from, to)}
            />
          ) : screen === 'answer' ? (
            <SupplementContentEditor
              title="答案／解析"
              helpText="保存标准答案或讲解，复做时按需查看"
              imageSectionTitle="解析图片（可选）"
              emptyTitle="添加答案或解析图片"
              textSectionTitle="文字解析（可选）"
              placeholder="写下标准答案、关键结论或详细讲解…"
              images={working.answerImages}
              text={working.answerText}
              busy={imageBusy}
              processingProgress={imageProgress}
              onChangeText={(value) => updateWorking({ answerText: value })}
              onTakePhoto={() => void addPhoto('answer', 'answerImages')}
              onPickImages={() => void addFromAlbum('answer', 'answerImages')}
              onDelete={(image) => removeImage('answerImages', image)}
              onMove={(from, to) => moveImage('answerImages', from, to)}
            />
          ) : screen === 'reasons' ? (
            <ErrorReasonPicker
              options={reasonOptions}
              selectedIds={working.errorReasonIds}
              onToggle={toggleReason}
              onCreate={() => setScreen('newReason')}
            />
          ) : screen === 'difficulty' ? (
            <DifficultyPicker value={working.difficulty} onChange={(difficulty) => updateWorking({ difficulty })} />
          ) : screen === 'titleNotes' ? (
            <TitleNotesEditor
              title={working.title}
              note={working.note}
              onChangeTitle={(title) => updateWorking({ title })}
              onChangeNote={(note) => updateWorking({ note })}
            />
          ) : (
            <View style={styles.createReasonContent}>
              <Text style={styles.fieldLabel}>错因名称</Text>
              <TextInput
                autoFocus={false}
                maxLength={MAX_CUSTOM_ERROR_REASON_NAME_LENGTH}
                onChangeText={(value) => { setReasonName(value); setReasonMessage(null); }}
                onSubmitEditing={() => void handleCreateReason()}
                placeholder="例如：审题遗漏"
                placeholderTextColor={SECONDARY}
                returnKeyType="done"
                style={styles.singleInput}
                value={reasonName}
              />
              <Text style={styles.counter}>{reasonName.length} / {MAX_CUSTOM_ERROR_REASON_NAME_LENGTH}</Text>
              {reasonMessage ? <Text style={styles.errorText}>{reasonMessage}</Text> : null}
              <Text style={styles.helpInline}>创建后会保存在本机，并自动加入本题错因。</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetHeader({ overview, title, onLeft, onRight, rightLabel }: { overview: boolean; title: string; onLeft: () => void; onRight: () => void; rightLabel: string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onLeft} style={styles.headerAction}>
        {overview ? <Text style={styles.headerLeftText}>取消</Text> : <MaterialIcons name="chevron-left" size={28} color={GREEN} />}
        {!overview ? <Text style={styles.backText}>可选信息</Text> : null}
      </Pressable>
      <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
      <Pressable onPress={onRight} style={styles.headerAction}>
        <Text style={styles.headerRightText}>{rightLabel}</Text>
      </Pressable>
    </View>
  );
}

function Overview({ draft, onNavigate }: { draft: AddMistakeDraft; onNavigate: (screen: OptionalScreen) => void }) {
  const contentAdded = (images: LocalImage[], text: string) => images.length > 0 || text.trim().length > 0;
  const difficulty = DIFFICULTY_OPTIONS.find((item) => item.value === draft.difficulty)?.label ?? `${draft.difficulty}`;
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.overviewContent}>
      <Text style={styles.overviewHelp}>这些都不是保存题目的必填项</Text>
      <OverviewGroup title="解题内容">
        <OverviewRow icon="edit-note" title="我的做法" status={contentAdded(draft.mySolutionImages, draft.mySolutionText) ? '已添加' : '添加图片或文字'} onPress={() => onNavigate('solution')} />
        <OverviewRow icon="menu-book" title="答案／解析" status={contentAdded(draft.answerImages, draft.answerText) ? '已添加' : '添加图片或文字'} onPress={() => onNavigate('answer')} border />
      </OverviewGroup>
      <OverviewGroup title="复盘信息">
        <OverviewRow icon="help-outline" title="错因" status={draft.errorReasonIds.length > 0 ? `${draft.errorReasonIds.length} 项` : '未选择'} onPress={() => onNavigate('reasons')} />
        <OverviewRow icon="signal-cellular-alt" title="难度" status={difficulty} statusActive onPress={() => onNavigate('difficulty')} border />
      </OverviewGroup>
      <OverviewGroup title="补充">
        <OverviewRow icon="notes" title="标题与备注" status={draft.title.trim() || draft.note.trim() ? '已填写' : '未填写'} onPress={() => onNavigate('titleNotes')} />
      </OverviewGroup>
      <Text style={styles.localOnly}><MaterialIcons name="lock-outline" size={14} /> 仅保存在本机</Text>
    </ScrollView>
  );
}

function OverviewGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.overviewGroup}><Text style={styles.groupTitle}>{title}</Text><View style={styles.groupList}>{children}</View></View>;
}

function OverviewRow({ icon, title, status, onPress, border = false, statusActive = false }: { icon: keyof typeof MaterialIcons.glyphMap; title: string; status: string; onPress: () => void; border?: boolean; statusActive?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.overviewRow, border && styles.rowBorder, pressed && styles.pressed]}>
      <View style={styles.rowIcon}><MaterialIcons name={icon} size={22} color="#636366" /></View>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text numberOfLines={1} style={[styles.rowStatus, statusActive && styles.greenText]}>{status}</Text>
      <MaterialIcons name="chevron-right" size={24} color={SECONDARY} />
    </Pressable>
  );
}

interface SupplementContentEditorProps {
  title: string;
  helpText: string;
  imageSectionTitle: string;
  emptyTitle: string;
  textSectionTitle: string;
  placeholder: string;
  images: LocalImage[];
  text: string;
  busy: boolean;
  processingProgress?: ImageBatchProgress | null;
  onChangeText: (value: string) => void;
  onTakePhoto: () => void;
  onPickImages: () => void;
  onDelete: (image: LocalImage) => void;
  onMove: (from: number, to: number) => void;
}

export function SupplementContentEditor({
  title,
  helpText,
  imageSectionTitle,
  emptyTitle,
  textSectionTitle,
  placeholder,
  images,
  text,
  busy,
  processingProgress,
  onChangeText,
  onTakePhoto,
  onPickImages,
  onDelete,
  onMove,
}: SupplementContentEditorProps) {
  return (
    <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}>
      <Text style={styles.screenHelp}>{helpText}</Text>
      <Text style={styles.fieldLabel}>{imageSectionTitle}</Text>
      <PhotoPickerSection
        compact
        busy={busy}
        images={images}
        processingProgress={processingProgress}
        emptyTitle={emptyTitle}
        onTakePhoto={onTakePhoto}
        onPickImages={onPickImages}
        onDelete={onDelete}
        onMove={onMove}
      />
      <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>{textSectionTitle}</Text>
      <View style={styles.textAreaWrap}>
        <TextInput multiline maxLength={SUPPLEMENT_TEXT_MAX_LENGTH} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={SECONDARY} style={styles.textArea} textAlignVertical="top" value={text} />
        <Text style={styles.textAreaCounter}>{text.length} / {SUPPLEMENT_TEXT_MAX_LENGTH}</Text>
      </View>
      <Text style={styles.localOnly}><MaterialIcons name="lock-outline" size={14} /> 仅保存在本机</Text>
      <Text accessibilityElementsHidden style={styles.hiddenTitle}>{title}</Text>
    </ScrollView>
  );
}

function ErrorReasonPicker({ options, selectedIds, onToggle, onCreate }: { options: ErrorReasonOption[]; selectedIds: string[]; onToggle: (option: ErrorReasonOption) => void; onCreate: () => void }) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.editorContent}>
      <Text style={styles.screenHelp}>可多选，帮助你发现重复犯错的原因</Text>
      <Text style={styles.selectionCount}>已选择 {selectedIds.length} 项</Text>
      <View style={styles.selectionList}>
        {options.map((option, index) => {
          const selected = selectedIds.includes(option.id);
          return (
            <Pressable key={option.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => onToggle(option)} style={({ pressed }) => [styles.selectionRow, index > 0 && styles.rowBorder, selected && styles.selectedRow, pressed && styles.pressed]}>
              <Text style={styles.selectionLabel}>{option.label}</Text>
              {option.isCustom ? <Text style={styles.customMark}>自定义</Text> : null}
              <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>{selected ? <MaterialIcons name="check" size={18} color="#FFFFFF" /> : null}</View>
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={onCreate} style={({ pressed }) => [styles.createReasonEntry, pressed && styles.pressed]}><MaterialIcons name="add" size={28} color={GREEN} /><Text style={styles.createReasonText}>新建自定义错因</Text><MaterialIcons name="chevron-right" size={23} color={SECONDARY} /></Pressable>
    </ScrollView>
  );
}

const DIFFICULTY_HELP: Record<number, string> = { 1: '看一眼就会', 2: '只需少量思考', 3: '需要完整推理', 4: '步骤较多，容易卡住', 5: '需要特殊方法' };

function DifficultyPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.editorContent}>
      <Text style={styles.screenHelp}>用于安排后续复做强度</Text>
      <View style={styles.selectionList}>
        {DIFFICULTY_OPTIONS.map((option, index) => {
          const selected = value === option.value;
          const [, ...nameParts] = option.label.split(' ');
          return (
            <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => onChange(option.value)} style={({ pressed }) => [styles.difficultyRow, index > 0 && styles.rowBorder, selected && styles.selectedRow, pressed && styles.pressed]}>
              <View style={[styles.numberCircle, selected && styles.numberCircleSelected]}><Text style={[styles.numberCircleText, selected && styles.numberCircleTextSelected]}>{option.value}</Text></View>
              <View style={styles.difficultyCopy}><Text style={styles.selectionLabel}>{nameParts.join(' ')}</Text><Text style={styles.difficultyHelp}>{DIFFICULTY_HELP[option.value]}</Text></View>
              <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>{selected ? <MaterialIcons name="check" size={18} color="#FFFFFF" /> : null}</View>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.defaultHint}>默认选择 3 中等</Text>
    </ScrollView>
  );
}

function TitleNotesEditor({ title, note, onChangeTitle, onChangeNote }: { title: string; note: string; onChangeTitle: (value: string) => void; onChangeNote: (value: string) => void }) {
  return (
    <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}>
      <Text style={styles.screenHelp}>标题方便搜索，备注用于记录额外提醒</Text>
      <Text style={styles.fieldLabel}>标题</Text>
      <View style={styles.titleInputWrap}><TextInput maxLength={MISTAKE_TITLE_MAX_LENGTH} onChangeText={onChangeTitle} placeholder="例如：椭圆切线范围题" placeholderTextColor={SECONDARY} style={styles.titleInput} value={title} /><Text style={styles.inputCounter}>{title.length} / {MISTAKE_TITLE_MAX_LENGTH}</Text></View>
      <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>备注</Text>
      <View style={styles.noteInputWrap}><TextInput multiline maxLength={ADD_MISTAKE_NOTE_MAX_LENGTH} onChangeText={onChangeNote} placeholder="例如：第二问要先设参数" placeholderTextColor={SECONDARY} style={styles.noteInput} textAlignVertical="top" value={note} /><Text style={styles.inputCounter}>{note.length} / {ADD_MISTAKE_NOTE_MAX_LENGTH}</Text></View>
      <View style={styles.searchTip}><MaterialIcons name="search" size={21} color={SECONDARY} /><Text style={styles.searchTipText}>标题会出现在题库搜索结果中</Text></View>
      <Text style={styles.localOnly}><MaterialIcons name="lock-outline" size={14} /> 仅保存在本机</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: 'flex-end' },
  flex: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(28,28,30,0.42)' },
  sheet: { height: '90%', overflow: 'hidden', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: BACKGROUND },
  handle: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 9, backgroundColor: '#C7C7CC' },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7 },
  headerAction: { width: 92, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: TEXT, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  headerLeftText: { color: TEXT, fontSize: 16, fontWeight: '600' },
  backText: { marginLeft: -5, color: GREEN, fontSize: 15, fontWeight: '600' },
  headerRightText: { color: GREEN, fontSize: 16, fontWeight: '700' },
  overviewContent: { paddingHorizontal: 20, paddingBottom: 28 },
  overviewHelp: { marginBottom: 14, color: SECONDARY, fontSize: 15, textAlign: 'center' },
  overviewGroup: { marginTop: 14 },
  groupTitle: { marginBottom: 8, marginLeft: 4, color: SECONDARY, fontSize: 14, fontWeight: '600' },
  groupList: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#FFFFFF' },
  overviewRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 11 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F2F7' },
  rowTitle: { flex: 1, color: TEXT, fontSize: 17, fontWeight: '600' },
  rowStatus: { maxWidth: 126, color: SECONDARY, fontSize: 14 },
  greenText: { color: GREEN, fontWeight: '600' },
  localOnly: { marginTop: 22, color: SECONDARY, fontSize: 13, textAlign: 'center' },
  editorContent: { paddingHorizontal: 20, paddingBottom: 34 },
  screenHelp: { marginBottom: 24, color: SECONDARY, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  fieldLabel: { marginBottom: 9, color: '#636366', fontSize: 16, fontWeight: '600' },
  fieldLabelSpaced: { marginTop: 24 },
  textAreaWrap: { minHeight: 190, borderRadius: 16, backgroundColor: '#FFFFFF' },
  textArea: { minHeight: 190, paddingHorizontal: 16, paddingTop: 15, paddingBottom: 36, color: TEXT, fontSize: 16, lineHeight: 23 },
  textAreaCounter: { position: 'absolute', right: 14, bottom: 11, color: SECONDARY, fontSize: 13 },
  hiddenTitle: { position: 'absolute', opacity: 0 },
  selectionCount: { marginBottom: 9, marginLeft: 4, color: SECONDARY, fontSize: 14 },
  selectionList: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#FFFFFF' },
  selectionRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 },
  selectedRow: { backgroundColor: colors.accentSoft },
  selectionLabel: { flex: 1, color: TEXT, fontSize: 17, fontWeight: '600' },
  customMark: { color: SECONDARY, fontSize: 12 },
  checkCircle: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#C7C7CC' },
  checkCircleSelected: { borderColor: GREEN, backgroundColor: GREEN },
  createReasonEntry: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, paddingHorizontal: 16, borderRadius: 16, backgroundColor: '#FFFFFF' },
  createReasonText: { flex: 1, color: TEXT, fontSize: 16, fontWeight: '600' },
  difficultyRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 14 },
  numberCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F2F7' },
  numberCircleSelected: { backgroundColor: GREEN },
  numberCircleText: { color: '#636366', fontSize: 20, fontWeight: '700' },
  numberCircleTextSelected: { color: '#FFFFFF' },
  difficultyCopy: { flex: 1 },
  difficultyHelp: { marginTop: 4, color: SECONDARY, fontSize: 14 },
  defaultHint: { marginTop: 18, color: SECONDARY, fontSize: 14, textAlign: 'center' },
  titleInputWrap: { minHeight: 82, borderRadius: 16, backgroundColor: '#FFFFFF' },
  titleInput: { minHeight: 56, paddingHorizontal: 16, color: TEXT, fontSize: 16 },
  noteInputWrap: { minHeight: 190, borderRadius: 16, backgroundColor: '#FFFFFF' },
  noteInput: { minHeight: 190, paddingHorizontal: 16, paddingTop: 15, paddingBottom: 36, color: TEXT, fontSize: 16, lineHeight: 23 },
  inputCounter: { position: 'absolute', right: 14, bottom: 10, color: SECONDARY, fontSize: 13 },
  searchTip: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22, paddingHorizontal: 16, borderRadius: 16, backgroundColor: '#FFFFFF' },
  searchTipText: { color: SECONDARY, fontSize: 14 },
  createReasonContent: { padding: 20 },
  singleInput: { minHeight: 54, borderRadius: 14, paddingHorizontal: 15, color: TEXT, fontSize: 17, backgroundColor: '#FFFFFF' },
  counter: { marginTop: 7, color: SECONDARY, fontSize: 13, textAlign: 'right' },
  errorText: { marginTop: 8, color: '#FF3B30', fontSize: 14 },
  helpInline: { marginTop: 18, color: SECONDARY, fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.55 },
});
