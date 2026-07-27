import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { initDatabase } from '@/src/db';
import { isAndroidNativeWorksheetPdfAvailable } from '@/src/services/AndroidNativeWorksheetPdfService';
import { Logger } from '@/src/services/Logger';
import {
  ensureTodayWorksheet,
  inspectTodayWorksheetPreparation,
} from '@/src/services/TodayWorksheetGenerationCoordinator';

const SERVICE_SCOPE = 'TodayWorksheetBackgroundTaskService';
const TASK_NAME = 'qishua-prepare-today-worksheet';
const MINIMUM_INTERVAL_MINUTES = 60;

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
      await initDatabase();
      const inspection = await inspectTodayWorksheetPreparation();
      Logger.info(SERVICE_SCOPE, 'Background worksheet preparation inspected.', {
        eventId: executionInfo.eventId,
        outcome: inspection.outcome,
        pendingCount: inspection.pendingCount,
        cachedExportedCount: inspection.cachedWorksheet?.exportedCount ?? 0,
        generationActive: inspection.generationActive,
      });

      if (
        inspection.outcome !== 'pending'
        || inspection.generationActive
      ) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      if (!isAndroidNativeWorksheetPdfAvailable()) {
        Logger.warn(SERVICE_SCOPE, 'Native worksheet PDF module is unavailable in background.', {
          eventId: executionInfo.eventId,
          pendingCount: inspection.pendingCount,
        });
        return BackgroundTask.BackgroundTaskResult.Failed;
      }

      const result = await ensureTodayWorksheet({
        expectedPendingCount: inspection.pendingCount,
      });
      Logger.info(SERVICE_SCOPE, 'Background worksheet preparation settled.', {
        eventId: executionInfo.eventId,
        outcome: result.outcome,
        exportedCount: result.exportedCount,
        fromCache: result.fromCache ?? false,
      });
      if (result.outcome !== 'success' && result.outcome !== 'empty') {
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (taskError) {
      Logger.error(SERVICE_SCOPE, 'Background worksheet preparation failed.', {
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
