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

import { colors, layout, spacing } from '@/src/styles/tokens';

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
  hasBottomTab?: boolean;
}

export function PageShell({
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
  hasBottomTab = false,
}: ScreenContainerProps) {
  return (
    <SafeAreaView edges={safeAreaEdges} style={[styles.safeArea, style]}>
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[
            styles.contentBase,
            withPadding && styles.padded,
            withPadding && hasBottomTab && styles.withBottomTab,
            contentStyle,
          ]}
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
        <View
          style={[
            styles.flex,
            styles.contentBase,
            withPadding && styles.padded,
            withPadding && hasBottomTab && styles.withBottomTab,
            contentStyle,
          ]}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

/** @deprecated Prefer PageShell for new page-level layouts. */
export const ScreenContainer = PageShell;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.pageBackground,
  },
  flex: {
    flex: 1,
  },
  contentBase: {
    backgroundColor: colors.pageBackground,
  },
  padded: {
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.xl,
  },
  withBottomTab: {
    paddingBottom: layout.bottomTabHeight + spacing.xxl,
  },
});
