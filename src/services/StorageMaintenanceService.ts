import { Directory, File, Paths } from 'expo-file-system';

import { IMAGE_ROOT_DIR_NAME, MISTAKE_IMAGE_DIR_NAME } from '@/src/constants/image';
import { MistakeImageRepository } from '@/src/repositories';
import { deleteLocalImage, getImageInfo } from '@/src/services/ImageStorageService';
import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'StorageMaintenanceService';

export type StorageUsageCategoryId =
  | 'mistake_images'
  | 'edited_images'
  | 'voice_notes'
  | 'pdf_exports'
  | 'local_music'
  | 'database_and_settings'
  | 'other_documents'
  | 'temporary_cache';

export type StorageUsageCategory = {
  id: StorageUsageCategoryId;
  label: string;
  fileCount: number;
  totalBytes: number;
};

export type StorageUsageScanResult = {
  categories: StorageUsageCategory[];
  persistentFileCount: number;
  persistentBytes: number;
  cacheFileCount: number;
  cacheBytes: number;
  totalFileCount: number;
  totalBytes: number;
  unreadableEntryCount: number;
  scannedAt: number;
};

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

type StorageLocation = 'document' | 'cache';

type StorageCategoryDefinition = {
  id: StorageUsageCategoryId;
  label: string;
  location: StorageLocation;
  roots: Directory[];
};

type MutableStorageUsageCategory = StorageUsageCategory & {
  location: StorageLocation;
};

const STORAGE_SCAN_YIELD_INTERVAL = 120;

function getStorageCategoryDefinitions(): StorageCategoryDefinition[] {
  return [
    {
      id: 'mistake_images',
      label: '错题图片',
      location: 'document',
      roots: [new Directory(Paths.document, IMAGE_ROOT_DIR_NAME, MISTAKE_IMAGE_DIR_NAME)],
    },
    {
      id: 'edited_images',
      label: '编辑图片',
      location: 'document',
      roots: [new Directory(Paths.document, 'qishua_images')],
    },
    {
      id: 'voice_notes',
      label: '语音讲解',
      location: 'document',
      roots: [new Directory(Paths.document, 'voice-notes')],
    },
    {
      id: 'pdf_exports',
      label: 'PDF 导出',
      location: 'document',
      roots: [new Directory(Paths.document, IMAGE_ROOT_DIR_NAME, 'exports')],
    },
    {
      id: 'local_music',
      label: '本地音乐',
      location: 'document',
      roots: [new Directory(Paths.document, 'app-music')],
    },
    {
      id: 'database_and_settings',
      label: '数据库与设置',
      location: 'document',
      roots: [
        new Directory(Paths.document, 'SQLite'),
        new Directory(Paths.document, IMAGE_ROOT_DIR_NAME, 'settings'),
      ],
    },
    {
      id: 'other_documents',
      label: '其他文档',
      location: 'document',
      roots: [],
    },
    {
      id: 'temporary_cache',
      label: '临时缓存',
      location: 'cache',
      roots: [new Directory(Paths.cache)],
    },
  ];
}

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

function isUriWithinDirectory(fileUri: string, directory: Directory): boolean {
  const normalizedFileUri = normalizeUri(fileUri);
  const normalizedDirectoryUri = normalizeUri(directory.uri);
  if (!normalizedFileUri || !normalizedDirectoryUri) {
    return false;
  }
  return (
    normalizedFileUri === normalizedDirectoryUri
    || normalizedFileUri.startsWith(`${normalizedDirectoryUri}/`)
  );
}

function createStorageUsageCategories(
  definitions: StorageCategoryDefinition[],
): Map<StorageUsageCategoryId, MutableStorageUsageCategory> {
  return new Map(
    definitions.map((definition) => [
      definition.id,
      {
        id: definition.id,
        label: definition.label,
        location: definition.location,
        fileCount: 0,
        totalBytes: 0,
      },
    ]),
  );
}

function resolveStorageCategoryId(
  fileUri: string,
  location: StorageLocation,
  definitions: StorageCategoryDefinition[],
): StorageUsageCategoryId {
  if (location === 'cache') {
    return 'temporary_cache';
  }

  const matched = definitions.find((definition) => (
    definition.location === 'document'
    && definition.id !== 'other_documents'
    && definition.roots.some((root) => isUriWithinDirectory(fileUri, root))
  ));
  return matched?.id ?? 'other_documents';
}

function yieldStorageScanToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function scanStorageRoot(
  root: Directory,
  location: StorageLocation,
  definitions: StorageCategoryDefinition[],
  categories: Map<StorageUsageCategoryId, MutableStorageUsageCategory>,
): Promise<{ unreadableEntryCount: number }> {
  const directories: Directory[] = [root];
  let unreadableEntryCount = 0;
  let processedEntryCount = 0;

  while (directories.length > 0) {
    const directory = directories.pop();
    if (!directory) {
      continue;
    }

    let entries: (Directory | File)[];
    try {
      if (!directory.exists) {
        continue;
      }
      entries = directory.list();
    } catch (error) {
      unreadableEntryCount += 1;
      Logger.warn(SERVICE_SCOPE, 'Failed to read directory during storage usage scan.', {
        location,
        directoryUriPreview: toUriPreview(directory.uri),
        error,
      });
      continue;
    }

    for (const entry of entries) {
      processedEntryCount += 1;
      if (entry instanceof Directory) {
        directories.push(entry);
      } else if (entry instanceof File) {
        const categoryId = resolveStorageCategoryId(entry.uri, location, definitions);
        const category = categories.get(categoryId);
        if (!category) {
          unreadableEntryCount += 1;
          continue;
        }

        category.fileCount += 1;
        try {
          const info = entry.info();
          if (info.exists && typeof info.size === 'number' && Number.isFinite(info.size) && info.size > 0) {
            category.totalBytes += info.size;
          }
        } catch (error) {
          unreadableEntryCount += 1;
          Logger.warn(SERVICE_SCOPE, 'Failed to read file size during storage usage scan.', {
            location,
            fileUriPreview: toUriPreview(entry.uri),
            error,
          });
        }
      }

      if (processedEntryCount % STORAGE_SCAN_YIELD_INTERVAL === 0) {
        await yieldStorageScanToUi();
      }
    }
  }

  return { unreadableEntryCount };
}

export async function scanStorageUsage(): Promise<StorageUsageScanResult> {
  const startedAt = Date.now();
  Logger.info(SERVICE_SCOPE, 'Start scanning categorized storage usage.');

  try {
    const definitions = getStorageCategoryDefinitions();
    const mutableCategories = createStorageUsageCategories(definitions);
    const documentResult = await scanStorageRoot(
      new Directory(Paths.document),
      'document',
      definitions,
      mutableCategories,
    );
    const cacheResult = await scanStorageRoot(
      new Directory(Paths.cache),
      'cache',
      definitions,
      mutableCategories,
    );
    const categories = definitions.map((definition): StorageUsageCategory => {
      const category = mutableCategories.get(definition.id);
      return {
        id: definition.id,
        label: definition.label,
        fileCount: category?.fileCount ?? 0,
        totalBytes: category?.totalBytes ?? 0,
      };
    });
    const persistentCategories = definitions
      .filter((definition) => definition.location === 'document')
      .map((definition) => mutableCategories.get(definition.id));
    const cacheCategory = mutableCategories.get('temporary_cache');
    const persistentFileCount = persistentCategories.reduce(
      (total, category) => total + (category?.fileCount ?? 0),
      0,
    );
    const persistentBytes = persistentCategories.reduce(
      (total, category) => total + (category?.totalBytes ?? 0),
      0,
    );
    const cacheFileCount = cacheCategory?.fileCount ?? 0;
    const cacheBytes = cacheCategory?.totalBytes ?? 0;
    const result: StorageUsageScanResult = {
      categories,
      persistentFileCount,
      persistentBytes,
      cacheFileCount,
      cacheBytes,
      totalFileCount: persistentFileCount + cacheFileCount,
      totalBytes: persistentBytes + cacheBytes,
      unreadableEntryCount:
        documentResult.unreadableEntryCount + cacheResult.unreadableEntryCount,
      scannedAt: Date.now(),
    };

    Logger.info(SERVICE_SCOPE, 'Finished scanning categorized storage usage.', {
      elapsedMs: Date.now() - startedAt,
      persistentFileCount: result.persistentFileCount,
      persistentBytes: result.persistentBytes,
      cacheFileCount: result.cacheFileCount,
      cacheBytes: result.cacheBytes,
      unreadableEntryCount: result.unreadableEntryCount,
    });
    return result;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to scan categorized storage usage.', {
      elapsedMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
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
    // Re-check references immediately before deletion. A file may have become
    // referenced after the scan result was shown in the confirmation dialog.
    const currentReferencedUris = await MistakeImageRepository.listAllImageUris();
    const currentReferencedSet = new Set(
      currentReferencedUris
        .map((uri) => normalizeUri(uri))
        .filter((uri): uri is string => typeof uri === 'string'),
    );

    for (const targetUri of normalizedTargets) {
      if (currentReferencedSet.has(targetUri)) {
        Logger.info(SERVICE_SCOPE, 'Skip image that is now referenced by a mistake.', {
          uriPreview: toUriPreview(targetUri),
        });
        continue;
      }

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
