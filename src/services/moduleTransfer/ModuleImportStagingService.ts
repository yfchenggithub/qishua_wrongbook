import { Directory, File, Paths, type FileHandle } from 'expo-file-system';
import { Unzip, UnzipInflate } from 'fflate';

import {
  MODULE_PACKAGE_DATA_FILE_NAME,
  MODULE_PACKAGE_MANIFEST_FILE_NAME,
  type ModulePackageArchiveEntry,
} from '@/src/models/ModulePackage';
import { Logger } from '@/src/services/Logger';
import type { ParsedModulePackagePreview } from '@/src/services/moduleTransfer/ModuleImportPreviewTypes';
import type {
  ModuleImportStagingFailureCode,
  StagedModuleImportAsset,
  StagedModuleImportPackage,
} from '@/src/services/moduleTransfer/ModuleImportStagingTypes';
import { MODULE_PACKAGE_LIMITS } from '@/src/services/moduleTransfer/ModulePackageValidator';

const SERVICE_SCOPE = 'ModuleImportStagingService';
const STAGING_ROOT_DIRECTORY_NAME = 'qishua_module_imports';
const ARCHIVE_STREAM_CHUNK_BYTES = 512 * 1024;
const MAX_ARCHIVE_PATH_LENGTH = 256;
const MAX_SESSION_DIRECTORY_ATTEMPTS = 20;
const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

type ImageSignatureState = {
  firstBytes: number[];
  lastBytes: number[];
};

export class ModuleImportStagingError extends Error {
  constructor(
    readonly code: ModuleImportStagingFailureCode,
    message: string,
    readonly entryPath?: string,
  ) {
    super(message);
    this.name = 'ModuleImportStagingError';
  }
}

function closeFileHandleBestEffort(handle: FileHandle | null): void {
  if (!handle) {
    return;
  }
  try {
    handle.close();
  } catch {
    // Best-effort cleanup only.
  }
}

function getFileSize(file: File): number {
  try {
    const info = file.info();
    if (typeof info.size === 'number' && Number.isFinite(info.size) && info.size >= 0) {
      return Math.floor(info.size);
    }
  } catch {
    // File.size may still be available.
  }
  return typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0
    ? Math.floor(file.size)
    : 0;
}

function createStagingDirectory(): Directory {
  const root = new Directory(Paths.cache, STAGING_ROOT_DIRECTORY_NAME);
  root.create({ intermediates: true, idempotent: true });
  for (let attempt = 0; attempt < MAX_SESSION_DIRECTORY_ATTEMPTS; attempt += 1) {
    const randomPart = Math.random().toString(36).slice(2, 12);
    const directory = new Directory(root, `import-${Date.now()}-${randomPart}`);
    if (!directory.exists) {
      directory.create({ intermediates: true });
      return directory;
    }
  }
  throw new ModuleImportStagingError(
    'image_write_failed',
    '无法创建独立的题包导入临时目录。',
  );
}

function validateEntryPath(pathInput: string): { path: string; isDirectory: boolean } {
  const path = typeof pathInput === 'string' ? pathInput : '';
  if (
    !path
    || path.length > MAX_ARCHIVE_PATH_LENGTH
    || path.includes('\\')
    || path.startsWith('/')
    || path.includes('\0')
    || /^[A-Za-z]:/.test(path)
  ) {
    throw new ModuleImportStagingError(
      'unsafe_entry_path',
      '题包暂存时发现不安全的 ZIP 路径。',
      path || undefined,
    );
  }
  const isDirectory = path.endsWith('/');
  const effectivePath = isDirectory ? path.slice(0, -1) : path;
  if (
    !effectivePath
    || effectivePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new ModuleImportStagingError(
      'unsafe_entry_path',
      '题包暂存时发现不安全的 ZIP 路径。',
      path,
    );
  }
  return { path, isDirectory };
}

function getEntrySizeLimit(path: string, isDirectory: boolean): number {
  if (isDirectory) {
    return 0;
  }
  const comparablePath = path.toLocaleLowerCase();
  if (comparablePath === MODULE_PACKAGE_MANIFEST_FILE_NAME) {
    return MODULE_PACKAGE_LIMITS.maxManifestBytes;
  }
  if (comparablePath === MODULE_PACKAGE_DATA_FILE_NAME) {
    return MODULE_PACKAGE_LIMITS.maxDataBytes;
  }
  return MODULE_PACKAGE_LIMITS.maxImageBytes;
}

function updateImageSignature(state: ImageSignatureState, chunk: Uint8Array): void {
  for (let index = 0; index < chunk.length && state.firstBytes.length < 3; index += 1) {
    state.firstBytes.push(chunk[index]);
  }
  if (chunk.length >= 2) {
    state.lastBytes = [chunk[chunk.length - 2], chunk[chunk.length - 1]];
  } else if (chunk.length === 1) {
    state.lastBytes = state.lastBytes.length >= 2
      ? [state.lastBytes[1], chunk[0]]
      : [...state.lastBytes, chunk[0]].slice(-2);
  }
}

