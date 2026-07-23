import { Logger } from '@/src/services/Logger';
import * as MistakeListService from '@/src/services/MistakeListService';
import * as TodayReviewPdfExportService from '@/src/services/TodayReviewPdfExportService';
import * as TodayWorksheetPdfCacheService from '@/src/services/TodayWorksheetPdfCacheService';
import type {
  PrintEnhanceConcurrency,
  PrintEnhancePerformanceProfile,
  PrintEnhanceClearPrintStrength,
  PrintEnhanceMode,
} from '@/src/utils/image/printEnhanceConfig';
import { toActivePrintEnhanceMode } from '@/src/utils/image/printEnhanceConfig';

const SERVICE_SCOPE = 'TodayWorksheetExportService';

const MESSAGE_EMPTY = '今天没有待复做错题可导出';
const MESSAGE_BUSY = '上一轮导出或分享还未结束，请先关闭分享面板后重试';
const MESSAGE_FAILED = '导出失败，请稍后重试';

export type TodayWorksheetExportStage =
  | 'preparing'
  | 'processing_images'
  | 'generating_pages'
  | 'saving'
  | 'sharing';

export type TodayWorksheetExportProgress = {
  stage: TodayWorksheetExportStage;
  pendingCount: number | null;
  current: number;
  total: number;
  message: string;
};

export type TodayWorksheetExportOutcome =
  | 'success'
  | 'empty'
  | 'share_unavailable'
  | 'busy'
  | 'failed';

export type TodayWorksheetExportResult = {
  outcome: TodayWorksheetExportOutcome;
  message: string;
  exportedCount: number;
  fileUri?: string;
  fileUris?: string[];
  pdfPageCounts?: number[];
  pdfPartCount?: number;
  fromCache?: boolean;
};

export type TodayWorksheetCachedExport = {
  printEnhanceMode: PrintEnhanceMode;
  fileUri: string;
  fileUris: string[];
  pdfPageCounts: number[];
  exportedCount: number;
  pdfPartCount: number;
  generatedAt: string;
};

export type ExportTodayWorksheetOptions = {
  expectedPendingCount?: number;
  forceRegenerate?: boolean;
  printEnhanceMode?: PrintEnhanceMode;
  printEnhanceClearPrintStrength?: PrintEnhanceClearPrintStrength;
  printEnhanceConcurrency?: PrintEnhanceConcurrency;
  printEnhancePerformanceProfile?: PrintEnhancePerformanceProfile;
  onProgress?: (progress: TodayWorksheetExportProgress) => void;
};

function toSafeCount(count: number | null | undefined): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.floor(count));
}

function formatCountSuffix(count: number): string {
  const safe = toSafeCount(count);
  return `${safe}题`;
}

function buildSuccessMessage(count: number, pdfPartCount?: number): string {
  const safePdfPartCount = toSafeCount(pdfPartCount);
  if (safePdfPartCount > 1) {
    return `今日练习卷已生成（${formatCountSuffix(count)}，${safePdfPartCount}个 PDF）`;
  }
  return `今日练习卷已生成（${formatCountSuffix(count)}）`;
}

function buildCachedMessage(count: number, pdfPartCount?: number): string {
  const safePdfPartCount = toSafeCount(pdfPartCount);
  if (safePdfPartCount > 1) {
    return `已打开今日生成的练习卷（${formatCountSuffix(count)}，${safePdfPartCount}个 PDF）`;
  }
  return `已打开今日生成的练习卷（${formatCountSuffix(count)}）`;
}

function buildShareUnavailableMessage(count: number, pdfPartCount?: number): string {
  const safePdfPartCount = toSafeCount(pdfPartCount);
  const pdfText = safePdfPartCount > 1 ? `${safePdfPartCount}个 PDF` : 'PDF';
  return `已生成${formatCountSuffix(count)}练习卷（${pdfText}），但当前设备不支持分享。请到文件管理器查看导出 PDF。`;
}

function buildFailedMessageFromPdfResult(
  fallbackCount: number,
  result: Extract<TodayReviewPdfExportService.ExportTodayReviewPdfResult, { success: false }>,
): string {
  const countForMessage = toSafeCount(result.exportedCount ?? fallbackCount);
  if (result.reason === 'share_unavailable') {
    return buildShareUnavailableMessage(countForMessage, result.pdfPartCount);
  }
  if (result.reason === 'busy') {
    return MESSAGE_BUSY;
  }
  return MESSAGE_FAILED;
}

