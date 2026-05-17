import { Logger } from '@/src/services/Logger';
import {
  BACKUP_FILE_EXTENSION,
  type BackupCreateResult,
  type BackupPackagePreview,
  type BackupRestoreResult,
} from '@/src/services/backup/BackupTypes';
import { createNotImplementedBackupError } from '@/src/services/backup/BackupRestoreError';
import {
  PlaceholderBackupZipAdapter,
  type BackupZipAdapter,
} from '@/src/services/backup/BackupZipAdapter';

const SERVICE_SCOPE = 'BackupService';

export interface RestoreFromBackupOptions {
  backupUri: string;
  requireUserConfirmation: boolean;
}

let zipAdapter: BackupZipAdapter = new PlaceholderBackupZipAdapter();

function throwPhaseOneNotImplemented(action: string): never {
  const error = createNotImplementedBackupError(action);
  Logger.warn(SERVICE_SCOPE, `${action} is not implemented in phase 1.`, {
    action,
  });
  throw error;
}

export function configureBackupZipAdapter(adapter: BackupZipAdapter): void {
  zipAdapter = adapter;
}

export async function createBackupPackage(): Promise<BackupCreateResult> {
  void zipAdapter;
  return throwPhaseOneNotImplemented('createBackupPackage');
}

export async function pickBackupPackageFromDevice(): Promise<string | null> {
  return throwPhaseOneNotImplemented('pickBackupPackageFromDevice');
}

export async function previewBackupPackage(backupUri: string): Promise<BackupPackagePreview> {
  void zipAdapter;
  void backupUri;
  return throwPhaseOneNotImplemented('previewBackupPackage');
}

export async function restoreFromBackupPackage(
  options: RestoreFromBackupOptions,
): Promise<BackupRestoreResult> {
  void options;
  return throwPhaseOneNotImplemented('restoreFromBackupPackage');
}

export function isBackupPackageFileName(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  return normalized.endsWith(BACKUP_FILE_EXTENSION);
}

