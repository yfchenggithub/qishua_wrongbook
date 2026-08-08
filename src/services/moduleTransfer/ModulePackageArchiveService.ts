import { Directory, File, Paths, type FileHandle } from 'expo-file-system';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import {
  MODULE_PACKAGE_DATA_FILE_NAME,
  MODULE_PACKAGE_FILE_EXTENSION,
  MODULE_PACKAGE_MANIFEST_FILE_NAME,
  type ModulePackageArchiveEntry,
  type ModulePackagePayload,
  type ModulePackageValidationIssue,
} from '@/src/models/ModulePackage';
import { Logger } from '@/src/services/Logger';
import type {
  CreateModulePackageArchiveInput,
  CreateModulePackageArchiveResult,
  ModulePackageArchiveFailureCode,
  ModulePackageArchiveImageMode,
  ModulePackageArchiveResult,
} from '@/src/services/moduleTransfer/ModulePackageArchiveTypes';
import {
  MODULE_PACKAGE_LIMITS,
  validateModulePackageArchive,
  validateModulePackagePayload,
} from '@/src/services/moduleTransfer/ModulePackageValidator';
import type {
  ModuleExportSourceAsset,
  PreparedModuleExport,
} from '@/src/services/moduleTransfer/ModuleTransferTypes';

const SERVICE_SCOPE = 'ModulePackageArchiveService';
const CACHE_EXPORT_DIRECTORY_NAME = 'qishua_module_exports';
const ZIP_STREAM_CHUNK_BYTES = 512 * 1024;
const DEFAULT_JPEG_QUALITY = 0.92;
const JSON_ZIP_COMPRESSION_LEVEL = 6;
const MAX_FILE_NAME_LENGTH = 160;
const MAX_UNIQUE_FILE_ATTEMPTS = 1000;

type PreparedArchiveImage = {
  file: File;
  mode: ModulePackageArchiveImageMode;
  sourceSizeBytes: number;
  archivedSizeBytes: number;
  temporaryUri: string | null;
};

class ModulePackageArchiveBuildError extends Error {
  constructor(
    readonly code: ModulePackageArchiveFailureCode,
    message: string,
    readonly assetId?: string,
    readonly validationIssues?: ModulePackageValidationIssue[],
  ) {
    super(message);
    this.name = 'ModulePackageArchiveBuildError';
  }
}

function failure(
  code: ModulePackageArchiveFailureCode,
  message: string,
  options?: {
    assetId?: string;
    validationIssues?: ModulePackageValidationIssue[];
  },
): CreateModulePackageArchiveResult {
  return {
    ok: false,
    code,
    message,
    ...(options?.assetId ? { assetId: options.assetId } : {}),
    ...(options?.validationIssues ? { validationIssues: options.validationIssues } : {}),
  };
}

function normalizeJpegQuality(value: number | undefined): number {
  const normalized = value ?? DEFAULT_JPEG_QUALITY;
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 1) {
    throw new ModulePackageArchiveBuildError(
      'invalid_input',
      'jpegQuality 必须大于 0 且不超过 1。',
    );
  }
  return normalized;
}

function formatFileTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ModulePackageArchiveBuildError('invalid_input', '题包创建时间无效。');
  }
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function buildSafeModuleFileSegment(moduleName: string): string {
  const normalized = moduleName
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 48);
  return normalized || 'module';
}

function buildDefaultFileName(payload: ModulePackagePayload): string {
  const moduleSegment = buildSafeModuleFileSegment(payload.manifest.module.name);
  const timestamp = formatFileTimestamp(payload.manifest.createdAt);
  return `qishua-module-${moduleSegment}-${timestamp}${MODULE_PACKAGE_FILE_EXTENSION}`;
}

