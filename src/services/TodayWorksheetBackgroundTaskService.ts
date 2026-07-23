import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { initDatabase } from '@/src/db';
import { Logger } from '@/src/services/Logger';
import { ensureTodayWorksheet } from '@/src/services/TodayWorksheetGenerationCoordinator';

const SERVICE_SCOPE = 'TodayWorksheetBackgroundTaskService';
const TASK_NAME = 'qishua-prepare-today-worksheet';
const MINIMUM_INTERVAL_MINUTES = 60;

function isAppActive(): boolean {
  return AppState.currentState === 'active';
}

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async ({ error, executionInfo }) => {
    if (error) {
      Logger.warn(SERVICE_SCOPE, 'Background worksheet task received an execution error.', {
        errorCode: error.code,
        errorMessage: error.message,
        eventId: executionInfo.eventId,
      });
      return BackgroundTask.BackgroundTaskResult.Failed;
    }

    try {
      if (isAppActive()) {
        Logger.info(SERVICE_SCOPE, 'Deferred worksheet generation while the app is active.', {
          eventId: executionInfo.eventId,
        });
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      await initDatabase();
      if (isAppActive()) {
        Logger.info(SERVICE_SCOPE, 'Deferred worksheet generation because the app became active.', {
          eventId: executionInfo.eventId,
        });
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      const result = await ensureTodayWorksheet();
      Logger.info(SERVICE_SCOPE, 'Background worksheet task finished.', {
        eventId: executionInfo.eventId,
        outcome: result.outcome,
        exportedCount: result.exportedCount,
        fromCache: result.fromCache ?? false,
      });
      return result.outcome === 'success' || result.outcome === 'empty'
        ? BackgroundTask.BackgroundTaskResult.Success
        : BackgroundTask.BackgroundTaskResult.Failed;
    } catch (taskError) {
      Logger.error(SERVICE_SCOPE, 'Background worksheet task failed.', {
        eventId: executionInfo.eventId,
        error: taskError,
      });
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerTodayWorksheetBackgroundTask(): Promise<boolean> {
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
    Logger.warn(SERVICE_SCOPE, 'Background worksheet task is unavailable.', {
      taskManagerAvailable,
      backgroundTaskStatus,
    });
    return false;
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (!isRegistered) {
    await BackgroundTask.registerTaskAsync(TASK_NAME, {
      minimumInterval: MINIMUM_INTERVAL_MINUTES,
    });
  }

  Logger.info(SERVICE_SCOPE, 'Background worksheet task is registered.', {
    alreadyRegistered: isRegistered,
    minimumIntervalMinutes: MINIMUM_INTERVAL_MINUTES,
  });
  return true;
}
