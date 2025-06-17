import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color, size }) => (
        <Ionicons name="home-outline" color={color} size={size} />
      )}} />
      <Tabs.Screen name="explore" options={{ title: 'Explore', tabBarIcon: ({ color, size }) => (
        <Ionicons name="compass-outline" color={color} size={size} />
      )}} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => (
        <Ionicons name="person-outline" color={color} size={size} />
      )}} />
    </Tabs>
  );
}
