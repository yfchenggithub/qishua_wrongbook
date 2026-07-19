import { Directory, File, Paths, type FileHandle } from 'expo-file-system';
import { strToU8, Zip, ZipPassThrough } from 'fflate';

import {
  BACKUP_DATA_FILE_NAME,
  BACKUP_IMAGES_DIR_NAME,
  BACKUP_MANIFEST_FILE_NAME,
  BACKUP_VOICE_FILES_DIR_NAME,
  BACKUP_VOICE_NOTES_FILE_NAME,
} from '@/src/services/backup/BackupManifest';
import {
  BACKUP_FILE_EXTENSION,
  type BackupDataPayload,
  type BackupImageArchiveFile,
  type BackupManifest,
  type BackupVoiceNoteRecord,
} from '@/src/services/backup/BackupTypes';
import { BackupRestoreError, getBackupErrorUserMessage } from '@/src/services/backup/BackupRestoreError';

const CACHE_BACKUP_DIR_NAME = 'qishua_wrongbook_backups';
const BACKUP_ZIP_STREAM_CHUNK_BYTES = 512 * 1024;

export interface BackupZipPackageProgressEvent {
  current: number;
  total: number;
  relativePath: string;
  bytesRead: number;
}

export interface CreateBackupPackageInput {
  fileName: string;
  manifest: BackupManifest;
  data: BackupDataPayload;
  images: BackupImageArchiveFile[];
  voiceNotes: BackupVoiceNoteRecord[];
  voiceFiles: BackupImageArchiveFile[];
  onFilePacked?: (event: BackupZipPackageProgressEvent) => void;
}

export interface BackupZipAdapter {
  createBackupPackage(input: CreateBackupPackageInput): Promise<{ fileUri: string; fileName: string }>;
}

function normalizeArchivePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized) {
    throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'));
  }
  return normalized;
}

function normalizeBackupFileName(fileName: string): string {
  const normalized = fileName.trim();
  if (!normalized) {
    throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'));
  }
  if (!normalized.toLowerCase().endsWith(BACKUP_FILE_EXTENSION)) {
    throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'));
  }
  return normalized;
}

function ensureCacheBackupDir(): Directory {
  const backupDir = new Directory(Paths.cache, CACHE_BACKUP_DIR_NAME);
  backupDir.create({ intermediates: true, idempotent: true });
  return backupDir;
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

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function normalizeReadableFileSize(file: File, fallbackSizeBytes?: number | null): number | null {
  if (typeof fallbackSizeBytes === 'number' && Number.isFinite(fallbackSizeBytes) && fallbackSizeBytes >= 0) {
    return Math.floor(fallbackSizeBytes);
  }

  const info = file.info();
  if (typeof info.size === 'number' && Number.isFinite(info.size) && info.size >= 0) {
    return Math.floor(info.size);
  }

  if (typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0) {
    return Math.floor(file.size);
  }

  return null;
}

function throwIfZipError(error: unknown | null): void {
  if (!error) {
    return;
  }
  throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'), {
    cause: error,
  });
}

function addBytesToZip(zip: Zip, relativePath: string, bytes: Uint8Array, getZipError: () => unknown | null): void {
  const entry = new ZipPassThrough(normalizeArchivePath(relativePath));
  zip.add(entry);
  throwIfZipError(getZipError());
  entry.push(bytes, true);
  throwIfZipError(getZipError());
}

