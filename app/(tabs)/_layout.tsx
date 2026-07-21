import { Tabs } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';

import { BottomTabBar } from '@/src/components';
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
      tabBar={(props) => <BottomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '今日',
        }}
        listeners={createTabLeaveGuardListener('index')}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '新增',
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: '题库',
        }}
        listeners={createTabLeaveGuardListener('library')}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
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
