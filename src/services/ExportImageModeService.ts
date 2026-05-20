import { Directory, File, Paths } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';
import {
  DEFAULT_BW_SCAN_STRENGTH,
  DEFAULT_PRINT_ENHANCE_MODE,
  toActiveBwScanStrength,
  toActivePrintEnhanceMode,
  type PrintEnhanceBwScanStrength,
  type PrintEnhanceMode,
} from '@/src/utils/image/printEnhanceConfig';

const SERVICE_SCOPE = 'ExportImageModeService';
const APP_STATE_DIR_NAME = 'qishua_wrongbook';
const SETTINGS_DIR_NAME = 'settings';
const SETTINGS_FILE_NAME = 'export_image_mode.json';

export type ExportImageSettings = {
  mode: PrintEnhanceMode;
  bwScanStrength: PrintEnhanceBwScanStrength;
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
  const bwScanStrength = toActiveBwScanStrength(raw?.bwScanStrength);
  const updatedAt =
    typeof raw?.updatedAt === 'string' && raw.updatedAt.trim().length > 0
      ? raw.updatedAt.trim()
      : new Date(0).toISOString();

  return {
    mode,
    bwScanStrength,
    updatedAt,
  };
}

async function writePersistedSettings(
  mode: PrintEnhanceMode,
  bwScanStrength: PrintEnhanceBwScanStrength,
): Promise<ExportImageSettings> {
  const next: ExportImageSettings = {
    mode: toActivePrintEnhanceMode(mode),
    bwScanStrength: toActiveBwScanStrength(bwScanStrength),
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
        bwScanStrength: DEFAULT_BW_SCAN_STRENGTH,
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
      bwScanStrength: DEFAULT_BW_SCAN_STRENGTH,
      updatedAt: new Date(0).toISOString(),
    };
  }
}

export async function saveExportImageSettings(
  mode: PrintEnhanceMode,
  bwScanStrength: PrintEnhanceBwScanStrength,
): Promise<ExportImageSettings> {
  try {
    return await writePersistedSettings(mode, bwScanStrength);
  } catch (error) {
    Logger.error(SERVICE_SCOPE, 'Failed to save export image mode.', {
      mode,
      bwScanStrength,
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
  const persisted = await saveExportImageSettings(mode, current.bwScanStrength);
  return persisted.mode;
}

export async function loadExportImageBwScanStrength(): Promise<PrintEnhanceBwScanStrength> {
  const settings = await loadExportImageSettings();
  return settings.bwScanStrength;
}

export async function saveExportImageBwScanStrength(
  strength: PrintEnhanceBwScanStrength,
): Promise<PrintEnhanceBwScanStrength> {
  const current = await loadExportImageSettings();
  const persisted = await saveExportImageSettings(current.mode, strength);
  return persisted.bwScanStrength;
}
