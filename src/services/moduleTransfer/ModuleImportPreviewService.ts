import { File, type FileHandle } from 'expo-file-system';
import { strFromU8, Unzip, UnzipInflate } from 'fflate';

import {
  MODULE_PACKAGE_DATA_FILE_NAME,
  MODULE_PACKAGE_FILE_EXTENSION,
  MODULE_PACKAGE_FORMAT,
  MODULE_PACKAGE_IMAGES_DIR_NAME,
  MODULE_PACKAGE_MANIFEST_FILE_NAME,
  type ModulePackageArchiveEntry,
  type ModulePackagePayload,
  type ModulePackageValidationIssue,
} from '@/src/models/ModulePackage';
import { Logger } from '@/src/services/Logger';
import type {
  ModuleImportPreview,
  ModuleImportPreviewFailureCode,
  ModuleImportPreviewImage,
  ParsedModulePackagePreview,
  ReadModuleImportPreviewInput,
  ReadModuleImportPreviewResult,
} from '@/src/services/moduleTransfer/ModuleImportPreviewTypes';
import {
  MODULE_PACKAGE_LIMITS,
  validateModulePackageArchive,
  validateModulePackagePayload,
} from '@/src/services/moduleTransfer/ModulePackageValidator';

const SERVICE_SCOPE = 'ModuleImportPreviewService';
const ARCHIVE_STREAM_CHUNK_BYTES = 512 * 1024;
const MAX_ARCHIVE_PATH_LENGTH = 256;

type ImageSignatureState = {
  firstBytes: number[];
  lastBytes: number[];
};

type ArchiveReadResult = {
  manifestBytes: Uint8Array | null;
  dataBytes: Uint8Array | null;
  entries: ModulePackageArchiveEntry[];
  jpegByComparablePath: Map<string, boolean>;
  totalUncompressedSizeBytes: number;
};

class ModuleImportPreviewBuildError extends Error {
  constructor(
    readonly code: ModuleImportPreviewFailureCode,
    message: string,
    readonly entryPath?: string,
    readonly validationIssues?: ModulePackageValidationIssue[],
  ) {
    super(message);
    this.name = 'ModuleImportPreviewBuildError';
  }
}

function failure(
  code: ModuleImportPreviewFailureCode,
  message: string,
  options?: {
    entryPath?: string;
    validationIssues?: ModulePackageValidationIssue[];
  },
): ReadModuleImportPreviewResult {
  return {
    ok: false,
    code,
    message,
    ...(options?.entryPath ? { entryPath: options.entryPath } : {}),
    ...(options?.validationIssues ? { validationIssues: options.validationIssues } : {}),
  };
}

