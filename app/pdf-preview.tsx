import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { HeaderBackButton } from '@react-navigation/elements';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Pdf from 'react-native-pdf';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logger } from '@/src/services/Logger';
import { prepareCachedTodayReviewPdfZip } from '@/src/services/TodayReviewPdfBundleService';
import * as TodayReviewPdfExportService from '@/src/services/TodayReviewPdfExportService';
import { colors, layout, radius, shadows, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'PdfPreviewScreen';

type ShareSetStatus = 'idle' | 'success' | 'error';
type ShareBundleStatus = 'preparing' | 'ready' | 'error';

function normalizeParamText(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim().length > 0);
    return first ? first.trim() : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePdfUri(value: string | string[] | undefined): string | null {
  return normalizeParamText(value);
}

function normalizePdfUriList(
  value: string | string[] | undefined,
  fallbackUri: string | null,
): string[] {
  const fallbackList = fallbackUri ? [fallbackUri] : [];
  const rawValue = normalizeParamText(value);
  if (!rawValue) {
    return fallbackList;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      const normalizedList = parsed
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
      return normalizedList.length > 0 ? normalizedList : fallbackList;
    }
  } catch {
    // Keep compatibility with older routes that only pass pdfUri.
  }

  return fallbackList;
}

function normalizePdfPageCounts(
  value: string | string[] | undefined,
  pdfPartCount: number,
): number[] {
  const emptyCounts = Array.from({ length: pdfPartCount }, () => 0);
  const rawValue = normalizeParamText(value);
  if (!rawValue) {
    return emptyCounts;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed) || parsed.length !== pdfPartCount) {
      return emptyCounts;
    }
    return parsed.map((item) => (
      typeof item === 'number' && Number.isFinite(item)
        ? Math.max(0, Math.floor(item))
        : 0
    ));
  } catch {
    return emptyCounts;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

function toChineseAlertMessage(
  message: string | null | undefined,
  fallbackMessage: string,
): string {
  const normalized = typeof message === 'string' ? message.trim() : '';
  if (!normalized) {
    return fallbackMessage;
  }
  return /[\u4e00-\u9fff]/.test(normalized) ? normalized : fallbackMessage;
}

function toSafeUriPreview(uri: string | null | undefined): string | null {
  if (!uri) {
    return null;
  }
  const normalized = uri.trim();
  if (normalized.length <= 72) {
    return normalized;
  }
  return `${normalized.slice(0, 28)}...${normalized.slice(-24)}`;
}

function readPdfFileInfo(uri: string): { exists: boolean; sizeBytes: number | null } {
  try {
    const info = new File(uri).info();
    if (!info.exists) {
      return { exists: false, sizeBytes: null };
    }
    return {
      exists: true,
      sizeBytes: typeof info.size === 'number' && Number.isFinite(info.size)
        ? Math.max(0, Math.floor(info.size))
        : null,
    };
  } catch {
    return { exists: false, sizeBytes: null };
  }
}

function formatSetSummary(pdfPartCount: number, totalPageCount: number | null): string {
  const pageText = totalPageCount === null ? '页数加载中' : `${totalPageCount} 页`;
  return `共 ${pdfPartCount} 份 · ${pageText}`;
}

export default function PdfPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    pdfUri?: string | string[];
    pdfUris?: string | string[];
    pdfPageCounts?: string | string[];
  }>();
  const primaryPdfUri = useMemo(() => normalizePdfUri(params.pdfUri), [params.pdfUri]);
  const pdfUris = useMemo(
    () => normalizePdfUriList(params.pdfUris, primaryPdfUri),
    [params.pdfUris, primaryPdfUri],
  );
  const pdfPartCount = pdfUris.length;
  const routePageCounts = useMemo(
    () => normalizePdfPageCounts(params.pdfPageCounts, pdfPartCount),
    [params.pdfPageCounts, pdfPartCount],
  );

  const [selectedPdfIndex, setSelectedPdfIndex] = useState(0);
  const [pageCounts, setPageCounts] = useState<number[]>(routePageCounts);
  const [previewKey, setPreviewKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isSharingWholeSet, setIsSharingWholeSet] = useState(false);
  const [isSharingCurrentPdf, setIsSharingCurrentPdf] = useState(false);
  const [shareSetStatus, setShareSetStatus] = useState<ShareSetStatus>('idle');
  const [shareBundleStatus, setShareBundleStatus] = useState<ShareBundleStatus>(
    pdfUris.length > 1 ? 'preparing' : 'ready',
  );
  const [isPrinting, setIsPrinting] = useState(false);
  const [isOpeningExternally, setIsOpeningExternally] = useState(false);
  const [isMoreMenuVisible, setIsMoreMenuVisible] = useState(false);
  const shareBundleRequestIdRef = useRef(0);

  const pdfUri = pdfUris[selectedPdfIndex] ?? primaryPdfUri;
  const currentPdfPageCount = pageCounts[selectedPdfIndex] > 0
    ? pageCounts[selectedPdfIndex]
    : null;
  const totalPageCount = pageCounts.length === pdfPartCount
    && pageCounts.length > 0
    && pageCounts.every((count) => count > 0)
    ? pageCounts.reduce((sum, count) => sum + count, 0)
    : null;
  const setSummary = formatSetSummary(pdfPartCount, totalPageCount);
  const source = useMemo(
    () => (pdfUri ? { uri: pdfUri, cache: false as const } : null),
    [pdfUri],
  );
  const isBusy = isSharingWholeSet || isSharingCurrentPdf || isPrinting || isOpeningExternally;

  useEffect(() => {
    setPageCounts((previous) => Array.from(
      { length: pdfPartCount },
      (_, index) => routePageCounts[index] || previous[index] || 0,
    ));
  }, [pdfPartCount, routePageCounts]);

  const prepareShareBundle = useCallback(async () => {
    const requestId = shareBundleRequestIdRef.current + 1;
    shareBundleRequestIdRef.current = requestId;
    setShareSetStatus('idle');

    if (pdfUris.length <= 0) {
      setShareBundleStatus('error');
      return;
    }
    if (pdfUris.length === 1) {
      setShareBundleStatus('ready');
      return;
    }

    const startedAt = Date.now();
    setShareBundleStatus('preparing');
    Logger.info(PAGE_SCOPE, 'pdf_preview_share_zip_prepare_start', {
      pdfPartCount: pdfUris.length,
    });
    try {
      const zipUri = await prepareCachedTodayReviewPdfZip(pdfUris);
      if (shareBundleRequestIdRef.current !== requestId) {
        return;
      }
      setShareBundleStatus('ready');
      Logger.info(PAGE_SCOPE, 'pdf_preview_share_zip_prepare_success', {
        pdfPartCount: pdfUris.length,
        durationMs: Math.max(0, Date.now() - startedAt),
        zipUriPreview: toSafeUriPreview(zipUri),
      });
    } catch (error) {
      if (shareBundleRequestIdRef.current !== requestId) {
        return;
      }
      setShareBundleStatus('error');
      Logger.error(PAGE_SCOPE, 'pdf_preview_share_zip_prepare_failed', {
        pdfPartCount: pdfUris.length,
        durationMs: Math.max(0, Date.now() - startedAt),
        error,
      });
    }
  }, [pdfUris]);

  useEffect(() => {
    void prepareShareBundle();
    return () => {
      shareBundleRequestIdRef.current += 1;
    };
  }, [prepareShareBundle]);

  useEffect(() => {
    if (shareSetStatus !== 'success') {
      return undefined;
    }
    const timer = setTimeout(() => setShareSetStatus('idle'), 1800);
    return () => clearTimeout(timer);
  }, [shareSetStatus]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    Logger.info(PAGE_SCOPE, 'pdf_preview_back_fallback_to_home');
    router.replace('/(tabs)' as never);
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (isMoreMenuVisible) {
          setIsMoreMenuVisible(false);
          return true;
        }
        handleBack();
        return true;
      });

      return () => subscription.remove();
    }, [handleBack, isMoreMenuVisible]),
  );

  useEffect(() => {
    if (selectedPdfIndex >= pdfUris.length && pdfUris.length > 0) {
      setSelectedPdfIndex(0);
    }
  }, [pdfUris.length, selectedPdfIndex]);

  useEffect(() => {
    if (!pdfUri) {
      setLoadError('未找到可预览的 PDF 文件。');
      setIsLoading(false);
      return;
    }

    const fileInfo = readPdfFileInfo(pdfUri);
    setLoadError(null);
    setIsLoading(true);
    setCurrentPage(1);
    Logger.info(PAGE_SCOPE, 'pdf_preview_load_start', {
      pdfUriPreview: toSafeUriPreview(pdfUri),
      attempt: previewKey + 1,
      pdfPartNumber: selectedPdfIndex + 1,
      pdfPartCount,
      sourceCache: false,
      fileExists: fileInfo.exists,
      fileSizeBytes: fileInfo.sizeBytes,
    });
  }, [pdfPartCount, pdfUri, previewKey, selectedPdfIndex]);

  const handleRetry = useCallback(() => {
    setLoadError(null);
    setIsLoading(true);
    setCurrentPage(1);
    setPreviewKey((previous) => previous + 1);
  }, []);

  const handlePreviousPdf = useCallback(() => {
    setSelectedPdfIndex((previous) => Math.max(0, previous - 1));
  }, []);

  const handleNextPdf = useCallback(() => {
    setSelectedPdfIndex((previous) => Math.min(Math.max(0, pdfPartCount - 1), previous + 1));
  }, [pdfPartCount]);

  const handleOpenWithOtherApp = useCallback(async () => {
    if (!pdfUri || isBusy) {
      return;
    }

    setIsOpeningExternally(true);
    try {
      const result = await TodayReviewPdfExportService.openTodayReviewPdfWithOtherApp(pdfUri);
      if (!result.success) {
        Alert.alert('无法打开 PDF', '无法打开 PDF，请尝试重新生成练习卷。');
      }
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'pdf_preview_open_with_other_app_failed', { pdfUri, error });
      Alert.alert('无法打开 PDF', '无法打开 PDF，请尝试重新生成练习卷。');
    } finally {
      setIsOpeningExternally(false);
    }
  }, [isBusy, pdfUri]);

  const handleShareCurrentPdf = useCallback(async () => {
    setIsMoreMenuVisible(false);
    if (!pdfUri || isBusy) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'pdf_preview_share_current_click', {
      pdfUri,
      pdfPartNumber: selectedPdfIndex + 1,
      pdfPartCount,
    });
    setIsSharingCurrentPdf(true);
    try {
      const result = await TodayReviewPdfExportService.shareTodayReviewPdf(pdfUri);
      if (result.success || result.reason === 'cancelled') {
        return;
      }

      Logger.warn(PAGE_SCOPE, 'pdf_preview_share_current_failed', {
        pdfPartNumber: selectedPdfIndex + 1,
        pdfPartCount,
        reason: result.reason,
        message: result.message,
      });
      Alert.alert(
        '分享本份失败',
        toChineseAlertMessage(result.message, '本份 PDF 分享失败，请稍后重试。'),
      );
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'pdf_preview_share_current_failed', { pdfUri, error });
      Alert.alert('分享本份失败', '本份 PDF 分享失败，请稍后重试。');
    } finally {
      setIsSharingCurrentPdf(false);
    }
  }, [isBusy, pdfPartCount, pdfUri, selectedPdfIndex]);

  const handleShareWholeSet = useCallback(async () => {
    if (shareBundleStatus === 'error') {
      await prepareShareBundle();
      return;
    }
    if (pdfUris.length <= 0 || isBusy || shareBundleStatus !== 'ready') {
      return;
    }

    Logger.info(PAGE_SCOPE, 'pdf_preview_share_set_click', {
      pdfPartCount: pdfUris.length,
      totalPageCount,
    });
    setShareSetStatus('idle');
    setIsSharingWholeSet(true);
    try {
      const result = await TodayReviewPdfExportService.shareTodayReviewPdfSet(pdfUris);
      if (result.success) {
        setShareSetStatus('success');
        Logger.info(PAGE_SCOPE, 'pdf_preview_share_set_success', {
          pdfPartCount: pdfUris.length,
          totalPageCount,
          shareMode: result.mode,
        });
        return;
      }
      if (result.reason === 'cancelled') {
        return;
      }

      setShareSetStatus('error');
      Logger.warn(PAGE_SCOPE, 'pdf_preview_share_set_failed', {
        pdfPartCount: pdfUris.length,
        totalPageCount,
        reason: result.reason,
        message: result.message,
      });
      Alert.alert(
        '分享整套失败',
        toChineseAlertMessage(result.message, '整套练习卷分享失败，请点击按钮重试。'),
      );
    } catch (error) {
      setShareSetStatus('error');
      Logger.error(PAGE_SCOPE, 'pdf_preview_share_set_failed', { error });
      Alert.alert('分享整套失败', '整套练习卷分享失败，请点击按钮重试。');
    } finally {
      setIsSharingWholeSet(false);
    }
  }, [isBusy, pdfUris, prepareShareBundle, shareBundleStatus, totalPageCount]);

  const handlePrintPdf = useCallback(async () => {
    if (!pdfUri || isBusy) {
      return;
    }

    setIsPrinting(true);
    try {
      await Print.printAsync({ uri: pdfUri });
      Logger.info(PAGE_SCOPE, 'pdf_preview_print_success', {
        pdfPartNumber: selectedPdfIndex + 1,
        pdfPartCount,
      });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'pdf_preview_print_failed', { pdfUri, error });
      Alert.alert('打印失败', '无法打开打印面板，请稍后重试。');
    } finally {
      setIsPrinting(false);
    }
  }, [isBusy, pdfPartCount, pdfUri, selectedPdfIndex]);

  const isShareBundlePreparing = shareBundleStatus === 'preparing';
  const isShareSetButtonDisabled = isBusy || pdfUris.length <= 0 || isShareBundlePreparing;
  const shareButtonTitle = isShareBundlePreparing
    ? '正在准备分享文件…'
    : shareBundleStatus === 'error'
      ? '准备失败，点击重试'
      : isSharingWholeSet
        ? '正在打开分享面板…'
        : shareSetStatus === 'error'
          ? '重新分享整套 PDF'
          : shareSetStatus === 'success'
            ? '分享面板已打开'
            : '分享整套 PDF';

  return (
    <>
      <Stack.Screen
        options={{
          title: '今日练习卷',
          headerTitleAlign: 'center',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.pageBackground },
          headerTitleStyle: styles.headerTitle,
          headerLeft: ({ tintColor }) => (
            <HeaderBackButton
              accessibilityLabel="返回"
              displayMode="minimal"
              onPress={handleBack}
              tintColor={tintColor ?? colors.textPrimary}
            />
          ),
          headerRight: () => (
            <Pressable
              accessibilityLabel="更多操作"
              accessibilityRole="button"
              disabled={isBusy}
              hitSlop={4}
              onPress={() => setIsMoreMenuVisible(true)}
              style={({ pressed }) => [
                styles.moreButton,
                pressed && !isBusy ? styles.controlPressed : null,
                isBusy ? styles.controlDisabled : null,
              ]}>
              <MaterialIcons color={colors.textPrimary} name="more-horiz" size={25} />
            </Pressable>
          ),
        }}
      />

      <SafeAreaView edges={['bottom']} style={styles.pageRoot}>
        <View style={styles.summaryCard}>
          <View style={styles.summaryCopy}>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={styles.summaryTitle}>
              今日练习卷
            </Text>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.summaryMeta}>
              {setSummary}
            </Text>
          </View>
          <View style={styles.partBadge}>
            <Text maxFontSizeMultiplier={1.1} style={styles.partBadgeText}>
              第 {Math.min(selectedPdfIndex + 1, Math.max(1, pdfPartCount))} 份
            </Text>
          </View>
        </View>

        <View style={styles.viewerShell}>
          <View style={styles.paperShadow}>
            {source ? (
              <Pdf
                key={`pdf-preview-${selectedPdfIndex}-${previewKey}`}
                source={source}
                style={styles.pdf}
                enablePaging={false}
                trustAllCerts={false}
                onLoadComplete={(numberOfPages) => {
                  const safePageCount = Math.max(1, Math.floor(numberOfPages));
                  setPageCounts((previous) => previous.map((count, index) => (
                    index === selectedPdfIndex ? safePageCount : count
                  )));
                  setIsLoading(false);
                  setLoadError(null);
                  const fileInfo = pdfUri
                    ? readPdfFileInfo(pdfUri)
                    : { exists: false, sizeBytes: null };
                  Logger.info(PAGE_SCOPE, 'pdf_preview_load_success', {
                    pageCount: safePageCount,
                    pdfUriPreview: toSafeUriPreview(pdfUri),
                    pdfPartNumber: selectedPdfIndex + 1,
                    pdfPartCount,
                    fileExists: fileInfo.exists,
                    fileSizeBytes: fileInfo.sizeBytes,
                  });
                }}
                onPageChanged={(page) => {
                  setCurrentPage(page);
                }}
                onError={(error) => {
                  setLoadError('PDF 预览失败，请重新加载。');
                  setIsLoading(false);
                  Logger.warn(PAGE_SCOPE, 'pdf_preview_load_failed', {
                    error: toErrorMessage(error),
                    pdfUriPreview: toSafeUriPreview(pdfUri),
                    pdfPartNumber: selectedPdfIndex + 1,
                    pdfPartCount,
                  });
                }}
              />
            ) : (
              <View style={styles.emptyViewer}>
                <Text style={styles.errorTitle}>无法预览 PDF</Text>
                <Text style={styles.errorText}>未找到可预览的 PDF 文件。</Text>
              </View>
            )}

            {isLoading && !loadError ? (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="small" color={colors.action} />
                <Text style={styles.loadingText}>正在加载 PDF…</Text>
              </View>
            ) : null}

            {loadError ? (
              <View style={styles.errorOverlay}>
                <Text style={styles.errorTitle}>PDF 预览失败</Text>
                <Text style={styles.errorText}>{loadError}</Text>
                <View style={styles.errorActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleRetry}
                    style={({ pressed }) => [styles.errorButton, pressed ? styles.controlPressed : null]}>
                    <Text style={styles.errorButtonText}>重新加载</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isBusy}
                    onPress={() => void handleOpenWithOtherApp()}
                    style={({ pressed }) => [
                      styles.errorButton,
                      pressed && !isBusy ? styles.controlPressed : null,
                      isBusy ? styles.controlDisabled : null,
                    ]}>
                    <Text style={styles.errorButtonText}>其他应用打开</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {currentPdfPageCount ? (
              <View pointerEvents="none" style={styles.pagePill}>
                <Text maxFontSizeMultiplier={1.1} style={styles.pagePillText}>
                  {currentPage} / {currentPdfPageCount}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.bottomPanel}>
          <View style={styles.partSwitcher}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: selectedPdfIndex <= 0 || isBusy }}
              disabled={selectedPdfIndex <= 0 || isBusy}
              onPress={handlePreviousPdf}
              style={({ pressed }) => [
                styles.partNavButton,
                pressed && selectedPdfIndex > 0 && !isBusy ? styles.controlPressed : null,
              ]}>
              <MaterialIcons
                color={selectedPdfIndex <= 0 || isBusy ? colors.textTertiary : colors.action}
                name="chevron-left"
                size={25}
              />
              <Text
                maxFontSizeMultiplier={1.1}
                style={[
                  styles.partNavText,
                  selectedPdfIndex <= 0 || isBusy ? styles.partNavTextDisabled : null,
                ]}>
                上一份
              </Text>
            </Pressable>

            <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.partIndicator}>
              第 {Math.min(selectedPdfIndex + 1, Math.max(1, pdfPartCount))} / {pdfPartCount} 份
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: selectedPdfIndex >= pdfPartCount - 1 || isBusy }}
              disabled={selectedPdfIndex >= pdfPartCount - 1 || isBusy}
              onPress={handleNextPdf}
              style={({ pressed }) => [
                styles.partNavButton,
                styles.partNavButtonEnd,
                pressed && selectedPdfIndex < pdfPartCount - 1 && !isBusy
                  ? styles.controlPressed
                  : null,
              ]}>
              <Text
                maxFontSizeMultiplier={1.1}
                style={[
                  styles.partNavText,
                  selectedPdfIndex >= pdfPartCount - 1 || isBusy
                    ? styles.partNavTextDisabled
                    : null,
                ]}>
                下一份
              </Text>
              <MaterialIcons
                color={selectedPdfIndex >= pdfPartCount - 1 || isBusy
                  ? colors.textTertiary
                  : colors.action}
                name="chevron-right"
                size={25}
              />
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              busy: isSharingWholeSet || isShareBundlePreparing,
              disabled: isShareSetButtonDisabled,
            }}
            disabled={isShareSetButtonDisabled}
            onPress={() => void handleShareWholeSet()}
            style={({ pressed }) => [
              styles.shareSetButton,
              pressed && !isShareSetButtonDisabled ? styles.shareSetButtonPressed : null,
              isShareSetButtonDisabled ? styles.shareSetButtonDisabled : null,
            ]}>
            {isSharingWholeSet || isShareBundlePreparing ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <MaterialIcons
                color={colors.white}
                name={shareBundleStatus === 'error' ? 'refresh' : 'ios-share'}
                size={27}
              />
            )}
            <View style={styles.shareSetCopy}>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.shareSetTitle}>
                {shareButtonTitle}
              </Text>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={styles.shareSetMeta}>
                {setSummary}
              </Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy || !pdfUri }}
            disabled={isBusy || !pdfUri}
            onPress={() => void handlePrintPdf()}
            style={({ pressed }) => [
              styles.printButton,
              pressed && !isBusy ? styles.controlPressed : null,
              isBusy || !pdfUri ? styles.controlDisabled : null,
            ]}>
            {isPrinting ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <MaterialIcons color={colors.textPrimary} name="print" size={24} />
            )}
            <Text maxFontSizeMultiplier={1.1} style={styles.printButtonText}>
              {isPrinting ? '正在打开打印…' : '打印本份'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsMoreMenuVisible(false)}
        statusBarTranslucent
        transparent
        visible={isMoreMenuVisible}>
        <View style={styles.menuOverlay}>
          <Pressable
            accessibilityLabel="关闭更多操作"
            onPress={() => setIsMoreMenuVisible(false)}
            style={styles.menuBackdrop}
          />
          <View style={[styles.menuSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.menuGroup}>
              <Pressable
                accessibilityRole="button"
                disabled={!pdfUri || isBusy}
                onPress={() => void handleShareCurrentPdf()}
                style={({ pressed }) => [
                  styles.menuAction,
                  pressed && !isBusy ? styles.controlPressed : null,
                  !pdfUri || isBusy ? styles.controlDisabled : null,
                ]}>
                <MaterialIcons color={colors.action} name="ios-share" size={23} />
                <Text maxFontSizeMultiplier={1.1} style={styles.menuActionText}>
                  分享本份 PDF
                </Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsMoreMenuVisible(false)}
              style={({ pressed }) => [styles.menuCancel, pressed ? styles.controlPressed : null]}>
              <Text maxFontSizeMultiplier={1.1} style={styles.menuCancelText}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '700',
  },
  pageRoot: {
    flex: 1,
    backgroundColor: colors.pageBackground,
  },
  moreButton: {
    width: layout.minimumTouchSize,
    height: layout.minimumTouchSize,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: {
    minHeight: 78,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  summaryTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  summaryMeta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  partBadge: {
    minHeight: layout.minimumTouchSize,
    minWidth: 76,
    paddingHorizontal: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.actionSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partBadgeText: {
    color: colors.action,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  viewerShell: {
    flex: 1,
    minHeight: 150,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  paperShadow: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  pdf: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  emptyViewer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.lg,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
  },
  errorTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorActions: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  errorButton: {
    minHeight: layout.minimumTouchSize,
    paddingHorizontal: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.actionSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorButtonText: {
    ...typography.bodySmall,
    color: colors.action,
    fontWeight: '600',
  },
  pagePill: {
    position: 'absolute',
    left: '50%',
    bottom: spacing.md,
    minWidth: 82,
    minHeight: 36,
    marginLeft: -41,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.floating,
  },
  pagePillText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
  bottomPanel: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    ...shadows.floating,
  },
  partSwitcher: {
    minHeight: layout.minimumTouchSize,
    flexDirection: 'row',
    alignItems: 'center',
  },
  partNavButton: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.minimumTouchSize,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  partNavButtonEnd: {
    justifyContent: 'flex-end',
  },
  partNavText: {
    color: colors.action,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  partNavTextDisabled: {
    color: colors.textTertiary,
  },
  partIndicator: {
    width: 104,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  shareSetButton: {
    minHeight: 66,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.action,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  shareSetButtonPressed: {
    backgroundColor: colors.actionPressed,
  },
  shareSetButtonDisabled: {
    backgroundColor: colors.actionDisabled,
  },
  shareSetCopy: {
    minWidth: 0,
    alignItems: 'center',
    gap: 1,
  },
  shareSetTitle: {
    color: colors.white,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  shareSetMeta: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    textAlign: 'center',
  },
  printButton: {
    minHeight: 50,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  printButtonText: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  controlPressed: {
    backgroundColor: colors.actionSoft,
  },
  controlDisabled: {
    opacity: 0.45,
  },
  menuOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(28, 28, 30, 0.32)',
  },
  menuSheet: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  menuGroup: {
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  menuAction: {
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  menuActionText: {
    color: colors.action,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '500',
  },
  menuCancel: {
    minHeight: 58,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuCancelText: {
    color: colors.action,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
  },
});
