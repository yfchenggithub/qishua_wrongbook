import { Directory, File, Paths } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';
import {
  DEFAULT_PRINT_ENHANCE_CONCURRENCY,
  DEFAULT_CLEAR_PRINT_STRENGTH,
  DEFAULT_PRINT_ENHANCE_MODE,
  toActivePrintEnhanceConcurrency,
  toActiveClearPrintStrength,
  toActivePrintEnhanceMode,
  type PrintEnhanceConcurrency,
  type PrintEnhanceClearPrintStrength,
  type PrintEnhanceMode,
} from '@/src/utils/image/printEnhanceConfig';

const SERVICE_SCOPE = 'ExportImageModeService';
const APP_STATE_DIR_NAME = 'qishua_wrongbook';
const SETTINGS_DIR_NAME = 'settings';
const SETTINGS_FILE_NAME = 'export_image_mode.json';

export type ExportImageSettings = {
  mode: PrintEnhanceMode;
  clearPrintStrength: PrintEnhanceClearPrintStrength;
  enhanceConcurrency: PrintEnhanceConcurrency;
  updatedAt: string;
};

function getSettingsDirectory(): Directory {
  return new Directory(Paths.document, APP_STATE_DIR_NAME, SETTINGS_DIR_NAME);
}

function getSettingsFile(): File {
  return new File(getSettingsDirectory(), SETTINGS_FILE_NAME);
}

function normalizePersistedSettings(input: unknown): ExportImageSettings {
  const raw = input as Partial<ExportImageSettings> | null | undefined;
  const mode = toActivePrintEnhanceMode(raw?.mode);
  const clearPrintStrength = toActiveClearPrintStrength(raw?.clearPrintStrength);
  const enhanceConcurrency = toActivePrintEnhanceConcurrency(raw?.enhanceConcurrency);
  const updatedAt =
    typeof raw?.updatedAt === 'string' && raw.updatedAt.trim().length > 0
      ? raw.updatedAt.trim()
      : new Date(0).toISOString();

  return {
    mode,
    clearPrintStrength,
    enhanceConcurrency,
    updatedAt,
  };
}

async function writePersistedSettings(
  mode: PrintEnhanceMode,
  clearPrintStrength: PrintEnhanceClearPrintStrength,
  enhanceConcurrency: PrintEnhanceConcurrency,
): Promise<ExportImageSettings> {
  const next: ExportImageSettings = {
    mode: toActivePrintEnhanceMode(mode),
    clearPrintStrength: toActiveClearPrintStrength(clearPrintStrength),
    enhanceConcurrency: toActivePrintEnhanceConcurrency(enhanceConcurrency),
    updatedAt: new Date().toISOString(),
  };

  const settingsDirectory = getSettingsDirectory();
  settingsDirectory.create({ intermediates: true, idempotent: true });
  const settingsFile = getSettingsFile();
  settingsFile.write(JSON.stringify(next));

  return next;
}

export async function loadExportImageSettings(): Promise<ExportImageSettings> {
  try {
    const settingsFile = getSettingsFile();
    if (!settingsFile.exists) {
      return {
        mode: DEFAULT_PRINT_ENHANCE_MODE,
        clearPrintStrength: DEFAULT_CLEAR_PRINT_STRENGTH,
        enhanceConcurrency: DEFAULT_PRINT_ENHANCE_CONCURRENCY,
        updatedAt: new Date(0).toISOString(),
      };
    }

    const raw = await settingsFile.text();
    const parsed = JSON.parse(raw) as unknown;
    return normalizePersistedSettings(parsed);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load export image mode, fallback to default.', {
      error,
    });
    return {
      mode: DEFAULT_PRINT_ENHANCE_MODE,
      clearPrintStrength: DEFAULT_CLEAR_PRINT_STRENGTH,
      enhanceConcurrency: DEFAULT_PRINT_ENHANCE_CONCURRENCY,
      updatedAt: new Date(0).toISOString(),
    };
  }
}

export async function saveExportImageSettings(
  mode: PrintEnhanceMode,
  clearPrintStrength: PrintEnhanceClearPrintStrength,
  enhanceConcurrency: PrintEnhanceConcurrency,
): Promise<ExportImageSettings> {
  try {
    return await writePersistedSettings(mode, clearPrintStrength, enhanceConcurrency);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to save export image mode.', {
      mode,
      clearPrintStrength,
      enhanceConcurrency,
      error,
    });
    throw error;
  }
}

export async function loadExportImageMode(): Promise<PrintEnhanceMode> {
  const settings = await loadExportImageSettings();
  return settings.mode;
}

export async function saveExportImageMode(mode: PrintEnhanceMode): Promise<PrintEnhanceMode> {
  const current = await loadExportImageSettings();
  const persisted = await saveExportImageSettings(
    mode,
    current.clearPrintStrength,
    current.enhanceConcurrency,
  );
  return persisted.mode;
}

export async function loadExportImageClearPrintStrength(): Promise<PrintEnhanceClearPrintStrength> {
  const settings = await loadExportImageSettings();
  return settings.clearPrintStrength;
}

export async function saveExportImageClearPrintStrength(
  strength: PrintEnhanceClearPrintStrength,
): Promise<PrintEnhanceClearPrintStrength> {
  const current = await loadExportImageSettings();
  const persisted = await saveExportImageSettings(
    current.mode,
    strength,
    current.enhanceConcurrency,
  );
  return persisted.clearPrintStrength;
}

export async function loadExportImageEnhanceConcurrency(): Promise<PrintEnhanceConcurrency> {
  const settings = await loadExportImageSettings();
  return settings.enhanceConcurrency;
}

export async function saveExportImageEnhanceConcurrency(
  concurrency: PrintEnhanceConcurrency,
): Promise<PrintEnhanceConcurrency> {
  const current = await loadExportImageSettings();
  const persisted = await saveExportImageSettings(
    current.mode,
    current.clearPrintStrength,
    concurrency,
  );
  return persisted.enhanceConcurrency;
}
