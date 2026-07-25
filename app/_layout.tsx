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
import {
  runRuntimeDailyWork,
  type RuntimeDailyWorkTrigger,
} from '@/src/services/RuntimeDailyWorkService';
import { getRuntimeLogContextWithDiagnostics } from '@/src/services/RuntimeContextService';
import { registerAutomaticBackupBackgroundTask } from '@/src/services/backup/AutomaticBackupBackgroundTaskService';
import { registerTodayWorksheetBackgroundTask } from '@/src/services/TodayWorksheetBackgroundTaskService';

export const unstable_settings = {
  anchor: '(tabs)',
};

const LAYOUT_SCOPE = 'RootLayout';
const MINIMUM_DAY_CHANGE_DELAY_MS = 1_000;
let appDatabaseInitPromise: Promise<void> | null = null;
let hasConfiguredNotificationHandler = false;
let hasLoggedRuntimeContext = false;

async function logRuntimeContextOnce(): Promise<void> {
  if (hasLoggedRuntimeContext) {
    return;
  }

  hasLoggedRuntimeContext = true;
  Logger.info(
    'RuntimeContext',
    'Runtime context initialized.',
    await getRuntimeLogContextWithDiagnostics(),
  );
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

function millisecondsUntilNextLocalDay(now = new Date()): number {
  const nextLocalDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(MINIMUM_DAY_CHANGE_DELAY_MS, nextLocalDay.getTime() - now.getTime());
}

function startRuntimeDailyWork(trigger: RuntimeDailyWorkTrigger): void {
  void runRuntimeDailyWork(trigger).catch((error) => {
    Logger.error(LAYOUT_SCOPE, 'App runtime daily work could not start or settle.', {
      trigger,
      error,
    });
  });
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();

  useEffect(() => {
    void logRuntimeContextOnce();
    configureNotificationHandlerOnce();
    startRuntimeDailyWork('app_start');

    let dayChangeTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNextLocalDay = () => {
      if (dayChangeTimer) {
        clearTimeout(dayChangeTimer);
      }
      dayChangeTimer = setTimeout(() => {
        startRuntimeDailyWork('local_day_change');
        scheduleNextLocalDay();
      }, millisecondsUntilNextLocalDay());
    };
    scheduleNextLocalDay();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        startRuntimeDailyWork('app_foreground');
        scheduleNextLocalDay();
      } else if (nextState === 'background') {
        startRuntimeDailyWork('app_background');
      }
    });

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

    return () => {
      appStateSubscription.remove();
      if (dayChangeTimer) {
        clearTimeout(dayChangeTimer);
      }
    };
  }, []);

  useEffect(() => {
    void registerTodayWorksheetBackgroundTask().catch((error) => {
      Logger.warn(LAYOUT_SCOPE, 'Today worksheet background task registration failed.', { error });
    });
    void registerAutomaticBackupBackgroundTask().catch((error) => {
      Logger.warn(LAYOUT_SCOPE, 'Automatic backup background task registration failed.', { error });
    });
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
