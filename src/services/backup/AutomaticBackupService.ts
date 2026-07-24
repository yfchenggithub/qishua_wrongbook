import { Directory, File, Paths } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';
import * as BackupService from '@/src/services/backup/BackupService';
import type { BackupProgressEvent } from '@/src/services/backup/BackupTypes';
import { cleanupCachedBackupPackagesBefore } from '@/src/services/backup/BackupZipAdapter';
import { toDateOnlyString } from '@/src/utils/date';

const SERVICE_SCOPE = 'AutomaticBackupService';
const APP_STATE_DIR_NAME = 'qishua_wrongbook';
const AUTOMATIC_BACKUP_DIR_NAME = 'automatic_backups';
const AUTOMATIC_BACKUP_FILE_PATTERN =
  /^qishua-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.qsbk$/i;

export type AutomaticBackupTrigger = 'app_runtime' | 'background';

export type AutomaticBackupRecord = {
  date: string;
  createdAt: string;
  fileUri: string;
  fileName: string;
  fileSizeBytes: number;
};

export type EnsureDailyAutomaticBackupResult = {
  outcome: 'created' | 'existing';
  backup: AutomaticBackupRecord;
  deletedCount: number;
};

export type CleanupAutomaticBackupsResult = {
  retainedBackup: AutomaticBackupRecord | null;
  deletedCount: number;
  failedCount: number;
};

type ManagedAutomaticBackup = {
  file: File;
  record: AutomaticBackupRecord | null;
};

let ensurePromise: Promise<EnsureDailyAutomaticBackupResult> | null = null;
const listeners = new Set<(backup: AutomaticBackupRecord) => void>();

function notifyAutomaticBackupReady(backup: AutomaticBackupRecord): void {
  for (const listener of listeners) {
    try {
      listener(backup);
    } catch (error) {
      Logger.warn(SERVICE_SCOPE, 'Automatic backup listener failed.', {
        fileName: backup.fileName,
        error,
      });
    }
  }
}

export function subscribeAutomaticBackup(
  listener: (backup: AutomaticBackupRecord) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getAutomaticBackupDirectory(): Directory {
  return new Directory(Paths.document, APP_STATE_DIR_NAME, AUTOMATIC_BACKUP_DIR_NAME);
}

function parseManagedBackupFile(file: File): ManagedAutomaticBackup | null {
  const matched = AUTOMATIC_BACKUP_FILE_PATTERN.exec(file.name);
  if (!matched) {
    return null;
  }

  const year = Number(matched[1]);
  const monthIndex = Number(matched[2]) - 1;
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const second = Number(matched[6]);
  const createdDate = new Date(year, monthIndex, day, hour, minute, second, 0);
  const isValidDate =
    !Number.isNaN(createdDate.getTime())
    && createdDate.getFullYear() === year
    && createdDate.getMonth() === monthIndex
    && createdDate.getDate() === day
    && createdDate.getHours() === hour
    && createdDate.getMinutes() === minute
    && createdDate.getSeconds() === second;

  try {
    const info = file.info();
    const fileSizeBytes =
      typeof info.size === 'number' && Number.isFinite(info.size)
        ? Math.max(0, Math.floor(info.size))
        : 0;
    if (!info.exists || !isValidDate || fileSizeBytes <= 0) {
      return { file, record: null };
    }

    return {
      file,
      record: {
        date: toDateOnlyString(createdDate),
        createdAt: createdDate.toISOString(),
        fileUri: file.uri,
        fileName: file.name,
        fileSizeBytes,
      },
    };
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to inspect a managed automatic backup.', {
      fileName: file.name,
      error,
    });
    return { file, record: null };
  }
}

function scanManagedAutomaticBackups(): ManagedAutomaticBackup[] {
  const directory = getAutomaticBackupDirectory();
  if (!directory.exists) {
    return [];
  }

  const entries: ManagedAutomaticBackup[] = [];
  for (const entry of directory.list()) {
    if (!(entry instanceof File)) {
      continue;
    }
    const managedBackup = parseManagedBackupFile(entry);
    if (managedBackup) {
      entries.push(managedBackup);
    }
  }
  return entries;
}

function compareBackupNewestFirst(
  left: AutomaticBackupRecord,
  right: AutomaticBackupRecord,
): number {
  return right.createdAt.localeCompare(left.createdAt);
}