function addSourceFileToZip(
  zip: Zip,
  archiveFile: BackupImageArchiveFile,
  getZipError: () => unknown | null,
): number {
  const relativePath = normalizeArchivePath(archiveFile.backupRelativePath);
  const sourceFile = new File(archiveFile.sourceUri);
  if (!sourceFile.exists) {
    throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'));
  }

  const entry = new ZipPassThrough(relativePath);
  zip.add(entry);
  throwIfZipError(getZipError());

  const fileSizeBytes = normalizeReadableFileSize(sourceFile, archiveFile.sizeBytes);
  let sourceHandle: FileHandle | null = null;
  let bytesRead = 0;
  try {
    sourceHandle = sourceFile.open();

    if (fileSizeBytes === 0) {
      entry.push(new Uint8Array(0), true);
      throwIfZipError(getZipError());
      return 0;
    }

    while (fileSizeBytes === null || bytesRead < fileSizeBytes) {
      const remainingBytes = fileSizeBytes === null ? BACKUP_ZIP_STREAM_CHUNK_BYTES : fileSizeBytes - bytesRead;
      const readLength = Math.min(BACKUP_ZIP_STREAM_CHUNK_BYTES, remainingBytes);
      const chunk = sourceHandle.readBytes(readLength);
      if (chunk.byteLength <= 0) {
        break;
      }

      bytesRead += chunk.byteLength;
      const isFinalChunk = fileSizeBytes !== null && bytesRead >= fileSizeBytes;
      entry.push(chunk, isFinalChunk);
      throwIfZipError(getZipError());

      if (fileSizeBytes === null && chunk.byteLength < BACKUP_ZIP_STREAM_CHUNK_BYTES) {
        break;
      }
    }

    if (fileSizeBytes !== null && bytesRead < fileSizeBytes) {
      throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'));
    }

    if (fileSizeBytes === null) {
      entry.push(new Uint8Array(0), true);
      throwIfZipError(getZipError());
    }
  } finally {
    closeFileHandleBestEffort(sourceHandle);
  }

  return bytesRead;
}

export class FflateBackupZipAdapter implements BackupZipAdapter {
  async createBackupPackage(
    input: CreateBackupPackageInput,
  ): Promise<{ fileUri: string; fileName: string }> {
    const normalizedFileName = normalizeBackupFileName(input.fileName);
    const backupDir = ensureCacheBackupDir();
    const file = new File(backupDir, normalizedFileName);

    if (file.exists) {
      file.delete();
    }
    file.create({ intermediates: true, overwrite: true });

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
      outputHandle = file.open();
      const metadataEntries: [string, Uint8Array][] = [
        [BACKUP_MANIFEST_FILE_NAME, strToU8(JSON.stringify(input.manifest, null, 2))],
        [BACKUP_DATA_FILE_NAME, strToU8(JSON.stringify(input.data, null, 2))],
        [BACKUP_VOICE_NOTES_FILE_NAME, strToU8(JSON.stringify(input.voiceNotes, null, 2))],
      ];

      for (const [relativePath, bytes] of metadataEntries) {
        addBytesToZip(zip, relativePath, bytes, () => zipError);
      }

      const totalSourceFiles = input.images.length + input.voiceFiles.length;
      let packedSourceFileCount = 0;
      for (const image of input.images) {
        const bytesRead = addSourceFileToZip(zip, image, () => zipError);
        packedSourceFileCount += 1;
        input.onFilePacked?.({
          current: packedSourceFileCount,
          total: totalSourceFiles,
          relativePath: image.backupRelativePath,
          bytesRead,
        });
        await yieldToEventLoop();
      }

      for (const voiceFile of input.voiceFiles) {
        const normalizedVoiceFile = {
          ...voiceFile,
          backupRelativePath: ensureBackupVoiceFileRelativePath(voiceFile.backupRelativePath),
        };
        const bytesRead = addSourceFileToZip(zip, normalizedVoiceFile, () => zipError);
        packedSourceFileCount += 1;
        input.onFilePacked?.({
          current: packedSourceFileCount,
          total: totalSourceFiles,
          relativePath: normalizedVoiceFile.backupRelativePath,
          bytesRead,
        });
        await yieldToEventLoop();
      }

      zip.end();
      throwIfZipError(zipError);
      if (!zipFinalized) {
        throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'));
      }
    } catch (error) {
      zip.terminate();
      if (error instanceof BackupRestoreError) {
        throw error;
      }
      throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'), {
        cause: error,
      });
    } finally {
      closeFileHandleBestEffort(outputHandle);
    }

    return {
      fileUri: file.uri,
      fileName: normalizedFileName,
    };
  }
}

export function ensureBackupImageRelativePath(path: string): string {
  const normalized = normalizeArchivePath(path);
  if (!normalized.startsWith(`${BACKUP_IMAGES_DIR_NAME}/`)) {
    throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'));
  }
  return normalized;
}

export function ensureBackupVoiceFileRelativePath(path: string): string {
  const normalized = normalizeArchivePath(path);
  if (!normalized.startsWith(`${BACKUP_VOICE_FILES_DIR_NAME}/`)) {
    throw new BackupRestoreError('BACKUP_FAILED', getBackupErrorUserMessage('BACKUP_FAILED'));
  }
  return normalized;
}
