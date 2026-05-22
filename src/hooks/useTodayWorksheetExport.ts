import { useCallback, useEffect, useRef, useState } from 'react';

import * as ExportImageModeService from '@/src/services/ExportImageModeService';
import type { TodayWorksheetExportStage } from '@/src/services/TodayWorksheetExportService';
import * as TodayWorksheetExportService from '@/src/services/TodayWorksheetExportService';
import { Logger } from '@/src/services/Logger';
import type {
  PrintEnhanceClearPrintStrength,
  PrintEnhanceMode,
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
  showToast: (message: string, type?: ExportToastType, duration?: number) => void;
  onSuccess: (fileUri: string) => void;
  onEmpty?: () => void;
};

export type UseTodayWorksheetExportResult = {
  isExporting: boolean;
  exportStage: TodayWorksheetExportStage | null;
  progress: ExportPdfProgressState;
  progressPercent: number;
  exportTodayWorksheet: () => Promise<void>;
};

type ResolvedPrintEnhanceSettings = {
  mode: PrintEnhanceMode;
  clearPrintStrength: PrintEnhanceClearPrintStrength;
  source: 'explicit' | 'saved' | 'mixed';
};

const EMPTY_MESSAGE = '今天暂无需要复做的错题';
const GENERATING_MESSAGE = '正在生成练习卷 PDF...';
const GENERIC_FAILED_MESSAGE = '导出失败，请稍后重试';

const INITIAL_PROGRESS: ExportPdfProgressState = {
  phase: 'idle',
  current: 0,
  total: 0,
  elapsedSeconds: 0,
  message: '',
};

function toSafeCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

async function resolvePrintEnhanceSettings(
  mode: PrintEnhanceMode | undefined,
  clearPrintStrength: PrintEnhanceClearPrintStrength | undefined,
): Promise<ResolvedPrintEnhanceSettings> {
  const hasMode = typeof mode === 'string' && mode.trim().length > 0;
  const hasStrength = typeof clearPrintStrength === 'string' && clearPrintStrength.trim().length > 0;
  if (hasMode && hasStrength) {
    return {
      mode: mode as PrintEnhanceMode,
      clearPrintStrength: clearPrintStrength as PrintEnhanceClearPrintStrength,
      source: 'explicit',
    };
  }

  const savedSettings = await ExportImageModeService.loadExportImageSettings();
  if (!hasMode && !hasStrength) {
    return {
      mode: savedSettings.mode,
      clearPrintStrength: savedSettings.clearPrintStrength,
      source: 'saved',
    };
  }

  return {
    mode: hasMode ? (mode as PrintEnhanceMode) : savedSettings.mode,
    clearPrintStrength: hasStrength
      ? (clearPrintStrength as PrintEnhanceClearPrintStrength)
      : savedSettings.clearPrintStrength,
    source: 'mixed',
  };
}

function toProgressPhase(stage: TodayWorksheetExportStage | null): ExportPdfProgressPhase {
  if (!stage) {
    return 'idle';
  }
  if (stage === 'preparing') {
    return 'preparing';
  }
  if (stage === 'processing_images') {
    return 'processing_images';
  }
  if (stage === 'generating_pages') {
    return 'generating_pages';
  }
  if (stage === 'saving') {
    return 'saving';
  }
  return 'sharing';
}

