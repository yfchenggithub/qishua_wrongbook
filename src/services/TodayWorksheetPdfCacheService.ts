import { Directory, File, Paths } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';
import { parseLocalDateTime, toDateOnlyString } from '@/src/utils/date';
import type { PrintEnhanceMode } from '@/src/utils/image/printEnhanceConfig';
import { toActivePrintEnhanceMode } from '@/src/utils/image/printEnhanceConfig';

const SERVICE_SCOPE = 'TodayWorksheetPdfCacheService';
const EXPORT_DIR_NAME = 'qishua_wrongbook';
const EXPORT_SUB_DIR_NAME = 'exports';
const CACHE_FILE_PREFIX = 'qishua_today_review_cache';
const PDF_FILE_PREFIX = 'qishua_today_review';
const CACHE_VERSION = 2;
const RECENT_EXPORT_PROTECTION_MS = 10 * 60 * 1000;
const CACHE_MODES: PrintEnhanceMode[] = ['original', 'clear_print'];
const WORKSHEET_PDF_FILE_PATTERN = new RegExp(
  `^${PDF_FILE_PREFIX}_\\d{4}-\\d{2}-\\d{2}(?:_part\\d+-of-\\d+)?_\\d+\\.pdf$`,
  'i',
);
const WORKSHEET_CACHE_FILE_PATTERN = new RegExp(
  `^${CACHE_FILE_PREFIX}_\\d{4}-\\d{2}-\\d{2}(?:_(?:original|clear_print|bw_scan))?\\.json$`,
  'i',
);

export type TodayWorksheetPdfCache = {
  version: typeof CACHE_VERSION;
  date: string;
  printEnhanceMode: PrintEnhanceMode;
  generatedAt: string;
  fileUri: string;
  fileUris: string[];
  pdfPageCounts: number[];
  exportedCount: number;
  pdfPartCount: number;
};

export type SaveTodayWorksheetPdfCacheInput = {
  date?: string;
  printEnhanceMode: PrintEnhanceMode;
  fileUris: string[];
  pdfPageCounts: number[];
  exportedCount: number;
};

export type HistoricalWorksheetPdfCleanupCandidate = {
  uri: string;
  fileName: string;
  kind: 'pdf' | 'cache_index';
  sizeBytes: number;
};

export type HistoricalWorksheetPdfScanResult = {
  candidates: HistoricalWorksheetPdfCleanupCandidate[];
  candidatePdfCount: number;
  candidateIndexCount: number;
  candidateBytes: number;
  protectedFileCount: number;
  scannedFileCount: number;
  unreadableFileCount: number;
  scannedAt: number;
};

export type HistoricalWorksheetPdfCleanupResult = {
  requestedCount: number;
  eligibleCount: number;
  deletedCount: number;
  failedCount: number;
  skippedCount: number;
  releasedBytes: number;
};

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toSafeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function resolveDateString(date?: string): string {
  const normalized = normalizeOptionalText(date);
  const parsed = parseLocalDateTime(normalized);
  return toDateOnlyString(parsed ?? new Date());
}

function getExportDirectory(): Directory {
  return new Directory(Paths.document, EXPORT_DIR_NAME, EXPORT_SUB_DIR_NAME);
}

function getCacheFile(dateString: string, printEnhanceMode: PrintEnhanceMode): File {
  const activeMode = toActivePrintEnhanceMode(printEnhanceMode);
  return new File(
    getExportDirectory(),
    `${CACHE_FILE_PREFIX}_${dateString}_${activeMode}.json`,
  );
}

function isUsablePdfFile(uri: string): boolean {
  try {
    const info = new File(uri).info();
    return info.exists && typeof info.size === 'number' && info.size > 0;
  } catch {
    return false;
  }
}

