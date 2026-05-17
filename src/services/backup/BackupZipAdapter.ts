import { createNotImplementedBackupError } from '@/src/services/backup/BackupRestoreError';

export interface BackupZipAdapter {
  createArchive(sourceDirectoryUri: string, targetArchiveUri: string): Promise<void>;
  extractArchive(archiveUri: string, targetDirectoryUri: string): Promise<void>;
  listArchiveEntries(archiveUri: string): Promise<string[]>;
}

export class PlaceholderBackupZipAdapter implements BackupZipAdapter {
  async createArchive(sourceDirectoryUri: string, targetArchiveUri: string): Promise<void> {
    void sourceDirectoryUri;
    void targetArchiveUri;
    throw createNotImplementedBackupError('createArchive');
  }

  async extractArchive(archiveUri: string, targetDirectoryUri: string): Promise<void> {
    void archiveUri;
    void targetDirectoryUri;
    throw createNotImplementedBackupError('extractArchive');
  }

  async listArchiveEntries(archiveUri: string): Promise<string[]> {
    void archiveUri;
    throw createNotImplementedBackupError('listArchiveEntries');
  }
}

