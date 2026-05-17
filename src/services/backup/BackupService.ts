import Constants from 'expo-constants';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { DATABASE_VERSION } from '@/src/db/constants';
import { MistakeImageRepository, MistakeRepository, ReviewRecordRepository } from '@/src/repositories';
import type { Mistake } from '@/src/models/Mistake';
import type { MistakeImage } from '@/src/models/MistakeImage';
import type { ReviewRecord } from '@/src/models/ReviewRecord';
import {
  BACKUP_IMAGES_DIR_NAME,
  createBackupManifest,
} from '@/src/services/backup/BackupManifest';
import { BackupRestoreError, createNotImplementedBackupError } from '@/src/services/backup/BackupRestoreError';
import {
  ensureBackupImageRelativePath,
  FflateBackupZipAdapter,
  type BackupZipAdapter,
} from '@/src/services/backup/BackupZipAdapter';
import {
  BACKUP_FILE_EXTENSION,
  BACKUP_FILE_NAME_PREFIX,
  type BackupCounts,
  type BackupDataPayload,
  type BackupDevicePlatform,
  type BackupImageArchiveFile,
  type BackupManifest,
  type BackupMistakeImageRecord,
  type CreateBackupOptions,
  type CreateBackupServiceResult,
} from '@/src/services/backup/BackupTypes';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'BackupService';
const BACKUP_QUERY_PAGE_SIZE = 200;

type RestoreFromBackupOptions = {
  backupUri: string;
  requireUserConfirmation: boolean;
};

type BackupCollectContext = {
  counts: BackupCounts;
  warningCount: number;
};

const EMPTY_COUNTS: BackupCounts = {
  mistakes: 0,
  mistakeImages: 0,
  reviewRecords: 0,
  imageFiles: 0,
};

let zipAdapter: BackupZipAdapter = new FflateBackupZipAdapter();

function buildSessionId(): string {
  return `backup-${Date.now()}-${Math.floor(Math.random() * 100000)
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

function toReadableError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    const trimmed = error.message.trim();
    if (trimmed.length > 0) {
      return error;
    }
  }
  return new Error(fallback);
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

function buildBackupFileName(date: Date = new Date()): string {
  const datePart = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const timePart = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${BACKUP_FILE_NAME_PREFIX}-${datePart}-${timePart}${BACKUP_FILE_EXTENSION}`;
}

