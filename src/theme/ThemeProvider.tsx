// src/theme/ThemeProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Mode = 'light' | 'dark' | 'system';

type Colors = {
  bg: string;
  card: string;
  border: string;
  text: string;
  textDim: string;
  primary: string;
  danger: string;
};

const light: Colors = {
  bg: '#ffffff',
  card: '#f7f7f7',
  border: '#e5e7eb',
  text: '#0f172a',
  textDim: '#64748b',
  primary: '#2563eb',
  danger: '#b91c1c',
};

const dark: Colors = {
  bg: '#000000',
  card: '#0b0b0b',
  border: '#222222',
  text: '#ffffff',
  textDim: '#9aa7b1',
  primary: '#2563eb',
  danger: '#7f1d1d',
};

type ThemeContextShape = {
  mode: Mode;                  // your chosen mode
  system: ColorSchemeName;     // current system scheme
  isDark: boolean;             // resolved darkness (mode === 'dark' or system === 'dark')
  colors: Colors;              // resolved palette
  setMode: (m: Mode) => void;  // change persisted mode
};

const ThemeContext = createContext<ThemeContextShape | null>(null);

const KEY = 'pref:themeMode'; // 'light' | 'dark' | 'system'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>('system');
  const [system, setSystem] = useState<ColorSchemeName>(Appearance.getColorScheme());

  // Keep in sync with OS changes
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystem(colorScheme));
    return () => sub.remove();
  }, []);

  // Load persisted mode
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setModeState(saved);
      }
    })();
  }, []);

  const setMode = async (m: Mode) => {
    setModeState(m);
    await AsyncStorage.setItem(KEY, m);
  };

  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const colors = isDark ? dark : light;

  const value = useMemo(() => ({ mode, system, isDark, colors, setMode }), [mode, system, isDark, colors]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
