import * as ExportImageModeService from '@/src/services/ExportImageModeService';
import { Logger } from '@/src/services/Logger';
import { prepareCachedTodayReviewPdfZip } from '@/src/services/TodayReviewPdfBundleService';
import type {
  ExportTodayWorksheetOptions,
  TodayWorksheetCachedExport,
  TodayWorksheetExportResult,
  TodayWorksheetExportStage,
} from '@/src/services/TodayWorksheetExportService';
import * as TodayWorksheetExportService from '@/src/services/TodayWorksheetExportService';
import type {
  PrintEnhanceClearPrintStrength,
  PrintEnhanceConcurrency,
  PrintEnhanceMode,
  PrintEnhancePerformanceProfile,
} from '@/src/utils/image/printEnhanceConfig';
import {
  toActivePrintEnhanceConcurrency,
  toActivePrintEnhancePerformanceProfile,
} from '@/src/utils/image/printEnhanceConfig';

const CACHE_PROGRESS_VISIBLE_MS = 240;
const SERVICE_SCOPE = 'TodayWorksheetGenerationCoordinator';

export type TodayWorksheetGenerationStatus =
  | 'idle'
  | 'checking_cache'
  | 'generating'
  | 'ready'
  | 'empty'
  | 'error';

export type TodayWorksheetGenerationSource = 'cache' | 'generated' | null;

export type TodayWorksheetGenerationState = {
  status: TodayWorksheetGenerationStatus;
  stage: TodayWorksheetExportStage | null;
  current: number;
  total: number;
  message: string;
  startedAt: number | null;
  source: TodayWorksheetGenerationSource;
  cachedWorksheet: TodayWorksheetCachedExport | null;
};

export type EnsureTodayWorksheetOptions = {
  expectedPendingCount?: number;
  printEnhanceMode?: PrintEnhanceMode;
  printEnhanceClearPrintStrength?: PrintEnhanceClearPrintStrength;
  printEnhanceConcurrency?: PrintEnhanceConcurrency;
  printEnhancePerformanceProfile?: PrintEnhancePerformanceProfile;
};

type ResolvedPrintEnhanceSettings = {
  mode: PrintEnhanceMode;
  clearPrintStrength: PrintEnhanceClearPrintStrength;
  concurrency: PrintEnhanceConcurrency;
  performanceProfile: PrintEnhancePerformanceProfile;
};

const INITIAL_STATE: TodayWorksheetGenerationState = {
  status: 'idle',
  stage: null,
  current: 0,
  total: 0,
  message: '今日练习卷尚未生成',
  startedAt: null,
  source: null,
  cachedWorksheet: null,
};

let state: TodayWorksheetGenerationState = INITIAL_STATE;
let activeGenerationPromise: Promise<TodayWorksheetExportResult> | null = null;
let latestCacheInspectionId = 0;
const listeners = new Set<() => void>();

function toSafeCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function updateState(next: TodayWorksheetGenerationState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function buildCachedResult(cached: TodayWorksheetCachedExport): TodayWorksheetExportResult {
  return {
    outcome: 'success',
    message: '今日练习卷缓存读取完成',
    exportedCount: cached.exportedCount,
    fileUri: cached.fileUri,
    fileUris: cached.fileUris,
    pdfPageCounts: cached.pdfPageCounts,
    pdfPartCount: cached.pdfPartCount,
    fromCache: true,
  };
}

async function prepareWholeSetShareCache(
  cached: TodayWorksheetCachedExport,
  startedAt: number,
  source: Exclude<TodayWorksheetGenerationSource, null>,
): Promise<void> {
  if (cached.fileUris.length <= 1) {
    return;
  }

  const completedCount = Math.max(1, toSafeCount(cached.exportedCount));
  updateState({
    status: source === 'cache' ? 'checking_cache' : 'generating',
    stage: 'saving',
    current: completedCount,
    total: completedCount,
    message: '正在缓存整套练习卷分享文件...',
    startedAt,
    source,
    cachedWorksheet: cached,
  });
  try {
    await prepareCachedTodayReviewPdfZip(cached.fileUris);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to prepare the complete worksheet share cache.', {
      pdfPartCount: cached.fileUris.length,
      error,
    });
  }
}

async function resolvePrintEnhanceSettings(
  options: EnsureTodayWorksheetOptions,
): Promise<ResolvedPrintEnhanceSettings> {
  const saved = await ExportImageModeService.loadExportImageSettings();
  return {
    mode: options.printEnhanceMode ?? saved.mode,
    clearPrintStrength:
      options.printEnhanceClearPrintStrength ?? saved.clearPrintStrength,
    concurrency: toActivePrintEnhanceConcurrency(
      options.printEnhanceConcurrency ?? saved.enhanceConcurrency,
    ),
    performanceProfile: toActivePrintEnhancePerformanceProfile(
      options.printEnhancePerformanceProfile ?? saved.performanceProfile,
    ),
  };
}

