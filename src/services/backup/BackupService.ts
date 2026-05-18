import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { strFromU8, unzipSync } from 'fflate';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { withDatabaseTransaction } from '@/src/db';
import { DATABASE_VERSION } from '@/src/db/constants';
import type { Mistake } from '@/src/models/Mistake';
import type { MistakeImage } from '@/src/models/MistakeImage';
import type { ReviewRecord } from '@/src/models/ReviewRecord';
import { MistakeImageRepository, MistakeRepository, ReviewRecordRepository } from '@/src/repositories';
import { ensureMistakeImageDir } from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';
import {
  BACKUP_DATA_FILE_NAME,
  BACKUP_IMAGES_DIR_NAME,
  BACKUP_MANIFEST_FILE_NAME,
  createBackupManifest,
  validateBackupManifest,
} from '@/src/services/backup/BackupManifest';
import {
  BackupRestoreError,
  type BackupRestoreErrorCode,
  createNotImplementedBackupError,
  getBackupErrorUserMessage,
  normalizeBackupError,
} from '@/src/services/backup/BackupRestoreError';
import {
  ensureBackupImageRelativePath,
  FflateBackupZipAdapter,
  type BackupZipAdapter,
} from '@/src/services/backup/BackupZipAdapter';
import {
  BACKUP_FILE_EXTENSION,
  BACKUP_FILE_NAME_PREFIX,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupCounts,
  type BackupDataPayload,
  type BackupDevicePlatform,
  type BackupImageArchiveFile,
  type BackupManifest,
  type BackupMistakeImageRecord,
  type CreateBackupOptions,
  type CreateBackupServiceResult,
  type InspectBackupResult,
  type RestoreFromBackupOptions,
  type RestoreFromBackupResult,
} from '@/src/services/backup/BackupTypes';
import {
  appendError,
  appendWarning,
  buildRestoreError,
  createEmptyDurations,
  createRestoreSessionId,
  firstItems,
  getUriScheme,
  logRestoreEvent,
  nowMs,
  safeError,
  shortFileInfo,
  shortPath,
  type RestoreDurations,
  type RestoreErrorItem,
  type RestoreStage,
  type RestoreWarningItem,
} from '@/src/services/backup/restoreDiagnostics';

const SERVICE_SCOPE = 'BackupService';
const BACKUP_QUERY_PAGE_SIZE = 200;
const RESTORE_TEMP_DIR_NAME = 'qishua_wrongbook_restore_tmp';
const RESTORE_IMAGE_EXTENSION_FALLBACK = 'jpg';
const SUPPORTED_SCHEMA_VERSIONS = [DATABASE_VERSION];
const DB_IMPORT_PROGRESS_INTERVAL = 50;
const IMAGE_RESTORE_PROGRESS_INTERVAL = 10;

const INSERT_MISTAKE_SQL = `
INSERT INTO mistakes (
  id,
  subject,
  module,
  title,
  error_reason,
  difficulty,
  note,
  review_count,
  status,
  created_at,
  updated_at,
  next_review_at,
  last_review_at,
  last_review_result
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

const INSERT_REVIEW_RECORD_SQL = `
INSERT INTO review_records (
  id,
  mistake_id,
  review_index,
  result,
  note,
  created_at
) VALUES (?, ?, ?, ?, ?, ?);
`;

const INSERT_MISTAKE_IMAGE_SQL = `
INSERT INTO mistake_images (
  id,
  mistake_id,
  review_record_id,
  type,
  uri,
  sort_order,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?);
