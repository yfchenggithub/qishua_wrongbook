import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { initDatabase } from '@/src/db';
import { Logger } from '@/src/services/Logger';
import { ensureDailyAutomaticBackup } from '@/src/services/backup/AutomaticBackupService';

const SERVICE_SCOPE = 'AutomaticBackupBackgroundTaskService';
const TASK_NAME = 'qishua-create-daily-automatic-backup';
const MINIMUM_INTERVAL_MINUTES = 60;

function isAppActive(): boolean {
  return AppState.currentState === 'active';
}

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
      if (isAppActive()) {
        Logger.info(SERVICE_SCOPE, 'Deferred automatic backup while the app is active.', {
          eventId: executionInfo.eventId,
        });
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      await initDatabase();
      if (isAppActive()) {
        Logger.info(SERVICE_SCOPE, 'Deferred automatic backup because the app became active.', {
          eventId: executionInfo.eventId,
        });
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      const result = await ensureDailyAutomaticBackup({ trigger: 'background' });
      Logger.info(SERVICE_SCOPE, 'Background automatic backup task finished.', {
        eventId: executionInfo.eventId,
        outcome: result.outcome,
        fileName: result.backup.fileName,
        deletedCount: result.deletedCount,
      });
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
