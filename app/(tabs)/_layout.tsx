import { Tabs } from 'expo-router';
import React from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        tabBarInactiveTintColor: '#8f8f8f',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: '600',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '今日',
          tabBarIcon: ({ color }) => <MaterialIcons size={24} name="today" color={color} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '新增',
          tabBarIcon: ({ color }) => (
            <MaterialIcons size={24} name="add-circle-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: '题库',
          tabBarIcon: ({ color }) => <MaterialIcons size={24} name="library-books" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
