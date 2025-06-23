import { Stack } from 'expo-router';
export default function Layout() {
  return (
    <Stack screenOptions={{ contentStyle: { flex: 1, backgroundColor: '#000' } }} />
  );
}