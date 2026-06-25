import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const webStorage = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  },
};

export const storage = Platform.OS === 'web' ? webStorage : AsyncStorage;