function normalizeCache(
  input: unknown,
  expectedDate: string,
  expectedPrintEnhanceMode: PrintEnhanceMode,
): TodayWorksheetPdfCache | null {
  const raw = input as Partial<TodayWorksheetPdfCache> | null | undefined;
  const activeMode = toActivePrintEnhanceMode(expectedPrintEnhanceMode);
  if (
    raw?.version !== CACHE_VERSION
    || raw.date !== expectedDate
    || raw.printEnhanceMode !== activeMode
  ) {
    return null;
  }

  const fileUris = Array.isArray(raw.fileUris)
    ? raw.fileUris
      .map(normalizeOptionalText)
      .filter((uri): uri is string => uri !== null)
    : [];
  const pdfPageCounts = Array.isArray(raw.pdfPageCounts)
    ? raw.pdfPageCounts.map(toSafeCount)
    : [];
  const generatedAt = normalizeOptionalText(raw.generatedAt);
  const exportedCount = toSafeCount(raw.exportedCount);
  if (
    fileUris.length <= 0
    || pdfPageCounts.length !== fileUris.length
    || toSafeCount(raw.pdfPartCount) !== fileUris.length
    || exportedCount <= 0
    || !generatedAt
    || Number.isNaN(new Date(generatedAt).getTime())
    || fileUris.some((uri) => !isUsablePdfFile(uri))
  ) {
    return null;
  }

  return {
    version: CACHE_VERSION,
    date: expectedDate,
    printEnhanceMode: activeMode,
    generatedAt,
    fileUri: fileUris[0],
    fileUris,
    pdfPageCounts,
    exportedCount,
    pdfPartCount: fileUris.length,
  };
}

export async function loadTodayWorksheetPdfCache(
  printEnhanceMode: PrintEnhanceMode,
  date?: string,
): Promise<TodayWorksheetPdfCache | null> {
  const dateString = resolveDateString(date);
  const activeMode = toActivePrintEnhanceMode(printEnhanceMode);
  try {
    const cacheFile = getCacheFile(dateString, activeMode);
    if (!cacheFile.exists) {
      return null;
    }
    const cache = normalizeCache(
      JSON.parse(await cacheFile.text()) as unknown,
      dateString,
      activeMode,
    );
    if (!cache) {
      Logger.warn(SERVICE_SCOPE, 'Ignore invalid or incomplete worksheet PDF cache.', {
        date: dateString,
        printEnhanceMode: activeMode,
      });
    }
    return cache;
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load worksheet PDF cache.', {
      date: dateString,
      printEnhanceMode: activeMode,
      error,
    });
    return null;
  }
}

function normalizeFileUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }
  const normalized = uri.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.length > 0 ? normalized : null;
}

function isFileInsideExportDirectory(file: File): boolean {
  const fileUri = normalizeFileUri(file.uri);
  const directoryUri = normalizeFileUri(getExportDirectory().uri);
  if (!fileUri || !directoryUri) {
    return false;
  }
  return fileUri.startsWith(`${directoryUri}/`);
}

function getManagedExportFileKind(fileName: string): 'pdf' | 'cache_index' | null {
  if (WORKSHEET_PDF_FILE_PATTERN.test(fileName)) {
    return 'pdf';
  }
  if (WORKSHEET_CACHE_FILE_PATTERN.test(fileName)) {
    return 'cache_index';
  }
  return null;
}

function isRecentlyWrittenFile(
  creationTime: number | null | undefined,
  modificationTime: number | null | undefined,
  now: number,
): boolean {
  const timestamps = [creationTime, modificationTime]
    .filter((value): value is number => (
      typeof value === 'number' && Number.isFinite(value) && value > 0
    ));
  if (timestamps.length <= 0) {
    return false;
  }
  return Math.max(...timestamps) >= now - RECENT_EXPORT_PROTECTION_MS;
}

