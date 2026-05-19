import { Directory, File, Paths } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';

const SERVICE_SCOPE = 'BackupHistoryService';
const APP_STATE_DIR_NAME = 'qishua_wrongbook';
const SETTINGS_DIR_NAME = 'settings';
const BACKUP_HISTORY_FILE_NAME = 'backup_history.json';

type BackupHistoryState = {
  lastBackupAt: string | null;
  updatedAt: string;
};

const DEFAULT_STATE: BackupHistoryState = {
  lastBackupAt: null,
  updatedAt: new Date(0).toISOString(),
};

function getSettingsDirectory(): Directory {
  return new Directory(Paths.document, APP_STATE_DIR_NAME, SETTINGS_DIR_NAME);
}

function getBackupHistoryFile(): File {
  return new File(getSettingsDirectory(), BACKUP_HISTORY_FILE_NAME);
}

function normalizeIsoDateTime(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return trimmed;
}

function normalizeState(
  input: Partial<BackupHistoryState> | null | undefined,
): BackupHistoryState {
  const source = input ?? {};
  const lastBackupAt = normalizeIsoDateTime(source.lastBackupAt);
  const updatedAt = normalizeIsoDateTime(source.updatedAt) ?? new Date().toISOString();
  return {
    lastBackupAt,
    updatedAt,
  };
}

export async function loadBackupHistoryState(): Promise<BackupHistoryState> {
  try {
    const file = getBackupHistoryFile();
    if (!file.exists) {
      return { ...DEFAULT_STATE };
    }

    const raw = await file.text();
    const parsed = JSON.parse(raw) as Partial<BackupHistoryState> | null;
    return normalizeState(parsed);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to read backup history state, fallback to defaults.', {
      error,
    });
    return { ...DEFAULT_STATE };
  }
}

export async function saveLastBackupAt(lastBackupAt: string): Promise<BackupHistoryState> {
  const normalizedLastBackupAt = normalizeIsoDateTime(lastBackupAt);
  if (!normalizedLastBackupAt) {
    throw new Error('lastBackupAt must be a valid ISO datetime string.');
  }

  const nextState = normalizeState({
    lastBackupAt: normalizedLastBackupAt,
    updatedAt: new Date().toISOString(),
  });

  const directory = getSettingsDirectory();
  directory.create({ intermediates: true, idempotent: true });

  const file = getBackupHistoryFile();
  file.write(JSON.stringify(nextState));
  return nextState;
}
