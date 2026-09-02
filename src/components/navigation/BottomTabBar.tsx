import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useEffect, useState, type ComponentProps } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, spacing } from '@/src/styles/tokens';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const TAB_META: Record<string, { label: string; active: IconName; inactive: IconName }> = {
  index: { label: '今日', active: 'calendar-check', inactive: 'calendar-check-outline' },
  add: { label: '新增', active: 'plus-circle', inactive: 'plus-circle-outline' },
  library: { label: '题库', active: 'book-open-page-variant', inactive: 'book-open-page-variant-outline' },
  settings: { label: '设置', active: 'cog', inactive: 'cog-outline' },
};

export function BottomTabBar({ state, navigation, descriptors }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const activeRoute = state.routes[state.index];
  const activeTabBarStyle = activeRoute
    ? StyleSheet.flatten(descriptors[activeRoute.key]?.options.tabBarStyle) as ViewStyle | undefined
    : undefined;

  if (keyboardVisible || activeTabBarStyle?.display === 'none') {
    return null;
  }

  const visibleRoutes = state.routes.filter((route) => TAB_META[route.name]);

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.container, { height: layout.bottomTabHeight + insets.bottom }]}>
      <View style={styles.items}>
        {visibleRoutes.map((route) => {
          const routeIndex = state.routes.findIndex((item) => item.key === route.key);
          const focused = state.index === routeIndex;
          const meta = TAB_META[route.name];
          const color = focused ? colors.accent : colors.textTertiary;

          return (
            <Pressable
              key={route.key}
              accessibilityLabel={meta.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              }}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
              <MaterialCommunityIcons
                color={color}
                name={focused ? meta.active : meta.inactive}
                size={layout.iconSize}
              />
              <Text numberOfLines={1} style={[styles.label, { color }]}>{meta.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  items: {
    height: layout.bottomTabHeight,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: spacing.xs,
  },
  item: {
    flex: 1,
    minWidth: layout.minimumTouchSize,
    minHeight: layout.minimumTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.55,
  },
});