export async function scanHistoricalWorksheetPdfFiles(): Promise<HistoricalWorksheetPdfScanResult> {
  const startedAt = Date.now();
  const currentDate = resolveDateString();
  Logger.info(SERVICE_SCOPE, 'Start scanning historical worksheet PDF files.', {
    currentDate,
  });

  try {
    const exportDirectory = getExportDirectory();
    if (!exportDirectory.exists) {
      return {
        candidates: [],
        candidatePdfCount: 0,
        candidateIndexCount: 0,
        candidateBytes: 0,
        protectedFileCount: 0,
        scannedFileCount: 0,
        unreadableFileCount: 0,
        scannedAt: Date.now(),
      };
    }

    const currentCaches = await Promise.all(
      CACHE_MODES.map((mode) => loadTodayWorksheetPdfCache(mode, currentDate)),
    );
    const protectedUris = new Set<string>();
    for (const mode of CACHE_MODES) {
      const currentCacheFileUri = normalizeFileUri(getCacheFile(currentDate, mode).uri);
      if (currentCacheFileUri) {
        protectedUris.add(currentCacheFileUri);
      }
    }
    for (const currentCache of currentCaches) {
      for (const fileUri of currentCache?.fileUris ?? []) {
        const normalizedUri = normalizeFileUri(fileUri);
        if (normalizedUri) {
          protectedUris.add(normalizedUri);
        }
      }
    }

    const candidates: HistoricalWorksheetPdfCleanupCandidate[] = [];
    let protectedFileCount = 0;
    let scannedFileCount = 0;
    let unreadableFileCount = 0;

    for (const entry of exportDirectory.list()) {
      if (!(entry instanceof File)) {
        continue;
      }
      scannedFileCount += 1;

      const kind = getManagedExportFileKind(entry.name);
      if (!kind || !isFileInsideExportDirectory(entry)) {
        continue;
      }

      try {
        const info = entry.info();
        if (!info.exists) {
          continue;
        }
        const normalizedUri = normalizeFileUri(entry.uri);
        if (
          !normalizedUri
          || protectedUris.has(normalizedUri)
          || isRecentlyWrittenFile(info.creationTime, info.modificationTime, startedAt)
        ) {
          protectedFileCount += 1;
          continue;
        }

        candidates.push({
          uri: entry.uri,
          fileName: entry.name,
          kind,
          sizeBytes:
            typeof info.size === 'number' && Number.isFinite(info.size) && info.size > 0
              ? info.size
              : 0,
        });
      } catch (error) {
        unreadableFileCount += 1;
        Logger.warn(SERVICE_SCOPE, 'Failed to inspect worksheet export file.', {
          fileName: entry.name,
          error,
        });
      }
    }

    candidates.sort((left, right) => left.fileName.localeCompare(right.fileName));
    const result: HistoricalWorksheetPdfScanResult = {
      candidates,
      candidatePdfCount: candidates.filter((candidate) => candidate.kind === 'pdf').length,
      candidateIndexCount: candidates.filter((candidate) => candidate.kind === 'cache_index').length,
      candidateBytes: candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0),
      protectedFileCount,
      scannedFileCount,
      unreadableFileCount,
      scannedAt: Date.now(),
    };

    Logger.info(SERVICE_SCOPE, 'Finished scanning historical worksheet PDF files.', {
      elapsedMs: Date.now() - startedAt,
      candidatePdfCount: result.candidatePdfCount,
      candidateIndexCount: result.candidateIndexCount,
      candidateBytes: result.candidateBytes,
      protectedFileCount: result.protectedFileCount,
      scannedFileCount: result.scannedFileCount,
      unreadableFileCount: result.unreadableFileCount,
    });
    return result;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to scan historical worksheet PDF files.', {
      elapsedMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

export async function cleanupHistoricalWorksheetPdfFiles(
  requestedUris: string[],
): Promise<HistoricalWorksheetPdfCleanupResult> {
  const startedAt = Date.now();
  const requestedSet = new Set(
    requestedUris
      .map(normalizeFileUri)
      .filter((uri): uri is string => uri !== null),
  );
  Logger.info(SERVICE_SCOPE, 'Start cleaning historical worksheet PDF files.', {
    requestedCount: requestedSet.size,
  });

  const latestScan = await scanHistoricalWorksheetPdfFiles();
  const eligibleCandidates = latestScan.candidates.filter((candidate) => {
    const normalizedUri = normalizeFileUri(candidate.uri);
    return normalizedUri ? requestedSet.has(normalizedUri) : false;
  });
  let deletedCount = 0;
  let failedCount = 0;
  let releasedBytes = 0;

  for (const candidate of eligibleCandidates) {
    try {
      const file = new File(candidate.uri);
      if (!isFileInsideExportDirectory(file) || !getManagedExportFileKind(file.name)) {
        failedCount += 1;
        Logger.warn(SERVICE_SCOPE, 'Rejected unsafe historical PDF cleanup target.', {
          fileName: candidate.fileName,
        });
        continue;
      }
      if (!file.exists) {
        continue;
      }
      file.delete();
      deletedCount += 1;
      releasedBytes += candidate.sizeBytes;
    } catch (error) {
      failedCount += 1;
      Logger.warn(SERVICE_SCOPE, 'Failed to delete historical worksheet export file.', {
        fileName: candidate.fileName,
        error,
      });
    }
  }

  const result: HistoricalWorksheetPdfCleanupResult = {
    requestedCount: requestedSet.size,
    eligibleCount: eligibleCandidates.length,
    deletedCount,
    failedCount,
    skippedCount: Math.max(0, requestedSet.size - eligibleCandidates.length),
    releasedBytes,
  };
  Logger.info(SERVICE_SCOPE, 'Finished cleaning historical worksheet PDF files.', {
    elapsedMs: Date.now() - startedAt,
    ...result,
  });
  return result;
}

function cleanupReplacedFiles(
  previousCache: TodayWorksheetPdfCache | null,
  currentFileUris: string[],
): void {
  if (!previousCache) {
    return;
  }
  const currentUriSet = new Set(currentFileUris);
  for (const previousUri of previousCache.fileUris) {
    if (currentUriSet.has(previousUri)) {
      continue;
    }
    try {
      const previousFile = new File(previousUri);
      if (previousFile.exists) {
        previousFile.delete();
      }
    } catch (error) {
      Logger.warn(SERVICE_SCOPE, 'Failed to remove a replaced cached worksheet PDF.', {
        error,
      });
    }
  }
}

export async function saveTodayWorksheetPdfCache(
  input: SaveTodayWorksheetPdfCacheInput,
): Promise<TodayWorksheetPdfCache> {
  const dateString = resolveDateString(input.date);
  const activeMode = toActivePrintEnhanceMode(input.printEnhanceMode);
  const fileUris = input.fileUris
    .map(normalizeOptionalText)
    .filter((uri): uri is string => uri !== null);
  const pdfPageCounts = input.pdfPageCounts.map(toSafeCount);
  if (
    fileUris.length <= 0
    || pdfPageCounts.length !== fileUris.length
    || fileUris.some((uri) => !isUsablePdfFile(uri))
  ) {
    throw new Error('Cannot cache an incomplete worksheet PDF set.');
  }

  const previousCache = await loadTodayWorksheetPdfCache(activeMode, dateString);
  const nextCache: TodayWorksheetPdfCache = {
    version: CACHE_VERSION,
    date: dateString,
    printEnhanceMode: activeMode,
    generatedAt: new Date().toISOString(),
    fileUri: fileUris[0],
    fileUris,
    pdfPageCounts,
    exportedCount: toSafeCount(input.exportedCount),
    pdfPartCount: fileUris.length,
  };

  const exportDirectory = getExportDirectory();
  exportDirectory.create({ intermediates: true, idempotent: true });
  getCacheFile(dateString, activeMode).write(JSON.stringify(nextCache));
  cleanupReplacedFiles(previousCache, fileUris);
  return nextCache;
}
