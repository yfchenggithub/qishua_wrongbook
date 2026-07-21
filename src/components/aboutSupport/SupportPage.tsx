import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SupportPageHeader } from '@/src/components/aboutSupport/SupportPageHeader';
import { aboutSupportColors, aboutSupportLayout } from '@/src/styles/aboutSupportTokens';

export interface SupportPageProps {
  title: string;
  fallbackRoute: '/about-support' | '/(tabs)/settings';
  children: ReactNode;
  overlay?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  keyboardAware?: boolean;
}

export function SupportPage({
  title,
  fallbackRoute,
  children,
  overlay,
  contentStyle,
  keyboardAware = false,
}: SupportPageProps) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" />
      <SupportPageHeader fallbackRoute={fallbackRoute} title={title} />
      <KeyboardAvoidingView
        behavior={keyboardAware ? (Platform.OS === 'ios' ? 'padding' : 'height') : undefined}
        enabled={keyboardAware}
        style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
      {overlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: aboutSupportColors.page,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: aboutSupportLayout.horizontalPadding,
    paddingTop: 20,
    paddingBottom: 24,
    backgroundColor: aboutSupportColors.page,
  },
});