function normalizeInput(input: ReadModuleImportPreviewInput): {
  fileUri: string;
  fileName: string;
  fileSizeBytes: number | null;
} {
  const fileUri = typeof input?.fileUri === 'string' ? input.fileUri.trim() : '';
  const fileName = typeof input?.fileName === 'string' ? input.fileName.trim() : '';
  if (!fileUri || !fileName || /[/\\\u0000-\u001F]/.test(fileName)) {
    throw new ModuleImportPreviewBuildError(
      'invalid_input',
      '必须提供有效的题包文件地址和文件名。',
    );
  }
  if (!fileName.toLocaleLowerCase().endsWith(MODULE_PACKAGE_FILE_EXTENSION)) {
    throw new ModuleImportPreviewBuildError(
      'invalid_extension',
      `只支持 ${MODULE_PACKAGE_FILE_EXTENSION} 模块题包，不能作为备份文件恢复。`,
    );
  }

  const sizeInput = input.fileSizeBytes;
  if (
    sizeInput !== undefined
    && sizeInput !== null
    && (!Number.isFinite(sizeInput) || sizeInput < 0)
  ) {
    throw new ModuleImportPreviewBuildError('invalid_input', 'fileSizeBytes 必须是非负数。');
  }
  return {
    fileUri,
    fileName,
    fileSizeBytes: sizeInput === undefined || sizeInput === null ? null : Math.floor(sizeInput),
  };
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

function resolveArchiveSize(file: File, inputSizeBytes: number | null): number {
  try {
    const info = file.info();
    if (typeof info.size === 'number' && Number.isFinite(info.size) && info.size > 0) {
      return Math.floor(info.size);
    }
  } catch {
    // The File.size fallback below may still be available.
  }
  if (typeof file.size === 'number' && Number.isFinite(file.size) && file.size > 0) {
    return Math.floor(file.size);
  }
  return typeof inputSizeBytes === 'number' && Number.isFinite(inputSizeBytes) && inputSizeBytes >= 0
    ? Math.floor(inputSizeBytes)
    : 0;
}

function validateArchiveEntryPath(pathInput: string): { path: string; isDirectory: boolean } {
  const path = typeof pathInput === 'string' ? pathInput : '';
  if (
    !path
    || path.length > MAX_ARCHIVE_PATH_LENGTH
    || path.includes('\\')
    || path.startsWith('/')
    || path.includes('\0')
    || /^[A-Za-z]:/.test(path)
  ) {
    throw new ModuleImportPreviewBuildError(
      'unsafe_entry_path',
      '题包包含不安全的 ZIP 路径。',
      path || undefined,
    );
  }
  const isDirectory = path.endsWith('/');
  const effectivePath = isDirectory ? path.slice(0, -1) : path;
  const segments = effectivePath.split('/');
  if (
    !effectivePath
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new ModuleImportPreviewBuildError(
      'unsafe_entry_path',
      '题包包含不安全的 ZIP 路径。',
      path,
    );
  }
  return { path, isDirectory };
}

function getEntryLimit(relativePath: string, isDirectory: boolean): number {
  if (isDirectory) {
    return 0;
  }
  const comparablePath = relativePath.toLocaleLowerCase();
  if (comparablePath === MODULE_PACKAGE_MANIFEST_FILE_NAME) {
    return MODULE_PACKAGE_LIMITS.maxManifestBytes;
  }
  if (comparablePath === MODULE_PACKAGE_DATA_FILE_NAME) {
    return MODULE_PACKAGE_LIMITS.maxDataBytes;
  }
  return MODULE_PACKAGE_LIMITS.maxImageBytes;
}

function concatUint8Chunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
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

function isJpegSignature(state: ImageSignatureState): boolean {
  return state.firstBytes.length === 3
    && state.firstBytes[0] === 0xff
    && state.firstBytes[1] === 0xd8
    && state.firstBytes[2] === 0xff
    && state.lastBytes.length === 2
    && state.lastBytes[0] === 0xff
    && state.lastBytes[1] === 0xd9;
}

function readArchive(file: File, compressedSizeBytes: number): ArchiveReadResult {
  let manifestBytes: Uint8Array | null = null;
  let dataBytes: Uint8Array | null = null;
  const entries: ModulePackageArchiveEntry[] = [];
  const jpegByComparablePath = new Map<string, boolean>();
  const seenEntryPaths = new Set<string>();
  let entryCount = 0;
  let totalUncompressedSizeBytes = 0;
  let streamError: unknown | null = null;

  const unzipper = new Unzip((entry) => {
    if (streamError) {
      return;
    }
    try {
      entryCount += 1;
      if (entryCount > MODULE_PACKAGE_LIMITS.maxArchiveEntries) {
        throw new ModuleImportPreviewBuildError(
          'entry_limit_exceeded',
          `ZIP 条目数量不能超过 ${MODULE_PACKAGE_LIMITS.maxArchiveEntries}。`,
        );
      }
      const normalized = validateArchiveEntryPath(entry.name);
      const collisionKey = normalized.path
        .replace(/\/$/, '')
        .toLocaleLowerCase();
      if (seenEntryPaths.has(collisionKey)) {
        throw new ModuleImportPreviewBuildError(
          'duplicate_entry',
          '题包内存在重复路径或仅大小写不同的路径。',
          normalized.path,
        );
      }
      seenEntryPaths.add(collisionKey);

      const entryLimit = getEntryLimit(normalized.path, normalized.isDirectory);
      if (
        typeof entry.originalSize === 'number'
        && (!Number.isInteger(entry.originalSize) || entry.originalSize < 0 || entry.originalSize > entryLimit)
      ) {
        throw new ModuleImportPreviewBuildError(
          'entry_size_limit_exceeded',
          `ZIP 条目超过允许大小：${normalized.path}。`,
          normalized.path,
        );
      }
      if (normalized.isDirectory) {
        entries.push({
          relativePath: normalized.path,
          uncompressedSize: 0,
          isDirectory: true,
        });
        return;
      }

      const comparablePath = normalized.path.toLocaleLowerCase();
      const shouldCollectJson = comparablePath === MODULE_PACKAGE_MANIFEST_FILE_NAME
        || comparablePath === MODULE_PACKAGE_DATA_FILE_NAME;
      const isImagePath = comparablePath.startsWith(`${MODULE_PACKAGE_IMAGES_DIR_NAME}/`);
      const chunks: Uint8Array[] = [];
      const signature: ImageSignatureState = { firstBytes: [], lastBytes: [] };
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
        if (entrySizeBytes > entryLimit) {
          streamError = new ModuleImportPreviewBuildError(
            'entry_size_limit_exceeded',
            `ZIP 条目超过允许大小：${normalized.path}。`,
            normalized.path,
          );
          return;
        }
        if (totalUncompressedSizeBytes > MODULE_PACKAGE_LIMITS.maxUncompressedBytes) {
          streamError = new ModuleImportPreviewBuildError(
            'uncompressed_size_limit_exceeded',
            '题包解压后总大小超过 1 GB。',
            normalized.path,
          );
          return;
        }
        if (shouldCollectJson && chunk.byteLength > 0) {
          chunks.push(new Uint8Array(chunk));
        }
        if (isImagePath && chunk.byteLength > 0) {
          updateImageSignature(signature, chunk);
        }
        if (final) {
          entries.push({
            relativePath: normalized.path,
            uncompressedSize: entrySizeBytes,
          });
          if (comparablePath === MODULE_PACKAGE_MANIFEST_FILE_NAME) {
            manifestBytes = concatUint8Chunks(chunks, entrySizeBytes);
          } else if (comparablePath === MODULE_PACKAGE_DATA_FILE_NAME) {
            dataBytes = concatUint8Chunks(chunks, entrySizeBytes);
          }
          if (isImagePath) {
            jpegByComparablePath.set(comparablePath, isJpegSignature(signature));
          }
        }
      };
      entry.start();
    } catch (error) {
      streamError = error;
    }
  });
  unzipper.register(UnzipInflate);

  let handle: FileHandle | null = null;
  let bytesRead = 0;
  try {
    handle = file.open();
    while (bytesRead < compressedSizeBytes) {
      const readLength = Math.min(
        ARCHIVE_STREAM_CHUNK_BYTES,
        compressedSizeBytes - bytesRead,
      );
      const chunk = handle.readBytes(readLength);
      if (chunk.byteLength <= 0) {
        break;
      }
      bytesRead += chunk.byteLength;
      try {
        unzipper.push(chunk, bytesRead >= compressedSizeBytes);
      } catch {
        throw new ModuleImportPreviewBuildError(
          'zip_read_failed',
          '题包 ZIP 结构损坏或使用了不支持的压缩方式。',
        );
      }
      if (streamError) {
        throw streamError;
      }
    }
  } finally {
    closeFileHandleBestEffort(handle);
  }
  if (streamError) {
    throw streamError;
  }
  if (bytesRead !== compressedSizeBytes) {
    throw new ModuleImportPreviewBuildError(
      'zip_read_failed',
      '题包文件在读取过程中被截断。',
    );
  }

  return {
    manifestBytes,
    dataBytes,
    entries,
    jpegByComparablePath,
    totalUncompressedSizeBytes,
  };
}

