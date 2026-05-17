import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { initDatabase } from '@/src/db';
import { Logger } from '@/src/services/Logger';
import * as ReviewReminderService from '@/src/services/ReviewReminderService';

export const unstable_settings = {
  anchor: '(tabs)',
};

const LAYOUT_SCOPE = 'RootLayout';
let appDatabaseInitPromise: Promise<void> | null = null;
let hasConfiguredNotificationHandler = false;

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

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();

  useEffect(() => {
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
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="mistake/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="mistake/[id]/image-edit" options={{ headerShown: false }} />
          <Stack.Screen name="review/session" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
