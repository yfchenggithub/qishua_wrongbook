import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { usePreventRemove } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast, PrimaryButton, SupportPage, SurfaceCard } from '@/src/components';
import { useAppToast } from '@/src/hooks/useAppToast';
import { Logger } from '@/src/services/Logger';
import { executeModuleImport } from '@/src/services/moduleTransfer/ModuleImportExecutionService';
import type {
  ExecutedModuleImport,
  ModuleImportExecutionProgressEvent,
} from '@/src/services/moduleTransfer/ModuleImportExecutionTypes';
import { readModuleImportPreview } from '@/src/services/moduleTransfer/ModuleImportPreviewService';
import type {
  ParsedModulePackagePreview,
  ReadModuleImportPreviewResult,
} from '@/src/services/moduleTransfer/ModuleImportPreviewTypes';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'ModuleImportScreen';
const QUESTION_PREVIEW_LIMIT = 5;

type ImportPhase = 'idle' | 'inspecting' | 'preview' | 'importing' | 'success' | 'error';

type SelectedPackageFile = {
  uri: string;
  name: string;
  sizeBytes: number | null;
};

type ImportPageError = {
  title: string;
  message: string;
  details: string[];
};

const INITIAL_PROGRESS: ModuleImportExecutionProgressEvent = {
  stage: 'validating',
  message: '正在重新校验题包…',
  percent: 5,
};

