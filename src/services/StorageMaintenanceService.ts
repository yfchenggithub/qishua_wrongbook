import { Directory, File, Paths } from 'expo-file-system';

import { IMAGE_ROOT_DIR_NAME, MISTAKE_IMAGE_DIR_NAME } from '@/src/constants/image';
import { MistakeImageRepository } from '@/src/repositories';
import { deleteLocalImage, getImageInfo } from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'StorageMaintenanceService';

export type OrphanImageScanResult = {
  orphanCount: number;
  orphanBytes: number;
  orphanFiles: string[];
  scannedFileCount: number;
  referencedImageCount: number;
};

export type OrphanImageCleanupResult = {
  scannedOrphanCount: number;
  deletedCount: number;
  failedCount: number;
  releasedBytes: number;
};

function normalizeUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') {
    return null;
  }
  const trimmed = uri.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
}

function toUriPreview(uri: string | null | undefined): string | null {
  const normalized = normalizeUri(uri);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 72) {
    return normalized;
  }
  return `${normalized.slice(0, 28)}...${normalized.slice(-20)}`;
}

function getMistakeImageRootDir(): Directory {
  return new Directory(Paths.document, IMAGE_ROOT_DIR_NAME, MISTAKE_IMAGE_DIR_NAME);
}

function listAllImageFilesFromDirectory(directory: Directory): File[] {
  const entries = directory.list();
  const files: File[] = [];

  for (const entry of entries) {
    if (entry instanceof File) {
      files.push(entry);
      continue;
    }

    if (entry instanceof Directory) {
      files.push(...listAllImageFilesFromDirectory(entry));
    }
  }

  return files;
}

export async function scanOrphanImageFiles(): Promise<OrphanImageScanResult> {
  const startedAt = Date.now();
  Logger.info(SERVICE_SCOPE, 'Start scanning orphan image files.');

  try {
    const referencedUris = await MistakeImageRepository.listAllImageUris();
    const referencedSet = new Set(
      referencedUris
        .map((uri) => normalizeUri(uri))
        .filter((uri): uri is string => typeof uri === 'string'),
    );

    const imageRootDir = getMistakeImageRootDir();
    if (!imageRootDir.exists) {
      const emptyResult: OrphanImageScanResult = {
        orphanCount: 0,
        orphanBytes: 0,
        orphanFiles: [],
        scannedFileCount: 0,
        referencedImageCount: referencedSet.size,
      };
      Logger.info(SERVICE_SCOPE, 'Image root directory is missing, skip orphan scan.', {
        elapsedMs: Date.now() - startedAt,
      });
      return emptyResult;
    }

    const localFiles = listAllImageFilesFromDirectory(imageRootDir);
    const orphanFiles: string[] = [];
    let orphanBytes = 0;

    for (const file of localFiles) {
      const normalizedUri = normalizeUri(file.uri);
      if (!normalizedUri || referencedSet.has(normalizedUri)) {
        continue;
      }

      orphanFiles.push(file.uri);

      const info = await getImageInfo(file.uri);
      if (info.exists && typeof info.size === 'number' && Number.isFinite(info.size) && info.size > 0) {
        orphanBytes += info.size;
      }
    }

    const result: OrphanImageScanResult = {
      orphanCount: orphanFiles.length,
      orphanBytes,
      orphanFiles,
      scannedFileCount: localFiles.length,
      referencedImageCount: referencedSet.size,
    };

    Logger.info(SERVICE_SCOPE, 'Finished scanning orphan image files.', {
      elapsedMs: Date.now() - startedAt,
      scannedFileCount: result.scannedFileCount,
      orphanCount: result.orphanCount,
      orphanBytes: result.orphanBytes,
      referencedImageCount: result.referencedImageCount,
    });

    return result;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to scan orphan image files.', {
      elapsedMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

export async function cleanupOrphanImageFiles(orphanFiles: string[]): Promise<OrphanImageCleanupResult> {
  const startedAt = Date.now();
  const normalizedTargets = Array.from(
    new Set(
      orphanFiles
        .map((uri) => normalizeUri(uri))
        .filter((uri): uri is string => typeof uri === 'string'),
    ),
  );

  Logger.info(SERVICE_SCOPE, 'Start cleaning orphan image files.', {
    targetCount: normalizedTargets.length,
  });

  let deletedCount = 0;
  let failedCount = 0;
  let releasedBytes = 0;

  try {
    for (const targetUri of normalizedTargets) {
      const info = await getImageInfo(targetUri);
      if (!info.exists) {
        deletedCount += 1;
        continue;
      }

      const fileSize =
        typeof info.size === 'number' && Number.isFinite(info.size) && info.size > 0
          ? info.size
          : 0;

      const deleted = await deleteLocalImage(targetUri);
      if (!deleted) {
        failedCount += 1;
        Logger.warn(SERVICE_SCOPE, 'Failed to delete orphan image file.', {
          uriPreview: toUriPreview(targetUri),
        });
        continue;
      }

      deletedCount += 1;
      releasedBytes += fileSize;
    }

    const result: OrphanImageCleanupResult = {
      scannedOrphanCount: normalizedTargets.length,
      deletedCount,
      failedCount,
      releasedBytes,
    };

    Logger.info(SERVICE_SCOPE, 'Finished cleaning orphan image files.', {
      elapsedMs: Date.now() - startedAt,
      deletedCount: result.deletedCount,
      failedCount: result.failedCount,
      releasedBytes: result.releasedBytes,
    });

    return result;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed while cleaning orphan image files.', {
      elapsedMs: Date.now() - startedAt,
      deletedCount,
      failedCount,
      releasedBytes,
      error,
    });
    throw error;
  }
}