function hasJpegSignature(state: ImageSignatureState): boolean {
  return state.firstBytes.length === 3
    && state.firstBytes[0] === 0xff
    && state.firstBytes[1] === 0xd8
    && state.firstBytes[2] === 0xff
    && state.lastBytes.length === 2
    && state.lastBytes[0] === 0xff
    && state.lastBytes[1] === 0xd9;
}

function buildExpectedEntryMap(
  entries: ModulePackageArchiveEntry[],
): Map<string, ModulePackageArchiveEntry> {
  return new Map(entries.map((entry) => [
    entry.relativePath.replace(/\/$/, '').toLocaleLowerCase(),
    entry,
  ]));
}

export function cleanupStagedModuleImport(staged: StagedModuleImportPackage | null): boolean {
  if (!staged) {
    return true;
  }
  try {
    const directory = new Directory(staged.directoryUri);
    if (directory.exists) {
      directory.delete();
    }
    return true;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to clean staged module import.', error);
    return false;
  }
}

export async function stageModulePackageImages(
  parsed: ParsedModulePackagePreview,
): Promise<StagedModuleImportPackage> {
  let sourceFile: File;
  try {
    sourceFile = new File(parsed.sourceFileUri);
    if (!sourceFile.exists) {
      throw new ModuleImportStagingError('source_file_missing', '题包源文件已不可访问。');
    }
  } catch (error) {
    if (error instanceof ModuleImportStagingError) {
      throw error;
    }
    throw new ModuleImportStagingError('source_file_missing', '题包源文件已不可访问。');
  }
  const compressedSizeBytes = getFileSize(sourceFile);
  if (compressedSizeBytes !== parsed.preview.compressedSizeBytes) {
    throw new ModuleImportStagingError(
      'archive_changed',
      '题包文件在预览后发生了变化，请重新选择。',
    );
  }

  const stagingDirectory = createStagingDirectory();
  const stagedShell: StagedModuleImportPackage = {
    directoryUri: stagingDirectory.uri,
    assets: [],
  };
  const expectedEntryByPath = buildExpectedEntryMap(parsed.entries);
  const expectedImageByPath = new Map(
    parsed.images.map((image) => [image.relativePath.toLocaleLowerCase(), image]),
  );
  const stagedByAssetId = new Map<string, StagedModuleImportAsset>();
  const seenPaths = new Set<string>();
  const openHandles = new Set<FileHandle>();
  let streamError: unknown | null = null;
  let entryCount = 0;
  let totalUncompressedSizeBytes = 0;

  const unzipper = new Unzip((entry) => {
    if (streamError) {
      return;
    }
    try {
      entryCount += 1;
      if (entryCount > MODULE_PACKAGE_LIMITS.maxArchiveEntries) {
        throw new ModuleImportStagingError(
          'entry_limit_exceeded',
          '题包 ZIP 条目数量超过限制。',
        );
      }
      const normalized = validateEntryPath(entry.name);
      const comparablePath = normalized.path.replace(/\/$/, '').toLocaleLowerCase();
      if (seenPaths.has(comparablePath)) {
        throw new ModuleImportStagingError(
          'archive_changed',
          '题包暂存时发现重复 ZIP 路径。',
          normalized.path,
        );
      }
      seenPaths.add(comparablePath);
      const expectedEntry = expectedEntryByPath.get(comparablePath);
      if (!expectedEntry || Boolean(expectedEntry.isDirectory) !== normalized.isDirectory) {
        throw new ModuleImportStagingError(
          'archive_changed',
          '题包条目在预览后发生了变化，请重新选择。',
          normalized.path,
        );
      }
      const entryLimit = getEntrySizeLimit(normalized.path, normalized.isDirectory);
      if (
        typeof entry.originalSize === 'number'
        && (!Number.isInteger(entry.originalSize) || entry.originalSize < 0 || entry.originalSize > entryLimit)
      ) {
        throw new ModuleImportStagingError(
          'size_limit_exceeded',
          `ZIP 条目超过允许大小：${normalized.path}。`,
          normalized.path,
        );
      }
      if (normalized.isDirectory) {
        if (expectedEntry.uncompressedSize !== 0) {
          throw new ModuleImportStagingError(
            'archive_changed',
            '题包目录条目在预览后发生了变化。',
            normalized.path,
          );
        }
        entry.ondata = (error, chunk) => {
          if (streamError) {
            return;
          }
          if (error) {
            streamError = error;
            return;
          }
          if (chunk.byteLength > 0) {
            streamError = new ModuleImportStagingError(
              'archive_changed',
              '题包目录条目包含异常数据。',
              normalized.path,
            );
          }
        };
        entry.start();
        return;
      }

      const expectedImage = expectedImageByPath.get(comparablePath);
      let outputFile: File | null = null;
      let outputHandle: FileHandle | null = null;
      const signature: ImageSignatureState = { firstBytes: [], lastBytes: [] };
      if (expectedImage) {
        if (!ASSET_ID_PATTERN.test(expectedImage.assetId)) {
          throw new ModuleImportStagingError(
            'image_write_failed',
            '题包图片 assetId 不能用于安全暂存。',
            normalized.path,
          );
        }
        outputFile = new File(stagingDirectory, `${expectedImage.assetId}.jpg`);
        outputFile.create({ intermediates: true });
        outputHandle = outputFile.open();
        openHandles.add(outputHandle);
      }

      let entrySizeBytes = 0;
      entry.ondata = (error, chunk, final) => {
        if (streamError) {
          return;
        }
        if (error) {
          streamError = error;
          return;
        }
        entrySizeBytes += chunk.byteLength;
        totalUncompressedSizeBytes += chunk.byteLength;
        if (
          entrySizeBytes > entryLimit
          || totalUncompressedSizeBytes > MODULE_PACKAGE_LIMITS.maxUncompressedBytes
        ) {
          streamError = new ModuleImportStagingError(
            'size_limit_exceeded',
            '题包解压大小超过安全限制。',
            normalized.path,
          );
          return;
        }
        if (expectedImage && chunk.byteLength > 0) {
          try {
            outputHandle?.writeBytes(chunk);
            updateImageSignature(signature, chunk);
          } catch {
            streamError = new ModuleImportStagingError(
              'image_write_failed',
              `写入暂存图片失败：${normalized.path}。`,
              normalized.path,
            );
            return;
          }
        }
        if (final) {
          if (outputHandle) {
            closeFileHandleBestEffort(outputHandle);
            openHandles.delete(outputHandle);
            outputHandle = null;
          }
          if (entrySizeBytes !== expectedEntry.uncompressedSize) {
            streamError = new ModuleImportStagingError(
              'archive_changed',
              '题包条目大小在预览后发生了变化。',
              normalized.path,
            );
            return;
          }
          if (expectedImage && outputFile) {
            if (!hasJpegSignature(signature) || getFileSize(outputFile) !== expectedImage.sizeBytes) {
              streamError = new ModuleImportStagingError(
                'image_invalid',
                `暂存图片校验失败：${normalized.path}。`,
                normalized.path,
              );
              return;
            }
            stagedByAssetId.set(expectedImage.assetId, {
              ...expectedImage,
              stagedUri: outputFile.uri,
            });
          }
        }
      };
      entry.start();
    } catch (error) {
      streamError = error;
    }
  });
  unzipper.register(UnzipInflate);

  let sourceHandle: FileHandle | null = null;
  let bytesRead = 0;
  try {
    sourceHandle = sourceFile.open();
    while (bytesRead < compressedSizeBytes) {
      const readLength = Math.min(
        ARCHIVE_STREAM_CHUNK_BYTES,
        compressedSizeBytes - bytesRead,
      );
      const chunk = sourceHandle.readBytes(readLength);
      if (chunk.byteLength <= 0) {
        break;
      }
      bytesRead += chunk.byteLength;
      try {
        unzipper.push(chunk, bytesRead >= compressedSizeBytes);
      } catch {
        throw new ModuleImportStagingError('zip_read_failed', '暂存时读取题包 ZIP 失败。');
      }
      if (streamError) {
        throw streamError;
      }
    }
    if (bytesRead !== compressedSizeBytes || seenPaths.size !== expectedEntryByPath.size) {
      throw new ModuleImportStagingError(
        'archive_changed',
        '题包文件在预览后发生了变化，请重新选择。',
      );
    }
    const assets = parsed.images.map((image) => stagedByAssetId.get(image.assetId));
    if (assets.some((asset) => !asset)) {
      throw new ModuleImportStagingError(
        'archive_changed',
        '题包图片没有全部完成安全暂存。',
      );
    }
    stagedShell.assets = assets as StagedModuleImportAsset[];
    Logger.info(SERVICE_SCOPE, 'Staged module package images.', {
      imageCount: stagedShell.assets.length,
      compressedSizeBytes,
      totalUncompressedSizeBytes,
    });
    return stagedShell;
  } catch (error) {
    for (const handle of openHandles) {
      closeFileHandleBestEffort(handle);
    }
    cleanupStagedModuleImport(stagedShell);
    if (error instanceof ModuleImportStagingError) {
      throw error;
    }
    throw new ModuleImportStagingError('zip_read_failed', '暂存题包图片失败。');
  } finally {
    closeFileHandleBestEffort(sourceHandle);
  }
}

export const ModuleImportStagingService = {
  stageModulePackageImages,
  cleanupStagedModuleImport,
} as const;
