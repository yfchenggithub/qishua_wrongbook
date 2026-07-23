import { useCallback, useEffect, useMemo, useState } from 'react';

import { Logger } from '@/src/services/Logger';
import {
  ensureTodayWorksheet,
  getTodayWorksheetGenerationState,
  inspectTodayWorksheetCache,
  subscribeTodayWorksheetGeneration,
  type TodayWorksheetGenerationState,
} from '@/src/services/TodayWorksheetGenerationCoordinator';
import type { TodayWorksheetExportStage } from '@/src/services/TodayWorksheetExportService';
import type {
  PrintEnhanceClearPrintStrength,
  PrintEnhanceConcurrency,
  PrintEnhanceMode,
  PrintEnhancePerformanceProfile,
} from '@/src/utils/image/printEnhanceConfig';

type ExportToastType = 'success' | 'info' | 'error';

export type ExportPdfProgressPhase =
  | 'idle'
  | 'preparing'
  | 'processing_images'
  | 'generating_pages'
  | 'saving'
  | 'sharing'
  | 'done'
  | 'error';

export type ExportPdfProgressState = {
  phase: ExportPdfProgressPhase;
  current: number;
  total: number;
  elapsedSeconds: number;
  message: string;
};

export type UseTodayWorksheetExportOptions = {
  scope: string;
  dueToday: number;
  longToastDurationMs: number;
  printEnhanceMode?: PrintEnhanceMode;
  printEnhanceClearPrintStrength?: PrintEnhanceClearPrintStrength;
  printEnhanceConcurrency?: PrintEnhanceConcurrency;
  printEnhancePerformanceProfile?: PrintEnhancePerformanceProfile;
  showToast: (message: string, type?: ExportToastType, duration?: number) => void;
  onSuccess: (fileUri: string, fileUris: string[], pdfPageCounts: number[]) => void;
  onEmpty?: () => void;
};

export type UseTodayWorksheetExportResult = {
  isExporting: boolean;
  hasCachedWorksheet: boolean;
  exportStage: TodayWorksheetExportStage | null;
  progress: ExportPdfProgressState;
  progressPercent: number;
  exportTodayWorksheet: () => Promise<void>;
};

const EMPTY_MESSAGE = '今天暂无需要复做的错题';
const GENERIC_FAILED_MESSAGE = '导出失败，请稍后重试';

function toSafeCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeFileUris(fileUri: string, fileUris: string[] | null | undefined): string[] {
  const normalizedList = Array.isArray(fileUris)
    ? fileUris
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
    : [];
  const normalizedPrimary = typeof fileUri === 'string' ? fileUri.trim() : '';
  if (normalizedList.length > 0) {
    return normalizedList;
  }
  return normalizedPrimary ? [normalizedPrimary] : [];
}

function normalizePdfPageCounts(value: number[] | null | undefined, fileCount: number): number[] {
  if (!Array.isArray(value) || value.length !== fileCount) {
    return [];
  }
  const normalized = value.map(toSafeCount);
  return normalized.every((pageCount) => pageCount > 0) ? normalized : [];
}

function toProgressPhase(state: TodayWorksheetGenerationState): ExportPdfProgressPhase {
  if (state.status === 'ready') {
    return 'done';
  }
  if (state.status === 'error') {
    return 'error';
  }
  if (!state.stage) {
    return 'idle';
  }
  if (state.stage === 'preparing') {
    return 'preparing';
  }
  if (state.stage === 'processing_images') {
    return 'processing_images';
  }
  if (state.stage === 'generating_pages') {
    return 'generating_pages';
  }
  if (state.stage === 'saving') {
    return 'saving';
  }
  return 'sharing';
}

function buildIdleMessage(dueToday: number): string {
  return dueToday > 0 ? '等待生成今日练习卷' : '今日没有待复做错题';
}