function inferImageExtension(uri: string | null): string {
  if (!uri) {
    return 'jpg';
  }
  const matched = uri.match(/\.([a-zA-Z0-9]{1,8})(?:$|[?#])/);
  if (!matched) {
    return 'jpg';
  }
  return matched[1].toLowerCase();
}

function buildBackupRelativePath(imageId: string, sourceUri: string | null): string {
  const extension = inferImageExtension(sourceUri);
  return `${BACKUP_IMAGES_DIR_NAME}/${imageId}.${extension}`;
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

function logBackupEvent(
  message: string,
  sessionId: string,
  durationMs: number,
  context?: Partial<BackupCollectContext> & {
    errorName?: string | null;
    errorMessage?: string | null;
    reason?: string;
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
    const backupRelativePath = ensureBackupImageRelativePath(
      buildBackupRelativePath(image.id, sourceUri),
    );

    const mappedImage: BackupMistakeImageRecord = {
      id: image.id,
      mistake_id: image.mistake_id,
      review_record_id: image.review_record_id ?? null,
      type: image.type,
      sort_order: image.sort_order,
      created_at: image.created_at,
      sourceUri: null,
      backupRelativePath,
    };
    backupMistakeImages.push(mappedImage);

    if (!sourceUri) {
      warnings.push(
        `image_missing_uri:imageId=${image.id},mistakeId=${image.mistake_id},type=${image.type}`,
      );
      continue;
    }

    try {
      const sourceFile = new File(sourceUri);
      if (!sourceFile.exists) {
        warnings.push(
          `image_file_missing:imageId=${image.id},mistakeId=${image.mistake_id},type=${image.type}`,
        );
        continue;
      }

      const bytes = await sourceFile.bytes();
      archiveImages.push({
        backupRelativePath,
        bytes,
      });
      copiedImageCount += 1;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      warnings.push(
        `image_read_failed:imageId=${image.id},mistakeId=${image.mistake_id},type=${image.type},error=${errorName}`,
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

export function configureBackupZipAdapter(adapter: BackupZipAdapter): void {
  zipAdapter = adapter;
}

export async function createBackup(options?: CreateBackupOptions): Promise<CreateBackupServiceResult> {
  const sessionId = buildSessionId();
  const startedAt = Date.now();
  const reason = options?.reason ?? 'manual';
  const collectContext: BackupCollectContext = {
    counts: { ...EMPTY_COUNTS },
    warningCount: 0,
  };

  logBackupEvent('backup_start', sessionId, 0, {
    counts: collectContext.counts,
    warningCount: collectContext.warningCount,
    reason,
  });

  try {
    const [mistakes, mistakeImages, reviewRecords] = await Promise.all([
      listAllMistakes(),
      listAllMistakeImages(),
      listAllReviewRecords(),
    ]);

    collectContext.counts = {
      ...collectContext.counts,
      mistakes: mistakes.length,
      mistakeImages: mistakeImages.length,
      reviewRecords: reviewRecords.length,
    };

    logBackupEvent('backup_collect_db_done', sessionId, Date.now() - startedAt, {
      counts: collectContext.counts,
      warningCount: collectContext.warningCount,
      reason,
    });

    const imageArtifacts = await collectImageArtifacts(mistakeImages);
    collectContext.warningCount = imageArtifacts.warnings.length;
    collectContext.counts = {
      ...collectContext.counts,
      imageFiles: imageArtifacts.copiedImageCount,
    };

    logBackupEvent('backup_collect_images_done', sessionId, Date.now() - startedAt, {
      counts: collectContext.counts,
      warningCount: collectContext.warningCount,
      reason,
    });

    const appMeta = resolveAppMeta();
    const manifest: BackupManifest = createBackupManifest({
      appName: appMeta.appName,
      appVersion: appMeta.appVersion,
      schemaVersion: DATABASE_VERSION,
      devicePlatform: toBackupDevicePlatform(),
      counts: collectContext.counts,
      warnings: imageArtifacts.warnings,
    });

    const data: BackupDataPayload = {
      mistakes,
      mistakeImages: imageArtifacts.backupMistakeImages,
      reviewRecords,
      extra: {
        reason,
      },
    };

    const fileName = buildBackupFileName();
    const packaged = await zipAdapter.createBackupPackage({
      fileName,
      manifest,
      data,
      images: imageArtifacts.archiveImages,
    });

    logBackupEvent('backup_package_created', sessionId, Date.now() - startedAt, {
      counts: collectContext.counts,
      warningCount: collectContext.warningCount,
      reason,
    });

    return {
      fileUri: packaged.fileUri,
      manifest,
    };
  } catch (error) {
    const normalizedError = toReadableError(error, '备份失败，请稍后重试。');
    Logger.error(SERVICE_SCOPE, 'backup_failed', {
      sessionId,
      counts: collectContext.counts,
      durationMs: Date.now() - startedAt,
      warningCount: collectContext.warningCount,
      errorName: normalizedError.name,
      errorMessage: normalizedError.message,
      reason,
    });
    throw normalizedError;
  }
}

export async function shareBackup(fileUri: string): Promise<void> {
  const sessionId = buildSessionId();
  const startedAt = Date.now();

  try {
    const file = new File(fileUri);
    if (!file.exists) {
      throw new BackupRestoreError('FILE_IO_FAILED', '备份文件不存在，请重新备份。');
    }

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new BackupRestoreError('FILE_IO_FAILED', '当前设备暂不支持分享，请稍后重试。');
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

    const normalizedError = toReadableError(error, '分享失败，请稍后重试。');
    Logger.error(SERVICE_SCOPE, 'backup_failed', {
      sessionId,
      counts: EMPTY_COUNTS,
      durationMs: Date.now() - startedAt,
      warningCount: 0,
      errorName: normalizedError.name,
      errorMessage: normalizedError.message,
      reason: 'manual',
    });
    throw normalizedError;
  }
}

// Restore is intentionally postponed to the next stage.
export async function previewBackupPackage(): Promise<never> {
  throw createNotImplementedBackupError('previewBackupPackage');
}

// Restore is intentionally postponed to the next stage.
export async function restoreFromBackupPackage(_options: RestoreFromBackupOptions): Promise<never> {
  throw createNotImplementedBackupError('restoreFromBackupPackage');
}