function normalizeRequestedFileName(
  fileNameInput: string | undefined,
  payload: ModulePackagePayload,
): string {
  const fileName = fileNameInput === undefined
    ? buildDefaultFileName(payload)
    : fileNameInput.trim();
  if (
    !fileName
    || fileName.length > MAX_FILE_NAME_LENGTH
    || fileName === '.'
    || fileName === '..'
    || /[<>:"/\\|?*\u0000-\u001F]/.test(fileName)
    || !fileName.toLocaleLowerCase().endsWith(MODULE_PACKAGE_FILE_EXTENSION)
  ) {
    throw new ModulePackageArchiveBuildError(
      'invalid_input',
      `fileName 必须是安全的 ${MODULE_PACKAGE_FILE_EXTENSION} 文件名。`,
    );
  }
  return fileName;
}

function ensureExportDirectory(): Directory {
  const directory = new Directory(Paths.cache, CACHE_EXPORT_DIRECTORY_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function resolveAvailableOutputFile(
  directory: Directory,
  requestedFileName: string,
): { file: File; fileName: string } {
  const baseName = requestedFileName.slice(0, -MODULE_PACKAGE_FILE_EXTENSION.length);
  for (let attempt = 1; attempt <= MAX_UNIQUE_FILE_ATTEMPTS; attempt += 1) {
    const fileName = attempt === 1
      ? requestedFileName
      : `${baseName}-${attempt}${MODULE_PACKAGE_FILE_EXTENSION}`;
    const file = new File(directory, fileName);
    if (!file.exists) {
      return { file, fileName };
    }
  }
  throw new ModulePackageArchiveBuildError(
    'archive_write_failed',
    '无法为题包分配可用的缓存文件名。',
  );
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

function deleteFileBestEffort(file: File | null): void {
  if (!file) {
    return;
  }
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function deleteUriBestEffort(uri: string | null): void {
  if (!uri) {
    return;
  }
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function readFileSize(file: File): number {
  const info = file.info();
  const value = typeof info.size === 'number' ? info.size : file.size;
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function isJpegFile(file: File, sizeBytes: number): boolean {
  if (sizeBytes < 5) {
    return false;
  }
  let handle: FileHandle | null = null;
  try {
    handle = file.open();
    const header = handle.readBytes(3);
    handle.offset = Math.max(0, sizeBytes - 2);
    const footer = handle.readBytes(2);
    return header.length === 3
      && header[0] === 0xff
      && header[1] === 0xd8
      && header[2] === 0xff
      && footer.length === 2
      && footer[0] === 0xff
      && footer[1] === 0xd9;
  } finally {
    closeFileHandleBestEffort(handle);
  }
}

async function prepareArchiveImage(
  asset: ModuleExportSourceAsset,
  jpegQuality: number,
): Promise<PreparedArchiveImage> {
  let sourceFile: File;
  try {
    sourceFile = new File(asset.sourceUri);
    if (!sourceFile.exists) {
      throw new ModulePackageArchiveBuildError(
        'source_image_missing',
        `图片资源 ${asset.assetId} 不存在。`,
        asset.assetId,
      );
    }
  } catch (error) {
    if (error instanceof ModulePackageArchiveBuildError) {
      throw error;
    }
    throw new ModulePackageArchiveBuildError(
      'source_image_read_failed',
      `无法访问图片资源 ${asset.assetId}。`,
      asset.assetId,
    );
  }

  let sourceSizeBytes: number;
  let sourceIsJpeg: boolean;
  try {
    sourceSizeBytes = readFileSize(sourceFile);
    if (sourceSizeBytes <= 0) {
      throw new ModulePackageArchiveBuildError(
        'source_image_empty',
        `图片资源 ${asset.assetId} 为空文件。`,
        asset.assetId,
      );
    }
    sourceIsJpeg = isJpegFile(sourceFile, sourceSizeBytes);
  } catch (error) {
    if (error instanceof ModulePackageArchiveBuildError) {
      throw error;
    }
    throw new ModulePackageArchiveBuildError(
      'source_image_read_failed',
      `读取图片资源 ${asset.assetId} 失败。`,
      asset.assetId,
    );
  }

  if (sourceIsJpeg && sourceSizeBytes <= MODULE_PACKAGE_LIMITS.maxImageBytes) {
    return {
      file: sourceFile,
      mode: 'copied',
      sourceSizeBytes,
      archivedSizeBytes: sourceSizeBytes,
      temporaryUri: null,
    };
  }

  let temporaryUri: string | null = null;
  try {
    const converted = await manipulateAsync(asset.sourceUri, [], {
      compress: jpegQuality,
      format: SaveFormat.JPEG,
      base64: false,
    });
    temporaryUri = typeof converted.uri === 'string' && converted.uri !== asset.sourceUri
      ? converted.uri
      : null;
    const convertedUri = typeof converted.uri === 'string' ? converted.uri.trim() : '';
    if (!convertedUri) {
      throw new ModulePackageArchiveBuildError(
        'image_conversion_failed',
        `图片资源 ${asset.assetId} 转换结果无效。`,
        asset.assetId,
      );
    }
    const convertedFile = new File(convertedUri);
    if (!convertedFile.exists) {
      throw new ModulePackageArchiveBuildError(
        'image_conversion_failed',
        `图片资源 ${asset.assetId} 的转换文件不存在。`,
        asset.assetId,
      );
    }
    const archivedSizeBytes = readFileSize(convertedFile);
    if (archivedSizeBytes <= 0 || !isJpegFile(convertedFile, archivedSizeBytes)) {
      throw new ModulePackageArchiveBuildError(
        'image_conversion_failed',
        `图片资源 ${asset.assetId} 未能转换为有效 JPEG。`,
        asset.assetId,
      );
    }
    if (archivedSizeBytes > MODULE_PACKAGE_LIMITS.maxImageBytes) {
      throw new ModulePackageArchiveBuildError(
        'image_too_large',
        `图片资源 ${asset.assetId} 转换后仍超过 20 MB。`,
        asset.assetId,
      );
    }
    return {
      file: convertedFile,
      mode: 'converted',
      sourceSizeBytes,
      archivedSizeBytes,
      temporaryUri,
    };
  } catch (error) {
    deleteUriBestEffort(temporaryUri);
    if (error instanceof ModulePackageArchiveBuildError) {
      throw error;
    }
    throw new ModulePackageArchiveBuildError(
      'image_conversion_failed',
      `转换图片资源 ${asset.assetId} 失败。`,
      asset.assetId,
    );
  }
}

function resolveOrderedAssets(
  prepared: PreparedModuleExport,
  payload: ModulePackagePayload,
): ModuleExportSourceAsset[] {
  const sourceAssets = new Map<string, ModuleExportSourceAsset>();
  for (const asset of prepared.assets) {
    if (sourceAssets.has(asset.assetId)) {
      throw new ModulePackageArchiveBuildError(
        'asset_mapping_invalid',
        `资源映射中存在重复 assetId：${asset.assetId}。`,
        asset.assetId,
      );
    }
    sourceAssets.set(asset.assetId, asset);
  }

  const ordered: ModuleExportSourceAsset[] = [];
  for (const question of payload.data.questions) {
    for (const image of question.images) {
      const asset = sourceAssets.get(image.assetId);
      if (
        !asset
        || !asset.sourceUri.trim()
        || asset.type !== image.type
        || asset.relativePath !== image.relativePath
      ) {
        throw new ModulePackageArchiveBuildError(
          'asset_mapping_invalid',
          `资源 ${image.assetId} 与 module.json 图片声明不一致。`,
          image.assetId,
        );
      }
      ordered.push(asset);
    }
  }

  if (ordered.length !== prepared.assets.length) {
    throw new ModulePackageArchiveBuildError(
      'asset_mapping_invalid',
      '资源映射数量与 module.json 图片声明不一致。',
    );
  }
  return ordered;
}

function throwIfZipError(error: unknown | null): void {
  if (error) {
    throw new ModulePackageArchiveBuildError('archive_write_failed', '写入题包 ZIP 数据失败。');
  }
}

function addJsonEntry(
  zip: Zip,
  relativePath: string,
  bytes: Uint8Array,
  getZipError: () => unknown | null,
): void {
  const entry = new ZipDeflate(relativePath, { level: JSON_ZIP_COMPRESSION_LEVEL });
  zip.add(entry);
  throwIfZipError(getZipError());
  entry.push(bytes, true);
  throwIfZipError(getZipError());
}

function addImageEntry(
  zip: Zip,
  relativePath: string,
  file: File,
  sizeBytes: number,
  getZipError: () => unknown | null,
): void {
  const entry = new ZipPassThrough(relativePath);
  zip.add(entry);
  throwIfZipError(getZipError());

  let sourceHandle: FileHandle | null = null;
  let bytesRead = 0;
  try {
    sourceHandle = file.open();
    while (bytesRead < sizeBytes) {
      const readLength = Math.min(ZIP_STREAM_CHUNK_BYTES, sizeBytes - bytesRead);
      const chunk = sourceHandle.readBytes(readLength);
      if (chunk.byteLength <= 0) {
        break;
      }
      bytesRead += chunk.byteLength;
      entry.push(chunk, bytesRead >= sizeBytes);
      throwIfZipError(getZipError());
    }
    if (bytesRead !== sizeBytes) {
      throw new ModulePackageArchiveBuildError(
        'source_image_read_failed',
        `图片 ${relativePath} 在读取过程中发生变化或被截断。`,
      );
    }
  } finally {
    closeFileHandleBestEffort(sourceHandle);
  }
}

function readOutputSize(file: File): number {
  const sizeBytes = readFileSize(file);
  if (sizeBytes <= 0) {
    throw new ModulePackageArchiveBuildError('archive_write_failed', '生成的题包文件为空。');
  }
  return sizeBytes;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function createModulePackageArchive(
  input: CreateModulePackageArchiveInput,
): Promise<CreateModulePackageArchiveResult> {
  if (!input?.prepared) {
    return failure('invalid_input', '缺少已经准备好的模块导出数据。');
  }

  const payloadValidation = validateModulePackagePayload(input.prepared.payload);
  if (!payloadValidation.ok) {
    return failure('payload_invalid', '模块数据未通过题包协议校验。', {
      validationIssues: payloadValidation.errors,
    });
  }

  let outputFile: File | null = null;
  let outputHandle: FileHandle | null = null;
  let zip: Zip | null = null;
  let zipError: unknown | null = null;
  let zipFinalized = false;

  try {
    const jpegQuality = normalizeJpegQuality(input.jpegQuality);
    const payload = payloadValidation.value;
    const orderedAssets = resolveOrderedAssets(input.prepared, payload);
    const fileName = normalizeRequestedFileName(input.fileName, payload);
    const output = resolveAvailableOutputFile(ensureExportDirectory(), fileName);
    outputFile = output.file;
    outputFile.create({ intermediates: true });
    outputHandle = outputFile.open();

    zip = new Zip((error, chunk, final) => {
      if (error) {
        zipError = error;
        return;
      }
      try {
        if (chunk.byteLength > 0) {
          outputHandle?.writeBytes(chunk);
        }
        if (final) {
          zipFinalized = true;
        }
      } catch (writeError) {
        zipError = writeError;
      }
    });

    const manifestBytes = strToU8(JSON.stringify(payload.manifest, null, 2));
    const dataBytes = strToU8(JSON.stringify(payload.data, null, 2));
    const entries: ModulePackageArchiveEntry[] = [
      { relativePath: MODULE_PACKAGE_MANIFEST_FILE_NAME, uncompressedSize: manifestBytes.byteLength },
      { relativePath: MODULE_PACKAGE_DATA_FILE_NAME, uncompressedSize: dataBytes.byteLength },
    ];
    addJsonEntry(zip, MODULE_PACKAGE_MANIFEST_FILE_NAME, manifestBytes, () => zipError);
    addJsonEntry(zip, MODULE_PACKAGE_DATA_FILE_NAME, dataBytes, () => zipError);

    let copiedImageCount = 0;
    let convertedImageCount = 0;
    for (let index = 0; index < orderedAssets.length; index += 1) {
      const asset = orderedAssets[index];
      let image: PreparedArchiveImage | null = null;
      try {
        image = await prepareArchiveImage(asset, jpegQuality);
        addImageEntry(
          zip,
          asset.relativePath,
          image.file,
          image.archivedSizeBytes,
          () => zipError,
        );
        entries.push({
          relativePath: asset.relativePath,
          uncompressedSize: image.archivedSizeBytes,
        });
        if (image.mode === 'copied') {
          copiedImageCount += 1;
        } else {
          convertedImageCount += 1;
        }
        input.onAssetPacked?.({
          current: index + 1,
          total: orderedAssets.length,
          assetId: asset.assetId,
          relativePath: asset.relativePath,
          mode: image.mode,
          sourceSizeBytes: image.sourceSizeBytes,
          archivedSizeBytes: image.archivedSizeBytes,
        });
      } finally {
        deleteUriBestEffort(image?.temporaryUri ?? null);
      }
      await yieldToEventLoop();
    }

    zip.end();
    throwIfZipError(zipError);
    if (!zipFinalized) {
      throw new ModulePackageArchiveBuildError(
        'archive_write_failed',
        '题包 ZIP 未能正确结束写入。',
      );
    }

    closeFileHandleBestEffort(outputHandle);
    outputHandle = null;
    const sizeBytes = readOutputSize(outputFile);
    const archiveValidation = validateModulePackageArchive({
      manifest: payload.manifest,
      data: payload.data,
      entries,
      compressedSizeBytes: sizeBytes,
    });
    if (!archiveValidation.ok) {
      throw new ModulePackageArchiveBuildError(
        'archive_invalid',
        '生成的题包未通过完整归档校验。',
        undefined,
        archiveValidation.errors,
      );
    }

    const result: ModulePackageArchiveResult = {
      fileUri: outputFile.uri,
      fileName: output.fileName,
      sizeBytes,
      copiedImageCount,
      convertedImageCount,
      entries,
    };
    Logger.info(SERVICE_SCOPE, 'Created module package archive.', {
      fileName: result.fileName,
      sizeBytes,
      imageCount: orderedAssets.length,
      copiedImageCount,
      convertedImageCount,
    });
    return { ok: true, value: result };
  } catch (error) {
    try {
      zip?.terminate();
    } catch {
      // Best-effort cleanup only.
    }
    closeFileHandleBestEffort(outputHandle);
    outputHandle = null;
    deleteFileBestEffort(outputFile);

    if (error instanceof ModulePackageArchiveBuildError) {
      Logger.warn(SERVICE_SCOPE, 'Module package archive creation stopped.', {
        code: error.code,
        assetId: error.assetId ?? null,
        message: error.message,
      });
      return failure(error.code, error.message, {
        assetId: error.assetId,
        validationIssues: error.validationIssues,
      });
    }
    Logger.error(SERVICE_SCOPE, 'Failed to create module package archive.', error);
    return failure('archive_write_failed', '生成题包文件失败，请稍后重试。');
  } finally {
    closeFileHandleBestEffort(outputHandle);
  }
}

export const ModulePackageArchiveService = {
  createModulePackageArchive,
} as const;