export async function cleanupAutomaticBackups(
  now = new Date(),
): Promise<CleanupAutomaticBackupsResult> {
  const today = toDateOnlyString(now);
  const directory = getAutomaticBackupDirectory();
  directory.create({ intermediates: true, idempotent: true });

  const managedBackups = scanManagedAutomaticBackups();
  const retainedBackup =
    managedBackups
      .map((entry) => entry.record)
      .filter((record): record is AutomaticBackupRecord => record?.date === today)
      .sort(compareBackupNewestFirst)[0] ?? null;
  const cacheCleanup = cleanupCachedBackupPackagesBefore(now);
  let deletedCount = cacheCleanup.deletedCount;
  let failedCount = cacheCleanup.failedCount;

  for (const entry of managedBackups) {
    if (retainedBackup && entry.file.uri === retainedBackup.fileUri) {
      continue;
    }
    try {
      if (entry.file.exists) {
        entry.file.delete();
        deletedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      Logger.warn(SERVICE_SCOPE, 'Failed to delete an expired automatic backup.', {
        fileName: entry.file.name,
        today,
        error,
      });
    }
  }

  Logger.info(SERVICE_SCOPE, 'Automatic backup cleanup finished.', {
    today,
    retainedFileName: retainedBackup?.fileName ?? null,
    deletedCount,
    failedCount,
  });
  return {
    retainedBackup,
    deletedCount,
    failedCount,
  };
}

export async function getTodayAutomaticBackup(
  now = new Date(),
): Promise<AutomaticBackupRecord | null> {
  const today = toDateOnlyString(now);
  return (
    scanManagedAutomaticBackups()
      .map((entry) => entry.record)
      .filter((record): record is AutomaticBackupRecord => record?.date === today)
      .sort(compareBackupNewestFirst)[0] ?? null
  );
}

async function createTodayAutomaticBackup(options: {
  trigger: AutomaticBackupTrigger;
  onProgress?: (event: BackupProgressEvent) => void;
}): Promise<EnsureDailyAutomaticBackupResult> {
  const startedAt = Date.now();
  const cleanupBeforeCreate = await cleanupAutomaticBackups();
  if (cleanupBeforeCreate.retainedBackup) {
    return {
      outcome: 'existing',
      backup: cleanupBeforeCreate.retainedBackup,
      deletedCount: cleanupBeforeCreate.deletedCount,
    };
  }

  Logger.info(SERVICE_SCOPE, 'Start creating today automatic backup.', {
    trigger: options.trigger,
  });
  const created = await BackupService.createBackup({
    reason: 'automatic',
    onProgress: options.onProgress,
  });

  const automaticBackupDirectory = getAutomaticBackupDirectory();
  automaticBackupDirectory.create({ intermediates: true, idempotent: true });
  const sourceFile = new File(created.fileUri);
  const destinationFile = new File(automaticBackupDirectory, created.fileName);
  if (destinationFile.exists) {
    destinationFile.delete();
  }
  sourceFile.copy(destinationFile);

  const destinationInfo = destinationFile.info();
  const fileSizeBytes =
    typeof destinationInfo.size === 'number' && Number.isFinite(destinationInfo.size)
      ? Math.max(0, Math.floor(destinationInfo.size))
      : 0;
  if (!destinationInfo.exists || fileSizeBytes <= 0) {
    if (destinationFile.exists) {
      destinationFile.delete();
    }
    throw new Error('Automatic backup could not be persisted.');
  }

  try {
    if (sourceFile.exists) {
      sourceFile.delete();
    }
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to delete the temporary automatic backup package.', {
      fileName: created.fileName,
      error,
    });
  }

  const cleanupAfterCreate = await cleanupAutomaticBackups();
  const backup =
    cleanupAfterCreate.retainedBackup
    ?? {
      date: toDateOnlyString(new Date(created.manifest.createdAt)),
      createdAt: created.manifest.createdAt,
      fileUri: destinationFile.uri,
      fileName: created.fileName,
      fileSizeBytes,
    };

  Logger.info(SERVICE_SCOPE, 'Today automatic backup is ready.', {
    trigger: options.trigger,
    fileName: backup.fileName,
    fileSizeBytes: backup.fileSizeBytes,
    elapsedMs: Date.now() - startedAt,
    deletedCount: cleanupBeforeCreate.deletedCount + cleanupAfterCreate.deletedCount,
  });
  return {
    outcome: 'created',
    backup,
    deletedCount: cleanupBeforeCreate.deletedCount + cleanupAfterCreate.deletedCount,
  };
}

export function ensureDailyAutomaticBackup(options: {
  trigger: AutomaticBackupTrigger;
  onProgress?: (event: BackupProgressEvent) => void;
}): Promise<EnsureDailyAutomaticBackupResult> {
  if (ensurePromise) {
    return ensurePromise;
  }

  ensurePromise = createTodayAutomaticBackup(options)
    .then((result) => {
      notifyAutomaticBackupReady(result.backup);
      return result;
    })
    .finally(() => {
      ensurePromise = null;
    });
  return ensurePromise;
}
