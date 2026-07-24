import { initDatabase } from '@/src/db';
import { ensureDailyAutomaticBackup } from '@/src/services/backup/AutomaticBackupService';
import { Logger } from '@/src/services/Logger';
import { ensureTodayWorksheet } from '@/src/services/TodayWorksheetGenerationCoordinator';

const SERVICE_SCOPE = 'RuntimeDailyWorkService';

export type RuntimeDailyWorkTrigger =
  | 'app_start'
  | 'app_foreground'
  | 'app_background'
  | 'local_day_change';

export async function runRuntimeDailyWork(trigger: RuntimeDailyWorkTrigger): Promise<void> {
  const startedAt = Date.now();
  await initDatabase();

  Logger.info(SERVICE_SCOPE, 'Start app runtime daily work.', { trigger });
  const [worksheetResult, backupResult] = await Promise.allSettled([
    ensureTodayWorksheet(),
    ensureDailyAutomaticBackup({ trigger: 'app_runtime' }),
  ]);

  if (worksheetResult.status === 'fulfilled') {
    Logger.info(SERVICE_SCOPE, 'App runtime worksheet work finished.', {
      trigger,
      outcome: worksheetResult.value.outcome,
      exportedCount: worksheetResult.value.exportedCount,
      fromCache: worksheetResult.value.fromCache ?? false,
    });
  } else {
    Logger.error(SERVICE_SCOPE, 'App runtime worksheet work failed.', {
      trigger,
      error: worksheetResult.reason,
    });
  }

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