export function formatElapsedSeconds(seconds: number): string {
  const safeSeconds = toSafeCount(seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainSeconds).padStart(2, '0')}`;
}

export function useTodayWorksheetExport(
  options: UseTodayWorksheetExportOptions,
): UseTodayWorksheetExportResult {
  const {
    scope,
    dueToday,
    longToastDurationMs,
    printEnhanceMode,
    printEnhanceClearPrintStrength,
    printEnhanceConcurrency,
    printEnhancePerformanceProfile,
    showToast,
    onSuccess,
    onEmpty,
  } = options;
  const safeDueToday = toSafeCount(dueToday);
  const [generationState, setGenerationState] = useState(getTodayWorksheetGenerationState);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => subscribeTodayWorksheetGeneration(() => {
    setGenerationState(getTodayWorksheetGenerationState());
  }), []);

  useEffect(() => {
    void inspectTodayWorksheetCache({ printEnhanceMode });
  }, [printEnhanceMode, safeDueToday]);

  const isExporting =
    generationState.status === 'checking_cache' || generationState.status === 'generating';
  const hasCachedWorksheet = generationState.cachedWorksheet !== null;

  useEffect(() => {
    if (!isExporting || generationState.startedAt === null) {
      setElapsedSeconds(0);
      return undefined;
    }

    const startedAt = generationState.startedAt;
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [generationState.startedAt, isExporting]);

  const progress = useMemo<ExportPdfProgressState>(() => {
    const fallbackTotal = generationState.status === 'idle' ? safeDueToday : 0;
    const total = generationState.total > 0 ? generationState.total : fallbackTotal;
    return {
      phase: toProgressPhase(generationState),
      current: total > 0 ? Math.min(total, generationState.current) : generationState.current,
      total,
      elapsedSeconds,
      message: generationState.message || buildIdleMessage(safeDueToday),
    };
  }, [elapsedSeconds, generationState, safeDueToday]);

  const progressPercent = progress.phase === 'done'
    ? 1
    : progress.total > 0 && Number.isFinite(progress.current / progress.total)
      ? Math.max(0, Math.min(1, progress.current / progress.total))
      : 0;

  const exportTodayWorksheet = useCallback(async () => {
    if (isExporting) {
      return;
    }

    const startedAt = Date.now();
    Logger.info(scope, 'export_pdf_start', {
      total: safeDueToday,
      cacheAware: true,
    });

    try {
      const result = await ensureTodayWorksheet({
        expectedPendingCount: safeDueToday,
        printEnhanceMode,
        printEnhanceClearPrintStrength,
        printEnhanceConcurrency,
        printEnhancePerformanceProfile,
      });
      const durationMs = Math.max(0, Date.now() - startedAt);

      if (result.outcome === 'success') {
        const pdfUri = typeof result.fileUri === 'string' ? result.fileUri.trim() : '';
        const pdfUris = normalizeFileUris(pdfUri, result.fileUris);
        const pdfPageCounts = normalizePdfPageCounts(result.pdfPageCounts, pdfUris.length);
        if (!pdfUri) {
          Logger.warn(scope, 'export_pdf_failed', {
            errorName: 'EmptyPdfUri',
            errorMessage: 'Worksheet export succeeded but fileUri is empty.',
            durationMs,
          });
          showToast('导出成功但未找到 PDF 文件，请重试', 'error', longToastDurationMs);
          return;
        }

        Logger.info(scope, result.fromCache ? 'export_pdf_cache_reused' : 'export_pdf_success', {
          total: result.exportedCount,
          durationMs,
          filePath: pdfUri,
          fileCount: pdfUris.length,
          pdfPageCounts,
        });
        onSuccess(pdfUri, pdfUris, pdfPageCounts);
        return;
      }

      if (result.outcome === 'empty') {
        showToast(EMPTY_MESSAGE, 'info');
        onEmpty?.();
        return;
      }

      const failureType = result.outcome === 'share_unavailable' ? 'info' : 'error';
      Logger.warn(scope, 'export_pdf_failed', {
        errorName: result.outcome,
        errorMessage: result.message,
        durationMs,
      });
      showToast(result.message, failureType, longToastDurationMs);
    } catch (error) {
      Logger.error(scope, 'export_pdf_failed', {
        durationMs: Math.max(0, Date.now() - startedAt),
        error,
      });
      showToast(GENERIC_FAILED_MESSAGE, 'error', longToastDurationMs);
    }
  }, [
    isExporting,
    longToastDurationMs,
    onEmpty,
    onSuccess,
    printEnhanceClearPrintStrength,
    printEnhanceConcurrency,
    printEnhanceMode,
    printEnhancePerformanceProfile,
    safeDueToday,
    scope,
    showToast,
  ]);

  return {
    isExporting,
    hasCachedWorksheet,
    exportStage: generationState.stage,
    progress,
    progressPercent,
    exportTodayWorksheet,
  };
}
