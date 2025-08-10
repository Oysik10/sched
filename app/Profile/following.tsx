import React from 'react';
import { View } from 'react-native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import FollowersTab from '../../components/FollowersTab';

const Tab = createMaterialTopTabNavigator();

export default function FollowTabsScreen() {
  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenOptions={{
          tabBarStyle: { backgroundColor: '#000' },
          tabBarLabelStyle: { color: '#fff', fontWeight: 'bold' },
          tabBarIndicatorStyle: { backgroundColor: '#4f8ef7' },
        }}
      >
        <Tab.Screen name="Friends" component={FollowersTab} />
      </Tab.Navigator>
    </View>
  );
}
