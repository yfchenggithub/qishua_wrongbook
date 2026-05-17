import type { Mistake, MistakeImageType } from '@/src/models/Mistake';
import type { ReviewRecord } from '@/src/models/ReviewRecord';

export const BACKUP_FILE_EXTENSION = '.qsbk' as const;
export const BACKUP_FILE_NAME_PREFIX = 'qishua-backup' as const;
export const BACKUP_FORMAT = 'qishua-backup' as const;
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

