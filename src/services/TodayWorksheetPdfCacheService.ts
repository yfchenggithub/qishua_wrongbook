import { Directory, File, Paths } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';
import { parseLocalDateTime, toDateOnlyString } from '@/src/utils/date';

const SERVICE_SCOPE = 'TodayWorksheetPdfCacheService';
const EXPORT_DIR_NAME = 'qishua_wrongbook';
const EXPORT_SUB_DIR_NAME = 'exports';
const CACHE_FILE_PREFIX = 'qishua_today_review_cache';
const CACHE_VERSION = 1;

export type TodayWorksheetPdfCache = {
  version: typeof CACHE_VERSION;
  date: string;
  generatedAt: string;
  fileUri: string;
  fileUris: string[];
  pdfPageCounts: number[];
  exportedCount: number;
  pdfPartCount: number;
};

export type SaveTodayWorksheetPdfCacheInput = {
  date?: string;
  fileUris: string[];
  pdfPageCounts: number[];
  exportedCount: number;
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

function getCacheFile(dateString: string): File {
  return new File(getExportDirectory(), `${CACHE_FILE_PREFIX}_${dateString}.json`);
}

function isUsablePdfFile(uri: string): boolean {
  try {
    const info = new File(uri).info();
    return info.exists && typeof info.size === 'number' && info.size > 0;
  } catch {
    return false;
  }
}

function normalizeCache(input: unknown, expectedDate: string): TodayWorksheetPdfCache | null {
  const raw = input as Partial<TodayWorksheetPdfCache> | null | undefined;
  if (raw?.version !== CACHE_VERSION || raw.date !== expectedDate) {
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
    generatedAt,
    fileUri: fileUris[0],
    fileUris,
    pdfPageCounts,
    exportedCount,
    pdfPartCount: fileUris.length,
  };
}

export async function loadTodayWorksheetPdfCache(
  date?: string,
): Promise<TodayWorksheetPdfCache | null> {
  const dateString = resolveDateString(date);
  try {
    const cacheFile = getCacheFile(dateString);
    if (!cacheFile.exists) {
      return null;
    }
    const cache = normalizeCache(JSON.parse(await cacheFile.text()) as unknown, dateString);
    if (!cache) {
      Logger.warn(SERVICE_SCOPE, 'Ignore invalid or incomplete worksheet PDF cache.', {
        date: dateString,
      });
    }
    return cache;
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load worksheet PDF cache.', {
      date: dateString,
      error,
    });
    return null;
  }
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

  const previousCache = await loadTodayWorksheetPdfCache(dateString);
  const nextCache: TodayWorksheetPdfCache = {
    version: CACHE_VERSION,
    date: dateString,
    generatedAt: new Date().toISOString(),
    fileUri: fileUris[0],
    fileUris,
    pdfPageCounts,
    exportedCount: toSafeCount(input.exportedCount),
    pdfPartCount: fileUris.length,
  };

  const exportDirectory = getExportDirectory();
  exportDirectory.create({ intermediates: true, idempotent: true });
  getCacheFile(dateString).write(JSON.stringify(nextCache));
  cleanupReplacedFiles(previousCache, fileUris);
  return nextCache;
}
