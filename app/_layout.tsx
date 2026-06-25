import { Stack } from 'expo-router';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../src/firebaseConfig';
import { useNotifications } from '../src/hooks/useNotifications';

// useNotifications.ts owns the setNotificationHandler call on native;
// nothing to set up here on web.

function NotificationInit() {
  const [uid, setUid] = useState('');
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? ''));
    return unsub;
  }, []);
  useNotifications(uid);
  return null;
}

export default function Layout() {
  return (
    <ThemeProvider>
      <StatusBar style="auto" />
      <NotificationInit />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