function parseJson(bytes: Uint8Array, fileName: string): unknown {
  try {
    return JSON.parse(strFromU8(bytes)) as unknown;
  } catch {
    throw new ModuleImportPreviewBuildError(
      'json_invalid',
      `${fileName} 不是有效的 UTF-8 JSON。`,
      fileName,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildPreview(options: {
  fileName: string;
  compressedSizeBytes: number;
  totalUncompressedSizeBytes: number;
  payload: ModulePackagePayload;
}): ModuleImportPreview {
  const { payload } = options;
  return {
    fileName: options.fileName,
    compressedSizeBytes: options.compressedSizeBytes,
    totalUncompressedSizeBytes: options.totalUncompressedSizeBytes,
    packageId: payload.manifest.packageId,
    contentVersion: payload.manifest.contentVersion,
    appName: payload.manifest.appName,
    appVersion: payload.manifest.appVersion,
    createdAt: payload.manifest.createdAt,
    creatorName: payload.manifest.creator.displayName,
    module: { ...payload.manifest.module },
    counts: { ...payload.manifest.counts },
    warnings: [...payload.manifest.warnings],
    questions: payload.data.questions.map((question) => ({
      itemId: question.itemId,
      position: question.position,
      title: question.title,
      difficulty: question.difficulty,
      tags: [...question.tags],
      imageCount: question.images.length,
      hasMySolution: Boolean(
        question.mySolutionText
        || question.images.some((image) => image.type === 'my_solution'),
      ),
      hasAnswer: Boolean(
        question.answerText
        || question.images.some((image) => image.type === 'answer'),
      ),
    })),
  };
}

function buildImagePreview(
  payload: ModulePackagePayload,
  entries: ModulePackageArchiveEntry[],
  jpegByComparablePath: ReadonlyMap<string, boolean>,
): ModuleImportPreviewImage[] {
  const sizeByPath = new Map(
    entries
      .filter((entry) => entry.isDirectory !== true)
      .map((entry) => [entry.relativePath.toLocaleLowerCase(), entry.uncompressedSize]),
  );
  return payload.data.questions.flatMap((question) =>
    question.images.map((image) => {
      const comparablePath = image.relativePath.toLocaleLowerCase();
      if (jpegByComparablePath.get(comparablePath) !== true) {
        throw new ModuleImportPreviewBuildError(
          'image_invalid',
          `图片条目不是有效的 JPEG：${image.relativePath}。`,
          image.relativePath,
        );
      }
      return {
        assetId: image.assetId,
        type: image.type,
        relativePath: image.relativePath,
        sizeBytes: sizeByPath.get(comparablePath) ?? 0,
      };
    }),
  );
}

export async function readModuleImportPreview(
  input: ReadModuleImportPreviewInput,
): Promise<ReadModuleImportPreviewResult> {
  try {
    const normalized = normalizeInput(input);
    let file: File;
    try {
      file = new File(normalized.fileUri);
      if (!file.exists) {
        return failure('file_not_found', '未找到要读取的题包文件。');
      }
    } catch {
      return failure('file_not_found', '无法访问要读取的题包文件。');
    }

    const compressedSizeBytes = resolveArchiveSize(file, normalized.fileSizeBytes);
    if (compressedSizeBytes <= 0) {
      return failure('file_empty', '题包文件为空或无法读取。');
    }
    if (compressedSizeBytes > MODULE_PACKAGE_LIMITS.maxCompressedBytes) {
      return failure('compressed_size_limit_exceeded', '题包压缩文件不能超过 500 MB。');
    }

    const archive = readArchive(file, compressedSizeBytes);
    if (!archive.manifestBytes || !archive.dataBytes) {
      return failure(
        'required_file_missing',
        `题包必须包含 ${MODULE_PACKAGE_MANIFEST_FILE_NAME} 和 ${MODULE_PACKAGE_DATA_FILE_NAME}。`,
      );
    }
    const manifest = parseJson(archive.manifestBytes, MODULE_PACKAGE_MANIFEST_FILE_NAME);
    const data = parseJson(archive.dataBytes, MODULE_PACKAGE_DATA_FILE_NAME);
    if (
      isRecord(manifest)
      && typeof manifest.format === 'string'
      && manifest.format !== MODULE_PACKAGE_FORMAT
    ) {
      return failure('invalid_format', '所选文件不是七刷模块题包，不能按模块导入。');
    }

    const payloadValidation = validateModulePackagePayload({ manifest, data });
    if (!payloadValidation.ok) {
      return failure('payload_invalid', '题包内容未通过模块数据协议校验。', {
        validationIssues: payloadValidation.errors,
      });
    }
    const archiveValidation = validateModulePackageArchive({
      manifest,
      data,
      entries: archive.entries,
      compressedSizeBytes,
    });
    if (!archiveValidation.ok) {
      return failure('archive_invalid', '题包文件条目与数据声明不一致。', {
        validationIssues: archiveValidation.errors,
      });
    }

    const payload = archiveValidation.value;
    const images = buildImagePreview(
      payload,
      archive.entries,
      archive.jpegByComparablePath,
    );
    const parsed: ParsedModulePackagePreview = {
      sourceFileUri: normalized.fileUri,
      payload,
      entries: archive.entries,
      images,
      preview: buildPreview({
        fileName: normalized.fileName,
        compressedSizeBytes,
        totalUncompressedSizeBytes: archive.totalUncompressedSizeBytes,
        payload,
      }),
    };
    Logger.info(SERVICE_SCOPE, 'Read module import preview.', {
      fileName: normalized.fileName,
      compressedSizeBytes,
      totalUncompressedSizeBytes: archive.totalUncompressedSizeBytes,
      questionCount: parsed.preview.counts.questions,
      imageCount: parsed.preview.counts.images,
      relationCount: parsed.preview.counts.relations,
    });
    return { ok: true, value: parsed };
  } catch (error) {
    if (error instanceof ModuleImportPreviewBuildError) {
      Logger.warn(SERVICE_SCOPE, 'Module import preview rejected.', {
        code: error.code,
        entryPath: error.entryPath ?? null,
        message: error.message,
      });
      return failure(error.code, error.message, {
        entryPath: error.entryPath,
        validationIssues: error.validationIssues,
      });
    }
    Logger.error(SERVICE_SCOPE, 'Failed to read module import preview.', error);
    return failure('zip_read_failed', '读取题包失败，文件可能已损坏。');
  }
}

export const ModuleImportPreviewService = {
  readModuleImportPreview,
} as const;
