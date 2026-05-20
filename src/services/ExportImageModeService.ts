import { Directory, File, Paths } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';
import {
  DEFAULT_PRINT_ENHANCE_MODE,
  type PrintEnhanceMode,
} from '@/src/utils/image/printEnhanceConfig';

const SERVICE_SCOPE = 'ExportImageModeService';
const APP_STATE_DIR_NAME = 'qishua_wrongbook';
const SETTINGS_DIR_NAME = 'settings';
const SETTINGS_FILE_NAME = 'export_image_mode.json';

type PersistedExportImageMode = {
  mode: PrintEnhanceMode;
  updatedAt: string;
};

function getSettingsDirectory(): Directory {
  return new Directory(Paths.document, APP_STATE_DIR_NAME, SETTINGS_DIR_NAME);
}

function getSettingsFile(): File {
  return new File(getSettingsDirectory(), SETTINGS_FILE_NAME);
}

function normalizeExportImageMode(input: unknown): PrintEnhanceMode {
  if (input === 'original' || input === 'clear_print' || input === 'bw_scan') {
    return input;
  }
  return DEFAULT_PRINT_ENHANCE_MODE;
}

function normalizePersistedMode(input: unknown): PersistedExportImageMode {
  const raw = input as Partial<PersistedExportImageMode> | null | undefined;
  const mode = normalizeExportImageMode(raw?.mode);
  const updatedAt =
    typeof raw?.updatedAt === 'string' && raw.updatedAt.trim().length > 0
      ? raw.updatedAt.trim()
      : new Date(0).toISOString();

  return {
    mode,
    updatedAt,
  };
}

async function writePersistedMode(mode: PrintEnhanceMode): Promise<PersistedExportImageMode> {
  const normalizedMode = normalizeExportImageMode(mode);
  const next: PersistedExportImageMode = {
    mode: normalizedMode,
    updatedAt: new Date().toISOString(),
  };

  const settingsDirectory = getSettingsDirectory();
  settingsDirectory.create({ intermediates: true, idempotent: true });
  const settingsFile = getSettingsFile();
  settingsFile.write(JSON.stringify(next));

  return next;
}

export async function loadExportImageMode(): Promise<PrintEnhanceMode> {
  try {
    const settingsFile = getSettingsFile();
    if (!settingsFile.exists) {
      return DEFAULT_PRINT_ENHANCE_MODE;
    }

    const raw = await settingsFile.text();
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizePersistedMode(parsed);
    return normalized.mode;
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load export image mode, fallback to default.', {
      error,
    });
    return DEFAULT_PRINT_ENHANCE_MODE;
  }
}

export async function saveExportImageMode(mode: PrintEnhanceMode): Promise<PrintEnhanceMode> {
  try {
    const persisted = await writePersistedMode(mode);
    return persisted.mode;
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to save export image mode.', {
      mode,
      error,
    });
    throw error;
  }
}
