// components/EphemeralMatchTile.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { auth, firestore } from '../src/firebaseConfig';
import {
  collection, getDocs, query, where, Timestamp, doc, getDoc, setDoc
} from 'firebase/firestore';

type MatchDoc = {
  participants: string[];
  createdAt: any;
  expiresAt: Timestamp;
  aliases: Record<string, string>;
  active: boolean;
};

function msLeft(expiresAt?: Timestamp | null) {
  if (!expiresAt) return 0;
  return expiresAt.toMillis() - Date.now();
}

function formatCountdown(ms: number) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

async function bothCompletedToday(uidA: string, uidB: string, dayKey: string) {
  const [aSnap, bSnap] = await Promise.all([
    getDoc(doc(firestore, 'users', uidA)),
    getDoc(doc(firestore, 'users', uidB)),
  ]);
  const aDone = aSnap.exists() && (aSnap.data()?.ephemeralQA?.completedOn === dayKey);
  const bDone = bSnap.exists() && (bSnap.data()?.ephemeralQA?.completedOn === dayKey);
  return [aDone, bDone] as const;
}


function todayKeyUTC() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}


export default function EphemeralMatchTile() {
  const uid = auth.currentUser?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [hasActiveMatch, setHasActiveMatch] = useState(false);
  const [partnerUid, setPartnerUid] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<Timestamp | null>(null);

  const [alreadyAnswered, setAlreadyAnswered] = useState(false);
  const [tick, setTick] = useState(0); // drives countdown updates

  // Poll 1s for countdown
  useEffect(() => {
    if (!expiresAt) return;
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, [expiresAt]);

  const countdown = useMemo(() => {
    if (!expiresAt) return '';
    const left = msLeft(expiresAt);
    return formatCountdown(left);
  }, [expiresAt, tick]);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        // --- Active match (+ partner + expiry) ---
        const mCol = collection(firestore, 'matches');
        const mQ = query(mCol, where('participants', 'array-contains', uid), where('active', '==', true));
        const mSnap = await getDocs(mQ);

        // pick the most recent active unexpired match (if multiple)
        let bestDoc: MatchDoc | null = null;
        let bestCreated = -1;
        let bestPartner = '';

        for (const d of mSnap.docs) {
          const data = d.data() as MatchDoc;
          if (data.active !== true || msLeft(data.expiresAt) <= 0) continue;
          const created = (data.createdAt?.seconds ?? 0) as number;
          if (created >= bestCreated) {
            bestCreated = created;
            bestDoc = data;
            bestPartner = (data.participants || []).find((p) => p !== uid) || '';
          }
        }

        if (bestDoc) {
          setHasActiveMatch(true);
          setPartnerUid(bestPartner);
          setExpiresAt(bestDoc.expiresAt);
        } else {
          setHasActiveMatch(false);
          setPartnerUid('');
          setExpiresAt(null);
        }

        // --- Did user finish questions "today"? ---
      const todayKey = todayKeyUTC();

      try {
        const uRef = doc(firestore, 'users', uid);
        const uSnap = await getDoc(uRef);
        const completedOn = uSnap.exists()
          ? (uSnap.data()?.ephemeralQA?.completedOn as string | undefined)
          : undefined;
        setAlreadyAnswered(completedOn === todayKey);
      } catch {
        setAlreadyAnswered(false);
      }
      } finally {
        setLoading(false);
      }
    })();
  }, [uid]);

  const go = async () => {
    if (!uid) {
      router.push('../src/index'); // adjust to your auth screen if needed
      return;
    }

    const dayKey = todayKeyUTC();

    // If we have an active match + partner, only proceed if BOTH finished today's questions
    if (hasActiveMatch && partnerUid) {
      const [meDone, partnerDone] = await bothCompletedToday(uid, partnerUid, dayKey);

      if (!meDone) {
        router.push('../match/questions');
        return;
      }
      if (!partnerDone) {
        // Optional: show a toast/alert instead of silent no-op
        // Alert.alert("Almost there", "Your partner hasn’t finished today’s questions yet.");
        return;
      }

      // Both done → ensure thread exists, then go to Inbox (not DM directly)
      try {
        const tid = threadIdFor(uid, partnerUid);
        await setDoc(doc(firestore, 'dms', tid), { participants: [uid, partnerUid].sort() }, { merge: true });
      } catch {}
      router.push('/(tabs)/chat');
      return;
    }

    // No active match: follow the gate (questions → inbox)
    if (alreadyAnswered) {
      router.push('/(tabs)/chat');
    } else {
      router.push('../match/questions');
    }
  };


  // If match expired while on screen, clear the flag
  useEffect(() => {
    if (!expiresAt) return;
    if (msLeft(expiresAt) <= 0 && hasActiveMatch) {
      setHasActiveMatch(false);
      setPartnerUid('');
      setExpiresAt(null);
    }
  }, [tick, expiresAt, hasActiveMatch]);

  return (
    <TouchableOpacity style={styles.tile} onPress={go} disabled={loading}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Anonymous Match</Text>

        {loading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator />
            <Text style={styles.sub}>Checking status…</Text>
          </View>
        ) : hasActiveMatch ? (
          <>
            <Text style={styles.sub}>Tap to open your chat</Text>
            <Text style={[styles.sub, styles.countdown]}>
              Time left: <Text style={styles.countNum}>{countdown}</Text>
            </Text>
          </>
        ) : alreadyAnswered ? (
          <Text style={styles.sub}>Questions done — tap to start chatting</Text>
        ) : (
          <Text style={styles.sub}>Tap to answer quick questions & start</Text>
        )}
      </View>

      <View style={styles.ctaPill}>
        <Text style={styles.ctaText}>
          {loading ? '…' : hasActiveMatch ? 'Open' : 'Start'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
    marginHorizontal: 12,
    marginTop: 12,
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#111' },
  sub: { fontSize: 13, color: '#666', marginTop: 2 },
  countdown: { marginTop: 4 },
  countNum: { fontWeight: '800', color: '#111' },
  ctaPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#111',
  },
  ctaText: { color: 'white', fontWeight: '700' },
});
