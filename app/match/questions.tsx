// app/match/questions.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { auth, firestore } from '../../src/firebaseConfig';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { router } from 'expo-router';

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function MatchQuestionsScreen() {
  const uid = auth.currentUser?.uid ?? null;
  const [loading, setLoading] = useState(true);
  const [needsQuestions, setNeedsQuestions] = useState(false);

  useEffect(() => {
    if (!uid) {
      router.push('../login');
      return;
    }

    (async () => {
      try {
        const uRef = doc(firestore, 'users', uid);
        const snap = await getDoc(uRef);
        const completedOn = snap.exists() ? snap.data()?.ephemeralQA?.completedOn as string | undefined : undefined;

        if (completedOn === todayKey()) {
          router.replace('../match/chat');
        } else {
          setNeedsQuestions(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [uid]);

  const completeQuestions = async () => {
    if (!uid) return;
    try {
      const uRef = doc(firestore, 'users', uid);
      await setDoc(uRef, {
        ephemeralQA: {
          completedOn: todayKey(),
        }
      }, { merge: true });
      router.replace('../match/chat');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save your answers.');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.sub}>Loading…</Text>
      </SafeAreaView>
    );
  }

  if (!needsQuestions) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.sub}>Redirecting…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={styles.title}>Quick questions</Text>
      <Text style={styles.sub}>Add your actual questions UI here. For now, tap Start & Complete.</Text>

      {/* Replace this block with your real questionnaire */}
      <View style={{ marginTop: 16, gap: 10 }}>
        <TouchableOpacity style={styles.primary} onPress={completeQuestions}>
          <Text style={styles.primaryText}>Start & Complete (stub)</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' },
  sub: { fontSize: 14, color: '#666', marginTop: 8 },
  primary: { backgroundColor: '#111', padding: 12, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
});
