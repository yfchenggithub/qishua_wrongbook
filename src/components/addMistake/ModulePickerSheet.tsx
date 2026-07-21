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

import { MAX_CUSTOM_MODULE_NAME_LENGTH } from '@/src/services/CustomModuleService';
import { colors } from '@/src/styles/tokens';

const GREEN = colors.accent;
const TEXT = '#1C1C1E';
const SECONDARY = '#8E8E93';
const BORDER = '#E5E5EA';
const BACKGROUND = '#F2F2F7';

export interface ModulePickerOption {
  id: string;
  label: string;
  isCustom?: boolean;
}

export interface ModulePickerSheetProps {
  visible: boolean;
  selectedId: string | null;
  options: ModulePickerOption[];
  recentIds: string[];
  busy?: boolean;
  onCancel: () => void;
  onComplete: (option: ModulePickerOption | null) => void;
  onCreateCustom: (name: string) => Promise<ModulePickerOption | null>;
}

export function ModulePickerSheet({
  visible,
  selectedId,
  options,
  recentIds,
  busy = false,
  onCancel,
  onComplete,
  onCreateCustom,
}: ModulePickerSheetProps) {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<'list' | 'create'>('list');
  const [temporaryId, setTemporaryId] = useState<string | null>(selectedId);
  const [searchText, setSearchText] = useState('');
  const [customName, setCustomName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setScreen('list');
    setTemporaryId(selectedId);
    setSearchText('');
    setCustomName('');
    setMessage(null);
  }, [selectedId, visible]);

  const filteredOptions = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase();
    return keyword
      ? options.filter((option) => option.label.toLocaleLowerCase().includes(keyword))
      : options;
  }, [options, searchText]);
  const recentOptions = recentIds
    .map((id) => options.find((option) => option.id === id))
    .filter((option): option is ModulePickerOption => !!option)
    .slice(0, 3);
  const temporaryOption = options.find((option) => option.id === temporaryId) ?? null;

  async function handleCreate() {
    if (creating || busy) return;
    const name = customName.trim();
    if (!name) {
      setMessage('请输入模块名称。');
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const created = await onCreateCustom(name);
      if (!created) return;
      setTemporaryId(created.id);
      setScreen('list');
      setCustomName('');
    } finally {
      setCreating(false);
    }
  }

  function handleSystemBack() {
    if (screen === 'create') {
      setScreen('list');
      return;
    }
    onCancel();
  }

  return (
    <Modal transparent statusBarTranslucent animationType="slide" visible={visible} onRequestClose={handleSystemBack}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.layer}>
        <Pressable accessibilityLabel="取消选择模块" onPress={onCancel} style={styles.backdrop} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.handle} />
          {screen === 'list' ? (
            <>
              <View style={styles.header}>
                <Pressable onPress={onCancel} style={styles.headerAction}><Text style={styles.headerActionText}>取消</Text></Pressable>
                <Text style={styles.headerTitle}>选择模块</Text>
                <Pressable
                  disabled={!temporaryOption || busy}
                  onPress={() => onComplete(temporaryOption)}
                  style={styles.headerAction}>
                  <Text style={[styles.headerActionText, styles.green, (!temporaryOption || busy) && styles.disabledText]}>完成</Text>
                </Pressable>
              </View>
              <View style={styles.searchWrap}>
                <MaterialIcons name="search" size={22} color={SECONDARY} />
                <TextInput
                  accessibilityLabel="搜索模块"
                  autoCorrect={false}
                  onChangeText={setSearchText}
                  placeholder="搜索模块"
                  placeholderTextColor={SECONDARY}
                  style={styles.searchInput}
                  value={searchText}
                />
                {searchText ? (
                  <Pressable accessibilityLabel="清空搜索" hitSlop={8} onPress={() => setSearchText('')}>
                    <MaterialIcons name="cancel" size={19} color={SECONDARY} />
                  </Pressable>
                ) : null}
              </View>
              <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                {!searchText ? (
                  recentOptions.length > 0 ? (
                    <OptionSection title="最近使用" options={recentOptions} selectedId={temporaryId} onSelect={setTemporaryId} />
                  ) : (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>最近使用</Text>
                      <Text style={styles.recentEmpty}>还没有最近使用的模块</Text>
                    </View>
                  )
                ) : null}
                <OptionSection
                  title={searchText ? `搜索结果（${filteredOptions.length}）` : '全部模块'}
                  options={filteredOptions}
                  selectedId={temporaryId}
                  onSelect={setTemporaryId}
                />
                {filteredOptions.length === 0 ? <Text style={styles.emptyText}>没有找到匹配的模块</Text> : null}
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                onPress={() => setScreen('create')}
                style={({ pressed }) => [styles.createEntry, pressed && styles.pressed]}>
                <MaterialIcons name="add-circle-outline" size={25} color={GREEN} />
                <Text style={styles.createEntryText}>新建自定义模块</Text>
                <MaterialIcons name="chevron-right" size={23} color={SECONDARY} />
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.header}>
                <Pressable onPress={() => setScreen('list')} style={styles.headerAction}>
                  <MaterialIcons name="chevron-left" size={28} color={GREEN} />
                  <Text style={[styles.headerActionText, styles.green]}>返回</Text>
                </Pressable>
                <Text style={styles.headerTitle}>新建模块</Text>
                <Pressable disabled={creating || busy} onPress={() => void handleCreate()} style={styles.headerAction}>
                  <Text style={[styles.headerActionText, styles.green, (creating || busy) && styles.disabledText]}>{creating ? '创建中' : '创建'}</Text>
                </Pressable>
              </View>
              <View style={styles.createContent}>
                <Text style={styles.fieldLabel}>模块名称</Text>
                <TextInput
                  autoFocus={false}
                  maxLength={MAX_CUSTOM_MODULE_NAME_LENGTH}
                  onChangeText={(value) => { setCustomName(value); setMessage(null); }}
                  onSubmitEditing={() => void handleCreate()}
                  placeholder="例如：解析几何"
                  placeholderTextColor={SECONDARY}
                  returnKeyType="done"
                  style={styles.nameInput}
                  value={customName}
                />
                <Text style={styles.counter}>{customName.length} / {MAX_CUSTOM_MODULE_NAME_LENGTH}</Text>
                {message ? <Text style={styles.errorText}>{message}</Text> : null}
                <Text style={styles.helpText}>创建后会保存在本机，并自动选中该模块。</Text>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function OptionSection({
  title,
  options,
  selectedId,
  onSelect,
}: {
  title: string;
  options: ModulePickerOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.list}>
        {options.map((option, index) => {
          const selected = option.id === selectedId;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onSelect(option.id)}
              style={({ pressed }) => [
                styles.optionRow,
                index > 0 && styles.optionBorder,
                selected && styles.selectedRow,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.optionLabel}>{option.label}</Text>
              {option.isCustom ? <Text style={styles.customMark}>自定义</Text> : null}
              {selected ? <MaterialIcons name="check" size={24} color={GREEN} /> : <View style={styles.checkSpace} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: 'flex-end' },
  flex: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(28,28,30,0.42)' },
  sheet: { height: '88%', overflow: 'hidden', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: BACKGROUND },
  handle: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 9, backgroundColor: '#C7C7CC' },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  headerTitle: { flex: 1, color: TEXT, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  headerAction: { minWidth: 72, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerActionText: { color: TEXT, fontSize: 16, fontWeight: '600' },
  green: { color: GREEN },
  disabledText: { opacity: 0.35 },
  searchWrap: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 13, borderRadius: 12, backgroundColor: '#E9E9EE' },
  searchInput: { flex: 1, minHeight: 44, color: TEXT, fontSize: 16, paddingVertical: 0 },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  section: { marginTop: 14 },
  sectionTitle: { marginBottom: 8, marginLeft: 4, color: SECONDARY, fontSize: 14, fontWeight: '600' },
  list: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#FFFFFF' },
  optionRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 },
  optionBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  selectedRow: { backgroundColor: colors.accentSoft },
  optionLabel: { flex: 1, color: TEXT, fontSize: 17, fontWeight: '500' },
  customMark: { color: SECONDARY, fontSize: 12 },
  checkSpace: { width: 24 },
  emptyText: { paddingVertical: 36, color: SECONDARY, fontSize: 15, textAlign: 'center' },
  recentEmpty: { padding: 16, borderRadius: 16, color: SECONDARY, fontSize: 14, backgroundColor: '#FFFFFF' },
  createEntry: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER, backgroundColor: '#FFFFFF' },
  createEntryText: { flex: 1, color: TEXT, fontSize: 16, fontWeight: '600' },
  createContent: { padding: 20 },
  fieldLabel: { marginBottom: 9, color: TEXT, fontSize: 16, fontWeight: '600' },
  nameInput: { minHeight: 54, borderRadius: 14, paddingHorizontal: 15, color: TEXT, fontSize: 17, backgroundColor: '#FFFFFF' },
  counter: { marginTop: 7, color: SECONDARY, fontSize: 13, textAlign: 'right' },
  errorText: { marginTop: 8, color: '#FF3B30', fontSize: 14 },
  helpText: { marginTop: 18, color: SECONDARY, fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.55 },
});
