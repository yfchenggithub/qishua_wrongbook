import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SurfaceCard } from '@/src/components/ui/CardContainer';
import {
  reviewSessionColors as palette,
  reviewSessionLayout as layout,
} from '@/src/styles/reviewSessionTokens';

export type ExplanationTab = 'solution' | 'voice' | 'text';
export type ReviewQuickTarget = 'question' | ExplanationTab;

export type ReviewModuleFilterOption = {
  key: string;
  value: string | null;
  label: string;
  count: number;
  remainingCount: number;
};

export type ReviewResultAction = {
  label: string;
  value: string;
  tone: 'known' | 'fuzzy' | 'unknown';
};

export function ReviewHeader({
  onExit,
  onOpenFilter,
}: {
  onExit: () => void;
  onOpenFilter: () => void;
}) {
  return (
    <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="退出今日复做"
          hitSlop={8}
          onPress={onExit}
          style={({ pressed }) => [styles.headerSideButton, pressed && styles.pressed]}>
          <Text style={styles.exitText}>退出</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerTitle}>今日复做</Text>
        <View style={styles.headerSideButton}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开快速导航和模块筛选"
            onPress={onOpenFilter}
            style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}>
            <MaterialIcons name="tune" size={23} color={palette.textPrimary} />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

export function ReviewProgress({
  current,
  total,
  round,
  module,
}: {
  current: number;
  total: number;
  round: number;
  module: string;
}) {
  const progress = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
  return (
    <View style={styles.progressSection}>
      <View style={styles.progressTopRow}>
        <View style={styles.progressNumberRow}>
          <Text style={styles.progressCurrent}>{current}</Text>
          <Text style={styles.progressRest}>{` / ${total}`}</Text>
        </View>
        <View style={styles.roundPill}>
          <Text style={styles.roundPillText}>{`第 ${round} 刷`}</Text>
        </View>
      </View>
      <Text numberOfLines={2} style={styles.progressModule}>
        {`${module || '未分类'} · 当前题`}
      </Text>
      <View accessibilityRole="progressbar" style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

const TAB_ITEMS: { id: ExplanationTab; label: string }[] = [
  { id: 'solution', label: '我的做法' },
  { id: 'voice', label: '语音讲解' },
  { id: 'text', label: '文字讲解' },
];

export function ExplanationTabs({
  activeTab,
  onChange,
  children,
}: {
  activeTab: ExplanationTab;
  onChange: (tab: ExplanationTab) => void;
  children: ReactNode;
}) {
  return (
    <SurfaceCard padding={0} style={styles.explanationCard}>
      <View accessibilityRole="tablist" style={styles.tabRow}>
        {TAB_ITEMS.map((item) => {
          const selected = activeTab === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onChange(item.id)}
              style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}>
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                {item.label}
              </Text>
              <View style={[styles.tabIndicator, selected && styles.tabIndicatorSelected]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.explanationContent}>{children}</View>
    </SurfaceCard>
  );
}

function ResultButton({
  action,
  disabled,
  busy,
  onPress,
}: {
  action: ReviewResultAction;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.resultButton,
        action.tone === 'known'
          ? styles.resultKnown
          : action.tone === 'fuzzy'
            ? styles.resultFuzzy
            : styles.resultUnknown,
        pressed && !disabled && styles.resultPressed,
        disabled && styles.disabled,
      ]}>
      {busy ? (
        <ActivityIndicator
          size="small"
          color={action.tone === 'known' ? palette.surface : palette.textSecondary}
        />
      ) : (
        <Text
          numberOfLines={1}
          style={[
            styles.resultText,
            action.tone === 'known'
              ? styles.resultKnownText
              : action.tone === 'fuzzy'
                ? styles.resultFuzzyText
                : styles.resultUnknownText,
          ]}>
          {action.label}
        </Text>
      )}
    </Pressable>
  );
}

export function ReviewResultBar({
  bottomInset,
  actions,
  disabled,
  busy,
  onSelect,
  onHeightChange,
}: {
  bottomInset: number;
  actions: ReviewResultAction[];
  disabled: boolean;
  busy: boolean;
  onSelect: (value: string) => void;
  onHeightChange?: (height: number) => void;
}) {
  return (
    <View pointerEvents="box-none" style={styles.resultOverlay}>
      <View
        onLayout={(event: LayoutChangeEvent) => {
          onHeightChange?.(Math.ceil(event.nativeEvent.layout.height));
        }}
        style={[styles.resultBar, { paddingBottom: Math.max(bottomInset, 8) }]}>
        <Text style={styles.resultHint}>选择结果后自动进入下一题</Text>
        <View style={styles.resultRow}>
          {actions.map((action) => (
            <ResultButton
              key={action.value}
              action={action}
              disabled={disabled}
              busy={busy}
              onPress={() => onSelect(action.value)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const QUICK_ITEMS: {
  target: ReviewQuickTarget | 'list';
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}[] = [
  { target: 'list', label: '今日题单', icon: 'format-list-bulleted' },
  { target: 'question', label: '当前题目', icon: 'image' },
  { target: 'solution', label: '我的做法', icon: 'photo-camera' },
  { target: 'voice', label: '语音讲解', icon: 'mic-none' },
  { target: 'text', label: '文字讲解', icon: 'edit-note' },
];

function formatRemaining(option: ReviewModuleFilterOption): string {
  return option.remainingCount > 0
    ? `剩余 ${option.remainingCount} / ${option.count}`
    : `已完成 · 共 ${option.count} 道`;
}

export function ReviewFilterSheet({
  visible,
  options,
  selectedValue,
  onClose,
  onSelectModule,
  onNavigate,
  onOpenQuestionList,
}: {
  visible: boolean;
  options: ReviewModuleFilterOption[];
  selectedValue: string | null;
  onClose: () => void;
  onSelectModule: (value: string | null) => void;
  onNavigate: (target: ReviewQuickTarget) => void;
  onOpenQuestionList: () => void;
}) {
  const insets = useSafeAreaInsets();
  const selectedLabel = useMemo(
    () => options.find((option) => option.value === selectedValue)?.label ?? '全部',
    [options, selectedValue],
  );

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable accessibilityLabel="关闭筛选面板" onPress={onClose} style={styles.sheetBackdrop} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderText}>
              <Text style={styles.sheetTitle}>导航与筛选</Text>
              <Text numberOfLines={1} style={styles.sheetSubtitle}>{`当前：${selectedLabel}`}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              onPress={onClose}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}>
              <MaterialIcons name="close" size={22} color={palette.textPrimary} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetSectionTitle}>快速导航</Text>
            <View style={styles.quickGrid}>
              {QUICK_ITEMS.map((item) => (
                <Pressable
                  key={item.target}
                  accessibilityRole="button"
                  onPress={() => {
                    if (item.target === 'list') {
                      onOpenQuestionList();
                      return;
                    }
                    onNavigate(item.target);
                  }}
                  style={({ pressed }) => [styles.quickButton, pressed && styles.quickButtonPressed]}>
                  <MaterialIcons name={item.icon} size={19} color={palette.green} />
                  <Text numberOfLines={1} style={styles.quickButtonText}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.sheetDivider} />
            <Text style={styles.sheetSectionTitle}>模块筛选</Text>
            <View style={styles.moduleList}>
              {options.map((option) => {
                const selected = selectedValue === option.value;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => onSelectModule(option.value)}
                    style={({ pressed }) => [
                      styles.moduleRow,
                      selected && styles.moduleRowSelected,
                      pressed && styles.pressed,
                    ]}>
                    <View style={styles.moduleTextWrap}>
                      <Text numberOfLines={2} style={[styles.moduleName, selected && styles.moduleNameSelected]}>
                        {option.label}
                      </Text>
                      <Text style={styles.moduleCount}>{formatRemaining(option)}</Text>
                    </View>
                    <MaterialIcons
                      name={selected ? 'check-circle' : 'radio-button-unchecked'}
                      size={22}
                      color={selected ? palette.green : palette.textMuted}
                    />
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  headerSafeArea: {
    backgroundColor: palette.background,
  },
  header: {
    height: 56,
    paddingHorizontal: layout.horizontalPadding,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSideButton: {
    width: 64,
    minHeight: layout.minimumTouchSize,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  exitText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  filterButton: {
    width: layout.minimumTouchSize,
    height: layout.minimumTouchSize,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.separator,
  },
  pressed: {
    opacity: 0.65,
  },
  progressSection: {
    paddingTop: 10,
    paddingBottom: 18,
    gap: 10,
  },
  progressTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  progressNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  progressCurrent: {
    fontSize: 43,
    lineHeight: 50,
    fontWeight: '800',
    color: palette.green,
    fontVariant: ['tabular-nums'],
  },
  progressRest: {
    fontSize: 29,
    lineHeight: 38,
    fontWeight: '800',
    color: palette.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  roundPill: {
    minHeight: 38,
    paddingHorizontal: 15,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.greenSoft,
    borderWidth: 1,
    borderColor: palette.greenBorder,
  },
  roundPillText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: palette.green,
  },
  progressModule: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '500',
    color: palette.textSecondary,
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: palette.separator,
  },
  progressFill: {
    height: '100%',
    minWidth: 5,
    borderRadius: 3,
    backgroundColor: palette.green,
  },
  explanationCard: {
    overflow: 'hidden',
  },
  tabRow: {
    height: 52,
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.separator,
    paddingHorizontal: 10,
  },
  tabButton: {
    flex: 1,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tabText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: palette.textMuted,
  },
  tabTextSelected: {
    color: palette.green,
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    left: '22%',
    right: '22%',
    bottom: -1,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  tabIndicatorSelected: {
    backgroundColor: palette.green,
  },
  explanationContent: {
    padding: 20,
  },
  resultOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  resultBar: {
    paddingTop: 11,
    paddingHorizontal: layout.horizontalPadding,
    backgroundColor: palette.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.separator,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -3 },
    elevation: 4,
    gap: 9,
  },
  resultHint: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    color: palette.textSecondary,
  },
  resultRow: {
    flexDirection: 'row',
    gap: 12,
  },
  resultButton: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  resultUnknown: {
    backgroundColor: palette.redSoft,
    borderColor: '#FFD2D4',
  },
  resultFuzzy: {
    backgroundColor: palette.orangeSoft,
    borderColor: '#FFE0A7',
  },
  resultKnown: {
    backgroundColor: palette.green,
    borderColor: palette.green,
  },
  resultPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.48,
  },
  resultText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  resultUnknownText: {
    color: palette.red,
  },
  resultFuzzyText: {
    color: palette.orange,
  },
  resultKnownText: {
    color: palette.surface,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.backdrop,
  },
  sheet: {
    maxHeight: '84%',
    paddingHorizontal: layout.horizontalPadding,
    paddingTop: 8,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: palette.surface,
  },
  sheetHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 6,
    backgroundColor: '#D1D1D6',
  },
  sheetHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  sheetSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: palette.textSecondary,
  },
  sheetClose: {
    width: layout.minimumTouchSize,
    height: layout.minimumTouchSize,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.background,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    paddingTop: 12,
    paddingBottom: 10,
  },
  sheetSectionTitle: {
    marginBottom: 10,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: palette.textSecondary,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickButton: {
    width: '48%',
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: layout.controlRadius,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.background,
  },
  quickButtonPressed: {
    backgroundColor: palette.greenSoft,
  },
  quickButtonText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 18,
    backgroundColor: palette.separator,
  },
  moduleList: {
    gap: 8,
  },
  moduleRow: {
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: layout.controlRadius,
    borderWidth: 1,
    borderColor: palette.separator,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  moduleRowSelected: {
    borderColor: palette.greenBorder,
    backgroundColor: palette.greenSoft,
  },
  moduleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  moduleName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  moduleNameSelected: {
    color: palette.green,
  },
  moduleCount: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: palette.textSecondary,
  },
});
