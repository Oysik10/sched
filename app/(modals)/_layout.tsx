import { Stack } from 'expo-router';

export default function ModalLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: 'transparentModal',   // nice dim overlay on iOS
        animation: 'fade',
        gestureEnabled: false,              // prevent swipe-to-dismiss
        contentStyle: { backgroundColor: 'transparent' },
      }}
    />
  );
}