function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return '未知大小';
  }
  if (sizeBytes < 1024) {
    return `${Math.floor(sizeBytes)} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function waitForUiFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

function buildPreviewError(result: Extract<ReadModuleImportPreviewResult, { ok: false }>): ImportPageError {
  return {
    title: '无法预览这个题包',
    message: result.message,
    details: result.validationIssues?.slice(0, 3).map((issue) => issue.message) ?? [],
  };
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function CountItem({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.countItem}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function Notice({
  icon,
  text,
  tone = 'neutral',
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  text: string;
  tone?: 'neutral' | 'warning' | 'success';
}) {
  const iconColor = tone === 'warning'
    ? colors.warning
    : tone === 'success'
      ? colors.accent
      : colors.textSecondary;
  return (
    <View style={[styles.notice, tone === 'warning' ? styles.noticeWarning : null]}>
      <MaterialIcons color={iconColor} name={icon} size={19} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

export default function ModuleImportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const { props: toastProps, showToast } = useAppToast();
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [selectedFile, setSelectedFile] = useState<SelectedPackageFile | null>(null);
  const [parsedPreview, setParsedPreview] = useState<ParsedModulePackagePreview | null>(null);
  const [progress, setProgress] = useState<ModuleImportExecutionProgressEvent>(INITIAL_PROGRESS);
  const [executedImport, setExecutedImport] = useState<ExecutedModuleImport | null>(null);
  const [pageError, setPageError] = useState<ImportPageError | null>(null);
  const isImporting = phase === 'importing';

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  usePreventRemove(isImporting, () => {
    Alert.alert('题包正在导入', '请等待导入完成后再离开当前页面。');
  });

  const resetFlow = useCallback(() => {
    if (busyRef.current) {
      return;
    }
    setPhase('idle');
    setSelectedFile(null);
    setParsedPreview(null);
    setExecutedImport(null);
    setPageError(null);
    setProgress(INITIAL_PROGRESS);
  }, []);

  const choosePackage = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    const previousPhase = phase;
    setPhase('inspecting');
    setPageError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: '*/*',
      });
      if (picked.canceled || !picked.assets?.[0]) {
        if (mountedRef.current) {
          setPhase(previousPhase);
          showToast('已取消选择题包', 'info');
        }
        return;
      }

      const asset = picked.assets[0];
      const file: SelectedPackageFile = {
        uri: asset.uri,
        name: asset.name || 'unknown.qsm',
        sizeBytes: typeof asset.size === 'number' ? asset.size : null,
      };
      const previewResult = await readModuleImportPreview({
        fileUri: file.uri,
        fileName: file.name,
        fileSizeBytes: file.sizeBytes,
      });
      if (!mountedRef.current) {
        return;
      }
      setSelectedFile(file);
      setExecutedImport(null);
      if (!previewResult.ok) {
        setParsedPreview(null);
        setPageError(buildPreviewError(previewResult));
        setPhase('error');
        return;
      }
      setParsedPreview(previewResult.value);
      setPageError(null);
      setPhase('preview');
      Logger.info(PAGE_SCOPE, 'Module package preview is ready.', {
        fileName: file.name,
        packageId: previewResult.value.preview.packageId,
        questionCount: previewResult.value.preview.counts.questions,
        imageCount: previewResult.value.preview.counts.images,
      });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Module package selection or preview failed.', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      if (mountedRef.current) {
        setParsedPreview(null);
        setPageError({
          title: '选择题包失败',
          message: '无法读取所选文件，请确认文件仍可访问后重试。',
          details: [],
        });
        setPhase('error');
      }
    } finally {
      busyRef.current = false;
    }
  }, [phase, showToast]);

  const executeImport = useCallback(async () => {
    if (!selectedFile || !parsedPreview || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setPageError(null);
    setProgress(INITIAL_PROGRESS);
    setPhase('importing');
    try {
      await waitForUiFrame();
      const result = await executeModuleImport({
        fileUri: selectedFile.uri,
        fileName: selectedFile.name,
        fileSizeBytes: selectedFile.sizeBytes,
        onProgress: (event) => {
          if (mountedRef.current) {
            setProgress(event);
          }
        },
      });
      if (!mountedRef.current) {
        return;
      }
      if (result.ok) {
        setExecutedImport(result.value);
        setPhase('success');
        showToast('题包导入完成', 'success', 2600);
        return;
      }
      const errorTitle = result.code === 'already_imported'
        ? '这个题包已经导入'
        : result.code === 'transaction_failed'
          ? '导入失败，数据已回滚'
          : '题包导入失败';
      setPageError({
        title: errorTitle,
        message: result.message,
        details: result.cleanupWarning ? [result.cleanupWarning] : [],
      });
      setPhase('error');
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected module import page failure.', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      if (mountedRef.current) {
        setPageError({
          title: '题包导入失败',
          message: '导入没有完成，请重新选择题包后再试。',
          details: [],
        });
        setPhase('error');
      }
    } finally {
      busyRef.current = false;
    }
  }, [parsedPreview, selectedFile, showToast]);

  const confirmImport = useCallback(() => {
    if (!parsedPreview || !selectedFile || busyRef.current) {
      return;
    }
    const preview = parsedPreview.preview;
    Alert.alert(
      '导入为新模块？',
      `将创建“${preview.module.name}”的新副本并导入 ${preview.counts.questions} 道题。复习次数会从 0 开始，不会修改已有内容。`,
      [
        { text: '再检查一下', style: 'cancel' },
        {
          text: '确认导入',
          onPress: () => {
            void executeImport();
          },
        },
      ],
    );
  }, [executeImport, parsedPreview, selectedFile]);

  const preview = parsedPreview?.preview ?? null;
  const visibleQuestions = preview?.questions.slice(0, QUESTION_PREVIEW_LIMIT) ?? [];
  const visibleWarnings = preview?.warnings.filter(
    (warning) => !(warning.includes('作者') && warning.includes('认证')),
  ) ?? [];

  return (
    <SupportPage
      contentStyle={styles.content}
      fallbackRoute="/(tabs)/settings"
      overlay={<AppToast {...toastProps} bottomOffset={Math.max(insets.bottom + 18, 28)} />}
      title="导入题包">
      {phase === 'idle' ? (
        <>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <MaterialIcons color={colors.accent} name="inventory-2" size={40} />
            </View>
            <Text style={styles.heroTitle}>导入别人分享的优质模块</Text>
            <Text style={styles.heroSubtitle}>只支持七刷模块题包 .qsm，不会覆盖你的现有数据。</Text>
          </View>
          <SurfaceCard style={styles.guideCard}>
            <Notice icon="upload-file" text="从手机文件中选择一个 .qsm 题包" />
            <Notice icon="visibility" text="先查看模块、作者、题目和图片数量" />
            <Notice icon="add-box" text="确认后导入为新的自定义模块" />
            <Notice icon="lock-outline" text="全部过程在本机完成，不会上传题包" />
          </SurfaceCard>
          <PrimaryButton onPress={() => void choosePackage()} title="选择 .qsm 题包" />
        </>
      ) : null}

      {phase === 'inspecting' ? (
        <SurfaceCard style={styles.centerCard}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.stateTitle}>正在检查题包</Text>
          <Text style={styles.stateText}>正在读取文件、校验协议和图片完整性…</Text>
        </SurfaceCard>
      ) : null}

      {phase === 'preview' && preview ? (
        <>
          <View style={styles.previewHeading}>
            <View style={styles.moduleIcon}>
              <MaterialIcons color={preview.module.color} name="inventory-2" size={32} />
            </View>
            <View style={styles.previewHeadingText}>
              <Text numberOfLines={2} style={styles.previewTitle}>{preview.module.name}</Text>
              <Text style={styles.previewSubtitle}>将导入为新的自定义模块</Text>
            </View>
          </View>

          <SurfaceCard padding={0} style={styles.previewCard}>
            <View style={styles.countRow}>
              <CountItem label="题目" value={preview.counts.questions} />
              <View style={styles.countDivider} />
              <CountItem label="图片" value={preview.counts.images} />
              <View style={styles.countDivider} />
              <CountItem label="关联" value={preview.counts.relations} />
            </View>
            <View style={styles.cardDivider} />
            <View style={styles.infoList}>
              <InfoRow label="作者昵称" value={preview.creatorName || '未填写'} />
              <InfoRow label="创建时间" value={formatDateTime(preview.createdAt)} />
              <InfoRow label="文件大小" value={formatFileSize(preview.compressedSizeBytes)} />
              <InfoRow label="文件名称" value={preview.fileName} />
            </View>
            {preview.module.description ? (
              <View style={styles.descriptionBlock}>
                <Text style={styles.descriptionLabel}>模块简介</Text>
                <Text style={styles.descriptionText}>{preview.module.description}</Text>
              </View>
            ) : null}
          </SurfaceCard>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>导入说明</Text>
            <Notice icon="restart-alt" text="所有题目的复习进度从 0 开始，不自动加入今日七刷" />
            <Notice icon="person-outline" text="作者昵称由分享者自行填写，未经平台认证" tone="warning" />
            {visibleWarnings.map((warning, index) => (
              <Notice key={`${index}-${warning}`} icon="warning-amber" text={warning} tone="warning" />
            ))}
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>题目预览</Text>
            <SurfaceCard padding={0} style={styles.questionList}>
              {visibleQuestions.map((question, index) => (
                <View key={question.itemId}>
                  {index > 0 ? <View style={styles.cardDivider} /> : null}
                  <View style={styles.questionRow}>
                    <View style={styles.questionNumber}>
                      <Text style={styles.questionNumberText}>{question.position}</Text>
                    </View>
                    <View style={styles.questionText}>
                      <Text numberOfLines={2} style={styles.questionTitle}>
                        {question.title || `第 ${question.position} 题`}
                      </Text>
                      <Text style={styles.questionMeta}>
                        难度 {question.difficulty} · {question.imageCount} 张图片
                        {question.tags.length > 0 ? ` · ${question.tags.join('、')}` : ''}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </SurfaceCard>
            {preview.questions.length > visibleQuestions.length ? (
              <Text style={styles.moreText}>
                还有 {preview.questions.length - visibleQuestions.length} 道题将在导入后显示
              </Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            <PrimaryButton onPress={confirmImport} title={`导入 ${preview.counts.questions} 道题`} />
            <Pressable
              accessibilityRole="button"
              onPress={() => void choosePackage()}
              style={({ pressed }) => [styles.secondaryButton, pressed ? styles.buttonPressed : null]}>
              <Text style={styles.secondaryButtonText}>重新选择题包</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {phase === 'importing' ? (
        <SurfaceCard style={styles.progressCard}>
          <View style={styles.progressIcon}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
          <Text style={styles.stateTitle}>正在导入题包</Text>
          <Text style={styles.stateText}>{progress.message}</Text>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: progress.percent }}
            style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
          </View>
          <Text style={styles.progressPercent}>{progress.percent}%</Text>
          <Notice icon="hourglass-top" text="导入期间请保持 App 在前台，不要关闭当前页面" />
        </SurfaceCard>
      ) : null}

      {phase === 'success' && executedImport ? (
        <>
          <SurfaceCard style={styles.centerCard}>
            <MaterialIcons color={colors.accent} name="check-circle" size={58} />
            <Text style={styles.stateTitle}>题包导入完成</Text>
            <Text style={styles.successModule}>{executedImport.moduleName}</Text>
            <Text style={styles.stateText}>
              {executedImport.moduleDisplayCode} · {executedImport.mistakeIds.length} 道题 · {executedImport.imageCount} 张图片
            </Text>
          </SurfaceCard>
          {executedImport.cleanupWarning ? (
            <Notice icon="warning-amber" text={executedImport.cleanupWarning} tone="warning" />
          ) : (
            <Notice icon="verified" text="数据库写入完成，题包临时文件已清理" tone="success" />
          )}
          <View style={styles.actions}>
            <PrimaryButton
              onPress={() => router.replace('/(tabs)/library' as never)}
              title="查看错题库"
            />
            <Pressable
              accessibilityRole="button"
              onPress={resetFlow}
              style={({ pressed }) => [styles.secondaryButton, pressed ? styles.buttonPressed : null]}>
              <Text style={styles.secondaryButtonText}>继续导入其他题包</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {phase === 'error' && pageError ? (
        <>
          <SurfaceCard style={styles.centerCard}>
            <MaterialIcons color={colors.danger} name="error-outline" size={56} />
            <Text style={styles.stateTitle}>{pageError.title}</Text>
            <Text style={styles.stateText}>{pageError.message}</Text>
            {pageError.details.map((detail, index) => (
              <View key={`${index}-${detail}`} style={styles.errorDetailRow}>
                <View style={styles.errorDot} />
                <Text style={styles.errorDetailText}>{detail}</Text>
              </View>
            ))}
          </SurfaceCard>
          <View style={styles.actions}>
            <PrimaryButton onPress={() => void choosePackage()} title="重新选择题包" />
            <Pressable
              accessibilityRole="button"
              onPress={resetFlow}
              style={({ pressed }) => [styles.secondaryButton, pressed ? styles.buttonPressed : null]}>
              <Text style={styles.secondaryButtonText}>返回导入说明</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </SupportPage>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.lg,
    gap: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  heroIcon: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  heroTitle: {
    ...typography.sectionMajor,
    textAlign: 'center',
  },
  heroSubtitle: {
    ...typography.body,
    maxWidth: 330,
    textAlign: 'center',
  },
  guideCard: {
    gap: spacing.md,
  },
  notice: {
    minHeight: 28,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  noticeWarning: {
    backgroundColor: colors.warningSoft,
  },
  noticeText: {
    ...typography.bodySmall,
    flex: 1,
    minWidth: 0,
    color: colors.textSecondary,
  },
  centerCard: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stateTitle: {
    ...typography.sectionMajor,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  stateText: {
    ...typography.body,
    maxWidth: 340,
    textAlign: 'center',
  },
  previewHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  moduleIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  previewHeadingText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  previewTitle: {
    ...typography.sectionMajor,
  },
  previewSubtitle: {
    ...typography.body,
  },
  previewCard: {
    overflow: 'hidden',
  },
  countRow: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
  },
  countItem: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  countValue: {
    color: colors.textPrimary,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
  },
  countLabel: {
    ...typography.meta,
  },
  countDivider: {
    width: StyleSheet.hairlineWidth,
    height: 36,
    backgroundColor: colors.separator,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  infoList: {
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  infoLabel: {
    ...typography.meta,
    width: 72,
    color: colors.textSecondary,
  },
  infoValue: {
    ...typography.bodySmall,
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  descriptionBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    padding: layout.cardPadding,
    gap: spacing.sm,
  },
  descriptionLabel: {
    ...typography.meta,
    fontWeight: '600',
  },
  descriptionText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  sectionBlock: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.sectionGroup,
    paddingHorizontal: spacing.xs,
  },
  questionList: {
    overflow: 'hidden',
  },
  questionRow: {
    minHeight: 76,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  questionNumber: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  questionNumberText: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  questionText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  questionTitle: {
    ...typography.cardTitle,
    fontSize: 16,
    lineHeight: 22,
  },
  questionMeta: {
    ...typography.meta,
  },
  moreText: {
    ...typography.meta,
    paddingTop: spacing.xs,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  secondaryButton: {
    minHeight: layout.minimumTouchSize,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.55,
  },
  progressCard: {
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  progressIcon: {
    height: 52,
    justifyContent: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  progressPercent: {
    ...typography.meta,
    color: colors.accent,
    fontWeight: '700',
  },
  successModule: {
    ...typography.cardTitle,
    color: colors.accent,
    textAlign: 'center',
  },
  errorDetailRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  errorDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 8,
    backgroundColor: colors.danger,
  },
  errorDetailText: {
    ...typography.meta,
    flex: 1,
    minWidth: 0,
  },
});
