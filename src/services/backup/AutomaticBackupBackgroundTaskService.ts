import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { initDatabase } from '@/src/db';
import { ensureDailyStorageMaintenance } from '@/src/services/DailyStorageMaintenanceService';
import { Logger } from '@/src/services/Logger';
import { ensureDailyAutomaticBackup } from '@/src/services/backup/AutomaticBackupService';

const SERVICE_SCOPE = 'AutomaticBackupBackgroundTaskService';
const TASK_NAME = 'qishua-create-daily-automatic-backup';
const MINIMUM_INTERVAL_MINUTES = 60;

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async ({ error, executionInfo }) => {
    if (error) {
      Logger.warn(SERVICE_SCOPE, 'Background automatic backup task received an execution error.', {
        errorCode: error.code,
        errorMessage: error.message,
        eventId: executionInfo.eventId,
      });
      return BackgroundTask.BackgroundTaskResult.Failed;
    }

    try {
      await initDatabase();
      const [backupResult, storageMaintenanceResult] = await Promise.allSettled([
        ensureDailyAutomaticBackup({ trigger: 'background' }),
        ensureDailyStorageMaintenance({ trigger: 'background_task' }),
      ]);

      if (backupResult.status === 'fulfilled') {
        Logger.info(SERVICE_SCOPE, 'Background automatic backup task finished.', {
          eventId: executionInfo.eventId,
          outcome: backupResult.value.outcome,
          fileName: backupResult.value.backup.fileName,
          deletedCount: backupResult.value.deletedCount,
        });
      } else {
        Logger.error(SERVICE_SCOPE, 'Background automatic backup task failed.', {
          eventId: executionInfo.eventId,
          error: backupResult.reason,
        });
      }

      if (storageMaintenanceResult.status === 'fulfilled') {
        Logger.info(SERVICE_SCOPE, 'Background daily storage maintenance finished.', {
          eventId: executionInfo.eventId,
          outcome: storageMaintenanceResult.value.outcome,
          date: storageMaintenanceResult.value.date,
          pdfDeletedCount:
            storageMaintenanceResult.value.pdfCleanup?.deletedCount ?? 0,
          imageDeletedCount:
            storageMaintenanceResult.value.imageCacheCleanup?.deletedCount ?? 0,
        });
      } else {
        Logger.error(SERVICE_SCOPE, 'Background daily storage maintenance failed.', {
          eventId: executionInfo.eventId,
          error: storageMaintenanceResult.reason,
        });
      }

      if (
        backupResult.status === 'rejected'
        || storageMaintenanceResult.status === 'rejected'
      ) {
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (taskError) {
      Logger.error(SERVICE_SCOPE, 'Background automatic backup task failed.', {
        eventId: executionInfo.eventId,
        error: taskError,
      });
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerAutomaticBackupBackgroundTask(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  const [taskManagerAvailable, backgroundTaskStatus] = await Promise.all([
    TaskManager.isAvailableAsync(),
    BackgroundTask.getStatusAsync(),
  ]);
  if (
    !taskManagerAvailable
    || backgroundTaskStatus !== BackgroundTask.BackgroundTaskStatus.Available
  ) {
    Logger.warn(SERVICE_SCOPE, 'Background automatic backup task is unavailable.', {
      taskManagerAvailable,
      backgroundTaskStatus,
    });
    return false;
  }

  let isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  let registrationUpdated = false;
  if (isRegistered) {
    const registeredOptions = await TaskManager.getTaskOptionsAsync<{
      minimumInterval?: number;
    }>(TASK_NAME);
    if (registeredOptions?.minimumInterval !== MINIMUM_INTERVAL_MINUTES) {
      await BackgroundTask.unregisterTaskAsync(TASK_NAME);
      isRegistered = false;
      registrationUpdated = true;
    }
  }
  if (!isRegistered) {
    await BackgroundTask.registerTaskAsync(TASK_NAME, {
      minimumInterval: MINIMUM_INTERVAL_MINUTES,
    });
  }

  Logger.info(SERVICE_SCOPE, 'Background automatic backup task is registered.', {
    alreadyRegistered: isRegistered,
    registrationUpdated,
    minimumIntervalMinutes: MINIMUM_INTERVAL_MINUTES,
  });
  return true;
}
