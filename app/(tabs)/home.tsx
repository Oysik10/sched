// app/(tabs)/home.tsx
import React from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../../src/firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';

import EphemeralMatchTile from '../../components/EphemeralMatchTile';
import EphemeralAnswersBlock from '../../components/EphemeralAnswersBlock';

import { useDailyQuestions } from '../../src/hooks/useDailyQuestions';
import { useActiveEphemeralMatch } from '../../src/hooks/useActiveEphemeralMatch';
import { todayKeyUTC } from '../../src/utils/day';

function AdminButton() {
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [checking, setChecking] = React.useState(true);
  const router = useRouter();

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setIsAdmin(false); setChecking(false); return; }
      const token = await u.getIdTokenResult(true);
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

function msLeftFromExpiresAt(expiresAt: any | undefined | null) {
  if (!expiresAt) return 0;
  try {
    if (typeof expiresAt.toMillis === 'function') {
      return expiresAt.toMillis() - Date.now();
    }
    if (typeof expiresAt === 'number') {
      return expiresAt - Date.now();
    }
  } catch {}
  return 0;
}

export default function HomeScreen() {
  const { dayKey, questions } = useDailyQuestions(3);
  const { hasActiveMatch, partnerUid, expiresAt } = useActiveEphemeralMatch() as {
    hasActiveMatch: boolean;
    partnerUid?: string;
    expiresAt?: any | null; // Firestore Timestamp preferred
  };
  const router = useRouter();

  // Show Daily Guess ONLY after countdown reaches zero
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;

    // cleanup any prior timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // must have an active match and a valid expiresAt
    if (!hasActiveMatch || !expiresAt) return;

    const checkAndMaybeOpen = async () => {
      const dk = todayKeyUTC();
      try {
        const snap = await getDoc(doc(firestore, 'users', u.uid));
        const done = snap.exists() && (snap.data()?.dailyGuess?.completedOn === dk);
        if (!done) {
          router.push('/(modals)/daily-guess');
        }
      } catch {
        // ignore fetch errors; don't hard-block
      }
    };

    const left = msLeftFromExpiresAt(expiresAt);

    if (left <= 0) {
      // already expired → open now
      checkAndMaybeOpen();
    } else {
      // schedule for the exact expiry moment (+ small buffer)
      timerRef.current = setTimeout(checkAndMaybeOpen, left + 50);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [hasActiveMatch, expiresAt, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header */}
      <View>
        <AdminButton />
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        <EphemeralMatchTile />
        {hasActiveMatch && partnerUid ? (
          <EphemeralAnswersBlock partnerUid={partnerUid} questionSet={questions} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No active match yet.</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    marginHorizontal: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
    alignItems: 'center',
  },
  placeholderText: { color: '#777' },
});
