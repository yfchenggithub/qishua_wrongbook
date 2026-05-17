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
  type RestoreFromBackupResult,
} from '@/src/services/backup/BackupTypes';

const SERVICE_SCOPE = 'BackupService';
const BACKUP_QUERY_PAGE_SIZE = 200;
const RESTORE_TEMP_DIR_NAME = 'qishua_wrongbook_restore_tmp';
const RESTORE_IMAGE_EXTENSION_FALLBACK = 'jpg';

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

type RestoreCollectContext = {
  counts: BackupCounts;
  warningCount: number;
};

type ExtractedBackupArchive = {
  tempDirectory: Directory;
  data: BackupDataPayload;
  archiveFileMap: Map<string, File>;
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
  const appName = normalizeOptionalText(Constants.expoConfig?.name) ?? '七刷错题本';
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
  if (!normalized) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length <= 0 || segment === '..')) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }
  return normalized;
}

function getFileShortInfo(fileUri: string): string {
  try {
    const file = new File(fileUri);
    const name = normalizeOptionalText(file.name) ?? 'unknown.qsbk';
    return name.length <= 48 ? name : `${name.slice(0, 24)}...${name.slice(-18)}`;
  } catch {
    return 'unknown.qsbk';
  }
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

function logRestoreInspectEvent(
  message: string,
  sessionId: string,
  fileShortInfo: string,
  context?: {
    durationMs?: number;
    counts?: BackupCounts;
    warningCount?: number;
    errorName?: string | null;
    errorMessage?: string | null;
  },
): void {
  Logger.info(SERVICE_SCOPE, message, {
    sessionId,
    fileShortInfo,
    durationMs: context?.durationMs ?? 0,
    counts: context?.counts ?? EMPTY_COUNTS,
    warningCount: context?.warningCount ?? 0,
    errorName: context?.errorName ?? null,
    errorMessage: context?.errorMessage ?? null,
  });
}

function logRestoreEvent(
  message: string,
  restoreSessionId: string,
  startedAt: number,
  context?: Partial<RestoreCollectContext> & {
    errorName?: string | null;
    errorMessage?: string | null;
  },
): void {
  Logger.info(SERVICE_SCOPE, message, {
    restoreSessionId,
    counts: context?.counts ?? EMPTY_COUNTS,
    durationMs: Date.now() - startedAt,
    warningCount: context?.warningCount ?? 0,
    errorName: context?.errorName ?? null,
    errorMessage: context?.errorMessage ?? null,
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

function cleanupRestoreTempDirectory(directory: Directory | null): void {
  if (!directory) {
    return;
  }
  try {
    if (directory.exists) {
      directory.delete();
    }
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to cleanup restore temp directory.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

async function extractBackupArchiveToTemp(
  fileUri: string,
  restoreSessionId: string,
): Promise<ExtractedBackupArchive> {
  const sourceFile = new File(fileUri);
  if (!sourceFile.exists) {
    throw new BackupRestoreError(
      'PERMISSION_OR_FILE_ACCESS_FAILED',
      getBackupErrorUserMessage('PERMISSION_OR_FILE_ACCESS_FAILED'),
    );
  }

  let archiveEntries: Record<string, Uint8Array>;
  try {
    archiveEntries = unzipSync(await sourceFile.bytes());
  } catch {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  const tempDirectory = new Directory(Paths.cache, RESTORE_TEMP_DIR_NAME, restoreSessionId);
  tempDirectory.create({ intermediates: true, idempotent: true });

  const archiveFileMap = new Map<string, File>();

  for (const [entryPath, bytes] of Object.entries(archiveEntries)) {
    const normalizedPath = normalizeArchiveEntryPath(entryPath);
    if (normalizedPath.endsWith('/')) {
      const dir = new Directory(tempDirectory, normalizedPath);
      dir.create({ intermediates: true, idempotent: true });
      continue;
    }

    const slashIndex = normalizedPath.lastIndexOf('/');
    if (slashIndex >= 0) {
      const parentPath = normalizedPath.slice(0, slashIndex);
      if (parentPath.trim().length > 0) {
        const parentDir = new Directory(tempDirectory, parentPath);
        parentDir.create({ intermediates: true, idempotent: true });
      }
    }

    const extractedFile = new File(tempDirectory, normalizedPath);
    extractedFile.create({ intermediates: true, overwrite: true });
    extractedFile.write(bytes);
    archiveFileMap.set(normalizedPath, extractedFile);
  }

  const dataFile = archiveFileMap.get(BACKUP_DATA_FILE_NAME);
  if (!dataFile || !dataFile.exists) {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  let parsedDataRaw: unknown;
  try {
    parsedDataRaw = JSON.parse(strFromU8(await dataFile.bytes()));
  } catch {
    throw new BackupRestoreError(
      'CORRUPTED_BACKUP_FILE',
      getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
    );
  }

  const data = validateBackupDataPayload(parsedDataRaw);
  ensureBackupPayloadRelations(data);

  return {
    tempDirectory,
    data,
    archiveFileMap,
  };
}

async function materializeRestoredImages(
  images: BackupMistakeImageRecord[],
  archiveFileMap: Map<string, File>,
): Promise<{ restoredImages: RestoredMistakeImageInsert[]; warningCount: number }> {
  const restoredImages: RestoredMistakeImageInsert[] = [];
  let warningCount = 0;

  for (const image of images) {
    const normalizedArchivePath = normalizeArchiveEntryPath(
      ensureBackupImageRelativePath(ensureRecordId(image.backupRelativePath)),
    );
    const sourceFile = archiveFileMap.get(normalizedArchivePath);
    if (!sourceFile || !sourceFile.exists) {
      warningCount += 1;
      continue;
    }

    const targetDirectoryUri = await ensureMistakeImageDir(image.mistake_id);
    const targetDirectory = new Directory(targetDirectoryUri);
    targetDirectory.create({ intermediates: true, idempotent: true });

    const targetFile = new File(targetDirectory, mapImageUriForRestore(image));
    if (targetFile.exists) {
      targetFile.delete();
    }
    sourceFile.copy(targetFile);

    restoredImages.push({
      id: image.id,
      mistake_id: image.mistake_id,
      review_record_id: image.review_record_id ?? null,
      type: image.type,
      sort_order: image.sort_order,
      created_at: image.created_at,
      uri: targetFile.uri,
    });
  }

  return {
    restoredImages,
    warningCount,
  };
}

async function runRestoreDatabaseTransaction(
  data: BackupDataPayload,
  restoredImages: RestoredMistakeImageInsert[],
): Promise<BackupCounts> {
  try {
    await withDatabaseTransaction(async (db) => {
      await db.runAsync('DELETE FROM review_records;');
      await db.runAsync('DELETE FROM mistake_images;');
      await db.runAsync('DELETE FROM mistakes;');

      for (const mistake of data.mistakes) {
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
      }

      for (const reviewRecord of data.reviewRecords) {
        await db.runAsync(
          INSERT_REVIEW_RECORD_SQL,
          reviewRecord.id,
          reviewRecord.mistake_id,
          reviewRecord.review_index,
          reviewRecord.result,
          reviewRecord.note ?? null,
          reviewRecord.created_at,
        );
      }

      for (const image of restoredImages) {
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
      }
    });
  } catch (error) {
    throw new BackupRestoreError('RESTORE_FAILED', getBackupErrorUserMessage('RESTORE_FAILED'), {
      cause: error,
    });
  }

  return ensureValidCounts({
    mistakes: data.mistakes.length,
    mistakeImages: restoredImages.length,
    reviewRecords: data.reviewRecords.length,
    imageFiles: restoredImages.length,
  });
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

export async function inspectBackup(fileUri: string): Promise<InspectBackupResult> {
  const sessionId = buildSessionId('restore');
  const fileShortInfo = getFileShortInfo(fileUri);
  const startedAt = Date.now();

  logRestoreInspectEvent('restore_inspect_start', sessionId, fileShortInfo, {
    durationMs: 0,
  });

  try {
    const normalizedUri = normalizeOptionalText(fileUri);
    if (!normalizedUri) {
      throw new BackupRestoreError(
        'INVALID_BACKUP_FILE',
        getBackupErrorUserMessage('INVALID_BACKUP_FILE'),
      );
    }

    const file = new File(normalizedUri);
    const fileName = normalizeOptionalText(file.name)?.toLowerCase() ?? '';
    if (!fileName.endsWith(BACKUP_FILE_EXTENSION)) {
      throw new BackupRestoreError(
        'INVALID_BACKUP_FILE',
        getBackupErrorUserMessage('INVALID_BACKUP_FILE'),
      );
    }
    if (!file.exists) {
      throw new BackupRestoreError(
        'PERMISSION_OR_FILE_ACCESS_FAILED',
        getBackupErrorUserMessage('PERMISSION_OR_FILE_ACCESS_FAILED'),
      );
    }

    let archiveEntries: Record<string, Uint8Array>;
    try {
      archiveEntries = unzipSync(await file.bytes());
    } catch {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }

    const manifestBytes = archiveEntries[BACKUP_MANIFEST_FILE_NAME];
    if (!manifestBytes) {
      throw new BackupRestoreError(
        'INVALID_BACKUP_FILE',
        getBackupErrorUserMessage('INVALID_BACKUP_FILE'),
      );
    }

    let manifestRaw: unknown;
    try {
      manifestRaw = JSON.parse(strFromU8(manifestBytes));
    } catch {
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }

    const validated = validateBackupManifest(manifestRaw);
    if (!validated.ok || !validated.manifest) {
      if (validated.errors.some((item) => item.includes('format'))) {
        throw new BackupRestoreError(
          'INVALID_BACKUP_FILE',
          getBackupErrorUserMessage('INVALID_BACKUP_FILE'),
        );
      }
      throw new BackupRestoreError(
        'CORRUPTED_BACKUP_FILE',
        getBackupErrorUserMessage('CORRUPTED_BACKUP_FILE'),
      );
    }

    const manifest = validated.manifest;
    if (manifest.format !== BACKUP_FORMAT) {
      throw new BackupRestoreError(
        'INVALID_BACKUP_FILE',
        getBackupErrorUserMessage('INVALID_BACKUP_FILE'),
      );
    }
    if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new BackupRestoreError(
        'UNSUPPORTED_BACKUP_VERSION',
        getBackupErrorUserMessage('UNSUPPORTED_BACKUP_VERSION'),
      );
    }

    const normalizedManifest = ensureManifestRequiredFields(manifest);
    const warnings = Array.isArray(normalizedManifest.warnings) ? normalizedManifest.warnings : [];
    logRestoreInspectEvent('restore_inspect_done', sessionId, fileShortInfo, {
      durationMs: Date.now() - startedAt,
      counts: normalizedManifest.counts,
      warningCount: warnings.length,
    });

    return {
      manifest: normalizedManifest,
      warnings,
    };
  } catch (error) {
    const normalized = normalizeBackupError(error, 'RESTORE_FAILED');
    Logger.error(SERVICE_SCOPE, 'restore_inspect_failed', {
      sessionId,
      fileShortInfo,
      durationMs: Date.now() - startedAt,
      counts: EMPTY_COUNTS,
      warningCount: 0,
      errorName: normalized.name,
      errorMessage: normalized.message,
    });
    throw normalized;
  }
}

export async function restoreFromBackup(fileUri: string): Promise<RestoreFromBackupResult> {
  const restoreSessionId = buildSessionId('restore');
  const startedAt = Date.now();
  const context: RestoreCollectContext = {
    counts: { ...EMPTY_COUNTS },
    warningCount: 0,
  };

  let tempDirectory: Directory | null = null;
  let beforeRestoreBackupUri: string | undefined;

  try {
    const inspected = await inspectBackup(fileUri);
    context.warningCount = inspected.warnings.length;
    context.counts = ensureValidCounts(inspected.manifest.counts);

    logRestoreEvent('before_restore_backup_start', restoreSessionId, startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
    });
    const safetyBackup = await createBackup({ reason: 'before_restore' });
    beforeRestoreBackupUri = safetyBackup.fileUri;
    logRestoreEvent('before_restore_backup_done', restoreSessionId, startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
    });

    const extracted = await extractBackupArchiveToTemp(fileUri, restoreSessionId);
    tempDirectory = extracted.tempDirectory;
    context.counts = {
      mistakes: extracted.data.mistakes.length,
      mistakeImages: extracted.data.mistakeImages.length,
      reviewRecords: extracted.data.reviewRecords.length,
      imageFiles: extracted.data.mistakeImages.length,
    };
    logRestoreEvent('restore_extract_done', restoreSessionId, startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
    });

    const restoredImageArtifacts = await materializeRestoredImages(
      extracted.data.mistakeImages,
      extracted.archiveFileMap,
    );
    context.warningCount += restoredImageArtifacts.warningCount;

    if (restoredImageArtifacts.warningCount > 0) {
      Logger.warn(SERVICE_SCOPE, 'Some images are missing during restore materialization.', {
        restoreSessionId,
        warningCount: restoredImageArtifacts.warningCount,
      });
    }

    logRestoreEvent('restore_db_transaction_start', restoreSessionId, startedAt, {
      counts: {
        mistakes: extracted.data.mistakes.length,
        mistakeImages: restoredImageArtifacts.restoredImages.length,
        reviewRecords: extracted.data.reviewRecords.length,
        imageFiles: restoredImageArtifacts.restoredImages.length,
      },
      warningCount: context.warningCount,
    });

    const restoredCounts = await runRestoreDatabaseTransaction(
      extracted.data,
      restoredImageArtifacts.restoredImages,
    );
    context.counts = restoredCounts;

    logRestoreEvent('restore_db_transaction_done', restoreSessionId, startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
    });

    logRestoreEvent('restore_success', restoreSessionId, startedAt, {
      counts: context.counts,
      warningCount: context.warningCount,
    });

    return {
      restoredMistakes: context.counts.mistakes,
      restoredImages: context.counts.mistakeImages,
      restoredReviewRecords: context.counts.reviewRecords,
      beforeRestoreBackupUri,
    };
  } catch (error) {
    const normalized = normalizeBackupError(error, 'RESTORE_FAILED');
    Logger.error(SERVICE_SCOPE, 'restore_failed', {
      restoreSessionId,
      counts: context.counts,
      durationMs: Date.now() - startedAt,
      warningCount: context.warningCount,
      errorName: normalized.name,
      errorMessage: normalized.message,
      hasBeforeRestoreBackup: !!beforeRestoreBackupUri,
    });

    if (normalized.code === 'RESTORE_FAILED') {
      throw normalized;
    }

    throw new BackupRestoreError('RESTORE_FAILED', getBackupErrorUserMessage('RESTORE_FAILED'), {
      cause: normalized,
      details: {
        hasBeforeRestoreBackup: !!beforeRestoreBackupUri,
      },
    });
  } finally {
    cleanupRestoreTempDirectory(tempDirectory);
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
      dialogTitle: '保存备份文件',
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
}): Promise<RestoreFromBackupResult> {
  if (!options.requireUserConfirmation) {
    throw new BackupRestoreError('RESTORE_FAILED', getBackupErrorUserMessage('RESTORE_FAILED'));
  }
  return restoreFromBackup(options.backupUri);
}
