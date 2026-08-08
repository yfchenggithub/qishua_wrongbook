import type { Mistake, MistakeImageType } from '@/src/models/Mistake';
import type { CustomErrorReason } from '@/src/models/CustomErrorReason';
import type { CustomModule } from '@/src/models/CustomModule';
import type { MistakeRelation } from '@/src/models/MistakeRelation';
import type { MistakeTag } from '@/src/models/MistakeTag';
import type { ModuleQuestionCounter, ModuleRecord } from '@/src/models/Module';
import type { ModuleImportItemRecord, ModuleImportRecord } from '@/src/models/ModuleImport';
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
export type BackupMistakeRelationRecord = MistakeRelation;
export type BackupMistakeTagRecord = MistakeTag;
export type BackupCustomModuleRecord = CustomModule;
export type BackupModuleRecord = ModuleRecord;
export type BackupModuleQuestionCounterRecord = ModuleQuestionCounter;
export type BackupModuleImportRecord = ModuleImportRecord;
export type BackupModuleImportItemRecord = ModuleImportItemRecord;
export type BackupCustomErrorReasonRecord = CustomErrorReason;

export interface BackupVoiceNoteRecord {
  id: string;
  mistakeId: string;
  reviewRecordId: string;
  fileName: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface BackupDataPayload {
  mistakes: BackupMistakeRecord[];
  mistakeImages: BackupMistakeImageRecord[];
  reviewRecords: BackupReviewRecord[];
  mistakeRelations: BackupMistakeRelationRecord[];
  mistakeTags: BackupMistakeTagRecord[];
  modules: BackupModuleRecord[];
  moduleQuestionCounters: BackupModuleQuestionCounterRecord[];
  moduleImports: BackupModuleImportRecord[];
  moduleImportItems: BackupModuleImportItemRecord[];
  customModules: BackupCustomModuleRecord[];
  customErrorReasons: BackupCustomErrorReasonRecord[];
  extra: Record<string, unknown>;
}

export interface BackupImageArchiveFile {
  backupRelativePath: string;
  sourceUri: string;
  sizeBytes: number | null;
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

export type BackupProgressStage =
  | 'starting'
  | 'collect_db'
  | 'collect_images'
  | 'collect_voice'
  | 'package'
  | 'share'
  | 'success';

export interface BackupProgressEvent {
  backupSessionId: string;
  stage: BackupProgressStage;
  message: string;
  current: number;
  total: number;
  elapsedSeconds: number;
}

export interface CreateBackupOptions {
  reason: 'manual' | 'automatic' | 'before_restore';
  onProgress?: (event: BackupProgressEvent) => void;
}

export interface CreateBackupServiceResult {
  fileUri: string;
  fileName: string;
  fileSizeBytes: number | null;
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
  skippedImageCount: number;
  restoredReviewRecords: number;
  voiceNoteCount: number;
  voiceFileCount: number;
  voiceWarningCount: number;
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
