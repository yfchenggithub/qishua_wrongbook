import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupCounts,
  type BackupDevicePlatform,
  type BackupPackageManifest,
} from '@/src/services/backup/BackupTypes';

export const BACKUP_MANIFEST_FILE_NAME = 'manifest.json' as const;
export const BACKUP_DATA_FILE_NAME = 'data.json' as const;
export const BACKUP_IMAGES_DIR_NAME = 'images' as const;

export interface CreateManifestInput {
  appName: string;
  appVersion: string;
  schemaVersion: number;
  devicePlatform: BackupDevicePlatform;
  counts: BackupCounts;
  warnings?: string[];
  createdAt?: string;
}

export interface ValidateManifestResult {
  ok: boolean;
  manifest?: BackupPackageManifest;
  errors: string[];
}

function isValidIsoDateTime(value: string): boolean {
  if (!value.trim()) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function normalizeWarnings(warnings?: string[]): string[] {
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function createBackupManifest(input: CreateManifestInput): BackupPackageManifest {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appName: input.appName.trim(),
    appVersion: input.appVersion.trim(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    schemaVersion: input.schemaVersion,
    devicePlatform: input.devicePlatform,
    counts: {
      mistakes: input.counts.mistakes,
      mistakeImages: input.counts.mistakeImages,
      reviewRecords: input.counts.reviewRecords,
      imageFiles: input.counts.imageFiles,
    },
    warnings: normalizeWarnings(input.warnings),
  };
}

export function validateBackupManifest(raw: unknown): ValidateManifestResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      errors: ['manifest must be an object.'],
    };
  }

  const input = raw as Partial<BackupPackageManifest>;

  if (input.format !== BACKUP_FORMAT) {
    errors.push('format is invalid.');
  }

  if (typeof input.formatVersion !== 'number' || input.formatVersion <= 0) {
    errors.push('formatVersion must be a positive number.');
  }

  if (typeof input.appName !== 'string' || input.appName.trim().length <= 0) {
    errors.push('appName is required.');
  }

  if (typeof input.appVersion !== 'string' || input.appVersion.trim().length <= 0) {
    errors.push('appVersion is required.');
  }

  if (typeof input.createdAt !== 'string' || !isValidIsoDateTime(input.createdAt)) {
    errors.push('createdAt must be a valid ISO datetime.');
  }

  if (typeof input.schemaVersion !== 'number' || input.schemaVersion < 0) {
    errors.push('schemaVersion must be a non-negative number.');
  }

  if (
    input.devicePlatform !== 'android' &&
    input.devicePlatform !== 'ios' &&
    input.devicePlatform !== 'web' &&
    input.devicePlatform !== 'unknown'
  ) {
    errors.push('devicePlatform is invalid.');
  }

  const counts = input.counts;
  if (!counts || typeof counts !== 'object') {
    errors.push('counts must be an object.');
  } else {
    const mappedCounts = counts as Partial<BackupCounts>;
    if (typeof mappedCounts.mistakes !== 'number' || mappedCounts.mistakes < 0) {
      errors.push('counts.mistakes must be a non-negative number.');
    }
    if (typeof mappedCounts.mistakeImages !== 'number' || mappedCounts.mistakeImages < 0) {
      errors.push('counts.mistakeImages must be a non-negative number.');
    }
    if (typeof mappedCounts.reviewRecords !== 'number' || mappedCounts.reviewRecords < 0) {
      errors.push('counts.reviewRecords must be a non-negative number.');
    }
    if (typeof mappedCounts.imageFiles !== 'number' || mappedCounts.imageFiles < 0) {
      errors.push('counts.imageFiles must be a non-negative number.');
    }
  }

  if (input.warnings !== undefined && !Array.isArray(input.warnings)) {
    errors.push('warnings must be an array when present.');
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }

  return {
    ok: true,
    errors: [],
    manifest: createBackupManifest({
      appName: input.appName as string,
      appVersion: input.appVersion as string,
      schemaVersion: input.schemaVersion as number,
      devicePlatform: input.devicePlatform as BackupDevicePlatform,
      counts: input.counts as BackupCounts,
      warnings: input.warnings,
      createdAt: input.createdAt,
    }),
  };
}

