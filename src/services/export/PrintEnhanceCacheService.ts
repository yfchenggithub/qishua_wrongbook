import { Directory, File, Paths } from 'expo-file-system';

import {
  cleanupPrintEnhancedTempFiles,
  enhanceImageForPdfPrint,
  type PrintEnhanceOutputFormat,
  type PrintEnhanceResult,
} from '@/src/services/export/PrintImageEnhancer';
import { Logger } from '@/src/services/Logger';
import {
  toActiveClearPrintStrength,
  toActivePrintEnhanceMode,
  toActivePrintEnhancePerformanceProfile,
  type PrintEnhanceClearPrintStrength,
  type PrintEnhanceMode,
  type PrintEnhancePerformanceProfile,
} from '@/src/utils/image/printEnhanceConfig';

const SERVICE_SCOPE = 'PrintEnhanceCacheService';
const CACHE_DIR_PARTS = ['qishua_wrongbook', 'export', 'print-enhanced-cache'] as const;
const CACHE_VERSION = 1;
const STALE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type PrintEnhanceCacheStatus =
  | 'bypass_original'
  | 'hit'
  | 'miss_created'
  | 'miss_passthrough'
  | 'miss_cache_write_failed';

export type CachedPrintEnhanceResult = PrintEnhanceResult & {
  cacheStatus: PrintEnhanceCacheStatus;
  shouldCleanupOutput: boolean;
};

export type PrintEnhanceCacheCleanupResult = {
  scannedCount: number;
  deletedCount: number;
  failedCount: number;
  retainedCount: number;
  releasedBytes: number;
};

type SourceSignature = {
  size: number | null;
  modificationTime: number | null;
};

function normalizeUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }
  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toShortUri(uri: string | null | undefined): string | null {
  const normalized = normalizeUri(uri);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 36)}...${normalized.slice(-24)}`;
}

function getCacheDirectory(): Directory {
  return new Directory(Paths.cache, ...CACHE_DIR_PARTS);
}

function ensureCacheDirectory(): Directory {
  const directory = getCacheDirectory();
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function inferOutputFormatFromUri(uri: string | null | undefined): PrintEnhanceOutputFormat | null {
  const normalized = normalizeUri(uri)?.toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.endsWith('.png')) {
    return 'png';
  }
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
    return 'jpeg';
  }
  return null;
}

function getExtensionByOutputFormat(format: PrintEnhanceOutputFormat): string {
  return format === 'png' ? 'png' : 'jpg';
}

function getPreferredOutputFormat(mode: Exclude<PrintEnhanceMode, 'original'>): PrintEnhanceOutputFormat {
  return mode === 'bw_scan' ? 'png' : 'jpeg';
}

function safeFileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

function readSourceSignature(uri: string): SourceSignature {
  try {
    const info = new File(uri).info();
    return {
      size: typeof info.size === 'number' && Number.isFinite(info.size) ? info.size : null,
      modificationTime:
        typeof info.modificationTime === 'number' && Number.isFinite(info.modificationTime)
          ? info.modificationTime
          : null,
    };
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to read source image signature for cache key.', {
      uriPreview: toShortUri(uri),
      error,
    });
    return {
      size: null,
      modificationTime: null,
    };
  }
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function buildCacheFile(params: {
  sourceUri: string;
  mode: Exclude<PrintEnhanceMode, 'original'>;
  clearPrintStrength: PrintEnhanceClearPrintStrength;
  performanceProfile: PrintEnhancePerformanceProfile;
  outputFormat: PrintEnhanceOutputFormat;
}): File {
  const signature = readSourceSignature(params.sourceUri);
  const cacheKey = [
    `v${CACHE_VERSION}`,
    params.mode,
    params.clearPrintStrength,
    params.performanceProfile,
    params.outputFormat,
    signature.size ?? 'unknown-size',
    signature.modificationTime ?? 'unknown-mtime',
    params.sourceUri,
  ].join('|');
  const extension = getExtensionByOutputFormat(params.outputFormat);
  const fileName = `${params.mode}_${params.clearPrintStrength}_${params.performanceProfile}_${hashString(cacheKey)}.${extension}`;
  return new File(ensureCacheDirectory(), fileName);
}

function safeCopyFile(sourceUri: string, targetFile: File): boolean {
  try {
    const sourceFile = new File(sourceUri);
    if (!sourceFile.exists) {
      return false;
    }
    if (targetFile.exists) {
      return true;
    }
    sourceFile.copy(targetFile);
    return targetFile.exists;
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to copy enhanced image into cache.', {
      sourceUriPreview: toShortUri(sourceUri),
      targetUriPreview: toShortUri(targetFile.uri),
      error,
    });
    return false;
  }
}

function listCacheFiles(): File[] {
  const directory = getCacheDirectory();
  if (!directory.exists) {
    return [];
  }

  const files: File[] = [];
  for (const entry of directory.list()) {
    if (entry instanceof File) {
      files.push(entry);
    }
  }
  return files;
}

function safeReadFileSize(file: File): number {
  try {
    const info = file.info();
    const size = typeof info.size === 'number' && Number.isFinite(info.size) ? info.size : 0;
    return Math.max(0, size);
  } catch {
    return 0;
  }
}

function safeReadFileModificationTime(file: File): number | null {
  try {
    const modificationTime = file.info().modificationTime;
    return typeof modificationTime === 'number' && Number.isFinite(modificationTime)
      ? modificationTime
      : null;
  } catch {
    return null;
  }
}

async function deletePrintEnhanceCacheFiles(
  files: File[],
  scannedCount: number,
  retainedCount: number,
  logEvent: string,
): Promise<PrintEnhanceCacheCleanupResult> {
  let deletedCount = 0;
  let failedCount = 0;
  let releasedBytes = 0;

  for (const file of files) {
    const size = safeReadFileSize(file);
    try {
      if (file.exists) {
        file.delete();
      }
      deletedCount += 1;
      releasedBytes += size;
    } catch (error) {
      failedCount += 1;
      Logger.warn(SERVICE_SCOPE, 'Failed to delete print enhance cache file.', {
        uriPreview: toShortUri(file.uri),
        error,
      });
    }
  }

  Logger.info(SERVICE_SCOPE, logEvent, {
    scannedCount,
    deletedCount,
    failedCount,
    retainedCount,
    releasedBytes,
  });

  return {
    scannedCount,
    deletedCount,
    failedCount,
    retainedCount,
    releasedBytes,
  };
}

export async function getCachedPrintEnhancedImageForPdf(
  sourceUriInput: string,
  modeInput?: PrintEnhanceMode,
  clearPrintStrengthInput?: PrintEnhanceClearPrintStrength,
  performanceProfileInput?: PrintEnhancePerformanceProfile,
): Promise<CachedPrintEnhanceResult> {
  const startedAt = Date.now();
  const sourceUri = normalizeUri(sourceUriInput);
  if (!sourceUri) {
    throw new Error('Image URI cannot be empty.');
  }

  const mode = toActivePrintEnhanceMode(modeInput);
  const clearPrintStrength = toActiveClearPrintStrength(clearPrintStrengthInput);
  const performanceProfile = toActivePrintEnhancePerformanceProfile(performanceProfileInput);

  if (mode === 'original') {
    const outputFormat = inferOutputFormatFromUri(sourceUri) ?? 'jpeg';
    return {
      success: true,
      outputUri: sourceUri,
      engine: 'original',
      outputFormat,
      usedFallback: false,
      durationMs: Math.max(0, Date.now() - startedAt),
      cacheStatus: 'bypass_original',
      shouldCleanupOutput: false,
    };
  }

  const preferredOutputFormat = getPreferredOutputFormat(mode);
  const cacheFile = buildCacheFile({
    sourceUri,
    mode,
    clearPrintStrength,
    performanceProfile,
    outputFormat: preferredOutputFormat,
  });

  if (cacheFile.exists) {
    Logger.info(SERVICE_SCOPE, 'print_enhance_cache_hit', {
      sourceUriPreview: toShortUri(sourceUri),
      cacheUriPreview: toShortUri(cacheFile.uri),
      mode,
      clearPrintStrength,
      performanceProfile,
    });
    return {
      success: true,
      outputUri: cacheFile.uri,
      engine: 'cache',
      outputFormat: preferredOutputFormat,
      usedFallback: false,
      durationMs: Math.max(0, Date.now() - startedAt),
      cacheStatus: 'hit',
      shouldCleanupOutput: false,
    };
  }

  const enhancedResult = await enhanceImageForPdfPrint(
    sourceUri,
    mode,
    clearPrintStrength,
    performanceProfile,
  );
  const enhancedUri = normalizeUri(enhancedResult.outputUri) ?? sourceUri;
  const enhancedIsTemporary = enhancedUri !== sourceUri;

  if (!enhancedResult.success || !enhancedIsTemporary || !safeFileExists(enhancedUri)) {
    return {
      ...enhancedResult,
      cacheStatus: 'miss_passthrough',
      shouldCleanupOutput: enhancedIsTemporary,
    };
  }

  const copied = safeCopyFile(enhancedUri, cacheFile);
  if (copied && cacheFile.exists) {
    cleanupPrintEnhancedTempFiles([enhancedUri]);
    Logger.info(SERVICE_SCOPE, 'print_enhance_cache_created', {
      sourceUriPreview: toShortUri(sourceUri),
      cacheUriPreview: toShortUri(cacheFile.uri),
      mode,
      clearPrintStrength,
      performanceProfile,
      engine: enhancedResult.engine,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    return {
      ...enhancedResult,
      outputUri: cacheFile.uri,
      cacheStatus: 'miss_created',
      shouldCleanupOutput: false,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  return {
    ...enhancedResult,
    cacheStatus: 'miss_cache_write_failed',
    shouldCleanupOutput: enhancedIsTemporary,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

export async function clearPrintEnhanceImageCache(): Promise<PrintEnhanceCacheCleanupResult> {
  const files = listCacheFiles();
  return deletePrintEnhanceCacheFiles(
    files,
    files.length,
    0,
    'print_enhance_cache_cleanup_finished',
  );
}

export async function cleanupStalePrintEnhanceImageCache(
  now: number = Date.now(),
): Promise<PrintEnhanceCacheCleanupResult> {
  const files = listCacheFiles();
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const staleBefore = safeNow - STALE_CACHE_MAX_AGE_MS;
  const staleFiles = files.filter((file) => {
    const modificationTime = safeReadFileModificationTime(file);
    return modificationTime !== null && modificationTime < staleBefore;
  });

  return deletePrintEnhanceCacheFiles(
    staleFiles,
    files.length,
    files.length - staleFiles.length,
    'print_enhance_stale_cache_cleanup_finished',
  );
}
