import type { Mistake, MistakeImageType } from '@/src/models/Mistake';
import type { ReviewRecord } from '@/src/models/ReviewRecord';

export const BACKUP_FILE_EXTENSION = '.qsbk' as const;
export const BACKUP_FILE_NAME_PREFIX = 'qishua-backup' as const;
export const BACKUP_FORMAT = 'qishua_backup' as const;
export const BACKUP_FORMAT_VERSION = 1 as const;

export type BackupDevicePlatform = 'android' | 'ios' | 'web' | 'unknown';

export interface BackupCounts {
  mistakes: number;
  mistakeImages: number;
  reviewRecords: number;
  imageFiles: number;
}

export interface BackupPackageManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appName: string;
  appVersion: string;
  createdAt: string;
  schemaVersion: number;
  devicePlatform: BackupDevicePlatform;
  counts: BackupCounts;
  warnings: string[];
}

export type BackupManifest = BackupPackageManifest;

export type BackupMistakeRecord = Mistake;

export interface BackupMistakeImageRecord {
  id: string;
  mistake_id: string;
  review_record_id: string | null;
  type: MistakeImageType;
  sort_order: number;
  created_at: string;
  sourceUri: string | null;
  backupRelativePath: string;
}

export type BackupReviewRecord = ReviewRecord;

export interface BackupDataPayload {
  mistakes: BackupMistakeRecord[];
  mistakeImages: BackupMistakeImageRecord[];
  reviewRecords: BackupReviewRecord[];
  extra: Record<string, unknown>;
}

export interface BackupImageArchiveFile {
  backupRelativePath: string;
  bytes: Uint8Array;
}

export interface BackupPackagePreview {
  packageUri: string;
  fileName: string;
  manifest: BackupPackageManifest;
  warnings: string[];
}

export interface BackupCreateResult {
  backupUri: string;
  fileName: string;
  manifest: BackupPackageManifest;
  warnings: string[];
}

export interface CreateBackupOptions {
  reason: 'manual' | 'before_restore';
}

export interface CreateBackupServiceResult {
  fileUri: string;
  manifest: BackupManifest;
}

export interface InspectBackupResult {
  manifest: BackupManifest;
  warnings: string[];
}

export interface RestoreFromBackupResult {
  restoreSessionId: string;
  restoredMistakes: number;
  restoredImages: number;
  restoredReviewRecords: number;
  warningCount: number;
  errorCount: number;
  hasBeforeRestoreBackup: boolean;
  beforeRestoreBackupUri?: string;
}

export type RestoreProgressStage =
  | 'starting'
  | 'temp_copy'
  | 'package_read'
  | 'validate'
  | 'before_snapshot'
  | 'images_restore'
  | 'db_import'
  | 'verify'
  | 'rollback'
  | 'success';

export interface RestoreProgressEvent {
  restoreSessionId: string;
  stage: RestoreProgressStage;
  message: string;
}

export interface RestoreFromBackupOptions {
  restoreSessionId?: string;
  fileShortInfo?: string;
  onProgress?: (event: RestoreProgressEvent) => void;
  /**
   * Internal flag for rollback path: skip creating another safety backup.
   */
  skipBeforeSnapshot?: boolean;
  /**
   * Internal flag: disable nested rollback attempts.
   */
  allowRollback?: boolean;
}

export interface RestoreSafetyBackupInfo {
  backupUri: string;
  fileName: string;
  createdAt: string;
}

export interface BackupRestoreResult {
  restoredAt: string;
  preview: BackupPackagePreview;
  safetyBackup: RestoreSafetyBackupInfo;
  warnings: string[];
}
