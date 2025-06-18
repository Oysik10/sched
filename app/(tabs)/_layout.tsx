import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color, size }) => (
        <Ionicons name="home-outline" color={color} size={size} />
      )}} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: ({ color, size }) => (
        <Ionicons name="search-outline" color={color} size={size} />
      )}} />
      <Tabs.Screen name="add" options={{ title: 'Add', tabBarIcon: ({ color, size }) => (
        <Ionicons name="add-outline" color={color} size={size} />
      )}} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: ({ color, size }) => (
        <Ionicons name="chatbubble-outline" color={color} size={size} />
      )}} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => (
        <Ionicons name="person-outline" color={color} size={size} />
      )}} />
    </Tabs>
  );
}
