import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { initDatabase } from '@/src/db';
import { Logger } from '@/src/services/Logger';

export const unstable_settings = {
  anchor: '(tabs)',
};

const LAYOUT_SCOPE = 'RootLayout';
let appDatabaseInitPromise: Promise<void> | null = null;

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

  useEffect(() => {
    initializeDatabaseOnce().catch(() => {
      // Initialization error is already logged by Logger.error.
    });
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="mistake/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="mistake/[id]/image-edit" options={{ headerShown: false }} />
          <Stack.Screen name="review/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
