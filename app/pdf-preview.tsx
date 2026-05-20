import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Print from 'expo-print';
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

export default function PdfPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ pdfUri?: string | string[] }>();
  const pdfUri = useMemo(() => normalizePdfUri(params.pdfUri), [params.pdfUri]);
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
    if (!pdfUri) {
      setLoadError('未找到可预览的 PDF 文件。');
      setIsLoading(false);
      return;
    }

    setLoadError(null);
    setIsLoading(true);
    Logger.info(PAGE_SCOPE, 'pdf_preview_load_start', {
      pdfUri,
      attempt: previewKey + 1,
    });
  }, [pdfUri, previewKey]);

  const handleRetry = useCallback(() => {
    setLoadError(null);
    setIsLoading(true);
    setPageCount(null);
    setCurrentPage(1);
    setPreviewKey((prev) => prev + 1);
  }, []);

  const handleOpenWithOtherApp = useCallback(async () => {
    if (!pdfUri || isOpeningExternally) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'pdf_preview_open_with_other_app_click', {
      pdfUri,
    });
    setIsOpeningExternally(true);
    try {
      const result = await TodayReviewPdfExportService.openTodayReviewPdfWithOtherApp(pdfUri);
      if (result.success) {
        Logger.info(PAGE_SCOPE, 'pdf_preview_open_with_other_app_success', {
          pdfUri,
        });
        return;
      }

      Logger.warn(PAGE_SCOPE, 'pdf_preview_open_with_other_app_failed', {
        pdfUri,
        reason: result.reason,
        message: result.message,
      });
      Alert.alert('无法打开 PDF', '无法打开 PDF，请尝试分享后用其他应用查看');
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'pdf_preview_open_with_other_app_failed', {
        pdfUri,
        error,
      });
      Alert.alert('无法打开 PDF', '无法打开 PDF，请尝试分享后用其他应用查看');
    } finally {
      setIsOpeningExternally(false);
    }
  }, [isOpeningExternally, pdfUri]);

  const handleSharePdf = useCallback(async () => {
    if (!pdfUri || isSharing || isPrinting) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'pdf_preview_share_click', {
      pdfUri,
    });
    setIsSharing(true);
    try {
      const result = await TodayReviewPdfExportService.shareTodayReviewPdf(pdfUri);
      if (result.success) {
        Logger.info(PAGE_SCOPE, 'pdf_preview_share_success', {
          pdfUri,
        });
        return;
      }

      if (result.reason === 'cancelled') {
        return;
      }

      Logger.warn(PAGE_SCOPE, 'pdf_preview_share_failed', {
        pdfUri,
        reason: result.reason,
        message: result.message,
      });
      Alert.alert('分享失败', toChineseAlertMessage(result.message, '分享失败，请稍后重试'));
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'pdf_preview_share_failed', {
        pdfUri,
        error,
      });
      Alert.alert('分享失败', '分享失败，请稍后重试');
    } finally {
      setIsSharing(false);
    }
  }, [isPrinting, isSharing, pdfUri]);

  const handlePrintPdf = useCallback(async () => {
    if (!pdfUri || isPrinting || isSharing) {
      return;
    }

    Logger.info(PAGE_SCOPE, 'pdf_preview_print_click', {
      pdfUri,
    });
    setIsPrinting(true);
    try {
      await Print.printAsync({
        uri: pdfUri,
      });
      Logger.info(PAGE_SCOPE, 'pdf_preview_print_success', {
        pdfUri,
      });
    } catch (error) {
      Logger.error(PAGE_SCOPE, 'pdf_preview_print_failed', {
        pdfUri,
        error,
      });
      Alert.alert('打印失败', '无法打开打印面板，请稍后重试');
    } finally {
      setIsPrinting(false);
    }
  }, [isPrinting, isSharing, pdfUri]);

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
              Logger.info(PAGE_SCOPE, 'pdf_preview_load_success', {
                pageCount: numberOfPages,
              });
            }}
            onPageChanged={(page) => {
              setCurrentPage(page);
              Logger.info(PAGE_SCOPE, 'pdf_preview_page_changed', {
                currentPage: page,
              });
            }}
            onError={(error) => {
              const message = toErrorMessage(error);
              setLoadError('PDF 预览失败，可以尝试用其他应用打开。');
              setIsLoading(false);
              Logger.warn(PAGE_SCOPE, 'pdf_preview_load_failed', {
                error: message,
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
                    {isSharing ? '分享中...' : '分享 PDF'}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={isPrinting || isSharing || !pdfUri}
                  onPress={() => void handlePrintPdf()}
                  style={[styles.secondaryWideButton, (isPrinting || isSharing || !pdfUri) && styles.buttonDisabled]}>
                  <Text style={styles.secondaryButtonText}>
                    {isPrinting ? '打印中...' : '打印'}
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
                  {isSharing ? '分享中...' : '分享 PDF'}
                </Text>
              </Pressable>
              <Pressable
                disabled={isPrinting || isSharing || !pdfUri}
                onPress={() => void handlePrintPdf()}
                style={[styles.secondaryWideButton, (isPrinting || isSharing || !pdfUri) && styles.buttonDisabled]}>
                <Text style={styles.secondaryButtonText}>
                  {isPrinting ? '打印中...' : '打印'}
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
  primaryButton: {
    minHeight: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryWideButton: {
    flex: 1,
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.white,
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
