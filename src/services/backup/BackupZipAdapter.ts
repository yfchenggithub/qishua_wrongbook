import { Directory, File, Paths } from 'expo-file-system';
import { strToU8, zipSync } from 'fflate';

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

export interface CreateBackupPackageInput {
  fileName: string;
  manifest: BackupManifest;
  data: BackupDataPayload;
  images: BackupImageArchiveFile[];
  voiceNotes: BackupVoiceNoteRecord[];
  voiceFiles: BackupImageArchiveFile[];
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

function buildArchiveEntries(input: CreateBackupPackageInput): Record<string, Uint8Array> {
  const manifestText = JSON.stringify(input.manifest, null, 2);
  const dataText = JSON.stringify(input.data, null, 2);
  const voiceNotesText = JSON.stringify(input.voiceNotes, null, 2);

  const entries: Record<string, Uint8Array> = {
    [BACKUP_MANIFEST_FILE_NAME]: strToU8(manifestText),
    [BACKUP_DATA_FILE_NAME]: strToU8(dataText),
    [BACKUP_VOICE_NOTES_FILE_NAME]: strToU8(voiceNotesText),
    [`${BACKUP_IMAGES_DIR_NAME}/`]: new Uint8Array(0),
    [`${BACKUP_VOICE_FILES_DIR_NAME}/`]: new Uint8Array(0),
  };

  for (const image of input.images) {
    const imagePath = normalizeArchivePath(image.backupRelativePath);
    entries[imagePath] = image.bytes;
  }

  for (const voiceFile of input.voiceFiles) {
    const voiceFilePath = ensureBackupVoiceFileRelativePath(voiceFile.backupRelativePath);
    entries[voiceFilePath] = voiceFile.bytes;
  }

  return entries;
}

function ensureCacheBackupDir(): Directory {
  const backupDir = new Directory(Paths.cache, CACHE_BACKUP_DIR_NAME);
  backupDir.create({ intermediates: true, idempotent: true });
  return backupDir;
}

export class FflateBackupZipAdapter implements BackupZipAdapter {
  async createBackupPackage(
    input: CreateBackupPackageInput,
  ): Promise<{ fileUri: string; fileName: string }> {
    const normalizedFileName = normalizeBackupFileName(input.fileName);

    const entries = buildArchiveEntries(input);

    // Images and voice notes are already compressed; storing entries avoids long JS-thread stalls.
    const archiveBytes = zipSync(entries, { level: 0 });
    const backupDir = ensureCacheBackupDir();
    const file = new File(backupDir, normalizedFileName);
    file.create({ intermediates: true, overwrite: true });
    file.write(archiveBytes);

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
