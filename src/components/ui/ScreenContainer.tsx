import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/src/styles/tokens';

export interface ScreenContainerProps {
  children: ReactNode;
  scroll?: boolean;
  withPadding?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  showsVerticalScrollIndicator?: boolean;
}

export function ScreenContainer({
  children,
  scroll = false,
  withPadding = true,
  style,
  contentStyle,
  showsVerticalScrollIndicator = false,
}: ScreenContainerProps) {
  return (
    <SafeAreaView style={[styles.safeArea, style]}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.contentBase, withPadding && styles.padded, contentStyle]}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.contentBase, withPadding && styles.padded, contentStyle]}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  contentBase: {
    backgroundColor: colors.background,
  },
  padded: {
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.xl,
  },
});

