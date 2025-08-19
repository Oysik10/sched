// app/match/questions.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { auth, firestore } from '../../src/firebaseConfig';
import {
  doc, getDoc, setDoc, collection, getDocs, query, where, Timestamp
} from 'firebase/firestore';
import { router } from 'expo-router';

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

type MatchDoc = {
  participants: string[];
  createdAt: any;
  expiresAt: Timestamp;
  active: boolean;
};

function msLeft(expiresAt?: Timestamp | null) {
  if (!expiresAt) return 0;
  return expiresAt.toMillis() - Date.now();
}

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

export default function MatchQuestionsScreen() {
  const uid = auth.currentUser?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [meDone, setMeDone] = useState<boolean>(false);
  const [partnerDone, setPartnerDone] = useState<boolean | null>(null); // null = unknown/no match
  const [hasActiveMatch, setHasActiveMatch] = useState(false);
  const [partnerUid, setPartnerUid] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<Timestamp | null>(null);
  const [saving, setSaving] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!uid) return;

    // Load me
    const uRef = doc(firestore, 'users', uid);
    const uSnap = await getDoc(uRef);
    const meCompleted = uSnap.exists() && (uSnap.data()?.ephemeralQA?.completedOn === todayKey());
    setMeDone(!!meCompleted);

    // Load active, unexpired match
    const mCol = collection(firestore, 'matches');
    const mQ = query(mCol, where('participants', 'array-contains', uid), where('active', '==', true));
    const mSnap = await getDocs(mQ);

    let pUid = '';
    let exp: Timestamp | null = null;
    let foundActive = false;

    for (const d of mSnap.docs) {
      const data = d.data() as MatchDoc;
      if (data.active !== true || msLeft(data.expiresAt) <= 0) continue;
      pUid = (data.participants || []).find((p) => p !== uid) || '';
      exp = data.expiresAt;
      foundActive = true;
      break;
    }

    setHasActiveMatch(foundActive);
    setPartnerUid(pUid || '');
    setExpiresAt(exp || null);

    if (foundActive && pUid) {
      const pRef = doc(firestore, 'users', pUid);
      const pSnap = await getDoc(pRef);
      const pCompleted = pSnap.exists() && (pSnap.data()?.ephemeralQA?.completedOn === todayKey());
      setPartnerDone(!!pCompleted);
    } else {
      setPartnerDone(null);
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      // Not signed in → send to your sign-in/home screen
      router.push('../src/index');
      return;
    }
    (async () => {
      setLoading(true);
      try {
        await refreshStatus();
      } finally {
        setLoading(false);
      }
    })();
  }, [uid, refreshStatus]);

  const ensureThreadIfBothDone = useCallback(async () => {
    if (!uid || !partnerUid) return;
    const tid = threadIdFor(uid, partnerUid);
    await setDoc(doc(firestore, 'dms', tid), { participants: [uid, partnerUid].sort() }, { merge: true });
  }, [uid, partnerUid]);

  const completeQuestions = async () => {
    if (!uid) return;
    setSaving(true);
    try {
      // Mark me as completed today
      const uRef = doc(firestore, 'users', uid);
      await setDoc(
        uRef,
        { ephemeralQA: { completedOn: todayKey() } },
        { merge: true }
      );

      await refreshStatus();

      // If we now have both done and an active match, create thread and go to Inbox
      if (hasActiveMatch && partnerUid) {
        const uNowSnap = await getDoc(uRef);
        const meNowDone = uNowSnap.exists() && (uNowSnap.data()?.ephemeralQA?.completedOn === todayKey());

        let partnerNowDone = false;
        if (partnerUid) {
          const pRef = doc(firestore, 'users', partnerUid);
          const pSnap = await getDoc(pRef);
          partnerNowDone = pSnap.exists() && (pSnap.data()?.ephemeralQA?.completedOn === todayKey());
        }

        if (meNowDone && partnerNowDone) {
          try { await ensureThreadIfBothDone(); } catch {}
          router.replace('/(tabs)/chat');
          return;
        } else {
          Alert.alert("All set on your side", "We’ll show the chat in your Inbox once your partner finishes.");
        }
      } else {
        // No active match yet; just let them know we're done for today.
        Alert.alert("You're done for today", "We’ll notify you if you get a match. You can check your Inbox anytime.");
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save your answers.');
    } finally {
      setSaving(false);
    }
  };

  const onPressTile = async () => {
    if (!uid) {
      router.push('../src/index');
      return;
    }

    // If user hasn't completed today → prompt to complete
    if (!meDone) {
      Alert.alert(
        "Answer today’s quick questions",
        "You need to finish today’s questions to access the anonymous chat.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Answer now", onPress: completeQuestions }
        ]
      );
      return;
    }

    // Me done, check partner + match
    if (hasActiveMatch && partnerUid) {
      if (partnerDone) {
        try { await ensureThreadIfBothDone(); } catch {}
        router.push('/(tabs)/chat'); // Go to Inbox; chat will be visible
      } else {
        Alert.alert("Almost there", "Your partner hasn’t finished today’s questions yet.");
      }
      return;
    }

    // Me done but no active match
    Alert.alert("No active match yet", "We’ll notify you when you’re matched. You can check your Inbox anytime.");
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.sub}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const statusBadge = (ok?: boolean | null) => {
    if (ok === null) return <Text style={[styles.badge, styles.badgeDim]}>No match</Text>;
    return ok ? <Text style={[styles.badge, styles.badgeOk]}>Done</Text>
              : <Text style={[styles.badge, styles.badgeWarn]}>Not done</Text>;
  };

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={styles.title}>Anonymous Match</Text>
      <Text style={styles.sub}>Both participants must complete today’s quick questions to access the chat.</Text>

      {/* Status panel */}
      <View style={styles.panel}>
        <View style={styles.row}>
          <Text style={styles.label}>You</Text>
          {statusBadge(meDone)}
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Partner</Text>
          {statusBadge(hasActiveMatch ? partnerDone : null)}
        </View>
        {hasActiveMatch && expiresAt ? (
          <Text style={styles.expireNote}>
            Match active • Expires at: {new Date(expiresAt.toMillis()).toLocaleTimeString()}
          </Text>
        ) : (
          <Text style={styles.expireNote}>No active match right now</Text>
        )}
      </View>

      {/* Tile (acts like the home tile) */}
      <TouchableOpacity style={styles.tile} onPress={onPressTile} disabled={saving}>
        <View style={{ flex: 1 }}>
          <Text style={styles.tileTitle}>Anonymous Match</Text>
          {meDone ? (
            hasActiveMatch ? (
              partnerDone ? (
                <Text style={styles.tileSub}>Both finished — tap to view in Inbox</Text>
              ) : (
                <Text style={styles.tileSub}>Waiting for your partner to finish…</Text>
              )
            ) : (
              <Text style={styles.tileSub}>Done for today — we’ll notify you when matched</Text>
            )
          ) : (
            <Text style={styles.tileSub}>Tap to answer quick questions & start</Text>
          )}
        </View>
        <View style={styles.ctaPill}>
          <Text style={styles.ctaText}>
            {saving ? '…' : meDone ? (hasActiveMatch ? (partnerDone ? 'Open Inbox' : 'Waiting') : 'Inbox') : 'Start'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Temporary questionnaire stub */}
      {!meDone && (
        <View style={{ marginTop: 16 }}>
          <TouchableOpacity style={styles.primary} onPress={completeQuestions} disabled={saving}>
            <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Start & Complete (stub)'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 14, color: '#666', marginTop: 8 },

  panel: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  label: { fontSize: 15, fontWeight: '600', color: '#111' },
  expireNote: { marginTop: 8, fontSize: 12, color: '#666' },

  badge: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden', fontWeight: '700' },
  badgeOk: { backgroundColor: '#e6ffed', color: '#0a7f2e' },
  badgeWarn: { backgroundColor: '#fff5f5', color: '#a61b1b' },
  badgeDim: { backgroundColor: '#f2f2f2', color: '#666' },

  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
    marginTop: 16,
    gap: 10,
  },
  tileTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  tileSub: { fontSize: 13, color: '#666', marginTop: 2 },

  ctaPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#111' },
  ctaText: { color: 'white', fontWeight: '700' },

  primary: { backgroundColor: '#111', padding: 12, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
});
