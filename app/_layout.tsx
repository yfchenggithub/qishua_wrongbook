import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { initDatabase } from '@/src/db';
import { MusicProvider } from '@/src/music';
import { Logger } from '@/src/services/Logger';
import * as ReviewReminderService from '@/src/services/ReviewReminderService';
import { getRuntimeLogContext } from '@/src/services/RuntimeContextService';
import { registerAutomaticBackupBackgroundTask } from '@/src/services/backup/AutomaticBackupBackgroundTaskService';
import { ensureDailyAutomaticBackup } from '@/src/services/backup/AutomaticBackupService';
import { registerTodayWorksheetBackgroundTask } from '@/src/services/TodayWorksheetBackgroundTaskService';
import { ensureTodayWorksheet } from '@/src/services/TodayWorksheetGenerationCoordinator';

export const unstable_settings = {
  anchor: '(tabs)',
};

const LAYOUT_SCOPE = 'RootLayout';
const WORKSHEET_STARTUP_DELAY_MS = 800;
const AUTOMATIC_BACKUP_STARTUP_DELAY_MS = 1800;
const DATE_ROLLOVER_DELAY_MS = 1000;
let appDatabaseInitPromise: Promise<void> | null = null;
let hasConfiguredNotificationHandler = false;
let hasLoggedRuntimeContext = false;

function logRuntimeContextOnce(): void {
  if (hasLoggedRuntimeContext) {
    return;
  }

  hasLoggedRuntimeContext = true;
  Logger.info('RuntimeContext', 'Runtime context initialized.', getRuntimeLogContext());
}

function configureNotificationHandlerOnce(): void {
  if (hasConfiguredNotificationHandler) {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  hasConfiguredNotificationHandler = true;
}

function initializeDatabaseOnce(): Promise<void> {
  if (!appDatabaseInitPromise) {
    appDatabaseInitPromise = initDatabase()
      .then(() => {
        Logger.info(LAYOUT_SCOPE, 'SQLite initialized during app bootstrap.');
      })
      .catch((error) => {
        Logger.error(LAYOUT_SCOPE, 'SQLite initialization failed during app bootstrap.', error);
        throw error;
      });
  }

  return appDatabaseInitPromise;
}

async function prepareTodayWorksheet(reason: string): Promise<void> {
  try {
    await initializeDatabaseOnce();
    const result = await ensureTodayWorksheet();
    Logger.info(LAYOUT_SCOPE, 'Today worksheet preparation finished.', {
      reason,
      outcome: result.outcome,
      exportedCount: result.exportedCount,
      fromCache: result.fromCache ?? false,
    });
  } catch (error) {
    Logger.warn(LAYOUT_SCOPE, 'Today worksheet preparation failed.', { reason, error });
  }
}

async function prepareAutomaticBackup(
  trigger: 'app_start' | 'app_foreground' | 'date_rollover',
): Promise<void> {
  try {
    await initializeDatabaseOnce();
    const result = await ensureDailyAutomaticBackup({ trigger });
    Logger.info(LAYOUT_SCOPE, 'Automatic backup preparation finished.', {
      trigger,
      outcome: result.outcome,
      fileName: result.backup.fileName,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    Logger.warn(LAYOUT_SCOPE, 'Automatic backup preparation failed.', { trigger, error });
  }
}

function getMillisecondsUntilNextLocalDay(): number {
  const now = new Date();
  const nextDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    DATE_ROLLOVER_DELAY_MS,
  );
  return Math.max(DATE_ROLLOVER_DELAY_MS, nextDay.getTime() - now.getTime());
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();

  useEffect(() => {
    logRuntimeContextOnce();
    configureNotificationHandlerOnce();

    void initializeDatabaseOnce()
      .then(async () => {
        await ReviewReminderService.refreshReminderSchedule({ reason: 'app_start' });
      })
      .then(() => {
        Logger.info(LAYOUT_SCOPE, 'Reminder schedule refreshed on app start.');
      })
      .catch((error: unknown) => {
        // Database initialization errors are already logged in initializeDatabaseOnce.
        Logger.warn(LAYOUT_SCOPE, 'Reminder schedule refresh on app start failed.', { error });
      });
  }, []);

  useEffect(() => {
    let dateRolloverTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleDateRollover = () => {
      if (dateRolloverTimer) {
        clearTimeout(dateRolloverTimer);
      }
      dateRolloverTimer = setTimeout(() => {
        void prepareTodayWorksheet('date_rollover');
        void prepareAutomaticBackup('date_rollover');
        scheduleDateRollover();
      }, getMillisecondsUntilNextLocalDay());
    };

    const startupTimer = setTimeout(() => {
      void prepareTodayWorksheet('app_start');
    }, WORKSHEET_STARTUP_DELAY_MS);
    const automaticBackupStartupTimer = setTimeout(() => {
      void prepareAutomaticBackup('app_start');
    }, AUTOMATIC_BACKUP_STARTUP_DELAY_MS);
    void registerTodayWorksheetBackgroundTask().catch((error) => {
      Logger.warn(LAYOUT_SCOPE, 'Today worksheet background task registration failed.', { error });
    });
    void registerAutomaticBackupBackgroundTask().catch((error) => {
      Logger.warn(LAYOUT_SCOPE, 'Automatic backup background task registration failed.', { error });
    });
    scheduleDateRollover();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return;
      }
      void prepareTodayWorksheet('app_foreground');
      void prepareAutomaticBackup('app_foreground');
      scheduleDateRollover();
    });

    return () => {
      clearTimeout(startupTimer);
      clearTimeout(automaticBackupStartupTimer);
      if (dateRolloverTimer) {
        clearTimeout(dateRolloverTimer);
      }
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const handleNotificationResponse = async (
      response: Notifications.NotificationResponse | null,
      source: 'listener' | 'last_response',
    ) => {
      if (!response) {
        return;
      }

      try {
        const handled = await ReviewReminderService.handleNotificationResponse(response);
        if (!handled) {
          return;
        }

        Logger.info(LAYOUT_SCOPE, 'Handled reminder notification response.', { source });
        router.replace('/(tabs)' as never);
        await Notifications.clearLastNotificationResponseAsync();
        await ReviewReminderService.refreshReminderSchedule({ reason: 'notification_response' });
      } catch (error) {
        Logger.warn(LAYOUT_SCOPE, 'Failed handling reminder notification response.', {
          source,
          error,
        });
      }
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotificationResponse(response, 'listener');
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => handleNotificationResponse(response, 'last_response'))
      .catch((error) => {
        Logger.warn(LAYOUT_SCOPE, 'Failed to inspect last notification response.', { error });
      });

    return () => {
      subscription.remove();
    };
  }, [router]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MusicProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="mistake/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="mistake/[id]/image-edit" options={{ headerShown: false }} />
              <Stack.Screen name="mistake-related/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="mistake-related/add" options={{ headerShown: false }} />
              <Stack.Screen name="review/session" options={{ headerShown: false }} />
              <Stack.Screen name="review-sheet/scan" options={{ headerShown: false }} />
              <Stack.Screen name="review-sheet/[sheetId]" options={{ headerShown: false }} />
              <Stack.Screen name="pdf-preview" options={{ title: '今日练习卷' }} />
              <Stack.Screen name="about-support" options={{ headerShown: false }} />
              <Stack.Screen name="official-account" options={{ headerShown: false }} />
              <Stack.Screen name="image-combiner" options={{ headerShown: false }} />
              <Stack.Screen name="feedback" options={{ headerShown: false }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
            <StatusBar style="auto" />
          </ThemeProvider>
        </MusicProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
