import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { CardContainer, PrimaryButton, ScreenContainer } from '@/src/components';
import type { ReviewResult } from '@/src/models/Mistake';
import type { ReviewSheetFillData } from '@/src/services/ReviewSheetService';
import * as ReviewSheetService from '@/src/services/ReviewSheetService';
import { colors, radius, shadows, spacing, typography } from '@/src/styles/tokens';

type PageState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: ReviewSheetFillData }
  | { kind: 'not_found'; message: string }
  | { kind: 'submitted'; message: string }
  | { kind: 'error'; message: string };

type ResultOption = {
  label: string;
  value: ReviewResult;
};

const RESULT_OPTIONS: ResultOption[] = [
  { label: '不会', value: 'wrong' },
  { label: '模糊', value: 'unsure' },
  { label: '会了', value: 'mastered' },
];

function normalizeSheetId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim().length > 0);
    return first ? first.trim() : '';
  }
  return typeof value === 'string' ? value.trim() : '';
}

function ResultOptionButton({
  option,
  selected,
  onPress,
}: {
  option: ResultOption;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.resultOption,
        selected ? styles.resultOptionSelected : null,
        pressed ? styles.resultOptionPressed : null,
      ]}>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.1}
        style={[styles.resultOptionText, selected ? styles.resultOptionTextSelected : null]}>
        {option.label}
      </Text>
    </Pressable>
  );
}

export default function ReviewSheetFillScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sheetId?: string | string[] }>();
  const sheetId = useMemo(() => normalizeSheetId(params.sheetId), [params.sheetId]);
  const [pageState, setPageState] = useState<PageState>({ kind: 'loading' });
  const [selectedResults, setSelectedResults] = useState<Record<string, ReviewResult | undefined>>({});
  const [isSaving, setIsSaving] = useState(false);

  const loadData = useCallback(async () => {
    setPageState({ kind: 'loading' });
    const result = await ReviewSheetService.getReviewSheetFillData(sheetId);
    if (result.ok) {
      setSelectedResults({});
      setPageState({ kind: 'ready', data: result.data });
      return;
    }

    if (result.alreadySubmitted) {
      setPageState({ kind: 'submitted', message: result.errorMessage });
      return;
    }
    if (result.notFound) {
      setPageState({ kind: 'not_found', message: result.errorMessage });
      return;
    }
    setPageState({ kind: 'error', message: result.errorMessage });
  }, [sheetId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const readyData = pageState.kind === 'ready' ? pageState.data : null;
  const selectedCount = readyData
    ? readyData.items.filter((item) => selectedResults[item.mistakeId]).length
    : 0;

  const handleSelectResult = useCallback((mistakeId: string, result: ReviewResult) => {
    setSelectedResults((prev) => ({
      ...prev,
      [mistakeId]: result,
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!readyData || isSaving) {
      return;
    }

    if (selectedCount < readyData.items.length) {
      Alert.alert('保存结果', '还有题目未选择结果');
      return;
    }

    setIsSaving(true);
    try {
      const submitResult = await ReviewSheetService.submitReviewSheetResults(sheetId, selectedResults);
      if (!submitResult.ok) {
        Alert.alert('保存结果', submitResult.errorMessage);
        if (submitResult.alreadySubmitted) {
          setPageState({ kind: 'submitted', message: submitResult.errorMessage });
        }
        return;
      }

      Alert.alert('保存结果', '复做结果已保存', [
        {
          text: '完成',
          onPress: () => router.replace('/(tabs)' as never),
        },
      ]);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, readyData, router, selectedCount, selectedResults, sheetId]);

  if (pageState.kind === 'loading') {
    return (
      <ScreenContainer>
        <View style={styles.centerState}>
          <ActivityIndicator size="small" color={colors.success} />
          <Text style={styles.stateText}>正在读取练习卷...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (pageState.kind !== 'ready') {
    const iconName = pageState.kind === 'submitted' ? 'task-alt' : 'error-outline';
    return (
      <ScreenContainer>
        <View style={styles.centerState}>
          <View style={styles.stateIcon}>
            <MaterialIcons name={iconName} size={30} color={colors.success} />
          </View>
          <Text style={styles.stateTitle}>{pageState.message}</Text>
          <PrimaryButton title="返回" onPress={() => router.back()} style={styles.stateButton} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenContainer scroll safeAreaEdges={['top']} contentStyle={styles.content}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerTextWrap}>
            <Text style={styles.pageTitle}>复做结果回填</Text>
            <Text style={styles.pageSubtitle}>
              已选择 {selectedCount} / {pageState.data.items.length}
            </Text>
          </View>
        </View>

        <View style={styles.itemList}>
          {pageState.data.items.map((item, index) => (
            <CardContainer key={item.mistakeId} padding={spacing.md} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemIndex}>{index + 1}.</Text>
                <View style={styles.itemTitleWrap}>
                  <Text numberOfLines={2} maxFontSizeMultiplier={1.1} style={styles.itemTitle}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.itemMeta}>
                    {item.module} · 第 {item.nextReviewIndex} / 7 刷
                  </Text>
                </View>
              </View>
              <View style={styles.resultRow}>
                {RESULT_OPTIONS.map((option) => (
                  <ResultOptionButton
                    key={option.value}
                    option={option}
                    selected={selectedResults[item.mistakeId] === option.value}
                    onPress={() => handleSelectResult(item.mistakeId, option.value)}
                  />
                ))}
              </View>
            </CardContainer>
          ))}
        </View>

        <View style={styles.bottomSpacer} />
      </ScreenContainer>

      <View style={styles.bottomBar}>
        <PrimaryButton
          title={isSaving ? '保存中...' : '保存结果'}
          disabled={isSaving}
          onPress={() => void handleSave()}
          style={styles.saveButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  pageSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  itemList: {
    gap: spacing.md,
  },
  itemCard: {
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  itemHeader: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  itemIndex: {
    ...typography.body,
    color: colors.success,
    fontWeight: '800',
    width: 28,
  },
  itemTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  itemTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  itemMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  resultRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  resultOption: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  resultOptionSelected: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
  },
  resultOptionPressed: {
    opacity: 0.86,
  },
  resultOptionText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '800',
  },
  resultOptionTextSelected: {
    color: colors.success,
  },
  bottomBar: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    ...shadows.floating,
  },
  saveButton: {
    width: '100%',
  },
  bottomSpacer: {
    height: 84,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stateIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  stateButton: {
    minWidth: 160,
  },
});
