import { Directory, File, Paths, type FileHandle } from 'expo-file-system';
import { Zip, ZipPassThrough } from 'fflate';

const SHARE_CACHE_DIR_NAME = 'qishua_wrongbook_pdf_share';
const COMPLETE_ZIP_FILE_PREFIX = 'qishua_today_review_complete_v2';
const ZIP_READ_CHUNK_BYTES = 512 * 1024;
const MINIMUM_ZIP_FILE_SIZE_BYTES = 22;
const activeCachedBundlePromises = new Map<string, Promise<string>>();

function ensureShareCacheDirectory(): Directory {
  const directory = new Directory(Paths.cache, SHARE_CACHE_DIR_NAME);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function closeFileHandle(handle: FileHandle | null): void {
  if (!handle) {
    return;
  }
  try {
    handle.close();
  } catch {
    // Best-effort cleanup for a temporary share artifact.
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function toArchiveFileName(index: number, total: number): string {
  const width = Math.max(2, String(Math.max(1, total)).length);
  const part = String(index + 1).padStart(width, '0');
  const partTotal = String(total).padStart(width, '0');
  return `qishua_today_review_part${part}-of-${partTotal}.pdf`;
}

function isUsableFile(file: File): boolean {
  try {
    const info = file.info();
    return info.exists
      && typeof info.size === 'number'
      && info.size >= MINIMUM_ZIP_FILE_SIZE_BYTES;
  } catch {
    return false;
  }
}

function buildSourceFingerprint(sourceFiles: File[]): string {
  const signature = sourceFiles.map((file) => {
    const info = file.info();
    if (!info.exists) {
      throw new Error('One or more PDF files no longer exist.');
    }
    const size = typeof info.size === 'number' && Number.isFinite(info.size) ? info.size : 0;
    const modifiedAt = typeof info.modificationTime === 'number' && Number.isFinite(info.modificationTime)
      ? info.modificationTime
      : 0;
    return `${file.uri}|${size}|${modifiedAt}`;
  }).join('\n');

  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function pushSourceFile(
  zip: Zip,
  sourceFile: File,
  archiveName: string,
  getZipError: () => unknown | null,
): void {
  const fileInfo = sourceFile.info();
  const fileSize = typeof fileInfo.size === 'number' && Number.isFinite(fileInfo.size)
    ? Math.max(0, Math.floor(fileInfo.size))
    : null;
  const entry = new ZipPassThrough(archiveName);
  zip.add(entry);

  let sourceHandle: FileHandle | null = null;
  let bytesRead = 0;
  try {
    sourceHandle = sourceFile.open();
    if (fileSize === 0) {
      entry.push(new Uint8Array(0), true);
      return;
    }

    while (fileSize === null || bytesRead < fileSize) {
      const remaining = fileSize === null ? ZIP_READ_CHUNK_BYTES : fileSize - bytesRead;
      const chunk = sourceHandle.readBytes(Math.min(ZIP_READ_CHUNK_BYTES, remaining));
      if (chunk.byteLength <= 0) {
        break;
      }

      bytesRead += chunk.byteLength;
      entry.push(chunk, fileSize !== null && bytesRead >= fileSize);
      const zipError = getZipError();
      if (zipError) {
        throw zipError;
      }
      if (fileSize === null && chunk.byteLength < ZIP_READ_CHUNK_BYTES) {
        break;
      }
    }

    if (fileSize !== null && bytesRead < fileSize) {
      throw new Error(`PDF read ended early: ${archiveName}`);
    }
    if (fileSize === null) {
      entry.push(new Uint8Array(0), true);
      const zipError = getZipError();
      if (zipError) {
        throw zipError;
      }
    }
  } finally {
    closeFileHandle(sourceHandle);
  }
}

async function createOrderedPdfZipFile(fileUris: string[], outputFile: File): Promise<string> {
  if (fileUris.length <= 0) {
    throw new Error('No PDF files were provided for the share archive.');
  }

  const sourceFiles = fileUris.map((uri) => new File(uri));
  if (sourceFiles.some((file) => !file.exists)) {
    throw new Error('One or more PDF files no longer exist.');
  }

  const temporaryOutputFile = new File(`${outputFile.uri}.next`);
  temporaryOutputFile.create({ intermediates: true, overwrite: true });

  let outputHandle: FileHandle | null = null;
  let zipError: unknown | null = null;
  let zipFinalized = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      zipError = error;
      return;
    }
    if (chunk.byteLength > 0) {
      outputHandle?.writeBytes(chunk);
    }
    if (final) {
      zipFinalized = true;
    }
  });

  try {
    outputHandle = temporaryOutputFile.open();
    for (let index = 0; index < sourceFiles.length; index += 1) {
      pushSourceFile(
        zip,
        sourceFiles[index],
        toArchiveFileName(index, sourceFiles.length),
        () => zipError,
      );
      await yieldToEventLoop();
    }

    zip.end();
    if (zipError) {
      throw zipError;
    }
    if (!zipFinalized) {
      throw new Error('PDF share archive was not finalized.');
    }
  } catch (error) {
    zip.terminate();
    closeFileHandle(outputHandle);
    outputHandle = null;
    if (temporaryOutputFile.exists) {
      temporaryOutputFile.delete();
    }
    throw error;
  } finally {
    closeFileHandle(outputHandle);
  }

  try {
    if (outputFile.exists) {
      outputFile.delete();
    }
    temporaryOutputFile.move(outputFile);
    return outputFile.uri;
  } catch (error) {
    if (temporaryOutputFile.exists) {
      temporaryOutputFile.delete();
    }
    throw error;
  }
}

export async function prepareCachedTodayReviewPdfZip(fileUris: string[]): Promise<string> {
  if (fileUris.length <= 0) {
    throw new Error('No PDF files were provided for the cached share archive.');
  }
  if (fileUris.length === 1) {
    const onlyFile = new File(fileUris[0]);
    if (!isUsableFile(onlyFile)) {
      throw new Error('The PDF file no longer exists.');
    }
    return onlyFile.uri;
  }

  const sourceFiles = fileUris.map((uri) => new File(uri));
  const fingerprint = buildSourceFingerprint(sourceFiles);
  const outputFile = new File(
    ensureShareCacheDirectory(),
    `${COMPLETE_ZIP_FILE_PREFIX}_${fingerprint}.zip`,
  );
  if (isUsableFile(outputFile)) {
    return outputFile.uri;
  }

  const activePromise = activeCachedBundlePromises.get(outputFile.uri);
  if (activePromise) {
    return activePromise;
  }

  const preparationPromise = createOrderedPdfZipFile(fileUris, outputFile)
    .finally(() => {
      activeCachedBundlePromises.delete(outputFile.uri);
    });
  activeCachedBundlePromises.set(outputFile.uri, preparationPromise);
  return preparationPromise;
}
