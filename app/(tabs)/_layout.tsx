import { Tabs } from 'expo-router';
import React from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Alert, StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
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
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#34C759',
        tabBarInactiveTintColor: '#8E8E93',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: '600',
        },
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E5E5EA',
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
          shadowColor: '#000000',
          shadowOpacity: 0.025,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: -1 },
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
