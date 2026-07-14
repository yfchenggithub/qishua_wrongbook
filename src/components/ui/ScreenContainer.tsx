import type { ReactNode, Ref } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, spacing } from '@/src/styles/tokens';

export interface ScreenContainerProps {
  children: ReactNode;
  scroll?: boolean;
  withPadding?: boolean;
  safeAreaEdges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  showsVerticalScrollIndicator?: boolean;
  onScroll?: ScrollViewProps['onScroll'];
  onContentSizeChange?: ScrollViewProps['onContentSizeChange'];
  onScrollBeginDrag?: ScrollViewProps['onScrollBeginDrag'];
  onScrollEndDrag?: ScrollViewProps['onScrollEndDrag'];
  onTouchStart?: ScrollViewProps['onTouchStart'];
  onTouchMove?: ScrollViewProps['onTouchMove'];
  onTouchEnd?: ScrollViewProps['onTouchEnd'];
  scrollRef?: Ref<ScrollView>;
  scrollEventThrottle?: number;
}

export function ScreenContainer({
  children,
  scroll = false,
  withPadding = true,
  safeAreaEdges = ['top', 'bottom'],
  style,
  contentStyle,
  showsVerticalScrollIndicator = false,
  onScroll,
  onContentSizeChange,
  onScrollBeginDrag,
  onScrollEndDrag,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  scrollRef,
  scrollEventThrottle = 16,
}: ScreenContainerProps) {
  return (
    <SafeAreaView edges={safeAreaEdges} style={[styles.safeArea, style]}>
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.contentBase, withPadding && styles.padded, contentStyle]}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
          onScroll={onScroll}
          onContentSizeChange={onContentSizeChange}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          scrollEventThrottle={scrollEventThrottle}>
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
