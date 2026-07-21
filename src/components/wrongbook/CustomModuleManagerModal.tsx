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

import type { CustomModule } from '@/src/models/CustomModule';
import {
  CUSTOM_MODULE_TEMPLATES,
  MAX_CUSTOM_MODULE_COUNT,
  type MoveCustomModuleDirection,
} from '@/src/services/CustomModuleService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

type ModuleManagerTab = 'mine' | 'templates';

export interface CustomModuleManagerModalLabels {
  title: string;
  closeAccessibilityLabel: string;
  saveAccessibilityLabel: string;
  mineTabLabel: string;
  templatesTabLabel: string;
  addPlaceholder: string;
  editPlaceholder: string;
  emptyText: string;
  itemCountUnit: string;
  addedText: string;
  addText: string;
  selectAccessibilityLabel: (name: string) => string;
  moveUpAccessibilityLabel: string;
  moveDownAccessibilityLabel: string;
  editAccessibilityLabel: string;
  deleteAccessibilityLabel: string;
}

export interface CustomModuleManagerModalProps {
  visible: boolean;
  customModules: CustomModule[];
  selectedModule: string | null;
  busy?: boolean;
  message?: string | null;
  labels?: Partial<CustomModuleManagerModalLabels>;
  templates?: readonly string[];
  maxItemCount?: number;
  onClose: () => void;
  onSelectModule: (moduleName: string) => void;
  onCreateModule: (moduleName: string) => Promise<boolean>;
  onUpdateModule: (moduleId: string, moduleName: string) => Promise<boolean>;
  onDeleteModule: (module: CustomModule) => void;
  onMoveModule: (moduleId: string, direction: MoveCustomModuleDirection) => void;
  onUseTemplate: (moduleName: string) => Promise<boolean>;
}

function normalizeModuleName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

const DEFAULT_LABELS: CustomModuleManagerModalLabels = {
  title: '自定义模块',
  closeAccessibilityLabel: '关闭自定义模块',
  saveAccessibilityLabel: '保存模块',
  mineTabLabel: '我的模块',
  templatesTabLabel: '推荐模板',
  addPlaceholder: '添加新模块',
  editPlaceholder: '编辑模块名称',
  emptyText: '还没有自定义模块',
  itemCountUnit: '个',
  addedText: '已添加',
  addText: '添加',
  selectAccessibilityLabel: (name) => `选择${name}`,
  moveUpAccessibilityLabel: '上移模块',
  moveDownAccessibilityLabel: '下移模块',
  editAccessibilityLabel: '编辑模块',
  deleteAccessibilityLabel: '删除模块',
};

