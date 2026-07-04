import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Print from 'expo-print';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logger } from '@/src/services/Logger';
import * as TodayReviewPdfExportService from '@/src/services/TodayReviewPdfExportService';
import { colors, radius, spacing, typography } from '@/src/styles/tokens';

const PAGE_SCOPE = 'PdfPreviewScreen';

function normalizePdfUri(value: string | string[] | undefined): string | null {
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
    const parsed = JSON.parse(rawValue);
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

export default function PdfPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ pdfUri?: string | string[]; pdfUris?: string | string[] }>();
  const primaryPdfUri = useMemo(() => normalizePdfUri(params.pdfUri), [params.pdfUri]);
  const pdfUris = useMemo(
    () => normalizePdfUriList(params.pdfUris, primaryPdfUri),
    [params.pdfUris, primaryPdfUri],
  );
  const [selectedPdfIndex, setSelectedPdfIndex] = useState(0);
  const pdfPartCount = pdfUris.length;
  const pdfUri = pdfUris[selectedPdfIndex] ?? primaryPdfUri;
  const source = useMemo(
    () => (pdfUri ? { uri: pdfUri, cache: false as const } : null),
    [pdfUri],
  );

  const [previewKey, setPreviewKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isSharing, setIsSharing] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isOpeningExternally, setIsOpeningExternally] = useState(false);

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
    setPageCount(null);
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
    setPageCount(null);
    setCurrentPage(1);
    setPreviewKey((prev) => prev + 1);
  }, []);

  const handlePreviousPdf = useCallback(() => {
    setSelectedPdfIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextPdf = useCallback(() => {
    setSelectedPdfIndex((prev) => Math.min(Math.max(0, pdfPartCount - 1), prev + 1));
  }, [pdfPartCount]);

  const handleOpenWithOtherApp = useCallback(async () => {
    if (!pdfUri || isOpeningExternally) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'pdf_preview_open_with_other_app_click', {
      pdfUri,
      pdfPartNumber: selectedPdfIndex + 1,
      pdfPartCount,
    });
    setIsOpeningExternally(true);
    try {
      const result = await TodayReviewPdfExportService.openTodayReviewPdfWithOtherApp(pdfUri);
      if (result.success) {
        Logger.info(PAGE_SCOPE, 'pdf_preview_open_with_other_app_success', {
          pdfUri,
          pdfPartNumber: selectedPdfIndex + 1,
          pdfPartCount,
        });
        return;
      }

      Logger.warn(PAGE_SCOPE, 'pdf_preview_open_with_other_app_failed', {
        pdfUri,
        pdfPartNumber: selectedPdfIndex + 1,
        pdfPartCount,
        reason: result.reason,
        message: result.message,
      });
      Alert.alert('无法打开 PDF', '无法打开 PDF，请尝试分享后用其他应用查看');
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'pdf_preview_open_with_other_app_failed', {
        pdfUri,
        pdfPartNumber: selectedPdfIndex + 1,
        pdfPartCount,
        error,
      });
      Alert.alert('无法打开 PDF', '无法打开 PDF，请尝试分享后用其他应用查看');
    } finally {
      setIsOpeningExternally(false);
    }
  }, [isOpeningExternally, pdfPartCount, pdfUri, selectedPdfIndex]);

  const handleSharePdf = useCallback(async () => {
    if (!pdfUri || isSharing || isPrinting) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'pdf_preview_share_click', {
      pdfUri,
      pdfPartNumber: selectedPdfIndex + 1,
      pdfPartCount,
    });
    setIsSharing(true);
    try {
      const result = await TodayReviewPdfExportService.shareTodayReviewPdf(pdfUri);
      if (result.success) {
        Logger.info(PAGE_SCOPE, 'pdf_preview_share_success', {
          pdfUri,
          pdfPartNumber: selectedPdfIndex + 1,
          pdfPartCount,
        });
        return;
      }

      if (result.reason === 'cancelled') {
        return;
      }

      Logger.warn(PAGE_SCOPE, 'pdf_preview_share_failed', {
        pdfUri,
        pdfPartNumber: selectedPdfIndex + 1,
        pdfPartCount,
        reason: result.reason,
        message: result.message,
      });
      Alert.alert('分享失败', toChineseAlertMessage(result.message, '分享失败，请稍后重试'));
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'pdf_preview_share_failed', {
        pdfUri,
        pdfPartNumber: selectedPdfIndex + 1,
        pdfPartCount,
        error,
      });
      Alert.alert('分享失败', '分享失败，请稍后重试');
    } finally {
      setIsSharing(false);
    }
  }, [isPrinting, isSharing, pdfPartCount, pdfUri, selectedPdfIndex]);

  const handlePrintPdf = useCallback(async () => {
    if (!pdfUri || isPrinting || isSharing) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'pdf_preview_print_click', {
      pdfUri,
      pdfPartNumber: selectedPdfIndex + 1,
      pdfPartCount,
    });
    setIsPrinting(true);
    try {
      await Print.printAsync({
        uri: pdfUri,
      });
      Logger.info(PAGE_SCOPE, 'pdf_preview_print_success', {
        pdfUri,
        pdfPartNumber: selectedPdfIndex + 1,
        pdfPartCount,
      });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'pdf_preview_print_failed', {
        pdfUri,
        pdfPartNumber: selectedPdfIndex + 1,
        pdfPartCount,
        error,
      });
      Alert.alert('打印失败', '无法打开打印面板，请稍后重试');
    } finally {
      setIsPrinting(false);
    }
  }, [isPrinting, isSharing, pdfPartCount, pdfUri, selectedPdfIndex]);

  return (
    <SafeAreaView edges={['bottom']} style={styles.pageRoot}>
      <View style={styles.viewerArea}>
        {source ? (
          <Pdf
            key={`pdf-preview-${previewKey}`}
            source={source}
            style={styles.pdf}
            enablePaging={false}
            trustAllCerts={false}
            onLoadComplete={(numberOfPages) => {
              setPageCount(numberOfPages);
              setIsLoading(false);
              setLoadError(null);
              const fileInfo = pdfUri ? readPdfFileInfo(pdfUri) : { exists: false, sizeBytes: null };
              Logger.info(PAGE_SCOPE, 'pdf_preview_load_success', {
                pageCount: numberOfPages,
                pdfUriPreview: toSafeUriPreview(pdfUri),
                pdfPartNumber: selectedPdfIndex + 1,
                pdfPartCount,
                fileExists: fileInfo.exists,
                fileSizeBytes: fileInfo.sizeBytes,
              });
            }}
            onPageChanged={(page) => {
              setCurrentPage(page);
              Logger.info(PAGE_SCOPE, 'pdf_preview_page_changed', {
                currentPage: page,
                pdfPartNumber: selectedPdfIndex + 1,
                pdfPartCount,
              });
            }}
            onError={(error) => {
              const message = toErrorMessage(error);
              setLoadError('PDF 预览失败，可以尝试用其他应用打开。');
              setIsLoading(false);
              const fileInfo = pdfUri ? readPdfFileInfo(pdfUri) : { exists: false, sizeBytes: null };
              Logger.warn(PAGE_SCOPE, 'pdf_preview_load_failed', {
                error: message,
                pdfUriPreview: toSafeUriPreview(pdfUri),
                pdfPartNumber: selectedPdfIndex + 1,
                pdfPartCount,
                fileExists: fileInfo.exists,
                fileSizeBytes: fileInfo.sizeBytes,
              });
            }}
          />
        ) : (
          <View style={styles.errorPanel}>
            <Text style={styles.errorTitle}>{'无法预览 PDF'}</Text>
            <Text style={styles.errorText}>{'未找到可预览的 PDF 文件。'}</Text>
          </View>
        )}

        {isLoading && !loadError ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="small" color={colors.textPrimary} />
            <Text style={styles.loadingText}>{'正在加载 PDF...'}</Text>
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.errorOverlay}>
            <View style={styles.errorPanel}>
              <Text style={styles.errorTitle}>{'PDF 预览失败'}</Text>
              <Text style={styles.errorText}>{loadError}</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {pdfPartCount > 1 ? (
          <View style={styles.partSwitcher}>
            <Pressable
              disabled={selectedPdfIndex <= 0 || isSharing || isPrinting}
              onPress={handlePreviousPdf}
              style={[
                styles.partNavButton,
                (selectedPdfIndex <= 0 || isSharing || isPrinting) && styles.buttonDisabled,
              ]}>
              <Text style={styles.partNavButtonText}>{'上一份'}</Text>
            </Pressable>
            <Text style={styles.partIndicator}>
              {'第'} {selectedPdfIndex + 1} / {pdfPartCount} {'份'}
            </Text>
            <Pressable
              disabled={selectedPdfIndex >= pdfPartCount - 1 || isSharing || isPrinting}
              onPress={handleNextPdf}
              style={[
                styles.partNavButton,
                (selectedPdfIndex >= pdfPartCount - 1 || isSharing || isPrinting) && styles.buttonDisabled,
              ]}>
              <Text style={styles.partNavButtonText}>{'下一份'}</Text>
            </Pressable>
          </View>
        ) : null}
        {!loadError ? (
          isLoading ? (
            <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>{'返回'}</Text>
            </Pressable>
          ) : (
            <>
              <View style={styles.rowButtons}>
                <Pressable
                  disabled={isSharing || isPrinting || !pdfUri}
                  onPress={() => void handleSharePdf()}
                  style={[
                    styles.primaryButton,
                    styles.primaryWideButton,
                    (isSharing || isPrinting || !pdfUri) && styles.buttonDisabled,
                  ]}>
                  <Text style={styles.primaryButtonText}>
                    {isSharing ? '分享中...' : pdfPartCount > 1 ? '分享本份 PDF' : '分享 PDF'}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={isPrinting || isSharing || !pdfUri}
                  onPress={() => void handlePrintPdf()}
                  style={[styles.secondaryWideButton, (isPrinting || isSharing || !pdfUri) && styles.buttonDisabled]}>
                  <Text style={styles.secondaryButtonText}>
                    {isPrinting ? '打印中...' : pdfPartCount > 1 ? '打印本份' : '打印'}
                  </Text>
                </Pressable>
              </View>
              <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>{'返回'}</Text>
              </Pressable>
            </>
          )
        ) : (
          <>
            <View style={styles.rowButtons}>
              <Pressable onPress={handleRetry} style={styles.secondaryWideButton}>
                <Text style={styles.secondaryButtonText}>{'重试'}</Text>
              </Pressable>
              <Pressable
                disabled={!pdfUri || isOpeningExternally}
                onPress={() => void handleOpenWithOtherApp()}
                style={[styles.secondaryWideButton, (!pdfUri || isOpeningExternally) && styles.buttonDisabled]}>
                <Text style={styles.secondaryButtonText}>
                  {isOpeningExternally ? '打开中...' : '用其他应用打开'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.rowButtons}>
              <Pressable
                disabled={isSharing || isPrinting || !pdfUri}
                onPress={() => void handleSharePdf()}
                style={[styles.secondaryWideButton, (isSharing || isPrinting || !pdfUri) && styles.buttonDisabled]}>
                <Text style={styles.secondaryButtonText}>
                  {isSharing ? '分享中...' : pdfPartCount > 1 ? '分享本份 PDF' : '分享 PDF'}
                </Text>
              </Pressable>
              <Pressable
                disabled={isPrinting || isSharing || !pdfUri}
                onPress={() => void handlePrintPdf()}
                style={[styles.secondaryWideButton, (isPrinting || isSharing || !pdfUri) && styles.buttonDisabled]}>
                <Text style={styles.secondaryButtonText}>
                  {isPrinting ? '打印中...' : pdfPartCount > 1 ? '打印本份' : '打印'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.rowButtons}>
              <Pressable onPress={() => router.back()} style={styles.secondaryWideButton}>
                <Text style={styles.secondaryButtonText}>{'返回'}</Text>
              </Pressable>
            </View>
          </>
        )}
        {pageCount ? (
          <Text style={styles.pageIndicator}>
            {'第'} {currentPage} / {pageCount} {'页'}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: '#EEF2F6',
  },
  viewerArea: {
    flex: 1,
    backgroundColor: '#D6DCE5',
  },
  pdf: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(250, 250, 250, 0.68)',
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(238, 242, 246, 0.85)',
  },
  errorPanel: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  errorTitle: {
    ...typography.sectionTitle,
    fontSize: 18,
    lineHeight: 24,
    color: '#1F2937',
  },
  errorText: {
    ...typography.body,
    color: '#4B5563',
  },
  bottomBar: {
    borderTopWidth: 1,
    borderTopColor: '#D6DEE8',
    backgroundColor: '#F8FAFC',
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  rowButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  partSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  partNavButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  partNavButtonText: {
    ...typography.caption,
    color: '#1F2937',
    fontWeight: '700',
    textAlign: 'center',
  },
  partIndicator: {
    flex: 1,
    ...typography.caption,
    color: '#475569',
    fontWeight: '700',
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryWideButton: {
    flex: 1,
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.success,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryWideButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    ...typography.body,
    color: '#1F2937',
    fontWeight: '700',
    textAlign: 'center',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  pageIndicator: {
    ...typography.caption,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 2,
  },
});