function mapPdfProgressStageToWorksheetStage(
  stage: TodayReviewPdfExportService.ExportTodayReviewPdfStage,
): TodayWorksheetExportStage {
  if (stage === 'process_images') {
    return 'processing_images';
  }
  if (stage === 'generate_pdf') {
    return 'generating_pages';
  }
  if (stage === 'save_pdf') {
    return 'saving';
  }
  if (stage === 'open_share') {
    return 'sharing';
  }
  return 'preparing';
}

function emitProgress(
  reporter: ExportTodayWorksheetOptions['onProgress'],
  stage: TodayWorksheetExportStage,
  pendingCount: number | null,
  current?: number | null,
  total?: number | null,
  message?: string | null,
): void {
  if (!reporter) {
    return;
  }
  const safeCount = toSafeCount(pendingCount);
  const safeTotal = toSafeCount(total ?? safeCount);
  const safeCurrentRaw = toSafeCount(current);
  const safeCurrent = safeTotal > 0 ? Math.min(safeTotal, safeCurrentRaw) : safeCurrentRaw;
  const safeMessage = typeof message === 'string' && message.trim().length > 0
    ? message.trim()
    : buildTodayWorksheetExportProgressMessage(stage, safeCount, safeCurrent, safeTotal);

  try {
    reporter({
      stage,
      pendingCount: safeCount,
      current: safeCurrent,
      total: safeTotal,
      message: safeMessage,
    });
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Worksheet export progress reporter callback failed.', {
      stage,
      pendingCount: safeCount,
      current: safeCurrent,
      total: safeTotal,
      error,
    });
  }
}

export function buildTodayWorksheetExportButtonLabel(pendingCount: number): string {
  return `导出今日练习卷（${formatCountSuffix(pendingCount)}）`;
}

export function buildTodayWorksheetExportProgressMessage(
  stage: TodayWorksheetExportStage,
  pendingCount?: number,
  current?: number,
  total?: number,
): string {
  const safeCount = toSafeCount(pendingCount);
  const safeTotal = toSafeCount(total ?? safeCount);
  const safeCurrent = safeTotal > 0
    ? Math.min(safeTotal, toSafeCount(current))
    : toSafeCount(current);

  if (stage === 'preparing') {
    if (safeCount > 0) {
      return `正在整理题目（${formatCountSuffix(safeCount)}）...`;
    }
    return '正在整理题目...';
  }
  if (stage === 'processing_images') {
    if (safeTotal > 0) {
      return `处理图片 ${safeCurrent} / ${safeTotal}...`;
    }
    return '正在处理图片...';
  }
  if (stage === 'generating_pages') {
    if (safeTotal > 0) {
      return `生成 PDF 页面 ${safeCurrent} / ${safeTotal}...`;
    }
    return '正在生成 PDF...';
  }
  if (stage === 'saving') {
    return '正在保存 PDF...';
  }
  return '正在打开分享面板...';
}

export async function getTodayWorksheetPendingCount(): Promise<number> {
  try {
    const count = await MistakeListService.getTodayReviewQueueCount();
    return toSafeCount(count);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load pending count for today worksheet export.', {
      error,
    });
    return 0;
  }
}

export async function getCachedTodayWorksheet(
  printEnhanceMode: PrintEnhanceMode,
): Promise<TodayWorksheetCachedExport | null> {
  const activeMode = toActivePrintEnhanceMode(printEnhanceMode);
  const cache = await TodayWorksheetPdfCacheService.loadTodayWorksheetPdfCache(activeMode);
  if (!cache) {
    return null;
  }
  return {
    printEnhanceMode: cache.printEnhanceMode,
    fileUri: cache.fileUri,
    fileUris: cache.fileUris,
    pdfPageCounts: cache.pdfPageCounts,
    exportedCount: cache.exportedCount,
    pdfPartCount: cache.pdfPartCount,
    generatedAt: cache.generatedAt,
  };
}