async function runEnsureTodayWorksheet(
  options: EnsureTodayWorksheetOptions,
): Promise<TodayWorksheetExportResult> {
  const startedAt = Date.now();
  const expectedPendingCount = toSafeCount(options.expectedPendingCount);
  updateState({
    status: 'checking_cache',
    stage: 'preparing',
    current: 0,
    total: expectedPendingCount,
    message: '正在检查今日练习卷缓存...',
    startedAt,
    source: null,
    cachedWorksheet: null,
  });

  const settings = await resolvePrintEnhanceSettings(options);
  const cached = await TodayWorksheetExportService.getCachedTodayWorksheet(settings.mode);
  if (cached) {
    const cachedCount = Math.max(1, toSafeCount(cached.exportedCount));
    updateState({
      status: 'checking_cache',
      stage: 'preparing',
      current: cachedCount,
      total: cachedCount,
      message: '正在读取今日练习卷缓存...',
      startedAt,
      source: 'cache',
      cachedWorksheet: cached,
    });
    await prepareWholeSetShareCache(cached, startedAt, 'cache');
    await delay(Math.max(0, CACHE_PROGRESS_VISIBLE_MS - (Date.now() - startedAt)));
    updateState({
      status: 'ready',
      stage: null,
      current: cachedCount,
      total: cachedCount,
      message: `今日练习卷已缓存（${cached.exportedCount}题）`,
      startedAt: null,
      source: 'cache',
      cachedWorksheet: cached,
    });
    return buildCachedResult(cached);
  }

  updateState({
    status: 'generating',
    stage: 'preparing',
    current: 0,
    total: expectedPendingCount,
    message: '正在生成今日练习卷...',
    startedAt,
    source: 'generated',
    cachedWorksheet: null,
  });

  const exportOptions: ExportTodayWorksheetOptions = {
    expectedPendingCount,
    printEnhanceMode: settings.mode,
    printEnhanceClearPrintStrength: settings.clearPrintStrength,
    printEnhanceConcurrency: settings.concurrency,
    printEnhancePerformanceProfile: settings.performanceProfile,
    onProgress: (progress) => {
      updateState({
        status: 'generating',
        stage: progress.stage,
        current: toSafeCount(progress.current),
        total: toSafeCount(progress.total ?? progress.pendingCount ?? expectedPendingCount),
        message: progress.message,
        startedAt,
        source: 'generated',
        cachedWorksheet: null,
      });
    },
  };
  const result = await TodayWorksheetExportService.exportTodayWorksheet(exportOptions);

  if (result.outcome === 'success') {
    const cachedWorksheet = await TodayWorksheetExportService.getCachedTodayWorksheet(settings.mode);
    const completedCount = Math.max(1, toSafeCount(result.exportedCount));
    if (cachedWorksheet) {
      await prepareWholeSetShareCache(cachedWorksheet, startedAt, 'generated');
    }
    updateState({
      status: 'ready',
      stage: null,
      current: completedCount,
      total: completedCount,
      message: `今日练习卷已生成（${result.exportedCount}题）`,
      startedAt: null,
      source: result.fromCache ? 'cache' : 'generated',
      cachedWorksheet,
    });
    return result;
  }

  if (result.outcome === 'empty') {
    updateState({
      status: 'empty',
      stage: null,
      current: 0,
      total: 0,
      message: result.message,
      startedAt: null,
      source: null,
      cachedWorksheet: null,
    });
    return result;
  }

  updateState({
    status: 'error',
    stage: null,
    current: 0,
    total: expectedPendingCount,
    message: result.message,
    startedAt: null,
    source: null,
    cachedWorksheet: null,
  });
  return result;
}

export function getTodayWorksheetGenerationState(): TodayWorksheetGenerationState {
  return state;
}

export function subscribeTodayWorksheetGeneration(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function inspectTodayWorksheetCache(
  options: Pick<EnsureTodayWorksheetOptions, 'printEnhanceMode'> = {},
): Promise<TodayWorksheetCachedExport | null> {
  const inspectionId = ++latestCacheInspectionId;
  const settings = await resolvePrintEnhanceSettings(options);
  if (activeGenerationPromise) {
    await activeGenerationPromise;
  }

  const cached = await TodayWorksheetExportService.getCachedTodayWorksheet(settings.mode);
  if (activeGenerationPromise || inspectionId !== latestCacheInspectionId) {
    return cached;
  }
  if (cached) {
    const count = Math.max(1, toSafeCount(cached.exportedCount));
    updateState({
      status: 'ready',
      stage: null,
      current: count,
      total: count,
      message: `今日练习卷已缓存（${cached.exportedCount}题）`,
      startedAt: null,
      source: 'cache',
      cachedWorksheet: cached,
    });
  } else {
    updateState(INITIAL_STATE);
  }
  return cached;
}

export function ensureTodayWorksheet(
  options: EnsureTodayWorksheetOptions = {},
): Promise<TodayWorksheetExportResult> {
  if (activeGenerationPromise) {
    return activeGenerationPromise;
  }

  activeGenerationPromise = runEnsureTodayWorksheet(options).finally(() => {
    activeGenerationPromise = null;
  });
  return activeGenerationPromise;
}
