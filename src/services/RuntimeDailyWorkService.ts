import { AppState } from 'react-native';

import { initDatabase } from '@/src/db';
import { ensureDailyAutomaticBackup } from '@/src/services/backup/AutomaticBackupService';
import { Logger } from '@/src/services/Logger';
import {
  ensureTodayWorksheet,
  inspectTodayWorksheetPreparation,
} from '@/src/services/TodayWorksheetGenerationCoordinator';

const SERVICE_SCOPE = 'RuntimeDailyWorkService';
const FOREGROUND_PREPARATION_RETRY_DELAY_MS = 3_000;

export type RuntimeDailyWorkTrigger =
  | 'app_start'
  | 'app_foreground'
  | 'app_background'
  | 'local_day_change';

type RuntimeWorksheetWorkResult = {
  operation: 'generation' | 'inspection';
  outcome: string;
  pendingCount: number;
  exportedCount: number;
  fromCache: boolean;
  generationActive: boolean;
  appState: string;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function runWorksheetDailyWork(
  trigger: RuntimeDailyWorkTrigger,
): Promise<RuntimeWorksheetWorkResult> {
  const appState = AppState.currentState ?? 'unknown';
  const canGenerate = trigger !== 'app_background' && appState === 'active';
  if (canGenerate) {
    let result = await ensureTodayWorksheet();
    if (
      result.outcome !== 'success'
      && result.outcome !== 'empty'
      && AppState.currentState === 'active'
    ) {
      Logger.warn(SERVICE_SCOPE, 'Foreground worksheet preparation will retry once.', {
        trigger,
        firstOutcome: result.outcome,
        retryDelayMs: FOREGROUND_PREPARATION_RETRY_DELAY_MS,
      });
      await delay(FOREGROUND_PREPARATION_RETRY_DELAY_MS);
      if (AppState.currentState === 'active') {
        result = await ensureTodayWorksheet();
      }
    }
    return {
      operation: 'generation',
      outcome: result.outcome,
      pendingCount: 0,
      exportedCount: result.exportedCount,
      fromCache: result.fromCache ?? false,
      generationActive: false,
      appState,
    };
  }

  const inspection = await inspectTodayWorksheetPreparation();
  return {
    operation: 'inspection',
    outcome: inspection.outcome,
    pendingCount: inspection.pendingCount,
    exportedCount: inspection.cachedWorksheet?.exportedCount ?? 0,
    fromCache: inspection.cachedWorksheet !== null,
    generationActive: inspection.generationActive,
    appState,
  };
}

export async function runRuntimeDailyWork(trigger: RuntimeDailyWorkTrigger): Promise<void> {
  const startedAt = Date.now();
  await initDatabase();

  Logger.info(SERVICE_SCOPE, 'Start app runtime daily work.', { trigger });
  const [worksheetResult] = await Promise.allSettled([
    runWorksheetDailyWork(trigger),
  ]);

  if (worksheetResult.status === 'fulfilled') {
    Logger.info(SERVICE_SCOPE, 'App runtime worksheet work finished.', {
      trigger,
      operation: worksheetResult.value.operation,
      outcome: worksheetResult.value.outcome,
      pendingCount: worksheetResult.value.pendingCount,
      exportedCount: worksheetResult.value.exportedCount,
      fromCache: worksheetResult.value.fromCache,
      generationActive: worksheetResult.value.generationActive,
      appState: worksheetResult.value.appState,
    });
  } else {
    Logger.error(SERVICE_SCOPE, 'App runtime worksheet work failed.', {
      trigger,
      error: worksheetResult.reason,
    });
  }

  if (
    worksheetResult.status === 'fulfilled'
    && worksheetResult.value.generationActive
  ) {
    Logger.info(SERVICE_SCOPE, 'Automatic backup deferred while worksheet generation is active.', {
      trigger,
      worksheetOutcome: worksheetResult.value.outcome,
    });
    Logger.info(SERVICE_SCOPE, 'App runtime daily work settled.', {
      trigger,
      elapsedMs: Date.now() - startedAt,
      backupDeferred: true,
    });
    return;
  }

  const [backupResult] = await Promise.allSettled([
    ensureDailyAutomaticBackup({ trigger: 'app_runtime' }),
  ]);
  if (backupResult.status === 'fulfilled') {
    Logger.info(SERVICE_SCOPE, 'App runtime automatic backup work finished.', {
      trigger,
      outcome: backupResult.value.outcome,
      fileName: backupResult.value.backup.fileName,
      deletedCount: backupResult.value.deletedCount,
    });
  } else {
    Logger.error(SERVICE_SCOPE, 'App runtime automatic backup work failed.', {
      trigger,
      error: backupResult.reason,
    });
  }

  Logger.info(SERVICE_SCOPE, 'App runtime daily work settled.', {
    trigger,
    elapsedMs: Date.now() - startedAt,
  });
}