export async function exportTodayWorksheet(
  options?: ExportTodayWorksheetOptions,
): Promise<TodayWorksheetExportResult> {
  const activePrintEnhanceMode = toActivePrintEnhanceMode(options?.printEnhanceMode);
  if (options?.forceRegenerate !== true) {
    const cached = await getCachedTodayWorksheet(activePrintEnhanceMode);
    if (cached) {
      return {
        outcome: 'success',
        message: buildCachedMessage(cached.exportedCount, cached.pdfPartCount),
        exportedCount: cached.exportedCount,
        fileUri: cached.fileUri,
        fileUris: cached.fileUris,
        pdfPageCounts: cached.pdfPageCounts,
        pdfPartCount: cached.pdfPartCount,
        fromCache: true,
      };
    }
  }

  const expectedPendingCount = toSafeCount(options?.expectedPendingCount);
  const pendingCount =
    expectedPendingCount > 0 ? expectedPendingCount : await getTodayWorksheetPendingCount();

  if (pendingCount <= 0) {
    return {
      outcome: 'empty',
      message: MESSAGE_EMPTY,
      exportedCount: 0,
    };
  }

  emitProgress(options?.onProgress, 'preparing', pendingCount, 0, pendingCount);
  try {
    const result = await TodayReviewPdfExportService.exportTodayReviewPdf({
      printEnhanceMode: activePrintEnhanceMode,
      printEnhanceClearPrintStrength: options?.printEnhanceClearPrintStrength,
      printEnhanceConcurrency: options?.printEnhanceConcurrency,
      printEnhancePerformanceProfile: options?.printEnhancePerformanceProfile,
      onProgress: (progress) => {
        const mappedStage = mapPdfProgressStageToWorksheetStage(progress.stage);
        const countInProgress =
          progress.itemCount !== null && progress.itemCount !== undefined
            ? progress.itemCount
            : pendingCount;

        emitProgress(
          options?.onProgress,
          mappedStage,
          countInProgress,
          progress.current,
          progress.total,
          progress.message,
        );
      },
    });

    if (result.success) {
      const exportedCount = toSafeCount(result.exportedCount);
      try {
        await TodayWorksheetPdfCacheService.saveTodayWorksheetPdfCache({
          printEnhanceMode: activePrintEnhanceMode,
          fileUris: result.fileUris,
          pdfPageCounts: result.pdfPageCounts,
          exportedCount,
        });
      } catch (error) {
        Logger.warn(SERVICE_SCOPE, 'Worksheet PDF generated but cache metadata could not be saved.', {
          exportedCount,
          pdfPartCount: result.pdfPartCount,
          error,
        });
      }
      return {
        outcome: 'success',
        message: buildSuccessMessage(exportedCount, result.pdfPartCount),
        exportedCount,
        fileUri: result.fileUri,
        fileUris: result.fileUris,
        pdfPageCounts: result.pdfPageCounts,
        pdfPartCount: result.pdfPartCount,
        fromCache: false,
      };
    }

    const exportedCount = toSafeCount(result.exportedCount ?? pendingCount);
    const message = buildFailedMessageFromPdfResult(pendingCount, result);

    if (result.reason === 'share_unavailable') {
      Logger.warn(SERVICE_SCOPE, 'Sharing unavailable while exporting today worksheet.', {
        message: result.message,
        exportedCount,
      });
      return {
        outcome: 'share_unavailable',
        message,
        exportedCount,
        fileUri: result.fileUri,
        fileUris: result.fileUris,
        pdfPartCount: result.pdfPartCount,
      };
    }

    if (result.reason === 'busy') {
      Logger.info(
        SERVICE_SCOPE,
        'Skip worksheet export because another export/share flow is in progress.',
        {
          message: result.message,
        },
      );
      return {
        outcome: 'busy',
        message,
        exportedCount,
        fileUri: result.fileUri,
        fileUris: result.fileUris,
        pdfPartCount: result.pdfPartCount,
      };
    }

    if (result.reason === 'empty') {
      return {
        outcome: 'empty',
        message: MESSAGE_EMPTY,
        exportedCount: 0,
      };
    }

    Logger.warn(SERVICE_SCOPE, 'Today worksheet export finished without success.', {
      reason: result.reason,
      message: result.message,
    });
    return {
      outcome: 'failed',
      message,
      exportedCount,
      fileUri: result.fileUri,
      fileUris: result.fileUris,
      pdfPartCount: result.pdfPartCount,
    };
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to export today worksheet.', { error });
    return {
      outcome: 'failed',
      message: MESSAGE_FAILED,
      exportedCount: pendingCount,
    };
  }
}
