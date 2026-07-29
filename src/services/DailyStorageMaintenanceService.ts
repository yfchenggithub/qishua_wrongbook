import { Directory, File, Paths } from 'expo-file-system';

import { Logger } from '@/src/services/Logger';
import {
  clearPrintEnhanceImageCache,
  type PrintEnhanceCacheCleanupResult,
} from '@/src/services/export/PrintEnhanceCacheService';
import {
  cleanupHistoricalWorksheetPdfFiles,
  scanHistoricalWorksheetPdfFiles,
  type HistoricalWorksheetPdfCleanupResult,
} from '@/src/services/TodayWorksheetPdfCacheService';
import { toDateOnlyString } from '@/src/utils/date';

const SERVICE_SCOPE = 'DailyStorageMaintenanceService';
const APP_STATE_DIR_NAME = 'qishua_wrongbook';
const STATE_FILE_NAME = 'daily_storage_maintenance.json';
const NEXT_STATE_FILE_NAME = `${STATE_FILE_NAME}.next`;
const STATE_VERSION = 1;

export type DailyStorageMaintenanceTrigger =
  | 'app_start'
  | 'app_foreground'
  | 'app_background'
  | 'local_day_change'
  | 'background_task';

export type DailyStorageMaintenanceResult = {
  outcome: 'completed' | 'already_completed';
  date: string;
  pdfCleanup: HistoricalWorksheetPdfCleanupResult | null;
  imageCacheCleanup: PrintEnhanceCacheCleanupResult | null;
};

type DailyStorageMaintenanceState = {
  version: typeof STATE_VERSION;
  lastCompletedDate: string;
  completedAt: string;
};

let maintenancePromise: Promise<DailyStorageMaintenanceResult> | null = null;

function getStateDirectory(): Directory {
  return new Directory(Paths.document, APP_STATE_DIR_NAME);
}

function getStateFile(): File {
  return new File(getStateDirectory(), STATE_FILE_NAME);
}

function getNextStateFile(): File {
  return new File(getStateDirectory(), NEXT_STATE_FILE_NAME);
}

function normalizeState(input: unknown): DailyStorageMaintenanceState | null {
  const raw = input as Partial<DailyStorageMaintenanceState> | null | undefined;
  if (
    raw?.version !== STATE_VERSION
    || typeof raw.lastCompletedDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(raw.lastCompletedDate)
    || typeof raw.completedAt !== 'string'
    || Number.isNaN(new Date(raw.completedAt).getTime())
  ) {
    return null;
  }

  return {
    version: STATE_VERSION,
    lastCompletedDate: raw.lastCompletedDate,
    completedAt: raw.completedAt,
  };
}

async function loadState(): Promise<DailyStorageMaintenanceState | null> {
  const stateFile = getStateFile();
  if (!stateFile.exists) {
    return null;
  }

  try {
    return normalizeState(JSON.parse(await stateFile.text()) as unknown);
  } catch (error) {
    Logger.warn(SERVICE_SCOPE, 'Failed to load daily storage maintenance state.', { error });
    return null;
  }
}

async function saveCompletedState(date: string): Promise<void> {
  const stateDirectory = getStateDirectory();
  stateDirectory.create({ intermediates: true, idempotent: true });

  const state: DailyStorageMaintenanceState = {
    version: STATE_VERSION,
    lastCompletedDate: date,
    completedAt: new Date().toISOString(),
  };
  const stateFile = getStateFile();
  const nextStateFile = getNextStateFile();
  if (nextStateFile.exists) {
    nextStateFile.delete();
  }
  nextStateFile.write(JSON.stringify(state));

  const verifiedState = normalizeState(JSON.parse(await nextStateFile.text()) as unknown);
  if (verifiedState?.lastCompletedDate !== date) {
    nextStateFile.delete();
    throw new Error('Daily storage maintenance state verification failed.');
  }

  if (stateFile.exists) {
    stateFile.delete();
  }
  nextStateFile.move(stateFile);
}

async function runDailyStorageMaintenance(
  trigger: DailyStorageMaintenanceTrigger,
): Promise<DailyStorageMaintenanceResult> {
  const startedAt = Date.now();
  const date = toDateOnlyString(new Date());
  const state = await loadState();
  if (state?.lastCompletedDate === date) {
    Logger.info(SERVICE_SCOPE, 'Daily storage maintenance already completed.', {
      trigger,
      date,
      completedAt: state.completedAt,
    });
    return {
      outcome: 'already_completed',
      date,
      pdfCleanup: null,
      imageCacheCleanup: null,
    };
  }

  Logger.info(SERVICE_SCOPE, 'Start daily storage maintenance.', { trigger, date });
  const pdfScan = await scanHistoricalWorksheetPdfFiles();
  const pdfCleanup = await cleanupHistoricalWorksheetPdfFiles(
    pdfScan.candidates.map((candidate) => candidate.uri),
  );
  const imageCacheCleanup = await clearPrintEnhanceImageCache();
  await saveCompletedState(date);

  Logger.info(SERVICE_SCOPE, 'Daily storage maintenance completed.', {
    trigger,
    date,
    elapsedMs: Date.now() - startedAt,
    pdfDeletedCount: pdfCleanup.deletedCount,
    pdfFailedCount: pdfCleanup.failedCount,
    pdfReleasedBytes: pdfCleanup.releasedBytes,
    imageDeletedCount: imageCacheCleanup.deletedCount,
    imageFailedCount: imageCacheCleanup.failedCount,
    imageReleasedBytes: imageCacheCleanup.releasedBytes,
  });
  return {
    outcome: 'completed',
    date,
    pdfCleanup,
    imageCacheCleanup,
  };
}

export function ensureDailyStorageMaintenance(options: {
  trigger: DailyStorageMaintenanceTrigger;
}): Promise<DailyStorageMaintenanceResult> {
  if (maintenancePromise) {
    return maintenancePromise;
  }

  maintenancePromise = runDailyStorageMaintenance(options.trigger)
    .finally(() => {
      maintenancePromise = null;
    });
  return maintenancePromise;
}