export function CustomModuleManagerModal({
  visible,
  customModules,
  selectedModule,
  busy = false,
  message,
  labels,
  templates = CUSTOM_MODULE_TEMPLATES,
  maxItemCount = MAX_CUSTOM_MODULE_COUNT,
  onClose,
  onSelectModule,
  onCreateModule,
  onUpdateModule,
  onDeleteModule,
  onMoveModule,
  onUseTemplate,
}: CustomModuleManagerModalProps) {
  const [activeTab, setActiveTab] = useState<ModuleManagerTab>('mine');
  const [draftName, setDraftName] = useState('');
  const [editingModule, setEditingModule] = useState<CustomModule | null>(null);
  const normalizedCustomModuleNames = useMemo(
    () => customModules.map((item) => normalizeModuleName(item.name)),
    [customModules],
  );
  const isEditing = editingModule !== null;
  const normalizedDraftName = normalizeModuleName(draftName);
  const displayLabels = {
    ...DEFAULT_LABELS,
    ...labels,
  };

  useEffect(() => {
    if (!visible) {
      setActiveTab('mine');
      setDraftName('');
      setEditingModule(null);
    }
  }, [visible]);

  function resetEditor() {
    setDraftName('');
    setEditingModule(null);
  }

  async function commitDraftName() {
    if (busy || normalizedDraftName.length === 0) {
      return;
    }

    const ok = editingModule
      ? await onUpdateModule(editingModule.id, normalizedDraftName)
      : await onCreateModule(normalizedDraftName);

    if (ok) {
      resetEditor();
    }
  }

  function startEditing(moduleItem: CustomModule) {
    setActiveTab('mine');
    setEditingModule(moduleItem);
    setDraftName(moduleItem.name);
  }

  function handleSelectModule(moduleName: string) {
    onSelectModule(moduleName);
    onClose();
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.layer}>
        <Pressable
          accessibilityLabel={displayLabels.closeAccessibilityLabel}
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />

        <View style={styles.panel}>
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.iconButton, pressed ? styles.iconButtonPressed : null]}>
              <MaterialIcons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.title}>
              {displayLabels.title}
            </Text>
            <Pressable
              accessibilityLabel={displayLabels.saveAccessibilityLabel}
              accessibilityRole="button"
              disabled={busy || normalizedDraftName.length === 0}
              onPress={() => {
                void commitDraftName();
              }}
              style={({ pressed }) => [
                styles.saveButton,
                (busy || normalizedDraftName.length === 0) ? styles.disabledButton : null,
                pressed && !busy ? styles.saveButtonPressed : null,
              ]}>
              <Text maxFontSizeMultiplier={1.1} style={styles.saveButtonText}>
                保存
              </Text>
            </Pressable>
          </View>

          <View style={styles.tabRow}>
            <Pressable
              accessibilityRole="tab"
              onPress={() => setActiveTab('mine')}
              style={[styles.tabButton, activeTab === 'mine' ? styles.tabButtonActive : null]}>
              <Text style={[styles.tabText, activeTab === 'mine' ? styles.tabTextActive : null]}>
                {displayLabels.mineTabLabel}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              onPress={() => setActiveTab('templates')}
              style={[styles.tabButton, activeTab === 'templates' ? styles.tabButtonActive : null]}>
              <Text style={[styles.tabText, activeTab === 'templates' ? styles.tabTextActive : null]}>
                {displayLabels.templatesTabLabel}
              </Text>
            </Pressable>
          </View>

          {activeTab === 'mine' ? (
            <>
              <View style={styles.inputPanel}>
                <MaterialIcons name={isEditing ? 'edit' : 'add'} size={20} color={colors.success} />
                <TextInput
                  value={draftName}
                  editable={!busy}
                  onChangeText={setDraftName}
                  placeholder={isEditing ? displayLabels.editPlaceholder : displayLabels.addPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    void commitDraftName();
                  }}
                  style={styles.input}
                  maxFontSizeMultiplier={1.1}
                />
                {isEditing ? (
                  <Pressable
                    accessibilityLabel="取消编辑"
                    accessibilityRole="button"
                    onPress={resetEditor}
                    disabled={busy}
                    style={({ pressed }) => [styles.smallIconButton, pressed ? styles.iconButtonPressed : null]}>
                    <MaterialIcons name="close" size={18} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
              </View>

              {message ? (
                <Text maxFontSizeMultiplier={1.1} style={styles.messageText}>
                  {message}
                </Text>
              ) : null}

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.moduleListContent}>
                {customModules.length === 0 ? (
                  <View style={styles.emptyPanel}>
                    <MaterialIcons name="category" size={28} color={colors.textMuted} />
                    <Text maxFontSizeMultiplier={1.1} style={styles.emptyText}>
                      {displayLabels.emptyText}
                    </Text>
                  </View>
                ) : (
                  customModules.map((moduleItem, index) => {
                    const selected = selectedModule === moduleItem.name;
                    return (
                      <Pressable
                        key={moduleItem.id}
                        accessibilityLabel={displayLabels.selectAccessibilityLabel(moduleItem.name)}
                        accessibilityRole="button"
                        onPress={() => handleSelectModule(moduleItem.name)}
                        style={({ pressed }) => [
                          styles.moduleRow,
                          selected ? styles.moduleRowSelected : null,
                          pressed ? styles.moduleRowPressed : null,
                        ]}>
                        <View style={styles.rowGrip}>
                          <MaterialIcons name="drag-indicator" size={22} color={colors.textMuted} />
                        </View>
                        <View style={[styles.moduleIcon, { backgroundColor: colors.accent }]}>
                          <MaterialIcons name={moduleItem.icon as never} size={18} color={colors.white} />
                        </View>
                        <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.moduleName}>
                          {moduleItem.name}
                        </Text>
                        <View style={styles.rowActions}>
                          <Pressable
                            accessibilityLabel={displayLabels.moveUpAccessibilityLabel}
                            accessibilityRole="button"
                            disabled={busy || index === 0}
                            onPress={() => onMoveModule(moduleItem.id, 'up')}
                            style={({ pressed }) => [
                              styles.smallIconButton,
                              (busy || index === 0) ? styles.disabledButton : null,
                              pressed ? styles.iconButtonPressed : null,
                            ]}>
                            <MaterialIcons name="keyboard-arrow-up" size={20} color={colors.textSecondary} />
                          </Pressable>
                          <Pressable
                            accessibilityLabel={displayLabels.moveDownAccessibilityLabel}
                            accessibilityRole="button"
                            disabled={busy || index === customModules.length - 1}
                            onPress={() => onMoveModule(moduleItem.id, 'down')}
                            style={({ pressed }) => [
                              styles.smallIconButton,
                              (busy || index === customModules.length - 1) ? styles.disabledButton : null,
                              pressed ? styles.iconButtonPressed : null,
                            ]}>
                            <MaterialIcons name="keyboard-arrow-down" size={20} color={colors.textSecondary} />
                          </Pressable>
                          <Pressable
                            accessibilityLabel={displayLabels.editAccessibilityLabel}
                            accessibilityRole="button"
                            disabled={busy}
                            onPress={() => startEditing(moduleItem)}
                            style={({ pressed }) => [
                              styles.smallIconButton,
                              busy ? styles.disabledButton : null,
                              pressed ? styles.iconButtonPressed : null,
                            ]}>
                            <MaterialIcons name="edit" size={19} color={colors.textSecondary} />
                          </Pressable>
                          <Pressable
                            accessibilityLabel={displayLabels.deleteAccessibilityLabel}
                            accessibilityRole="button"
                            disabled={busy}
                            onPress={() => onDeleteModule(moduleItem)}
                            style={({ pressed }) => [
                              styles.smallIconButton,
                              busy ? styles.disabledButton : null,
                              pressed ? styles.iconButtonPressed : null,
                            ]}>
                            <MaterialIcons name="delete-outline" size={20} color={colors.textMuted} />
                          </Pressable>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>

              <Text maxFontSizeMultiplier={1.1} style={styles.limitText}>
                已创建 {customModules.length} / {maxItemCount} {displayLabels.itemCountUnit}
              </Text>
            </>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.templateListContent}>
              {templates.map((templateName) => {
                const exists = normalizedCustomModuleNames.includes(normalizeModuleName(templateName));
                return (
                  <Pressable
                    key={templateName}
                    accessibilityRole="button"
                    disabled={busy || exists}
                    onPress={() => {
                      void onUseTemplate(templateName);
                    }}
                    style={({ pressed }) => [
                      styles.templateRow,
                      exists ? styles.templateRowAdded : null,
                      pressed && !exists ? styles.moduleRowPressed : null,
                    ]}>
                    <View style={styles.templateIcon}>
                      <MaterialIcons name={exists ? 'check' : 'add'} size={18} color={colors.success} />
                    </View>
                    <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.moduleName}>
                      {templateName}
                    </Text>
                    <Text maxFontSizeMultiplier={1.1} style={styles.templateActionText}>
                      {exists ? displayLabels.addedText : displayLabels.addText}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '86%',
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    shadowColor: colors.black,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
    gap: spacing.md,
  },
  header: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  title: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '800',
    textAlign: 'center',
  },
  saveButton: {
    minWidth: 40,
    minHeight: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  saveButtonPressed: {
    backgroundColor: colors.successBg,
  },
  saveButtonText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '800',
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: colors.success,
  },
  tabText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.success,
  },
  inputPanel: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    ...typography.body,
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  smallIconButton: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageText: {
    ...typography.caption,
    color: colors.danger,
  },
  moduleListContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  moduleRow: {
    minHeight: 58,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  moduleRowSelected: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
  },
  moduleRowPressed: {
    opacity: 0.86,
  },
  rowGrip: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleName: {
    ...typography.bodySmall,
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyPanel: {
    minHeight: 96,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  emptyText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  limitText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  templateListContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  templateRow: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  templateRowAdded: {
    backgroundColor: colors.surfaceMuted,
  },
  templateIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateActionText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.45,
  },
});
