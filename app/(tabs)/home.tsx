// app/(tabs)/home.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../src/firebaseConfig';

function AdminButton() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setIsAdmin(false);
        setChecking(false);
        return;
      }
      // refresh token so custom claims are included
      const token = await u.getIdTokenResult(true);
      setIsAdmin(!!token.claims?.admin);
      setChecking(false);
    });
    return unsub;
  }, []);

  if (checking || !isAdmin) return null;

  return (
    <TouchableOpacity
      onPress={() => router.push('/admin/reports')} // use absolute path in Expo Router
      style={{ padding: 10, backgroundColor: '#1f2937', borderRadius: 8, marginTop: 12 }}
    >
      <Text style={{ color: '#fff', fontWeight: '700' }}>Open Admin Reports</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
      <Text style={{ color: '#fff', marginBottom: 8 }}>🏠 Home Tab</Text>
      {/* 👇 actually render the button */}
      <AdminButton />
    </View>
  );
}
