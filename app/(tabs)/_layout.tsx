import { Tabs } from 'expo-router';
import React from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Alert } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getAddScreenHasUnsavedPhotos } from '@/src/services/LeaveGuardService';

type TabPressEvent = {
  preventDefault: () => void;
};

type TabNavigationState = {
  index: number;
  routes: { name: string }[];
};

type TabNavigation = {
  getState: () => TabNavigationState;
  navigate: (name: string) => void;
};

function createTabLeaveGuardListener(targetTabName: string) {
  return ({ navigation }: { navigation: unknown }) => ({
    tabPress: (event: TabPressEvent) => {
      const tabNavigation = navigation as TabNavigation;
      const state = tabNavigation.getState();
      const activeTabName = state.routes[state.index]?.name;
      const isLeavingAddTab = activeTabName === 'add' && targetTabName !== 'add';

      if (!isLeavingAddTab || !getAddScreenHasUnsavedPhotos()) {
        return;
      }

      event.preventDefault();
      Alert.alert('确认离开', '当前还有未保存的题目，确定离开吗？', [
        { text: '继续编辑', style: 'cancel' },
        {
          text: '放弃离开',
          style: 'destructive',
          onPress: () => {
            tabNavigation.navigate(targetTabName);
          },
        },
      ]);
    },
  });
}

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
        listeners={createTabLeaveGuardListener('index')}
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
        listeners={createTabLeaveGuardListener('library')}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color }) => <MaterialIcons size={24} name="settings" color={color} />,
        }}
        listeners={createTabLeaveGuardListener('settings')}
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