`;

type BackupCollectContext = {
  counts: BackupCounts;
  warningCount: number;
};

type RestoreFailureContext = {
  restoreSessionId: string;
  stage: RestoreStage;
  step: string;
  errorCode: BackupRestoreErrorCode;
  startedAt: number;
  fileShortInfo: string;
  countsParsed: BackupCounts;
  countsImported: BackupCounts;
  currentCounts: BackupCounts;
  warningCount: number;
  warnings: RestoreWarningItem[];
  errors: RestoreErrorItem[];
  hasBeforeRestoreBackup: boolean;
  rollbackAttempted: boolean;
  rollbackSuccess: boolean;
  durations: RestoreDurations;
  rootCause?: unknown;
};

type ExtractedBackupArchive = {
  tempArchiveFile: File;
  tempArchiveSizeBytes: number;
  tempDirectory: Directory;
  manifest: BackupManifest;
  manifestWarnings: string[];
  data: BackupDataPayload;
  archiveFileMap: Map<string, File>;
  imageTotalBytes: number;
  countsFromManifest: BackupCounts;
  appVersionInBackup: string;
  createdAtInBackup: string;
};

type RestoreImageMaterializedResult = {
  restoredImages: RestoredMistakeImageInsert[];
  missingRelativePaths: string[];
  restoredFileBytes: number;
  failedCount: number;
  skippedCount: number;
  errorCount: number;
};

type RestoreVerifyResult = {
  expectedCounts: BackupCounts;
  actualCounts: BackupCounts;
  mismatch: Record<keyof BackupCounts, boolean>;
  missingImageSamples: string[];
  orphanImageSamples: string[];
  imageFilesExpected: number;
  imageFilesActual: number;
};

type RestoredMistakeImageInsert = Omit<BackupMistakeImageRecord, 'backupRelativePath' | 'sourceUri'> & {
  uri: string;
};

const EMPTY_COUNTS: BackupCounts = {
  mistakes: 0,
  mistakeImages: 0,
  reviewRecords: 0,
  imageFiles: 0,
};

let zipAdapter: BackupZipAdapter = new FflateBackupZipAdapter();

function buildSessionId(prefix: 'backup' | 'restore'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0')}`;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toBackupDevicePlatform(): BackupDevicePlatform {
  if (Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web') {
    return Platform.OS;
  }
  return 'unknown';
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export function buildBackupFileName(date: Date = new Date()): string {
  const datePart = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const timePart = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${BACKUP_FILE_NAME_PREFIX}-${datePart}-${timePart}${BACKUP_FILE_EXTENSION}`;
}

function inferImageExtension(uri: string | null): string {
  if (!uri) {
    return RESTORE_IMAGE_EXTENSION_FALLBACK;
  }
  const matched = uri.match(/\.([a-zA-Z0-9]{1,8})(?:$|[?#])/);
  if (!matched) {
    return RESTORE_IMAGE_EXTENSION_FALLBACK;
  }
  return matched[1].toLowerCase();
}

export function mapImageUriForBackup(imageId: string, sourceUri: string | null): string {
  const safeImageId = imageId.trim();
  const extension = inferImageExtension(sourceUri);
  return ensureBackupImageRelativePath(`${BACKUP_IMAGES_DIR_NAME}/${safeImageId}.${extension}`);
}

function inferArchiveExtension(path: string): string {
  const matched = path.match(/\.([a-zA-Z0-9]{1,8})$/);
  if (!matched) {
    return RESTORE_IMAGE_EXTENSION_FALLBACK;
  }
  return matched[1].toLowerCase();
}

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function mapImageUriForRestore(image: BackupMistakeImageRecord): string {
  const safeType = sanitizeFileNameSegment(image.type);
  const safeId = sanitizeFileNameSegment(image.id);
  const safeOrder = Number.isFinite(image.sort_order)
    ? Math.max(0, Math.floor(image.sort_order)).toString().padStart(3, '0')
    : '000';
  const extension = inferArchiveExtension(image.backupRelativePath);
  return `${safeType}_${safeOrder}_${safeId}.${extension}`;
}

function isUserCancelledShare(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    message.includes('cancel') ||
    message.includes('canceled') ||
    message.includes('cancelled') ||
    message.includes('dismiss') ||
    message.includes('did not share') ||
    name.includes('abort')
  );
}

function resolveAppMeta(): { appName: string; appVersion: string } {
  const appName = normalizeOptionalText(Constants.expoConfig?.name) ?? 'Qishua Wrongbook';
  const appVersion = normalizeOptionalText(Constants.expoConfig?.version) ?? 'unknown';
  return {
    appName,
    appVersion,
  };
}

function ensureNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function ensureManifestRequiredFields(manifest: BackupManifest): BackupManifest {
  if (!manifest.appName || !manifest.appVersion || !manifest.createdAt) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  const counts = manifest.counts;
  if (
    !counts ||
    !ensureNonNegativeNumber(counts.mistakes) ||
    !ensureNonNegativeNumber(counts.mistakeImages) ||
    !ensureNonNegativeNumber(counts.reviewRecords) ||
    !ensureNonNegativeNumber(counts.imageFiles)
  ) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  return manifest;
}

export function validateBackupDataPayload(raw: unknown): BackupDataPayload {
  if (!raw || typeof raw !== 'object') {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  const input = raw as Partial<BackupDataPayload>;
  if (!Array.isArray(input.mistakes) || !Array.isArray(input.mistakeImages) || !Array.isArray(input.reviewRecords)) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  return {
    mistakes: input.mistakes as BackupDataPayload['mistakes'],
    mistakeImages: input.mistakeImages as BackupDataPayload['mistakeImages'],
    reviewRecords: input.reviewRecords as BackupDataPayload['reviewRecords'],
    extra: input.extra && typeof input.extra === 'object' ? input.extra : {},
  };
}

function ensureRecordId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length <= 0) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  return value.trim();
}

function ensureOptionalRecordId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureBackupPayloadRelations(data: BackupDataPayload): void {
  const mistakeIds = new Set<string>();
  for (const mistake of data.mistakes) {
    mistakeIds.add(ensureRecordId((mistake as Partial<Mistake>).id));
  }

  const reviewIds = new Set<string>();
  for (const reviewRecord of data.reviewRecords) {
    const reviewId = ensureRecordId((reviewRecord as Partial<ReviewRecord>).id);
    const mistakeId = ensureRecordId((reviewRecord as Partial<ReviewRecord>).mistake_id);
    if (!mistakeIds.has(mistakeId)) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
    reviewIds.add(reviewId);
  }

  for (const image of data.mistakeImages) {
    const mistakeId = ensureRecordId((image as Partial<BackupMistakeImageRecord>).mistake_id);
    if (!mistakeIds.has(mistakeId)) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }

    const reviewRecordId = ensureOptionalRecordId(
      (image as Partial<BackupMistakeImageRecord>).review_record_id,
    );
    if (reviewRecordId && !reviewIds.has(reviewRecordId)) {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }
  }
}

function normalizeArchiveEntryPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const isDirectoryPath = normalized.endsWith('/');
  const normalizedWithoutTrailingSlash = isDirectoryPath ? normalized.slice(0, -1) : normalized;

  if (!normalizedWithoutTrailingSlash) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  const segments = normalizedWithoutTrailingSlash.split('/');
  if (segments.some((segment) => segment.length <= 0 || segment === '..')) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  return isDirectoryPath ? `${normalizedWithoutTrailingSlash}/` : normalizedWithoutTrailingSlash;
}

function getFileShortInfo(fileUri: string): string {
  try {
    return shortFileInfo({
      uri: fileUri,
      name: normalizeOptionalText(new File(fileUri).name),
    });
  } catch {
    return shortFileInfo({ uri: fileUri });
  }
}

function cloneCounts(counts: BackupCounts): BackupCounts {
  return {
    mistakes: counts.mistakes,
    mistakeImages: counts.mistakeImages,
    reviewRecords: counts.reviewRecords,
    imageFiles: counts.imageFiles,
  };
}

async function readCurrentDatabaseCounts(): Promise<BackupCounts> {
  const [mistakes, mistakeImages, reviewRecords] = await Promise.all([
    MistakeRepository.countMistakes(),
    MistakeImageRepository.countMistakeImages(),
    ReviewRecordRepository.countReviewRecords(),
  ]);
  return {
    mistakes,
    mistakeImages,
    reviewRecords,
    imageFiles: mistakeImages,
  };
}

function logBackupEvent(
  message: string,
  sessionId: string,
  durationMs: number,
  context?: Partial<BackupCollectContext> & {
    errorName?: string | null;
    errorMessage?: string | null;
    reason?: string | null;
  },
): void {
  Logger.info(SERVICE_SCOPE, message, {
    sessionId,
    counts: context?.counts ?? EMPTY_COUNTS,
    durationMs,
    warningCount: context?.warningCount ?? 0,
    errorName: context?.errorName ?? null,
    errorMessage: context?.errorMessage ?? null,
    reason: context?.reason ?? null,
  });
}

async function listAllMistakes(): Promise<Mistake[]> {
  const collected: Mistake[] = [];
  let offset = 0;

  while (true) {
    const page = await MistakeRepository.listMistakes({
      status: 'all',
      sortBy: 'created_at',
      sortOrder: 'asc',
      limit: BACKUP_QUERY_PAGE_SIZE,
      offset,
    });

    collected.push(...page);
    if (page.length < BACKUP_QUERY_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  return collected;
}

async function listAllMistakeImages(): Promise<MistakeImage[]> {
  const collected: MistakeImage[] = [];
  let offset = 0;

  while (true) {
    const page = await MistakeImageRepository.listAllMistakeImages({
      limit: BACKUP_QUERY_PAGE_SIZE,
      offset,
    });

    collected.push(...page);
    if (page.length < BACKUP_QUERY_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  return collected;
}

async function listAllReviewRecords(): Promise<ReviewRecord[]> {
  const collected: ReviewRecord[] = [];
  let offset = 0;

  while (true) {
    const page = await ReviewRecordRepository.listAllReviewRecords({
      limit: BACKUP_QUERY_PAGE_SIZE,
      offset,
    });

    collected.push(...page);
    if (page.length < BACKUP_QUERY_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  return collected;
}

type CollectImageArtifactsResult = {
  backupMistakeImages: BackupMistakeImageRecord[];
  archiveImages: BackupImageArchiveFile[];
  warnings: string[];
  copiedImageCount: number;
};

async function collectImageArtifacts(
  mistakeImages: Awaited<ReturnType<typeof listAllMistakeImages>>,
): Promise<CollectImageArtifactsResult> {
  const backupMistakeImages: BackupMistakeImageRecord[] = [];
  const archiveImages: BackupImageArchiveFile[] = [];
  const warnings: string[] = [];
  let copiedImageCount = 0;

  for (const image of mistakeImages) {
    const sourceUri = normalizeOptionalText(image.uri);
    const backupRelativePath = mapImageUriForBackup(image.id, sourceUri);

    backupMistakeImages.push({
      id: image.id,
      mistake_id: image.mistake_id,
      review_record_id: image.review_record_id ?? null,
      type: image.type,
      sort_order: image.sort_order,
      created_at: image.created_at,
      sourceUri: null,
      backupRelativePath,
    });

    if (!sourceUri) {
      warnings.push(`IMAGE_MISSING:imageId=${image.id},mistakeId=${image.mistake_id},type=${image.type}`);
      continue;
    }

    try {
      const sourceFile = new File(sourceUri);
      if (!sourceFile.exists) {
        warnings.push(`IMAGE_MISSING:imageId=${image.id},mistakeId=${image.mistake_id},type=${image.type}`);
        continue;
      }

      archiveImages.push({
        backupRelativePath,
        bytes: await sourceFile.bytes(),
      });
      copiedImageCount += 1;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      warnings.push(
        `IMAGE_MISSING:imageId=${image.id},mistakeId=${image.mistake_id},type=${image.type},error=${errorName}`,
      );
    }
  }

  return {
    backupMistakeImages,
    archiveImages,
    warnings,
    copiedImageCount,
  };
}

function ensureValidCounts(counts: BackupCounts): BackupCounts {
  if (
    !ensureNonNegativeNumber(counts.mistakes) ||
    !ensureNonNegativeNumber(counts.mistakeImages) ||
    !ensureNonNegativeNumber(counts.reviewRecords) ||
    !ensureNonNegativeNumber(counts.imageFiles)
  ) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  return counts;
}

function toCountsFromData(data: BackupDataPayload): BackupCounts {
  return ensureValidCounts({
    mistakes: data.mistakes.length,
    mistakeImages: data.mistakeImages.length,
    reviewRecords: data.reviewRecords.length,
    imageFiles: data.mistakeImages.length,
  });
}

function ensureSupportedSchemaVersion(schemaVersion: number): void {
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    throw buildRestoreError({
      errorCode: 'RESTORE_SCHEMA_UNSUPPORTED',
      stage: 'validate',
      step: 'validate_schema_version',
      details: {
        schemaVersion,
        supportedSchemaVersions: SUPPORTED_SCHEMA_VERSIONS,
      },
    });
  }
}

function cleanupRestoreTempDirectory(directory: Directory | null): { cleaned: boolean; error?: ReturnType<typeof safeError> } {
  if (!directory) {
    return { cleaned: true };
  }

  try {
    if (directory.exists) {
      directory.delete();
    }
    return { cleaned: true };
  } catch (error) {
    return {
      cleaned: false,
      error: safeError(error),
    };
  }
}

function buildFailureMetadata(context: RestoreFailureContext): Record<string, unknown> {
  const rootCause = safeError(context.rootCause);
  const totalDurationMs = nowMs() - context.startedAt;
  context.durations.totalDurationMs = totalDurationMs;
  return {
    restoreSessionId: context.restoreSessionId,
    stage: context.stage,
    step: context.step,
    errorCode: context.errorCode,
    errorName: rootCause.name,
    errorMessage: getBackupErrorUserMessage(context.errorCode),
    rootCauseName: rootCause.name,
    rootCauseMessage: rootCause.message,
    durationMs: totalDurationMs,
    countsParsed: context.countsParsed,
    countsImported: context.countsImported,
    currentCounts: context.currentCounts,
    hasBeforeRestoreBackup: context.hasBeforeRestoreBackup,
    rollbackAttempted: context.rollbackAttempted,
    rollbackSuccess: context.rollbackSuccess,
    warningCount: context.warningCount,
    firstWarnings: firstItems(context.warnings),
    errorCount: context.errors.length,
    firstErrors: firstItems(context.errors),
    durations: context.durations,
  };
}

async function copyBackupFileToTemp(
  fileUri: string,
  restoreSessionId: string,
  fileShortInfo: string,
): Promise<{ tempDirectory: Directory; tempArchiveFile: File; tempArchiveSizeBytes: number }> {
  const sourceFile = new File(fileUri);
  if (!sourceFile.exists) {
    throw buildRestoreError({
      errorCode: 'RESTORE_FILE_STAT_FAILED',
      stage: 'file_stat',
      step: 'check_source_file_exists',
      details: {
        restoreSessionId,
        fileShortInfo,
        sourceUriScheme: getUriScheme(fileUri),
      },
    });
  }

  const rawName = normalizeOptionalText(sourceFile.name) ?? `${restoreSessionId}${BACKUP_FILE_EXTENSION}`;
  const normalizedArchiveName = rawName.toLowerCase().endsWith(BACKUP_FILE_EXTENSION)
    ? rawName
    : `${rawName}${BACKUP_FILE_EXTENSION}`;
  const tempDirectory = new Directory(Paths.cache, RESTORE_TEMP_DIR_NAME, restoreSessionId);
  tempDirectory.create({ intermediates: true, idempotent: true });
  const tempArchiveFile = new File(tempDirectory, normalizedArchiveName);
  const copyStartedAt = nowMs();

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_temp_copy_started', {
    restoreSessionId,
    sourceUriScheme: getUriScheme(fileUri),
    targetShortPath: shortPath(tempArchiveFile.uri),
    fileShortInfo,
  });

  try {
    if (tempArchiveFile.exists) {
      tempArchiveFile.delete();
    }

    try {
      sourceFile.copy(tempArchiveFile);
    } catch {
      tempArchiveFile.create({ intermediates: true, overwrite: true });
      tempArchiveFile.write(await sourceFile.bytes());
    }
  } catch (error) {
    throw buildRestoreError({
      errorCode: 'RESTORE_TEMP_COPY_FAILED',
      stage: 'temp_copy',
      step: 'copy_source_to_temp',
      cause: error,
      details: {
        restoreSessionId,
        sourceUriScheme: getUriScheme(fileUri),
        targetShortPath: shortPath(tempArchiveFile.uri),
        fileShortInfo,
      },
    });
  }

  const copiedInfo = tempArchiveFile.info();
  const tempFileSizeBytes = typeof copiedInfo.size === 'number' ? copiedInfo.size : 0;
  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_temp_copy_success', {
    restoreSessionId,
    tempFileShortPath: shortPath(tempArchiveFile.uri),
    tempFileSizeBytes,
    durationMs: nowMs() - copyStartedAt,
  });

  return {
    tempDirectory,
    tempArchiveFile,
    tempArchiveSizeBytes: tempFileSizeBytes,
  };
}

async function readBackupPackageFromTemp(options: {
  restoreSessionId: string;
  tempDirectory: Directory;
  tempArchiveFile: File;
  tempArchiveSizeBytes: number;
}): Promise<ExtractedBackupArchive> {
  const { restoreSessionId, tempDirectory, tempArchiveFile, tempArchiveSizeBytes } = options;
  const readStartedAt = nowMs();

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_package_read_started', {
    restoreSessionId,
    tempFileSizeBytes: tempArchiveSizeBytes,
  });

  let archiveEntries: Record<string, Uint8Array>;
  try {
    archiveEntries = unzipSync(await tempArchiveFile.bytes());
  } catch (error) {
    throw buildRestoreError({
      errorCode: 'RESTORE_PACKAGE_READ_FAILED',
      stage: 'package_read',
      step: 'unzip_backup_archive',
      cause: error,
      details: {
        restoreSessionId,
        tempFileShortPath: shortPath(tempArchiveFile.uri),
      },
    });
  }

  const extractDirectory = new Directory(tempDirectory, 'extract');
  extractDirectory.create({ intermediates: true, idempotent: true });
  const archiveFileMap = new Map<string, File>();
  let imageTotalBytes = 0;

  for (const [entryPath, bytes] of Object.entries(archiveEntries)) {
    const normalizedPath = normalizeArchiveEntryPath(entryPath);
    if (normalizedPath.endsWith('/')) {
      const dir = new Directory(extractDirectory, normalizedPath);
      dir.create({ intermediates: true, idempotent: true });
      continue;
    }

    const slashIndex = normalizedPath.lastIndexOf('/');
    if (slashIndex >= 0) {
      const parentPath = normalizedPath.slice(0, slashIndex);
      if (parentPath.trim().length > 0) {
        const parentDir = new Directory(extractDirectory, parentPath);
        parentDir.create({ intermediates: true, idempotent: true });
      }
    }

    const extractedFile = new File(extractDirectory, normalizedPath);
    extractedFile.create({ intermediates: true, overwrite: true });
    extractedFile.write(bytes);
    archiveFileMap.set(normalizedPath, extractedFile);

    if (normalizedPath.startsWith(`${BACKUP_IMAGES_DIR_NAME}/`)) {
      imageTotalBytes += bytes.byteLength;
    }
  }

  const manifestFile = archiveFileMap.get(BACKUP_MANIFEST_FILE_NAME);
  if (!manifestFile || !manifestFile.exists) {
    throw buildRestoreError({
      errorCode: 'RESTORE_MANIFEST_MISSING',
      stage: 'package_read',
      step: 'ensure_manifest_exists',
      details: {
        restoreSessionId,
      },
    });
  }

  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(strFromU8(await manifestFile.bytes()));
  } catch (error) {
    throw buildRestoreError({
      errorCode: 'RESTORE_JSON_PARSE_FAILED',
      stage: 'package_read',
      step: 'parse_manifest_json',
      cause: error,
      details: {
        restoreSessionId,
      },
    });
  }

  const manifestValidated = validateBackupManifest(manifestRaw);
  if (!manifestValidated.ok || !manifestValidated.manifest) {
    throw buildRestoreError({
      errorCode: 'RESTORE_DATA_VALIDATE_FAILED',
      stage: 'package_read',
      step: 'validate_manifest_shape',
      details: {
        restoreSessionId,
        firstManifestErrors: manifestValidated.errors.slice(0, 5),
      },
    });
  }

  const manifest = ensureManifestRequiredFields(manifestValidated.manifest);
  const warnings = Array.isArray(manifest.warnings) ? manifest.warnings : [];
  const dataFile = archiveFileMap.get(BACKUP_DATA_FILE_NAME);
  if (!dataFile || !dataFile.exists) {
    throw buildRestoreError({
      errorCode: 'RESTORE_PACKAGE_READ_FAILED',
      stage: 'package_read',
      step: 'ensure_data_file_exists',
      details: {
        restoreSessionId,
      },
    });
  }

  let parsedDataRaw: unknown;
  try {
    parsedDataRaw = JSON.parse(strFromU8(await dataFile.bytes()));
  } catch (error) {
    throw buildRestoreError({
      errorCode: 'RESTORE_JSON_PARSE_FAILED',
      stage: 'package_read',
      step: 'parse_data_json',
      cause: error,
      details: {
        restoreSessionId,
      },
    });
  }

  let data: BackupDataPayload;
  try {
    data = validateBackupDataPayload(parsedDataRaw);
  } catch (error) {
    throw buildRestoreError({
      errorCode: 'RESTORE_DATA_VALIDATE_FAILED',
      stage: 'package_read',
      step: 'validate_data_payload_shape',
      cause: error,
      details: {
        restoreSessionId,
      },
    });
  }

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_package_read_success', {
    restoreSessionId,
    packageFormat: 'zip',
    manifestExists: true,
    manifestVersion: manifest.formatVersion,
    schemaVersion: manifest.schemaVersion,
    appVersionInBackup: manifest.appVersion,
    createdAtInBackup: manifest.createdAt,
    countsFromManifest: manifest.counts,
    durationMs: nowMs() - readStartedAt,
  });

  return {
    tempArchiveFile,
    tempArchiveSizeBytes,
    tempDirectory: extractDirectory,
    manifest,
    manifestWarnings: warnings,
    data,
    archiveFileMap,
    imageTotalBytes,
    countsFromManifest: manifest.counts,
    appVersionInBackup: manifest.appVersion,
    createdAtInBackup: manifest.createdAt,
  };
}

function validateRestorePackage(options: {
  restoreSessionId: string;
  manifest: BackupManifest;
  data: BackupDataPayload;
  archiveFileMap: Map<string, File>;
  warnings: RestoreWarningItem[];
}): { counts: BackupCounts; missingRequiredFieldsCount: number; imageTotalBytes: number; orphanImageSamples: string[] } {
  const { restoreSessionId, manifest, data, archiveFileMap, warnings } = options;
  const validateStartedAt = nowMs();

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_package_validate_started', {
    restoreSessionId,
    schemaVersion: manifest.schemaVersion,
    supportedSchemaVersions: SUPPORTED_SCHEMA_VERSIONS,
  });

  ensureSupportedSchemaVersion(manifest.schemaVersion);

  let missingRequiredFieldsCount = 0;
  let relationError: unknown | null = null;
  try {
    ensureBackupPayloadRelations(data);
  } catch (error) {
    relationError = error;
  }
  if (relationError) {
    throw buildRestoreError({
      errorCode: 'RESTORE_DATA_VALIDATE_FAILED',
      stage: 'validate',
      step: 'validate_relations',
      cause: relationError,
      details: {
        restoreSessionId,
      },
    });
  }

  const counts = toCountsFromData(data);
  const referencedImageSet = new Set<string>();
  for (const image of data.mistakeImages) {
    const relativePath = normalizeArchiveEntryPath(ensureBackupImageRelativePath(ensureRecordId(image.backupRelativePath)));
    referencedImageSet.add(relativePath);
  }

  const orphanImageSamples: string[] = [];
  for (const archivePath of archiveFileMap.keys()) {
    if (!archivePath.startsWith(`${BACKUP_IMAGES_DIR_NAME}/`)) {
      continue;
    }
    if (!referencedImageSet.has(archivePath)) {
      const sample = shortPath(archivePath) ?? archivePath;
      if (orphanImageSamples.length < 5) {
        orphanImageSamples.push(sample);
      }
      appendWarning(warnings, {
        code: 'RESTORE_ORPHAN_IMAGE_FILE',
        stage: 'validate',
        message: 'Backup image file is not referenced by any mistake image record.',
        shortTarget: sample,
      });
    }
  }

  for (const mistake of data.mistakes) {
    if (!normalizeOptionalText(mistake.id)) {
      missingRequiredFieldsCount += 1;
    }
  }

  for (const reviewRecord of data.reviewRecords) {
    if (!normalizeOptionalText(reviewRecord.id) || !normalizeOptionalText(reviewRecord.mistake_id)) {
      missingRequiredFieldsCount += 1;
    }
  }

  let imageTotalBytes = 0;
  for (const image of data.mistakeImages) {
    const archivePath = normalizeArchiveEntryPath(ensureBackupImageRelativePath(ensureRecordId(image.backupRelativePath)));
    const sourceFile = archiveFileMap.get(archivePath);
    if (sourceFile && sourceFile.exists) {
      const info = sourceFile.info();
      if (typeof info.size === 'number') {
        imageTotalBytes += info.size;
      }
    }
  }

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_package_validate_success', {
    restoreSessionId,
    counts,
    imageTotalBytes,
    missingRequiredFieldsCount,
    warningCount: warnings.length,
    durationMs: nowMs() - validateStartedAt,
  });

  return {
    counts,
    missingRequiredFieldsCount,
    imageTotalBytes,
    orphanImageSamples,
  };
}

async function materializeRestoredImages(options: {
  restoreSessionId: string;
  images: BackupMistakeImageRecord[];
  archiveFileMap: Map<string, File>;
  warnings: RestoreWarningItem[];
  errors: RestoreErrorItem[];
}): Promise<RestoreImageMaterializedResult> {
  const { restoreSessionId, images, archiveFileMap, warnings, errors } = options;
  const restoredImages: RestoredMistakeImageInsert[] = [];
  const missingRelativePaths: string[] = [];
  let restoredFileBytes = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let progressRestored = 0;
  let errorCount = 0;
  const startedAt = nowMs();

  for (const image of images) {
    const normalizedArchivePath = normalizeArchiveEntryPath(
      ensureBackupImageRelativePath(ensureRecordId(image.backupRelativePath)),
    );
    const sourceFile = archiveFileMap.get(normalizedArchivePath);
    if (!sourceFile || !sourceFile.exists) {
      skippedCount += 1;
      missingRelativePaths.push(shortPath(normalizedArchivePath) ?? normalizedArchivePath);
      appendWarning(warnings, {
        code: 'RESTORE_IMAGE_SOURCE_MISSING',
        stage: 'images_restore',
        message: 'Image file missing in backup package.',
        shortTarget: shortPath(normalizedArchivePath) ?? normalizedArchivePath,
      });
      continue;
    }

    try {
      const targetDirectoryUri = await ensureMistakeImageDir(image.mistake_id);
      const targetDirectory = new Directory(targetDirectoryUri);
      targetDirectory.create({ intermediates: true, idempotent: true });

      const targetFile = new File(targetDirectory, mapImageUriForRestore(image));
      if (targetFile.exists) {
        targetFile.delete();
      }
      sourceFile.copy(targetFile);
      const copiedInfo = targetFile.info();
      if (typeof copiedInfo.size === 'number') {
        restoredFileBytes += copiedInfo.size;
      }

      restoredImages.push({
        id: image.id,
        mistake_id: image.mistake_id,
        review_record_id: image.review_record_id ?? null,
        type: image.type,
        sort_order: image.sort_order,
        created_at: image.created_at,
        uri: targetFile.uri,
      });
      progressRestored += 1;
    } catch (error) {
      failedCount += 1;
      errorCount += 1;
      appendError(errors, {
        code: 'RESTORE_IMAGE_COPY_FAILED',
        stage: 'images_restore',
        message: 'Failed to restore image file.',
        shortTarget: shortPath(normalizedArchivePath) ?? normalizedArchivePath,
        rootCauseMessage: safeError(error).message,
      });
    }

    if (progressRestored > 0 && progressRestored % IMAGE_RESTORE_PROGRESS_INTERVAL === 0) {
      logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_images_progress', {
        restoreSessionId,
        restoredCount: progressRestored,
        totalCount: images.length,
        failedCount,
        lastImageShortName: shortPath(normalizedArchivePath),
        durationMs: nowMs() - startedAt,
      });
    }
  }

  return {
    restoredImages,
    missingRelativePaths,
    restoredFileBytes,
    failedCount,
    skippedCount,
    errorCount,
  };
}

async function runRestoreDatabaseTransaction(options: {
  restoreSessionId: string;
  data: BackupDataPayload;
  restoredImages: RestoredMistakeImageInsert[];
  errors: RestoreErrorItem[];
}): Promise<{ counts: BackupCounts; dbClearDurationMs: number }> {
  const { restoreSessionId, data, restoredImages, errors } = options;
  const importStartedAt = nowMs();
  let dbClearDurationMs = 0;
  try {
    await withDatabaseTransaction(async (db) => {
      const dbClearStartedAt = nowMs();
      try {
        await db.runAsync('DELETE FROM review_records;');
        await db.runAsync('DELETE FROM mistake_images;');
        await db.runAsync('DELETE FROM mistakes;');
      } catch (error) {
        appendError(errors, {
          code: 'RESTORE_DB_CLEAR_FAILED',
          stage: 'db_clear',
          message: 'Failed to clear existing restore tables.',
          rootCauseMessage: safeError(error).message,
        });
        throw buildRestoreError({
          errorCode: 'RESTORE_DB_CLEAR_FAILED',
          stage: 'db_clear',
          step: 'delete_existing_records',
          cause: error,
          details: {
            restoreSessionId,
          },
        });
      }

      logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_clear_success', {
        restoreSessionId,
        countsAfterClear: {
          mistakes: 0,
          mistakeImages: 0,
          reviewRecords: 0,
          imageFiles: 0,
        },
        durationMs: nowMs() - dbClearStartedAt,
      });
      dbClearDurationMs = nowMs() - dbClearStartedAt;

      try {
        for (let index = 0; index < data.mistakes.length; index += 1) {
          const mistake = data.mistakes[index];
          await db.runAsync(
            INSERT_MISTAKE_SQL,
            mistake.id,
            mistake.subject,
            mistake.module,
            mistake.title ?? null,
            mistake.error_reason ?? null,
            mistake.difficulty,
            mistake.note ?? null,
            mistake.review_count,
            mistake.status,
            mistake.created_at,
            mistake.updated_at,
            mistake.next_review_at ?? null,
            mistake.last_review_at ?? null,
            mistake.last_review_result ?? null,
          );

          if ((index + 1) % DB_IMPORT_PROGRESS_INTERVAL === 0 || index === data.mistakes.length - 1) {
            logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_progress', {
              restoreSessionId,
              tableName: 'mistakes',
              importedCount: index + 1,
              totalCount: data.mistakes.length,
              durationMs: nowMs() - importStartedAt,
            });
          }
        }

        for (let index = 0; index < data.reviewRecords.length; index += 1) {
          const reviewRecord = data.reviewRecords[index];
          await db.runAsync(
            INSERT_REVIEW_RECORD_SQL,
            reviewRecord.id,
            reviewRecord.mistake_id,
            reviewRecord.review_index,
            reviewRecord.result,
            reviewRecord.note ?? null,
            reviewRecord.created_at,
          );

          if ((index + 1) % DB_IMPORT_PROGRESS_INTERVAL === 0 || index === data.reviewRecords.length - 1) {
            logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_progress', {
              restoreSessionId,
              tableName: 'review_records',
              importedCount: index + 1,
              totalCount: data.reviewRecords.length,
              durationMs: nowMs() - importStartedAt,
            });
          }
        }

        for (let index = 0; index < restoredImages.length; index += 1) {
          const image = restoredImages[index];
          await db.runAsync(
            INSERT_MISTAKE_IMAGE_SQL,
            image.id,
            image.mistake_id,
            image.review_record_id ?? null,
            image.type,
            image.uri,
            image.sort_order,
            image.created_at,
          );

          if ((index + 1) % DB_IMPORT_PROGRESS_INTERVAL === 0 || index === restoredImages.length - 1) {
            logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_progress', {
              restoreSessionId,
              tableName: 'mistake_images',
              importedCount: index + 1,
              totalCount: restoredImages.length,
              durationMs: nowMs() - importStartedAt,
            });
          }
        }
      } catch (error) {
        appendError(errors, {
          code: 'RESTORE_DB_IMPORT_FAILED',
          stage: 'db_import',
          message: 'Failed to import records into database.',
          rootCauseMessage: safeError(error).message,
        });
        throw buildRestoreError({
          errorCode: 'RESTORE_DB_IMPORT_FAILED',
          stage: 'db_import',
          step: 'insert_restore_records',
          cause: error,
          details: {
            restoreSessionId,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof BackupRestoreError) {
      throw error;
    }
    throw buildRestoreError({
      errorCode: 'RESTORE_DB_IMPORT_FAILED',
      stage: 'db_import',
      step: 'write_transaction',
      cause: error,
      details: {
        restoreSessionId,
      },
    });
  }

  return {
    counts: ensureValidCounts({
      mistakes: data.mistakes.length,
      mistakeImages: restoredImages.length,
      reviewRecords: data.reviewRecords.length,
      imageFiles: restoredImages.length,
    }),
    dbClearDurationMs,
  };
}

async function verifyRestoreResults(options: {
  restoreSessionId: string;
  expectedCounts: BackupCounts;
  importedCounts: BackupCounts;
  restoredImages: RestoredMistakeImageInsert[];
  missingImageSamples: string[];
  orphanImageSamples: string[];
}): Promise<RestoreVerifyResult> {
  const { restoreSessionId, expectedCounts, importedCounts, restoredImages, missingImageSamples, orphanImageSamples } = options;
  const actualDbCounts = await readCurrentDatabaseCounts();
  let actualImageFiles = 0;
  for (const image of restoredImages) {
    const file = new File(image.uri);
    if (file.exists) {
      actualImageFiles += 1;
    }
  }

  const actualCounts: BackupCounts = {
    mistakes: actualDbCounts.mistakes,
    mistakeImages: actualDbCounts.mistakeImages,
    reviewRecords: actualDbCounts.reviewRecords,
    imageFiles: actualImageFiles,
  };
  const mismatch: Record<keyof BackupCounts, boolean> = {
    mistakes: actualCounts.mistakes !== expectedCounts.mistakes,
    mistakeImages: actualCounts.mistakeImages !== expectedCounts.mistakeImages,
    reviewRecords: actualCounts.reviewRecords !== expectedCounts.reviewRecords,
    imageFiles: actualCounts.imageFiles !== expectedCounts.imageFiles,
  };

  const verifyResult: RestoreVerifyResult = {
    expectedCounts: cloneCounts(expectedCounts),
    actualCounts,
    mismatch,
    missingImageSamples: missingImageSamples.slice(0, 5),
    orphanImageSamples: orphanImageSamples.slice(0, 5),
    imageFilesExpected: expectedCounts.imageFiles,
    imageFilesActual: actualCounts.imageFiles,
  };

  if (mismatch.mistakes || mismatch.mistakeImages || mismatch.reviewRecords || mismatch.imageFiles) {
    throw buildRestoreError({
      errorCode: 'RESTORE_VERIFY_FAILED',
      stage: 'verify',
      step: 'compare_expected_actual_counts',
      details: {
        restoreSessionId,
        expectedCounts,
        actualCounts,
        mismatch,
        missingImageSamples: verifyResult.missingImageSamples,
        orphanImageSamples: verifyResult.orphanImageSamples,
        importedCounts,
      },
    });
  }

  return verifyResult;
}

export function configureBackupZipAdapter(adapter: BackupZipAdapter): void {
  zipAdapter = adapter;
}

export async function createBackup(options?: CreateBackupOptions): Promise<CreateBackupServiceResult> {
  const sessionId = buildSessionId('backup');
  const startedAt = Date.now();
  const reason = options?.reason ?? 'manual';
  const context: BackupCollectContext = {
    counts: { ...EMPTY_COUNTS },
    warningCount: 0,
  };

  logBackupEvent('backup_start', sessionId, 0, {
    counts: context.counts,
    warningCount: context.warningCount,
    reason,
  });

  try {
    const [mistakes, mistakeImages, reviewRecords] = await Promise.all([
      listAllMistakes(),
      listAllMistakeImages(),
      listAllReviewRecords(),
    ]);

    context.counts = {
      ...context.counts,
      mistakes: mistakes.length,
      mistakeImages: mistakeImages.length,
      reviewRecords: reviewRecords.length,
    };
    logBackupEvent('backup_collect_db_done', sessionId, Date.now() - startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
      reason,
    });

    const imageArtifacts = await collectImageArtifacts(mistakeImages);
    context.warningCount = imageArtifacts.warnings.length;
    context.counts = {
      ...context.counts,
      imageFiles: imageArtifacts.copiedImageCount,
    };
    logBackupEvent('backup_collect_images_done', sessionId, Date.now() - startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
      reason,
    });

    const appMeta = resolveAppMeta();
    const manifest: BackupManifest = createBackupManifest({
      appName: appMeta.appName,
      appVersion: appMeta.appVersion,
      schemaVersion: DATABASE_VERSION,
      devicePlatform: toBackupDevicePlatform(),
      counts: context.counts,
      warnings: imageArtifacts.warnings,
    });

    const data: BackupDataPayload = {
      mistakes,
      mistakeImages: imageArtifacts.backupMistakeImages,
      reviewRecords,
      extra: { reason },
    };

    const packaged = await zipAdapter.createBackupPackage({
      fileName: buildBackupFileName(),
      manifest,
      data,
      images: imageArtifacts.archiveImages,
    });

    logBackupEvent('backup_package_created', sessionId, Date.now() - startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
      reason,
    });

    return {
      fileUri: packaged.fileUri,
      manifest,
    };
  } catch (error) {
    const normalized = normalizeBackupError(error, 'BACKUP_FAILED');
    Logger.error(SERVICE_SCOPE, 'backup_failed', {
      sessionId,
      counts: context.counts,
      durationMs: Date.now() - startedAt,
      warningCount: context.warningCount,
      errorName: normalized.name,
      errorMessage: normalized.message,
      reason,
    });
    throw normalized;
  }
}

export async function inspectBackup(
  fileUri: string,
  options?: { restoreSessionId?: string; fileShortInfo?: string },
): Promise<InspectBackupResult> {
  const restoreSessionId = normalizeOptionalText(options?.restoreSessionId) ?? createRestoreSessionId();
  const fileShortInfo = normalizeOptionalText(options?.fileShortInfo) ?? getFileShortInfo(fileUri);
  const startedAt = nowMs();

  logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_inspect_start', {
    restoreSessionId,
    fileShortInfo,
    durationMs: 0,
  });

  try {
    const normalizedUri = normalizeOptionalText(fileUri);
    if (!normalizedUri) {
      throw new BackupRestoreError('INVALID_BACKUP_FILE', getBackupErrorUserMessage('INVALID_BACKUP_FILE'), {
        stage: 'file_pick',
        step: 'validate_backup_uri',
      });
    }

    const file = new File(normalizedUri);
    const fileName = normalizeOptionalText(file.name)?.toLowerCase() ?? '';
    if (!fileName.endsWith(BACKUP_FILE_EXTENSION)) {
      throw new BackupRestoreError('INVALID_BACKUP_FILE', getBackupErrorUserMessage('INVALID_BACKUP_FILE'), {
        stage: 'file_stat',
        step: 'validate_backup_extension',
      });
    }
    if (!file.exists) {
      throw new BackupRestoreError(
        'PERMISSION_OR_FILE_ACCESS_FAILED',
        getBackupErrorUserMessage('PERMISSION_OR_FILE_ACCESS_FAILED'),
        {
          stage: 'file_stat',
          step: 'check_backup_file_exists',
        },
      );
    }

    let archiveEntries: Record<string, Uint8Array>;
    try {
      archiveEntries = unzipSync(await file.bytes());
    } catch (error) {
      throw new BackupRestoreError(
        'RESTORE_PACKAGE_READ_FAILED',
        getBackupErrorUserMessage('RESTORE_PACKAGE_READ_FAILED'),
        {
          stage: 'package_read',
          step: 'unzip_backup_archive',
          cause: error,
        },
      );
    }

    const manifestBytes = archiveEntries[BACKUP_MANIFEST_FILE_NAME];
    if (!manifestBytes) {
      throw new BackupRestoreError('RESTORE_MANIFEST_MISSING', getBackupErrorUserMessage('RESTORE_MANIFEST_MISSING'), {
        stage: 'package_read',
        step: 'ensure_manifest_exists',
      });
    }

    let manifestRaw: unknown;
    try {
      manifestRaw = JSON.parse(strFromU8(manifestBytes));
    } catch (error) {
      throw new BackupRestoreError('RESTORE_JSON_PARSE_FAILED', getBackupErrorUserMessage('RESTORE_JSON_PARSE_FAILED'), {
        stage: 'package_read',
        step: 'parse_manifest_json',
        cause: error,
      });
    }

    const validated = validateBackupManifest(manifestRaw);
    if (!validated.ok || !validated.manifest) {
      throw new BackupRestoreError(
        'RESTORE_DATA_VALIDATE_FAILED',
        getBackupErrorUserMessage('RESTORE_DATA_VALIDATE_FAILED'),
        {
          stage: 'validate',
          step: 'validate_manifest_shape',
          details: {
            firstErrors: validated.errors.slice(0, 5),
          },
        },
      );
    }

    const manifest = validated.manifest;
    if (manifest.format !== BACKUP_FORMAT) {
      throw new BackupRestoreError('INVALID_BACKUP_FILE', getBackupErrorUserMessage('INVALID_BACKUP_FILE'), {
        stage: 'validate',
        step: 'validate_manifest_format',
      });
    }
    if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new BackupRestoreError(
        'UNSUPPORTED_BACKUP_VERSION',
        getBackupErrorUserMessage('UNSUPPORTED_BACKUP_VERSION'),
        {
          stage: 'validate',
          step: 'validate_manifest_format_version',
        },
      );
    }

    const normalizedManifest = ensureManifestRequiredFields(manifest);
    const warnings = Array.isArray(normalizedManifest.warnings) ? normalizedManifest.warnings : [];
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_inspect_done', {
      restoreSessionId,
      fileShortInfo,
      durationMs: nowMs() - startedAt,
      counts: normalizedManifest.counts,
      warningCount: warnings.length,
    });

    return {
      manifest: normalizedManifest,
      warnings,
    };
  } catch (error) {
    const normalized = normalizeBackupError(error, 'RESTORE_UNKNOWN_FAILED');
    logRestoreEvent(SERVICE_SCOPE, 'error', 'restore_inspect_failed', {
      restoreSessionId,
      fileShortInfo,
      durationMs: nowMs() - startedAt,
      counts: EMPTY_COUNTS,
      warningCount: 0,
      errorCode: normalized.code,
      stage: normalized.stage ?? 'unknown',
      step: normalized.step ?? 'unknown',
      errorName: normalized.name,
      errorMessage: normalized.message,
      rootCause: safeError(normalized.cause),
    });
    throw normalized;
  }
}

export async function restoreFromBackup(
  fileUri: string,
  options?: RestoreFromBackupOptions,
): Promise<RestoreFromBackupResult> {
  const restoreSessionId = normalizeOptionalText(options?.restoreSessionId) ?? createRestoreSessionId();
  const startedAt = nowMs();
  const fileShortInfo = normalizeOptionalText(options?.fileShortInfo) ?? getFileShortInfo(fileUri);
  const warnings: RestoreWarningItem[] = [];
  const errors: RestoreErrorItem[] = [];
  const durations = createEmptyDurations();
  const failureContext: RestoreFailureContext = {
    restoreSessionId,
    stage: 'unknown',
    step: 'unknown',
    errorCode: 'RESTORE_UNKNOWN_FAILED',
    startedAt,
    fileShortInfo,
    countsParsed: cloneCounts(EMPTY_COUNTS),
    countsImported: cloneCounts(EMPTY_COUNTS),
    currentCounts: cloneCounts(EMPTY_COUNTS),
    warningCount: 0,
    warnings,
    errors,
    hasBeforeRestoreBackup: false,
    rollbackAttempted: false,
    rollbackSuccess: false,
    durations,
  };

  let tempDirectory: Directory | null = null;
  let beforeRestoreBackupUri: string | undefined;
  let orphanImageSamples: string[] = [];
  let missingImageSamples: string[] = [];
  let tempCopyStartedAt: number | null = null;
  let packageReadStartedAt: number | null = null;
  let validateStartedAt: number | null = null;
  let beforeSnapshotStartedAt: number | null = null;
  let dbImportStartedAt: number | null = null;
  let imageRestoreStartedAt: number | null = null;
  let verifyStartedAt: number | null = null;

  try {
    const normalizedUri = normalizeOptionalText(fileUri);
    if (!normalizedUri) {
      throw buildRestoreError({
        errorCode: 'RESTORE_FILE_PICK_FAILED',
        stage: 'file_pick',
        step: 'validate_backup_uri',
      });
    }

    const selectedFile = new File(normalizedUri);
    const fileName = normalizeOptionalText(selectedFile.name) ?? fileShortInfo;
    const extension = fileName.toLowerCase();
    if (!extension.endsWith(BACKUP_FILE_EXTENSION)) {
      throw buildRestoreError({
        errorCode: 'INVALID_BACKUP_FILE',
        stage: 'file_stat',
        step: 'validate_backup_extension',
        details: {
          restoreSessionId,
          fileShortInfo,
        },
      });
    }

    failureContext.stage = 'file_stat';
    failureContext.step = 'read_source_file_info';
    const fileInfo = selectedFile.info();
    if (!selectedFile.exists || fileInfo.exists === false) {
      throw buildRestoreError({
        errorCode: 'RESTORE_FILE_STAT_FAILED',
        stage: 'file_stat',
        step: 'check_source_file_exists',
        details: {
          restoreSessionId,
          fileShortInfo,
          sourceUriScheme: getUriScheme(normalizedUri),
        },
      });
    }

    const currentCountsBeforeRestore = await readCurrentDatabaseCounts();
    failureContext.currentCounts = cloneCounts(currentCountsBeforeRestore);

    failureContext.stage = 'temp_copy';
    failureContext.step = 'copy_source_to_temp';
    tempCopyStartedAt = nowMs();
    const copied = await copyBackupFileToTemp(normalizedUri, restoreSessionId, fileShortInfo);
    durations.tempCopyDurationMs = nowMs() - tempCopyStartedAt;
    tempDirectory = copied.tempDirectory;

    failureContext.stage = 'package_read';
    failureContext.step = 'read_backup_package';
    packageReadStartedAt = nowMs();
    const extracted = await readBackupPackageFromTemp({
      restoreSessionId,
      tempDirectory: copied.tempDirectory,
      tempArchiveFile: copied.tempArchiveFile,
      tempArchiveSizeBytes: copied.tempArchiveSizeBytes,
    });
    durations.packageReadDurationMs = nowMs() - packageReadStartedAt;

    for (const warningText of extracted.manifestWarnings.slice(0, 20)) {
      appendWarning(warnings, {
        code: 'RESTORE_MANIFEST_WARNING',
        stage: 'validate',
        message: warningText,
      });
    }

    failureContext.stage = 'validate';
    failureContext.step = 'validate_manifest_and_data';
    validateStartedAt = nowMs();
    const validateResult = validateRestorePackage({
      restoreSessionId,
      manifest: extracted.manifest,
      data: extracted.data,
      archiveFileMap: extracted.archiveFileMap,
      warnings,
    });
    durations.validateDurationMs = nowMs() - validateStartedAt;
    failureContext.countsParsed = cloneCounts(validateResult.counts);
    orphanImageSamples = validateResult.orphanImageSamples;

    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_before_snapshot_started', {
      restoreSessionId,
      currentCountsBeforeRestore,
    });

    failureContext.stage = 'before_snapshot';
    failureContext.step = 'create_before_restore_backup';
    beforeSnapshotStartedAt = nowMs();
    let safetyBackup: CreateBackupServiceResult;
    try {
      safetyBackup = await createBackup({ reason: 'before_restore' });
    } catch (error) {
      throw buildRestoreError({
        errorCode: 'RESTORE_BEFORE_SNAPSHOT_FAILED',
        stage: 'before_snapshot',
        step: 'create_before_restore_backup',
        cause: error,
        details: {
          restoreSessionId,
        },
      });
    }
    beforeRestoreBackupUri = safetyBackup.fileUri;
    failureContext.hasBeforeRestoreBackup = true;
    durations.beforeSnapshotDurationMs = nowMs() - beforeSnapshotStartedAt;
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_before_snapshot_success', {
      restoreSessionId,
      snapshotShortPath: shortPath(beforeRestoreBackupUri),
      snapshotCounts: safetyBackup.manifest.counts,
      snapshotSizeBytes: new File(safetyBackup.fileUri).info().size ?? null,
      durationMs: durations.beforeSnapshotDurationMs,
    });

    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_clear_started', {
      restoreSessionId,
      currentCountsBeforeClear: currentCountsBeforeRestore,
    });
    failureContext.stage = 'db_import';
    failureContext.step = 'write_restore_transaction';
    dbImportStartedAt = nowMs();
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_started', {
      restoreSessionId,
      targetCounts: validateResult.counts,
    });

    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_images_started', {
      restoreSessionId,
      imageFileCount: extracted.data.mistakeImages.length,
      imageTotalBytes: validateResult.imageTotalBytes,
    });
    failureContext.stage = 'images_restore';
    failureContext.step = 'copy_image_files';
    imageRestoreStartedAt = nowMs();
    const imageResult = await materializeRestoredImages({
      restoreSessionId,
      images: extracted.data.mistakeImages,
      archiveFileMap: extracted.archiveFileMap,
      warnings,
      errors,
    });
    durations.imageRestoreDurationMs = nowMs() - imageRestoreStartedAt;
    missingImageSamples = imageResult.missingRelativePaths.slice(0, 5);

    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_images_success', {
      restoreSessionId,
      restoredImageFileCount: imageResult.restoredImages.length,
      skippedImageFileCount: imageResult.skippedCount,
      failedImageFileCount: imageResult.failedCount,
      imageTotalBytes: imageResult.restoredFileBytes,
      durationMs: durations.imageRestoreDurationMs,
    });

    const dbTransactionResult = await runRestoreDatabaseTransaction({
      restoreSessionId,
      data: extracted.data,
      restoredImages: imageResult.restoredImages,
      errors,
    });
    const importedCounts = dbTransactionResult.counts;
    durations.dbImportDurationMs = nowMs() - dbImportStartedAt;
    durations.dbClearDurationMs = dbTransactionResult.dbClearDurationMs;
    failureContext.countsImported = cloneCounts(importedCounts);
    failureContext.currentCounts = cloneCounts(importedCounts);

    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_db_import_success', {
      restoreSessionId,
      importedCounts: {
        mistakes: importedCounts.mistakes,
        mistakeImages: importedCounts.mistakeImages,
        reviewRecords: importedCounts.reviewRecords,
      },
      durationMs: durations.dbImportDurationMs,
    });

    failureContext.stage = 'verify';
    failureContext.step = 'compare_expected_actual_counts';
    verifyStartedAt = nowMs();
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_verify_started', {
      restoreSessionId,
      expectedCounts: validateResult.counts,
    });
    const verifyResult = await verifyRestoreResults({
      restoreSessionId,
      expectedCounts: validateResult.counts,
      importedCounts,
      restoredImages: imageResult.restoredImages,
      missingImageSamples,
      orphanImageSamples,
    });
    durations.verifyDurationMs = nowMs() - verifyStartedAt;
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_verify_success', {
      restoreSessionId,
      expectedCounts: verifyResult.expectedCounts,
      actualCounts: verifyResult.actualCounts,
      mismatch: verifyResult.mismatch,
      missingImageSamples: verifyResult.missingImageSamples,
      orphanImageSamples: verifyResult.orphanImageSamples,
      imageFilesExpected: verifyResult.imageFilesExpected,
      imageFilesActual: verifyResult.imageFilesActual,
      durationMs: durations.verifyDurationMs,
    });

    durations.totalDurationMs = nowMs() - startedAt;
    failureContext.warningCount = warnings.length;
    logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_success', {
      restoreSessionId,
      fileShortInfo,
      totalDurationMs: durations.totalDurationMs,
      finalCounts: importedCounts,
      warningCount: warnings.length,
      hasBeforeRestoreBackup: true,
      durations,
    });

    return {
      restoreSessionId,
      restoredMistakes: importedCounts.mistakes,
      restoredImages: importedCounts.mistakeImages,
      restoredReviewRecords: importedCounts.reviewRecords,
      warningCount: warnings.length,
      errorCount: errors.length,
      hasBeforeRestoreBackup: true,
      beforeRestoreBackupUri,
    };
  } catch (error) {
    const normalized = normalizeBackupError(error, 'RESTORE_UNKNOWN_FAILED');
    const resolvedStage = (normalized.stage as RestoreStage | undefined) ?? failureContext.stage;
    const resolvedStep = normalized.step ?? failureContext.step;
    let resolvedErrorCode: BackupRestoreErrorCode = normalized.code;

    if (
      (normalized.code === 'CORRUPTED_BACKUP_FILE' || normalized.code === 'INVALID_BACKUP_FILE') &&
      resolvedStage === 'package_read'
    ) {
      resolvedErrorCode = 'RESTORE_PACKAGE_READ_FAILED';
    } else if (
      (normalized.code === 'CORRUPTED_BACKUP_FILE' || normalized.code === 'INVALID_BACKUP_FILE') &&
      resolvedStage === 'validate'
    ) {
      resolvedErrorCode = 'RESTORE_DATA_VALIDATE_FAILED';
    } else if (normalized.code === 'UNSUPPORTED_BACKUP_VERSION' && resolvedStage === 'validate') {
      resolvedErrorCode = 'RESTORE_SCHEMA_UNSUPPORTED';
    }

    if (durations.tempCopyDurationMs === 0 && tempCopyStartedAt !== null && resolvedStage === 'temp_copy') {
      durations.tempCopyDurationMs = nowMs() - tempCopyStartedAt;
    }
    if (durations.packageReadDurationMs === 0 && packageReadStartedAt !== null && resolvedStage === 'package_read') {
      durations.packageReadDurationMs = nowMs() - packageReadStartedAt;
    }
    if (durations.validateDurationMs === 0 && validateStartedAt !== null && resolvedStage === 'validate') {
      durations.validateDurationMs = nowMs() - validateStartedAt;
    }
    if (
      durations.beforeSnapshotDurationMs === 0 &&
      beforeSnapshotStartedAt !== null &&
      resolvedStage === 'before_snapshot'
    ) {
      durations.beforeSnapshotDurationMs = nowMs() - beforeSnapshotStartedAt;
    }
    if (durations.dbImportDurationMs === 0 && dbImportStartedAt !== null && resolvedStage === 'db_import') {
      durations.dbImportDurationMs = nowMs() - dbImportStartedAt;
    }
    if (durations.imageRestoreDurationMs === 0 && imageRestoreStartedAt !== null && resolvedStage === 'images_restore') {
      durations.imageRestoreDurationMs = nowMs() - imageRestoreStartedAt;
    }
    if (durations.verifyDurationMs === 0 && verifyStartedAt !== null && resolvedStage === 'verify') {
      durations.verifyDurationMs = nowMs() - verifyStartedAt;
    }

    failureContext.errorCode = resolvedErrorCode;
    failureContext.stage = resolvedStage;
    failureContext.step = resolvedStep;
    failureContext.rootCause = normalized.cause ?? error;
    failureContext.warningCount = warnings.length;
    failureContext.hasBeforeRestoreBackup = !!beforeRestoreBackupUri;
    appendError(errors, {
      code: resolvedErrorCode,
      stage: resolvedStage,
      message: getBackupErrorUserMessage(resolvedErrorCode),
      shortTarget: fileShortInfo,
      rootCauseMessage: safeError(normalized.cause ?? error).message,
    });

    if (failureContext.stage === 'before_snapshot' && beforeRestoreBackupUri) {
      failureContext.rollbackAttempted = false;
      failureContext.rollbackSuccess = false;
    }

    const failureMetadata = buildFailureMetadata(failureContext);
    logRestoreEvent(SERVICE_SCOPE, 'error', 'restore_failed', {
      ...failureMetadata,
      fileShortInfo,
    });

    throw buildRestoreError({
      errorCode: resolvedErrorCode,
      stage: failureContext.stage,
      step: failureContext.step,
      cause: normalized.cause ?? normalized,
      userMessage: getBackupErrorUserMessage('RESTORE_FAILED'),
      details: {
        ...failureMetadata,
        fileShortInfo,
      },
    });
  } finally {
    const cleanupStartedAt = nowMs();
    const cleanupResult = cleanupRestoreTempDirectory(tempDirectory);
    durations.cleanupDurationMs = nowMs() - cleanupStartedAt;
    if (!cleanupResult.cleaned) {
      logRestoreEvent(SERVICE_SCOPE, 'warn', 'restore_cleanup_failed', {
        restoreSessionId,
        durationMs: durations.cleanupDurationMs,
        cleanupError: cleanupResult.error,
      });
    } else {
      logRestoreEvent(SERVICE_SCOPE, 'info', 'restore_cleanup_success', {
        restoreSessionId,
        durationMs: durations.cleanupDurationMs,
      });
    }
  }
}

export async function shareBackup(fileUri: string): Promise<void> {
  const sessionId = buildSessionId('backup');
  const startedAt = Date.now();

  try {
    const file = new File(fileUri);
    if (!file.exists) {
      throw new BackupRestoreError(
        'PERMISSION_OR_FILE_ACCESS_FAILED',
        getBackupErrorUserMessage('PERMISSION_OR_FILE_ACCESS_FAILED'),
      );
    }

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'));
    }

    logBackupEvent('backup_share_opened', sessionId, Date.now() - startedAt, {
      counts: EMPTY_COUNTS,
      warningCount: 0,
      reason: 'manual',
    });

    await Sharing.shareAsync(fileUri, {
      dialogTitle: 'Save backup file',
      mimeType: 'application/octet-stream',
      UTI: 'public.data',
    });
  } catch (error) {
    if (isUserCancelledShare(error)) {
      Logger.info(SERVICE_SCOPE, 'Backup share canceled by user.', {
        sessionId,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const normalized = normalizeBackupError(error, 'BACKUP_FAILED');
    Logger.error(SERVICE_SCOPE, 'backup_failed', {
      sessionId,
      counts: EMPTY_COUNTS,
      durationMs: Date.now() - startedAt,
      warningCount: 0,
      errorName: normalized.name,
      errorMessage: normalized.message,
      reason: 'manual',
    });
    throw normalized;
  }
}

export async function previewBackupPackage(): Promise<never> {
  throw createNotImplementedBackupError('previewBackupPackage');
}

export async function restoreFromBackupPackage(options: {
  backupUri: string;
  requireUserConfirmation: boolean;
  restoreSessionId?: string;
  fileShortInfo?: string;
}): Promise<RestoreFromBackupResult> {
  if (!options.requireUserConfirmation) {
    throw new BackupRestoreError('RESTORE_FAILED', getBackupErrorUserMessage('RESTORE_FAILED'));
  }
  return restoreFromBackup(options.backupUri, {
    restoreSessionId: options.restoreSessionId,
    fileShortInfo: options.fileShortInfo,
  });
}