function toErrorInfo(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || GENERIC_FAILED_MESSAGE,
    };
  }
  return {
    name: 'UnknownError',
    message: typeof error === 'string' && error.trim() ? error.trim() : GENERIC_FAILED_MESSAGE,
  };
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
    showToast,
    onSuccess,
    onEmpty,
  } = options;

  const [isExporting, setIsExporting] = useState(false);
  const [exportStage, setExportStage] = useState<TodayWorksheetExportStage | null>(null);
  const [progress, setProgress] = useState<ExportPdfProgressState>(INITIAL_PROGRESS);

  const isMountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ExportPdfProgressState>(INITIAL_PROGRESS);

  const clearTimer = useCallback(() => {
    if (!timerRef.current) {
      return;
    }
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      clearTimer();
    },
    [clearTimer],
  );

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const progressPercent = progress.total > 0 && Number.isFinite(progress.current / progress.total)
    ? Math.max(0, Math.min(1, progress.current / progress.total))
    : 0;

  const exportTodayWorksheet = useCallback(async () => {
    if (isExporting) {
      return;
    }

    const safeDueToday = toSafeCount(dueToday);
    if (safeDueToday <= 0) {
      Logger.info(scope, 'export_today_practice_pdf_empty', {
        dueToday: safeDueToday,
      });
      showToast(EMPTY_MESSAGE, 'info');
      if (onEmpty) {
        onEmpty();
      }
      return;
    }

    const startedAt = Date.now();
    const resolvedEnhanceSettings = await resolvePrintEnhanceSettings(
      printEnhanceMode,
      printEnhanceClearPrintStrength,
    );
    Logger.info(scope, 'export_pdf_start', {
      total: safeDueToday,
      printEnhanceMode: resolvedEnhanceSettings.mode,
      printEnhanceClearPrintStrength: resolvedEnhanceSettings.clearPrintStrength,
      printEnhanceSettingsSource: resolvedEnhanceSettings.source,
    });

    if (isMountedRef.current) {
      setIsExporting(true);
      setExportStage('preparing');
      setProgress({
        phase: 'preparing',
        current: 0,
        total: safeDueToday,
        elapsedSeconds: 0,
        message: GENERATING_MESSAGE,
      });
    }

    clearTimer();
    timerRef.current = setInterval(() => {
      if (!isMountedRef.current) {
        return;
      }
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setProgress((prev) => ({
        ...prev,
        elapsedSeconds,
      }));
    }, 1000);

    try {
      const result = await TodayWorksheetExportService.exportTodayWorksheet({
        expectedPendingCount: safeDueToday,
        printEnhanceMode: resolvedEnhanceSettings.mode,
        printEnhanceClearPrintStrength: resolvedEnhanceSettings.clearPrintStrength,
        onProgress: (next) => {
          const elapsedMs = Math.max(0, Date.now() - startedAt);
          const total = toSafeCount(next.total ?? next.pendingCount ?? safeDueToday);
          const currentRaw = toSafeCount(next.current);
          const current = total > 0 ? Math.min(total, currentRaw) : currentRaw;

          Logger.info(scope, 'export_pdf_progress', {
            phase: next.stage,
            current,
            total,
            elapsedMs,
          });

          if (!isMountedRef.current) {
            return;
          }
          setExportStage(next.stage);
          setProgress({
            phase: toProgressPhase(next.stage),
            current,
            total,
            elapsedSeconds: Math.floor(elapsedMs / 1000),
            message: next.message || GENERATING_MESSAGE,
          });
        },
      });

      const durationMs = Math.max(0, Date.now() - startedAt);
      if (result.outcome === 'success') {
        const pdfUri = typeof result.fileUri === 'string' ? result.fileUri.trim() : '';
        if (!pdfUri) {
          Logger.warn(scope, 'export_pdf_failed', {
            errorName: 'EmptyPdfUri',
            errorMessage: 'Worksheet export succeeded but fileUri is empty.',
            durationMs,
            current: progressRef.current.current,
            total: progressRef.current.total,
          });
          showToast('导出成功但未找到 PDF 文件，请重试', 'error', longToastDurationMs);
          return;
        }

        Logger.info(scope, 'export_pdf_success', {
          total: result.exportedCount,
          durationMs,
          filePath: pdfUri,
        });
        if (isMountedRef.current) {
          setProgress((prev) => ({
            ...prev,
            phase: 'done',
            current: prev.total > 0 ? prev.total : prev.current,
          }));
        }
        onSuccess(pdfUri);
        return;
      }

      if (result.outcome === 'empty') {
        showToast(EMPTY_MESSAGE, 'info');
        if (onEmpty) {
          onEmpty();
        }
        return;
      }

      if (result.outcome === 'busy') {
        showToast(result.message, 'info', longToastDurationMs);
        return;
      }

      const failureType = result.outcome === 'share_unavailable' ? 'info' : 'error';
      Logger.warn(scope, 'export_pdf_failed', {
        errorName: result.outcome,
        errorMessage: result.message,
        durationMs,
        current: progressRef.current.current,
        total: progressRef.current.total,
      });
      showToast(result.message, failureType, longToastDurationMs);
    } catch (error) {
      const durationMs = Math.max(0, Date.now() - startedAt);
      const errorInfo = toErrorInfo(error);
      Logger.error(scope, 'export_pdf_failed', {
        errorName: errorInfo.name,
        errorMessage: errorInfo.message,
        durationMs,
        current: progressRef.current.current,
        total: progressRef.current.total,
        error,
      });
      showToast(GENERIC_FAILED_MESSAGE, 'error', longToastDurationMs);
      if (isMountedRef.current) {
        setProgress((prev) => ({
          ...prev,
          phase: 'error',
        }));
      }
    } finally {
      clearTimer();
      if (isMountedRef.current) {
        setIsExporting(false);
        setExportStage(null);
        setProgress(INITIAL_PROGRESS);
      }
    }
  }, [
    clearTimer,
    dueToday,
    isExporting,
    longToastDurationMs,
    onEmpty,
    onSuccess,
    printEnhanceClearPrintStrength,
    printEnhanceMode,
    scope,
    showToast,
  ]);

  return {
    isExporting,
    exportStage,
    progress,
    progressPercent,
    exportTodayWorksheet,
  };
}
