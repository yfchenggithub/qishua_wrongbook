import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  aboutSupportColors,
  aboutSupportLayout,
  aboutSupportTypography,
} from '@/src/styles/aboutSupportTokens';

export interface SupportPageHeaderProps {
  title: string;
  fallbackRoute: '/about-support' | '/(tabs)/settings';
}

export function SupportPageHeader({ title, fallbackRoute }: SupportPageHeaderProps) {
  const router = useRouter();

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(fallbackRoute as never);
  }, [fallbackRoute, router]);

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="返回"
        accessibilityRole="button"
        hitSlop={4}
        onPress={goBack}
        style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}>
        <MaterialIcons color={aboutSupportColors.text} name="arrow-back-ios-new" size={25} />
      </Pressable>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <View style={styles.rightPlaceholder} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: aboutSupportLayout.headerHeight,
    paddingHorizontal: aboutSupportLayout.horizontalPadding - 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: aboutSupportColors.page,
  },
  backButton: {
    width: aboutSupportLayout.touchSize,
    height: aboutSupportLayout.touchSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.45,
  },
  title: {
    ...aboutSupportTypography.navigationTitle,
    flex: 1,
    textAlign: 'center',
  },
  rightPlaceholder: {
    width: aboutSupportLayout.touchSize,
    height: aboutSupportLayout.touchSize,
  },
});
