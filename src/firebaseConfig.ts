import { initializeApp } from 'firebase/app';
import {
 initializeAuth,
 getReactNativePersistence,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
 persistence: getReactNativePersistence(AsyncStorage),
});
export { auth, app };
