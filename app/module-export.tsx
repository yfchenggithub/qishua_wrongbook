import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { usePreventRemove } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppToast,
  LibraryBottomSheet,
  PrimaryButton,
  SupportPage,
  SurfaceCard,
} from '@/src/components';
import { useAppToast } from '@/src/hooks/useAppToast';
import { Logger } from '@/src/services/Logger';
import {
  listModuleExportCandidates,
  prepareModuleExportPayload,
} from '@/src/services/moduleTransfer/ModuleExportService';
import { createModulePackageArchive } from '@/src/services/moduleTransfer/ModulePackageArchiveService';
import type { ModulePackageArchiveResult } from '@/src/services/moduleTransfer/ModulePackageArchiveTypes';
import { shareModulePackage } from '@/src/services/moduleTransfer/ModulePackageShareService';
import type {
  ModuleExportCandidate,
  PreparedModuleExport,
} from '@/src/services/moduleTransfer/ModuleTransferTypes';
import { colors, layout, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'ModuleExportScreen';
const CREATOR_NAME_MAX_LENGTH = 32;
const DESCRIPTION_MAX_LENGTH = 500;
const QUESTION_PREVIEW_LIMIT = 5;

type ExportPhase = 'form' | 'preparing' | 'preview' | 'building' | 'ready' | 'error';

type ExportProgress = {
  message: string;
  percent: number;
  detail: string | null;
};

type ExportPageError = {
  title: string;
  message: string;
  details: string[];
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

function waitForUiFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
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

function CountItem({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.countItem}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

export default function ModuleExportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const shareBusyRef = useRef(false);
  const { props: toastProps, showToast } = useAppToast();
  const [phase, setPhase] = useState<ExportPhase>('form');
  const [candidates, setCandidates] = useState<ModuleExportCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [moduleSheetVisible, setModuleSheetVisible] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);
  const [creatorName, setCreatorName] = useState('');
  const [description, setDescription] = useState('');
  const [preparedExport, setPreparedExport] = useState<PreparedModuleExport | null>(null);
  const [shareConsent, setShareConsent] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>({
    message: '正在准备模块数据…',
    percent: 8,
    detail: null,
  });
  const [archive, setArchive] = useState<ModulePackageArchiveResult | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareWarning, setShareWarning] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [pageError, setPageError] = useState<ExportPageError | null>(null);
  const isBuilding = phase === 'building';

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  usePreventRemove(isBuilding, () => {
    Alert.alert('题包正在生成', '请等待题包生成完成后再离开当前页面。');
  });

  const loadCandidates = useCallback(async () => {
    setCandidatesLoading(true);
    setCandidatesError(null);
    const result = await listModuleExportCandidates();
    if (!mountedRef.current) {
      return;
    }
    if (!result.ok) {
      setCandidates([]);
      setCandidatesError(result.message);
      setCandidatesLoading(false);
      return;
    }
    setCandidates(result.value);
    setSelectedModuleId((current) => (
      current !== null && result.value.some((item) => item.moduleId === current)
        ? current
        : null
    ));
    setCandidatesLoading(false);
  }, []);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.moduleId === selectedModuleId) ?? null,
    [candidates, selectedModuleId],
  );

  const resetExport = useCallback(() => {
    if (busyRef.current || shareBusyRef.current) {
      return;
    }
    setPhase('form');
    setPreparedExport(null);
    setShareConsent(false);
    setArchive(null);
    setShareMessage(null);
    setShareWarning(null);
    setPageError(null);
    setProgress({ message: '正在准备模块数据…', percent: 8, detail: null });
    void loadCandidates();
  }, [loadCandidates]);

  const selectModule = useCallback((candidate: ModuleExportCandidate) => {
    if (candidate.questionCount <= 0) {
      return;
    }
    setSelectedModuleId(candidate.moduleId);
    setPreparedExport(null);
    setArchive(null);
    setShareConsent(false);
    setModuleSheetVisible(false);
  }, []);

  const preparePreview = useCallback(async () => {
    if (!selectedCandidate || selectedCandidate.questionCount <= 0 || busyRef.current) {
      showToast('请先选择一个包含错题的模块', 'warning');
      return;
    }
    busyRef.current = true;
    setPageError(null);
    setPhase('preparing');
    try {
      await waitForUiFrame();
      const result = await prepareModuleExportPayload({
        moduleId: selectedCandidate.moduleId,
        creatorName,
        description,
      });
      if (!mountedRef.current) {
        return;
      }
      if (!result.ok) {
        setPageError({
          title: '无法生成导出预览',
          message: result.message,
          details: result.validationIssues?.slice(0, 3).map((issue) => issue.message) ?? [],
        });
        setPhase('error');
        return;
      }
      setPreparedExport(result.value);
      setShareConsent(false);
      setPhase('preview');
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected module export preview failure.', {
        moduleId: selectedCandidate.moduleId,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      if (mountedRef.current) {
        setPageError({
          title: '无法生成导出预览',
          message: '读取模块数据失败，请稍后重试。',
          details: [],
        });
        setPhase('error');
      }
    } finally {
      busyRef.current = false;
    }
  }, [creatorName, description, selectedCandidate, showToast]);

  const shareArchive = useCallback(async (archiveValue: ModulePackageArchiveResult) => {
    if (shareBusyRef.current) {
      return;
    }
    shareBusyRef.current = true;
    setIsSharing(true);
    setShareWarning(null);
    try {
      const result = await shareModulePackage({
        fileUri: archiveValue.fileUri,
        fileName: archiveValue.fileName,
      });
      if (!mountedRef.current) {
        return;
      }
      if (result.ok) {
        setShareMessage('系统分享面板已打开，你可以发送或保存这个题包。');
        showToast('已打开系统分享', 'success', 2400);
        return;
      }
      if (result.code === 'cancelled') {
        setShareMessage(null);
        setShareWarning(result.message);
        return;
      }
      setShareMessage(null);
      setShareWarning(result.message);
    } finally {
      shareBusyRef.current = false;
      if (mountedRef.current) {
        setIsSharing(false);
      }
    }
  }, [showToast]);

  const buildAndShare = useCallback(async () => {
    if (!preparedExport || !shareConsent || busyRef.current) {
      if (!shareConsent) {
        showToast('请先确认内容与分享权利', 'warning');
      }
      return;
    }
    busyRef.current = true;
    setArchive(null);
    setShareMessage(null);
    setShareWarning(null);
    setPageError(null);
    setProgress({ message: '正在创建题包…', percent: 12, detail: null });
    setPhase('building');
    try {
      await waitForUiFrame();
      const totalImages = preparedExport.assets.length;
      const result = await createModulePackageArchive({
        prepared: preparedExport,
        onAssetPacked: (event) => {
          if (!mountedRef.current) {
            return;
          }
          const imageProgress = event.total > 0 ? event.current / event.total : 1;
          setProgress({
            message: '正在处理题包图片…',
            percent: Math.min(88, 18 + Math.round(imageProgress * 70)),
            detail: `${event.current} / ${event.total} 张`,
          });
        },
      });
      if (!mountedRef.current) {
        return;
      }
      if (!result.ok) {
        setPageError({
          title: '题包生成失败',
          message: result.message,
          details: result.validationIssues?.slice(0, 3).map((issue) => issue.message) ?? [],
        });
        setPhase('error');
        return;
      }
      setProgress({
        message: '正在打开系统分享…',
        percent: 96,
        detail: totalImages > 0 ? `${totalImages} 张图片已处理` : null,
      });
      setArchive(result.value);
      const shareResult = await shareModulePackage({
        fileUri: result.value.fileUri,
        fileName: result.value.fileName,
      });
      if (!mountedRef.current) {
        return;
      }
      if (shareResult.ok) {
        setShareMessage('系统分享面板已打开，你可以发送或保存这个题包。');
        setShareWarning(null);
        showToast('题包已生成', 'success', 2600);
      } else {
        setShareMessage(null);
        setShareWarning(shareResult.message);
      }
      setProgress({ message: '题包已生成', percent: 100, detail: null });
      setPhase('ready');
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'Unexpected module package build failure.', {
        moduleId: preparedExport.sourceModuleId,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      if (mountedRef.current) {
        setPageError({
          title: '题包生成失败',
          message: '题包没有生成完成，请确认存储空间后重试。',
          details: [],
        });
        setPhase('error');
      }
    } finally {
      busyRef.current = false;
    }
  }, [preparedExport, shareConsent, showToast]);

  const confirmBuildAndShare = useCallback(() => {
    if (!preparedExport || !shareConsent || busyRef.current) {
      if (!shareConsent) {
        showToast('请先确认内容与分享权利', 'warning');
      }
      return;
    }
    const manifest = preparedExport.payload.manifest;
    Alert.alert(
      '生成并分享题包？',
      `将把“${manifest.module.name}”中的 ${manifest.counts.questions} 道题和 ${manifest.counts.images} 张图片写入一个 .qsm 文件。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '生成并分享',
          onPress: () => {
            void buildAndShare();
          },
        },
      ],
    );
  }, [buildAndShare, preparedExport, shareConsent, showToast]);

  const manifest = preparedExport?.payload.manifest ?? null;
  const previewQuestions = preparedExport?.payload.data.questions.slice(0, QUESTION_PREVIEW_LIMIT) ?? [];

  return (
    <SupportPage
      contentStyle={styles.content}
      fallbackRoute="/(tabs)/settings"
      keyboardAware
      overlay={<AppToast {...toastProps} bottomOffset={Math.max(insets.bottom + 18, 28)} />}
      title="导出题包">
      {phase === 'form' ? (
        <>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <MaterialIcons color={colors.accent} name="ios-share" size={40} />
            </View>
            <Text style={styles.heroTitle}>把一个模块分享给其他人</Text>
            <Text style={styles.heroSubtitle}>题包不会包含七刷进度、复做照片、语音或其他模块内容。</Text>
          </View>

          <View style={styles.formSection}>
            <Text style={styles.fieldLabel}>选择模块</Text>
            <Pressable
              accessibilityLabel="选择要导出的模块"
              accessibilityRole="button"
              disabled={candidatesLoading}
              onPress={() => setModuleSheetVisible(true)}
              style={({ pressed }) => [
                styles.moduleSelector,
                pressed ? styles.buttonPressed : null,
              ]}>
              {candidatesLoading ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <View style={styles.moduleSelectorIcon}>
                  <MaterialIcons
                    color={selectedCandidate?.color ?? colors.textTertiary}
                    name="inventory-2"
                    size={25}
                  />
                </View>
              )}
              <View style={styles.moduleSelectorText}>
                <Text numberOfLines={1} style={styles.moduleSelectorTitle}>
                  {selectedCandidate?.name ?? (candidatesLoading ? '正在读取模块…' : '请选择模块')}
                </Text>
                <Text style={styles.moduleSelectorSubtitle}>
                  {selectedCandidate
                    ? `${selectedCandidate.displayCode} · ${selectedCandidate.questionCount} 道错题`
                    : '系统模块和自定义模块都可以导出'}
                </Text>
              </View>
              <MaterialIcons color={colors.textTertiary} name="expand-more" size={24} />
            </Pressable>
            {candidatesError ? (
              <View style={styles.inlineError}>
                <Text style={styles.inlineErrorText}>{candidatesError}</Text>
                <Pressable accessibilityRole="button" onPress={() => void loadCandidates()}>
                  <Text style={styles.retryText}>重试</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.formSection}>
            <View style={styles.fieldHeading}>
              <Text style={styles.fieldLabel}>作者昵称</Text>
              <Text style={styles.fieldCounter}>{creatorName.length}/{CREATOR_NAME_MAX_LENGTH}</Text>
            </View>
            <TextInput
              accessibilityLabel="题包作者昵称"
              maxLength={CREATOR_NAME_MAX_LENGTH}
              onChangeText={setCreatorName}
              placeholder="选填，例如：小七"
              placeholderTextColor={colors.textTertiary}
              style={styles.textInput}
              value={creatorName}
            />
            <Text style={styles.fieldHint}>昵称只用于题包展示，不代表平台认证身份。</Text>
          </View>

          <View style={styles.formSection}>
            <View style={styles.fieldHeading}>
              <Text style={styles.fieldLabel}>模块简介</Text>
              <Text style={styles.fieldCounter}>{description.length}/{DESCRIPTION_MAX_LENGTH}</Text>
            </View>
            <TextInput
              accessibilityLabel="题包模块简介"
              maxLength={DESCRIPTION_MAX_LENGTH}
              multiline
              onChangeText={setDescription}
              placeholder="选填，介绍适用年级、专题或使用方式"
              placeholderTextColor={colors.textTertiary}
              style={[styles.textInput, styles.descriptionInput]}
              textAlignVertical="top"
              value={description}
            />
          </View>

          <Notice icon="privacy-tip" text="导出前请检查图片、备注和答案中是否包含姓名、学校、二维码等个人信息" tone="warning" />
          <PrimaryButton
            disabled={!selectedCandidate || selectedCandidate.questionCount <= 0 || candidatesLoading}
            onPress={() => void preparePreview()}
            title="生成导出预览"
          />
        </>
      ) : null}

      {phase === 'preparing' ? (
        <SurfaceCard style={styles.centerCard}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.stateTitle}>正在生成导出预览</Text>
          <Text style={styles.stateText}>正在整理题目、答案、标签、图片和模块内部关联…</Text>
        </SurfaceCard>
      ) : null}

      {phase === 'preview' && manifest && preparedExport ? (
        <>
          <View style={styles.previewHeading}>
            <View style={styles.previewModuleIcon}>
              <MaterialIcons color={manifest.module.color} name="inventory-2" size={32} />
            </View>
            <View style={styles.previewHeadingText}>
              <Text numberOfLines={2} style={styles.previewTitle}>{manifest.module.name}</Text>
              <Text style={styles.previewSubtitle}>导出预览 · 尚未生成文件</Text>
            </View>
          </View>

          <SurfaceCard padding={0} style={styles.previewCard}>
            <View style={styles.countRow}>
              <CountItem label="题目" value={manifest.counts.questions} />
              <View style={styles.countDivider} />
              <CountItem label="图片" value={manifest.counts.images} />
              <View style={styles.countDivider} />
              <CountItem label="关联" value={manifest.counts.relations} />
            </View>
            <View style={styles.cardDivider} />
            <View style={styles.metaBlock}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>作者昵称</Text>
                <Text style={styles.metaValue}>{manifest.creator.displayName || '未填写'}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>模块简介</Text>
                <Text style={styles.metaValue}>{manifest.module.description || '未填写'}</Text>
              </View>
            </View>
          </SurfaceCard>

          <View style={styles.formSection}>
            <Text style={styles.fieldLabel}>题目预览</Text>
            <SurfaceCard padding={0} style={styles.questionList}>
              {previewQuestions.map((question, index) => (
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
                        难度 {question.difficulty} · {question.images.length} 张图片
                        {question.tags.length > 0 ? ` · ${question.tags.join('、')}` : ''}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </SurfaceCard>
            {manifest.counts.questions > previewQuestions.length ? (
              <Text style={styles.moreText}>
                还有 {manifest.counts.questions - previewQuestions.length} 道题将写入题包
              </Text>
            ) : null}
          </View>

          <View style={styles.formSection}>
            <Text style={styles.fieldLabel}>导出说明</Text>
            <Notice icon="remove-circle-outline" text="不会导出七刷记录、掌握状态、复做照片、语音和浏览状态" />
            <Notice icon="image" text="题目图、做法图、答案图和文字内容会随题包分享" />
            {preparedExport.warnings.map((warning) => (
              <Notice key={warning.code} icon="warning-amber" text={warning.message} tone="warning" />
            ))}
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: shareConsent }}
            onPress={() => setShareConsent((current) => !current)}
            style={({ pressed }) => [styles.consentRow, pressed ? styles.buttonPressed : null]}>
            <MaterialIcons
              color={shareConsent ? colors.accent : colors.textTertiary}
              name={shareConsent ? 'check-box' : 'check-box-outline-blank'}
              size={25}
            />
            <Text style={styles.consentText}>我已检查内容，并确认有权分享这个题包</Text>
          </Pressable>

          <View style={styles.actions}>
            <PrimaryButton
              disabled={!shareConsent}
              onPress={confirmBuildAndShare}
              title="生成 .qsm 并分享"
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setPhase('form')}
              style={({ pressed }) => [styles.secondaryButton, pressed ? styles.buttonPressed : null]}>
              <Text style={styles.secondaryButtonText}>返回修改</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {phase === 'building' ? (
        <SurfaceCard style={styles.progressCard}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.stateTitle}>正在生成题包</Text>
          <Text style={styles.stateText}>{progress.message}</Text>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: progress.percent }}
            style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
          </View>
          <Text style={styles.progressPercent}>{progress.percent}%</Text>
          {progress.detail ? <Text style={styles.progressDetail}>{progress.detail}</Text> : null}
          <Notice icon="hourglass-top" text="生成期间请保持 App 在前台，不要关闭当前页面" />
        </SurfaceCard>
      ) : null}

      {phase === 'ready' && archive && manifest ? (
        <>
          <SurfaceCard style={styles.centerCard}>
            <MaterialIcons color={colors.accent} name="check-circle" size={58} />
            <Text style={styles.stateTitle}>题包已生成</Text>
            <Text style={styles.readyFileName}>{archive.fileName}</Text>
            <Text style={styles.stateText}>
              {formatFileSize(archive.sizeBytes)} · {manifest.counts.questions} 道题 · {manifest.counts.images} 张图片
            </Text>
            <Text style={styles.archiveMeta}>
              原样复制 {archive.copiedImageCount} 张 · 转换为 JPEG {archive.convertedImageCount} 张
            </Text>
          </SurfaceCard>
          {shareMessage ? <Notice icon="ios-share" text={shareMessage} tone="success" /> : null}
          {shareWarning ? <Notice icon="warning-amber" text={shareWarning} tone="warning" /> : null}
          <View style={styles.actions}>
            <PrimaryButton
              disabled={isSharing}
              onPress={() => void shareArchive(archive)}
              title={isSharing ? '正在打开系统分享…' : '再次打开系统分享'}
            />
            <Pressable
              accessibilityRole="button"
              onPress={resetExport}
              style={({ pressed }) => [styles.secondaryButton, pressed ? styles.buttonPressed : null]}>
              <Text style={styles.secondaryButtonText}>导出其他模块</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/(tabs)/settings' as never)}
              style={({ pressed }) => [styles.secondaryButton, pressed ? styles.buttonPressed : null]}>
              <Text style={styles.secondaryMutedText}>返回设置</Text>
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
          <PrimaryButton onPress={resetExport} title="返回导出设置" />
        </>
      ) : null}

      <LibraryBottomSheet
        onClose={() => setModuleSheetVisible(false)}
        title="选择导出模块"
        visible={moduleSheetVisible}>
        <FlatList
          contentContainerStyle={styles.moduleListContent}
          data={candidates}
          keyExtractor={(candidate) => String(candidate.moduleId)}
          ListEmptyComponent={(
            <View style={styles.emptyModules}>
              <Text style={styles.stateText}>
                {candidatesLoading ? '正在读取模块…' : '没有可导出的模块'}
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            const selected = item.moduleId === selectedModuleId;
            const disabled = item.questionCount <= 0;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                onPress={() => selectModule(item)}
                style={({ pressed }) => [
                  styles.moduleOption,
                  pressed && !disabled ? styles.moduleOptionPressed : null,
                  disabled ? styles.moduleOptionDisabled : null,
                ]}>
                <View style={[styles.moduleOptionIcon, { backgroundColor: `${item.color}18` }]}>
                  <MaterialIcons color={item.color} name="inventory-2" size={24} />
                </View>
                <View style={styles.moduleOptionText}>
                  <Text numberOfLines={1} style={styles.moduleOptionTitle}>{item.name}</Text>
                  <Text style={styles.moduleOptionMeta}>
                    {item.displayCode} · {item.type === 'system' ? '系统模块' : '自定义模块'} · {item.questionCount > 0 ? `${item.questionCount} 道题` : '暂无错题'}
                  </Text>
                </View>
                {selected ? <MaterialIcons color={colors.accent} name="check" size={22} /> : null}
              </Pressable>
            );
          }}
        />
      </LibraryBottomSheet>
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
    maxWidth: 340,
    textAlign: 'center',
  },
  formSection: {
    gap: spacing.sm,
  },
  fieldHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  fieldLabel: {
    ...typography.sectionGroup,
    paddingHorizontal: spacing.xs,
  },
  fieldCounter: {
    ...typography.meta,
  },
  fieldHint: {
    ...typography.meta,
    paddingHorizontal: spacing.xs,
  },
  moduleSelector: {
    minHeight: 76,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  moduleSelectorIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  moduleSelectorText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  moduleSelectorTitle: {
    ...typography.cardTitle,
    fontSize: 17,
    lineHeight: 23,
  },
  moduleSelectorSubtitle: {
    ...typography.meta,
  },
  textInput: {
    minHeight: 52,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  descriptionInput: {
    minHeight: 120,
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  inlineErrorText: {
    ...typography.meta,
    flex: 1,
    color: colors.danger,
  },
  retryText: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
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
  buttonPressed: {
    opacity: 0.55,
  },
  centerCard: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stateTitle: {
    ...typography.sectionMajor,
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
  previewModuleIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
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
  metaBlock: {
    padding: layout.cardPadding,
    gap: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  metaLabel: {
    ...typography.meta,
    width: 72,
  },
  metaValue: {
    ...typography.bodySmall,
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    textAlign: 'right',
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
  consentRow: {
    minHeight: 64,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  consentText: {
    ...typography.bodySmall,
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
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
  secondaryMutedText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  progressCard: {
    minHeight: 330,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
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
  progressDetail: {
    ...typography.meta,
  },
  readyFileName: {
    ...typography.cardTitle,
    maxWidth: '100%',
    color: colors.accent,
    textAlign: 'center',
  },
  archiveMeta: {
    ...typography.meta,
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
  moduleListContent: {
    paddingBottom: spacing.sm,
  },
  moduleOption: {
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  moduleOptionPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  moduleOptionDisabled: {
    opacity: 0.42,
  },
  moduleOptionIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleOptionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  moduleOptionTitle: {
    ...typography.cardTitle,
    fontSize: 16,
    lineHeight: 22,
  },
  moduleOptionMeta: {
    ...typography.meta,
  },
  emptyModules: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
});
