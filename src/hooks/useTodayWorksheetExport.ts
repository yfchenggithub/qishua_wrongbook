import { useCallback, useEffect, useMemo, useState } from 'react';

import { Logger } from '@/src/services/Logger';
import {
  ensureTodayWorksheet,
  getCachedTodayWorksheetForOpening,
  getTodayWorksheetGenerationState,
  inspectTodayWorksheetCache,
  regenerateTodayWorksheet as requestTodayWorksheetRegeneration,
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
  isRegenerating: boolean;
  hasCachedWorksheet: boolean;
  cachedWorksheet: TodayWorksheetGenerationState['cachedWorksheet'];
  exportStage: TodayWorksheetExportStage | null;
  progress: ExportPdfProgressState;
  progressPercent: number;
  exportTodayWorksheet: () => Promise<void>;
  regenerateTodayWorksheet: () => Promise<void>;
};

const EMPTY_MESSAGE = '今天暂无需要复做的错题';
const GENERIC_FAILED_MESSAGE = '练习卷读取失败，系统会自动重新准备';
const PREPARING_MESSAGE = '练习卷正在后台准备，完成后可直接打开';

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
    generationState.status === 'checking_cache'
    || generationState.status === 'generating'
    || generationState.status === 'refreshing';
  const isRegenerating = generationState.status === 'refreshing';
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
    const startedAt = Date.now();
    Logger.info(scope, 'open_cached_worksheet_start', {
      total: safeDueToday,
      generationActive: isExporting,
    });

    try {
      const cached = await getCachedTodayWorksheetForOpening({ printEnhanceMode });
      const durationMs = Math.max(0, Date.now() - startedAt);
      if (cached) {
        const pdfUri = cached.fileUri.trim();
        const pdfUris = normalizeFileUris(pdfUri, cached.fileUris);
        const pdfPageCounts = normalizePdfPageCounts(cached.pdfPageCounts, pdfUris.length);
        if (!pdfUri) {
          Logger.warn(scope, 'open_cached_worksheet_failed', {
            errorName: 'EmptyPdfUri',
            errorMessage: 'Worksheet cache has an empty fileUri.',
            durationMs,
          });
          showToast(GENERIC_FAILED_MESSAGE, 'error', longToastDurationMs);
          return;
        }

        Logger.info(scope, 'open_cached_worksheet_success', {
          total: cached.exportedCount,
          durationMs,
          filePath: pdfUri,
          fileCount: pdfUris.length,
          pdfPageCounts,
        });
        onSuccess(pdfUri, pdfUris, pdfPageCounts);
        return;
      }

      if (safeDueToday <= 0) {
        showToast(EMPTY_MESSAGE, 'info');
        onEmpty?.();
        return;
      }

      Logger.info(scope, 'open_cached_worksheet_not_ready', {
        total: safeDueToday,
        durationMs,
        generationActive: isExporting,
      });
      showToast(PREPARING_MESSAGE, 'info', longToastDurationMs);
      void ensureTodayWorksheet({
        expectedPendingCount: safeDueToday,
        printEnhanceMode,
        printEnhanceClearPrintStrength,
        printEnhanceConcurrency,
        printEnhancePerformanceProfile,
      }).then((result) => {
        Logger.info(scope, 'worksheet_preparation_after_cache_miss_settled', {
          outcome: result.outcome,
          exportedCount: result.exportedCount,
          fromCache: result.fromCache ?? false,
        });
      }).catch((error) => {
        Logger.error(scope, 'worksheet_preparation_after_cache_miss_rejected', {
          error,
        });
      });
    } catch (error) {
      Logger.error(scope, 'open_cached_worksheet_failed', {
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

  const regenerateTodayWorksheet = useCallback(async () => {
    if (isExporting) {
      showToast(
        isRegenerating ? '今日练习卷正在重新生成' : '今日练习卷正在自动准备',
        'info',
      );
      return;
    }
    if (!hasCachedWorksheet) {
      showToast('当前没有可保留的今日练习卷，请先等待自动准备完成', 'info');
      return;
    }
    if (safeDueToday <= 0) {
      showToast('当前没有待复做题，已保留原练习卷', 'info');
      return;
    }

    const startedAt = Date.now();
    Logger.info(scope, 'force_regenerate_worksheet_start', {
      pendingCount: safeDueToday,
      previousCachedCount: generationState.cachedWorksheet?.exportedCount ?? 0,
    });
    try {
      const result = await requestTodayWorksheetRegeneration({
        expectedPendingCount: safeDueToday,
        printEnhanceMode,
        printEnhanceClearPrintStrength,
        printEnhanceConcurrency,
        printEnhancePerformanceProfile,
      });
      Logger.info(scope, 'force_regenerate_worksheet_settled', {
        outcome: result.outcome,
        exportedCount: result.exportedCount,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
      if (result.outcome === 'success') {
        showToast('今日练习卷已更新', 'success');
        return;
      }
      if (result.outcome === 'busy' || result.outcome === 'empty') {
        showToast(result.message, 'info', longToastDurationMs);
        return;
      }
      showToast('重新生成失败，原练习卷仍可使用', 'error', longToastDurationMs);
    } catch (error) {
      Logger.error(scope, 'force_regenerate_worksheet_rejected', {
        durationMs: Math.max(0, Date.now() - startedAt),
        error,
      });
      showToast('重新生成失败，原练习卷仍可使用', 'error', longToastDurationMs);
    }
  }, [
    generationState.cachedWorksheet?.exportedCount,
    hasCachedWorksheet,
    isExporting,
    isRegenerating,
    longToastDurationMs,
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
    isRegenerating,
    hasCachedWorksheet,
    cachedWorksheet: generationState.cachedWorksheet,
    exportStage: generationState.stage,
    progress,
    progressPercent,
    exportTodayWorksheet,
    regenerateTodayWorksheet,
  };
}
