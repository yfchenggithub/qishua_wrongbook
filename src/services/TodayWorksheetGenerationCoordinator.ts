import { AppState, type AppStateStatus } from 'react-native';

import * as ExportImageModeService from '@/src/services/ExportImageModeService';
import { Logger } from '@/src/services/Logger';
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

const SERVICE_SCOPE = 'TodayWorksheetGenerationCoordinator';
const PREPARATION_FAILED_MESSAGE = '今日练习卷自动准备失败，系统稍后会重试';

export type TodayWorksheetGenerationStatus =
  | 'idle'
  | 'checking_cache'
  | 'generating'
  | 'refreshing'
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

export type RegenerateTodayWorksheetOptions = EnsureTodayWorksheetOptions;

export type TodayWorksheetPreparationInspection = {
  outcome: 'cached' | 'pending' | 'empty';
  pendingCount: number;
  cachedWorksheet: TodayWorksheetCachedExport | null;
  generationActive: boolean;
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
let activeGenerationOperation: 'prepare' | 'regenerate' | null = null;
let latestCacheInspectionId = 0;
let generationActiveElapsedMs = 0;
let generationActiveSegmentStartedAt: number | null = null;
let generationClockSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
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

function settleGenerationActiveSegment(now: number = Date.now()): void {
  if (generationActiveSegmentStartedAt === null) {
    return;
  }
  generationActiveElapsedMs += Math.max(0, now - generationActiveSegmentStartedAt);
  generationActiveSegmentStartedAt = null;
}

function handleGenerationAppStateChange(nextState: AppStateStatus): void {
  const now = Date.now();
  if (nextState === 'active') {
    if (generationActiveSegmentStartedAt === null) {
      generationActiveSegmentStartedAt = now;
    }
    return;
  }
  settleGenerationActiveSegment(now);
}

function startGenerationActiveClock(): void {
  generationClockSubscription?.remove();
  generationActiveElapsedMs = 0;
  generationActiveSegmentStartedAt = AppState.currentState === 'active' ? Date.now() : null;
  generationClockSubscription = AppState.addEventListener(
    'change',
    handleGenerationAppStateChange,
  );
}

function stopGenerationActiveClock(): void {
  settleGenerationActiveSegment();
  generationClockSubscription?.remove();
  generationClockSubscription = null;
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
    if (!cachedWorksheet) {
      const cacheMissingResult: TodayWorksheetExportResult = {
        outcome: 'failed',
        message: '练习卷缓存校验失败，系统会自动重试',
        exportedCount: toSafeCount(result.exportedCount),
      };
      updateState({
        status: 'error',
        stage: null,
        current: 0,
        total: expectedPendingCount,
        message: cacheMissingResult.message,
        startedAt: null,
        source: null,
        cachedWorksheet: null,
      });
      return cacheMissingResult;
    }
    const completedCount = Math.max(1, toSafeCount(result.exportedCount));
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

async function runRegenerateTodayWorksheet(
  options: RegenerateTodayWorksheetOptions,
): Promise<TodayWorksheetExportResult> {
  const startedAt = Date.now();
  const settings = await resolvePrintEnhanceSettings(options);
  const previousCachedWorksheet =
    await TodayWorksheetExportService.getCachedTodayWorksheet(settings.mode);
  const expectedPendingCount = toSafeCount(options.expectedPendingCount);
  const progressTotal = expectedPendingCount > 0
    ? expectedPendingCount
    : toSafeCount(previousCachedWorksheet?.exportedCount);

  Logger.info(SERVICE_SCOPE, 'Start forced worksheet regeneration.', {
    expectedPendingCount,
    previousCachedCount: previousCachedWorksheet?.exportedCount ?? 0,
    printEnhanceMode: settings.mode,
  });
  updateState({
    status: 'refreshing',
    stage: 'preparing',
    current: 0,
    total: progressTotal,
    message: '正在重新生成今日练习卷...',
    startedAt,
    source: previousCachedWorksheet ? 'cache' : null,
    cachedWorksheet: previousCachedWorksheet,
  });

  const result = await TodayWorksheetExportService.exportTodayWorksheet({
    expectedPendingCount,
    forceRegenerate: true,
    printEnhanceMode: settings.mode,
    printEnhanceClearPrintStrength: settings.clearPrintStrength,
    printEnhanceConcurrency: settings.concurrency,
    printEnhancePerformanceProfile: settings.performanceProfile,
    onProgress: (progress) => {
      updateState({
        status: 'refreshing',
        stage: progress.stage,
        current: toSafeCount(progress.current),
        total: toSafeCount(progress.total ?? progress.pendingCount ?? progressTotal),
        message: progress.message,
        startedAt,
        source: previousCachedWorksheet ? 'cache' : null,
        cachedWorksheet: previousCachedWorksheet,
      });
    },
  });

  if (result.outcome === 'success') {
    const refreshedCache = await TodayWorksheetExportService.getCachedTodayWorksheet(settings.mode);
    if (refreshedCache) {
      const completedCount = Math.max(1, toSafeCount(refreshedCache.exportedCount));
      updateState({
        status: 'ready',
        stage: null,
        current: completedCount,
        total: completedCount,
        message: `今日练习卷已更新（${refreshedCache.exportedCount}题）`,
        startedAt: null,
        source: 'generated',
        cachedWorksheet: refreshedCache,
      });
      Logger.info(SERVICE_SCOPE, 'Forced worksheet regeneration completed.', {
        exportedCount: refreshedCache.exportedCount,
        pdfPartCount: refreshedCache.pdfPartCount,
        printEnhanceMode: settings.mode,
      });
      return result;
    }
  }

  const settledResult: TodayWorksheetExportResult = result.outcome === 'success'
    ? {
        outcome: 'failed',
        message: '重新生成完成但新缓存校验失败',
        exportedCount: toSafeCount(result.exportedCount),
      }
    : result;
  const failureMessage = settledResult.outcome === 'empty'
    ? '当前没有待复做题，已保留原练习卷'
    : '重新生成失败，原练习卷仍可使用';
  if (previousCachedWorksheet) {
    const previousCount = Math.max(1, toSafeCount(previousCachedWorksheet.exportedCount));
    updateState({
      status: 'ready',
      stage: null,
      current: previousCount,
      total: previousCount,
      message: failureMessage,
      startedAt: null,
      source: 'cache',
      cachedWorksheet: previousCachedWorksheet,
    });
  } else {
    updateState({
      status: settledResult.outcome === 'empty' ? 'empty' : 'error',
      stage: null,
      current: 0,
      total: progressTotal,
      message: settledResult.outcome === 'empty' ? settledResult.message : failureMessage,
      startedAt: null,
      source: null,
      cachedWorksheet: null,
    });
  }
  Logger.warn(SERVICE_SCOPE, 'Forced worksheet regeneration did not replace the cache.', {
    outcome: settledResult.outcome,
    previousCacheRetained: previousCachedWorksheet !== null,
    printEnhanceMode: settings.mode,
  });
  return settledResult;
}

export function getTodayWorksheetGenerationState(): TodayWorksheetGenerationState {
  return state;
}

export function getTodayWorksheetGenerationActiveElapsedMs(): number {
  const currentSegmentMs = generationActiveSegmentStartedAt === null
    ? 0
    : Math.max(0, Date.now() - generationActiveSegmentStartedAt);
  return Math.max(0, generationActiveElapsedMs + currentSegmentMs);
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

export async function getCachedTodayWorksheetForOpening(
  options: Pick<EnsureTodayWorksheetOptions, 'printEnhanceMode'> = {},
): Promise<TodayWorksheetCachedExport | null> {
  const settings = await resolvePrintEnhanceSettings(options);
  return TodayWorksheetExportService.getCachedTodayWorksheet(settings.mode);
}

export async function inspectTodayWorksheetPreparation(
  options: Pick<EnsureTodayWorksheetOptions, 'printEnhanceMode'> = {},
): Promise<TodayWorksheetPreparationInspection> {
  const settings = await resolvePrintEnhanceSettings(options);
  const [cachedWorksheet, pendingCount] = await Promise.all([
    TodayWorksheetExportService.getCachedTodayWorksheet(settings.mode),
    TodayWorksheetExportService.getTodayWorksheetPendingCount(),
  ]);
  return {
    outcome: cachedWorksheet ? 'cached' : pendingCount > 0 ? 'pending' : 'empty',
    pendingCount: toSafeCount(pendingCount),
    cachedWorksheet,
    generationActive: activeGenerationPromise !== null,
  };
}

export function ensureTodayWorksheet(
  options: EnsureTodayWorksheetOptions = {},
): Promise<TodayWorksheetExportResult> {
  if (activeGenerationPromise) {
    return activeGenerationPromise;
  }

  activeGenerationOperation = 'prepare';
  startGenerationActiveClock();
  activeGenerationPromise = runEnsureTodayWorksheet(options)
    .catch((error): TodayWorksheetExportResult => {
      const expectedPendingCount = toSafeCount(options.expectedPendingCount);
      Logger.error(SERVICE_SCOPE, 'Unexpected worksheet preparation failure.', {
        expectedPendingCount,
        error,
      });
      updateState({
        status: 'error',
        stage: null,
        current: 0,
        total: expectedPendingCount,
        message: PREPARATION_FAILED_MESSAGE,
        startedAt: null,
        source: null,
        cachedWorksheet: null,
      });
      return {
        outcome: 'failed',
        message: PREPARATION_FAILED_MESSAGE,
        exportedCount: expectedPendingCount,
      };
    })
    .finally(() => {
      stopGenerationActiveClock();
      activeGenerationPromise = null;
      activeGenerationOperation = null;
    });
  return activeGenerationPromise;
}

export function regenerateTodayWorksheet(
  options: RegenerateTodayWorksheetOptions = {},
): Promise<TodayWorksheetExportResult> {
  if (activeGenerationPromise) {
    return Promise.resolve({
      outcome: 'busy',
      message: activeGenerationOperation === 'regenerate'
        ? '今日练习卷正在重新生成'
        : '今日练习卷正在自动准备',
      exportedCount: toSafeCount(state.cachedWorksheet?.exportedCount),
      fromCache: state.cachedWorksheet !== null,
    });
  }

  activeGenerationOperation = 'regenerate';
  startGenerationActiveClock();
  activeGenerationPromise = runRegenerateTodayWorksheet(options)
    .catch((error): TodayWorksheetExportResult => {
      const cachedWorksheet = state.cachedWorksheet;
      const cachedCount = Math.max(1, toSafeCount(cachedWorksheet?.exportedCount));
      Logger.error(SERVICE_SCOPE, 'Unexpected forced worksheet regeneration failure.', {
        previousCacheRetained: cachedWorksheet !== null,
        error,
      });
      if (cachedWorksheet) {
        updateState({
          status: 'ready',
          stage: null,
          current: cachedCount,
          total: cachedCount,
          message: '重新生成失败，原练习卷仍可使用',
          startedAt: null,
          source: 'cache',
          cachedWorksheet,
        });
      } else {
        updateState({
          status: 'error',
          stage: null,
          current: 0,
          total: toSafeCount(options.expectedPendingCount),
          message: '重新生成失败，请稍后重试',
          startedAt: null,
          source: null,
          cachedWorksheet: null,
        });
      }
      return {
        outcome: 'failed',
        message: cachedWorksheet
          ? '重新生成失败，原练习卷仍可使用'
          : '重新生成失败，请稍后重试',
        exportedCount: toSafeCount(cachedWorksheet?.exportedCount),
        fromCache: cachedWorksheet !== null,
      };
    })
    .finally(() => {
      stopGenerationActiveClock();
      activeGenerationPromise = null;
      activeGenerationOperation = null;
    });
  return activeGenerationPromise;
}
