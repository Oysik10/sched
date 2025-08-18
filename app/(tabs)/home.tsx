// app/(tabs)/home.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../src/firebaseConfig';
import EphemeralMatchChat from '../../components/EphemeralMatchChat';
import EphemeralMatchTile from '../../components/EphemeralMatchTile'; // adjust relative path as needed


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
      const token = await u.getIdTokenResult(true); // refresh to get latest claims
      setIsAdmin(!!token.claims?.admin);
      setChecking(false);
    });
    return unsub;
  }, []);

  if (checking || !isAdmin) return null;

  return (
    <TouchableOpacity
      onPress={() => router.push('/admin/reports')}
      style={{ padding: 10, backgroundColor: '#1f2937', borderRadius: 8 }}
    >
      <Text style={{ color: '#fff', fontWeight: '700' }}>Open Admin Reports</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header row */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, backgroundColor: '#000' }}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>🏠 Home</Text>
        <AdminButton />
      </View>

      {/* Ephemeral match/chat fills the rest */}
      <View style={{ flex: 1 }}>
        <EphemeralMatchTile />
      </View>
    </SafeAreaView>
  );
}
