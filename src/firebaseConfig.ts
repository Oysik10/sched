import { initializeApp } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, Persistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// getReactNativePersistence is absent from firebase/auth TS types but present in the RN bundle
const { getReactNativePersistence } = require('firebase/auth') as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

const firebaseConfig = {
  apiKey: "AIzaSyA5Ih6TQ6cVavLwG4DOMVBIpnSUOFIZPLE",
  authDomain: "better-cc0f9.firebaseapp.com",
  projectId: "better-cc0f9",
  storageBucket: "better-cc0f9.firebasestorage.app",
  messagingSenderId: "892513267453",
  appId: "1:892513267453:web:ee55a5b2c8b2afca7dd894",
  measurementId: "G-3HW9TWBQWQ"
};

const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: Platform.OS === 'web'
    ? browserLocalPersistence
    : getReactNativePersistence(AsyncStorage),
});
const firestore = getFirestore(app);
const functions = getFunctions(app, 'us-central1');
export { auth, app, firestore, functions };
export const db = getFirestore(app);