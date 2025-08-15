import { Stack } from 'expo-router';
import { ThemeProvider } from '../src/theme/ThemeProvider';// adjust path if needed
import { StatusBar } from 'expo-status-bar';
import React from 'react';
export default function Layout() {
  return (
    <ThemeProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}