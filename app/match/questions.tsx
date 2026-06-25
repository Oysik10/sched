// app/match/questions.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, SafeAreaView, Alert, TextInput, ScrollView } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../../src/firebaseConfig';
import {
  doc, getDoc, setDoc, collection, getDocs, query, where, Timestamp
} from 'firebase/firestore';
import { router } from 'expo-router';

function todayKeyUTC() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`; // ✅ same “day” for everyone (UTC)
}
function msUntilNextUtcMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.getTime() - now.getTime();
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

const QUESTION_POOL: string[] = [
  "What's your hottest take on movies?",
  "If your job were a dish, what would it be and why?",
  "What's a famous dish from your culture?",
  "What's a lesser-known fact about your country?",
  "What's a stereotype about your culture?",
  "What's a stereotype about your job?",
  "Which popular movie do you think is mid, and why?",
  "What's a tradition you wish more people knew about?",
  "What holiday dish feels like home to you?",
  "What's a stereotype about your culture that's actually false?",
  "What word or phrase in your language do you say a lot, and what does it mean?",
  "What local superstition do you kind of believe?",
  "What law or custom where you live would outsiders find weird?",
  "What local scam should visitors watch for?",
  "What's your favorite rainy-day thing to do in your city?",
  "What's a slang term only locals use, and what does it mean?",
  "If your city were a smell, what would it be?",
  "What's your favorite book (right now)?",
  "Which movie do you wish you could see again for the first time, and why?",
  "Which city surprised you, and how?",
  "What souvenir do you actually use?",
  "What's one rule you live by?",
  "How would you define \"success\" in one sentence?",
  "What's a red flag you ignore every time?",
  "If your life were a genre, which would it be and why?",
  "What's a smell that instantly teleports you somewhere?",
  "What's the most \"you\" object on your desk, and why?",
  "If you could be born into a different religion than your current one, which would it be and why?",
  "Do you believe in a higher power? Why or why not (in one line)?",
  "Fate, free will, or a messy mix—what do you lean toward, and why?",
  "Do you think life has a purpose? Why or why not?",
  "What's a small ritual that centers you?",
  "What verse or quote stays with you?",
  "What's a belief you've outgrown, and what replaced it?",
  "What festival or holiday from your tradition would you share with everyone, and why?",
  "What one-sentence blessing would you give a friend?"
];


/** Deterministic PRNG (seeded) so the same seed → same 3 questions */
function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickNDeterministic<T>(arr: T[], n: number, seedStr: string): T[] {
  const seed = xmur3(seedStr)();
  const rand = mulberry32(seed);
  const idx = Array.from(arr.keys());
  // Fisher–Yates with seeded RNG
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(n, arr.length)).map((i) => arr[i]);
}

export default function MatchQuestionsScreen() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);

  const [loading, setLoading] = useState(true);
  const [meDone, setMeDone] = useState<boolean>(false);
  const [partnerDone, setPartnerDone] = useState<boolean | null>(null); // null = unknown/no match
  const [hasActiveMatch, setHasActiveMatch] = useState(false);
  const [partnerUid, setPartnerUid] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<Timestamp | null>(null);
  const [saving, setSaving] = useState(false);

  // Daily (UTC) key for “same everywhere” questions
  const [dayKey, setDayKey] = useState<string>(todayKeyUTC());

  // Selected 3 questions + answers
  const [questionSet, setQuestionSet] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  // Recompute dayKey at next UTC midnight (keeps the app fresh if left open)
  useEffect(() => {
    const ms = msUntilNextUtcMidnight();
    const id = setTimeout(() => setDayKey(todayKeyUTC()), ms + 1000);
    return () => clearTimeout(id);
  }, [dayKey]);

  const refreshStatus = useCallback(async () => {
    if (!uid) return;

    // Load me
    const uRef = doc(firestore, 'users', uid);
    const uSnap = await getDoc(uRef);
    const meCompleted = uSnap.exists() && (uSnap.data()?.ephemeralQA?.completedOn === dayKey);
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
      const pCompleted = pSnap.exists() && (pSnap.data()?.ephemeralQA?.completedOn === dayKey);
      setPartnerDone(!!pCompleted);
    } else {
      setPartnerDone(null);
    }
  }, [uid, dayKey]);

  // Compute the 3-question set (deterministic; same for everyone each UTC day)
  const computeQuestionSet = useCallback(() => {
    const seed = `day:${dayKey}`; // ✅ ONLY day in seed → same for all users
    const selected = pickNDeterministic(QUESTION_POOL, 3, seed);
    setQuestionSet(selected);
    setAnswers({}); // reset local answers when day flips
  }, [dayKey]);

  useEffect(() => {
    if (!uid) {
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

  useEffect(() => {
    computeQuestionSet();
  }, [computeQuestionSet]);

  const ensureThreadIfBothDone = useCallback(async () => {
    if (!uid || !partnerUid) return;
    const tid = threadIdFor(uid, partnerUid);
    await setDoc(doc(firestore, 'dms', tid), { participants: [uid, partnerUid].sort() }, { merge: true });
  }, [uid, partnerUid]);

  const allAnswered =
    questionSet.length > 0 &&
    questionSet.every((_, i) => (answers[i]?.trim().length ?? 0) > 0);

  const completeQuestions = async () => {
    if (!uid) return;
    if (!allAnswered) {
      Alert.alert('Almost there', 'Please answer all three questions.');
      return;
    }
    setSaving(true);
    try {
      const uRef = doc(firestore, 'users', uid);
      await setDoc(
        uRef,
        {
          ephemeralQA: {
            completedOn: dayKey,
            setKey: `day:${dayKey}`,
            answers: questionSet.map((_, i) => (answers[i] ?? '').trim()),
          },
        },
        { merge: true }
      );

      await refreshStatus();

      // If both are done and we have an active match → ensure thread and route to Inbox
      if (hasActiveMatch && partnerUid) {
        const [meNowSnap, pSnap] = await Promise.all([
          getDoc(uRef),
          getDoc(doc(firestore, 'users', partnerUid)),
        ]);
        const meNowDone = meNowSnap.exists() && (meNowSnap.data()?.ephemeralQA?.completedOn === dayKey);
        const partnerNowDone = pSnap.exists() && (pSnap.data()?.ephemeralQA?.completedOn === dayKey);

        if (meNowDone && partnerNowDone) {
          try { await ensureThreadIfBothDone(); } catch {}
          router.replace('/(tabs)/chat');
          return;
        } else {
          Alert.alert("All set on your side", "We’ll show the chat in your Inbox once your partner finishes.");
        }
      } else {
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
          { text: "Answer now", onPress: () => {} }
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
      <Text style={styles.sub}>Both participants must complete them to access the chat.</Text>

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

      {/* Tile */}
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
            <Text style={styles.tileSub}>Answer today’s three quick questions below</Text>
          )}
        </View>
        <View style={styles.ctaPill}>
          <Text style={styles.ctaText}>
            {saving ? '…' : meDone ? (hasActiveMatch ? (partnerDone ? 'Open Inbox' : 'Waiting') : 'Inbox') : 'Start'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Questionnaire (3 per UTC day) */}
      {!meDone && (
        <ScrollView style={{ marginTop: 16 }} contentContainerStyle={{ paddingBottom: 24 }}>
          {questionSet.map((q, i) => (
            <View key={i} style={styles.qBlock}>
              <Text style={styles.qText}>{i + 1}. {q}</Text>
              <TextInput
                style={styles.qInput}
                value={answers[i] ?? ''}
                onChangeText={(t) =>
                  setAnswers((prev) => ({ ...prev, [i]: t }))
                }
                placeholder="Type your answer…"
                placeholderTextColor="#999"
                multiline
              />
            </View>
          ))}

          <TouchableOpacity style={[styles.primary, { marginTop: 8 }]} onPress={completeQuestions} disabled={saving}>
            <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Submit answers'}</Text>
          </TouchableOpacity>
        </ScrollView>
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

  qBlock: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  qText: { fontSize: 15, fontWeight: '600', color: '#111', marginBottom: 8 },
  qInput: {
    minHeight: 60,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    textAlignVertical: 'top',
    color: '#111',
    backgroundColor: '#fafafa',
  },
});
