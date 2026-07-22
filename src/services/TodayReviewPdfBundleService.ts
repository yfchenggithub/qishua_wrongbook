import { Directory, File, Paths, type FileHandle } from 'expo-file-system';
import { Zip, ZipPassThrough } from 'fflate';

const SHARE_CACHE_DIR_NAME = 'qishua_wrongbook_pdf_share';
const ZIP_READ_CHUNK_BYTES = 512 * 1024;

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

export async function createOrderedPdfZip(fileUris: string[]): Promise<string> {
  if (fileUris.length <= 0) {
    throw new Error('No PDF files were provided for the share archive.');
  }

  const sourceFiles = fileUris.map((uri) => new File(uri));
  if (sourceFiles.some((file) => !file.exists)) {
    throw new Error('One or more PDF files no longer exist.');
  }

  const outputFile = new File(
    ensureShareCacheDirectory(),
    `qishua_today_review_complete_${Date.now()}.zip`,
  );
  outputFile.create({ intermediates: true, overwrite: true });

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
    outputHandle = outputFile.open();
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
    return outputFile.uri;
  } catch (error) {
    zip.terminate();
    closeFileHandle(outputHandle);
    outputHandle = null;
    if (outputFile.exists) {
      outputFile.delete();
    }
    throw error;
  } finally {
    closeFileHandle(outputHandle);
  }
}
