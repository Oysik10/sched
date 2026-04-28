// app/(tabs)/home.tsx
import React from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../../src/firebaseConfig';
import {
  doc, getDoc, collection, query, orderBy, limit, onSnapshot
} from 'firebase/firestore';


import { useDailyQuestions } from '../../src/hooks/useDailyQuestions';
import { todayKeyUTC } from '../../src/utils/day';
import { MatchTopSection } from '../../src/components/MatchTopSection';

/* ---------------- Admin button (unchanged) ---------------- */
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

/* ---------------- Listen to latest pending match in user's inbox ---------------- */
type InboxItem = {
  matchId: string;
  participants: string[];
  createdAt?: any; // Firestore Timestamp
  status?: 'pending_questionnaire' | 'active' | 'expired' | string;
};

function useLatestPendingMatch() {
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState<InboxItem | null>(null);

  React.useEffect(() => {
    const u = auth.currentUser;
    if (!u) { setPending(null); setLoading(false); return; }

    const qy = query(
      collection(firestore, 'users', u.uid, 'inbox'),
      orderBy('createdAt', 'desc'),
      limit(5) // grab a few in case top one is not pending
    );

    const unsub = onSnapshot(qy, (snap) => {
      const items = snap.docs.map(d => ({ matchId: d.id, ...(d.data() as any) })) as InboxItem[];
      // find the newest pending questionnaire
      const found = items.find(it => it?.status === 'pending_questionnaire') || null;
      setPending(found);
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, []);

  return { loading, pending };
}

/* ---------------- Home screen ---------------- */
export default function HomeScreen() {
  const router = useRouter();
  const { dayKey, questions } = useDailyQuestions(3);

  const { loading, pending } = useLatestPendingMatch();

  // derive partner uid from participants
  const u = auth.currentUser;
  const partnerUid = React.useMemo(() => {
    if (!u || !pending?.participants?.length) return undefined;
    return pending.participants.find(p => p !== u.uid);
  }, [pending, u]);

  // Auto-open questionnaire when a pending match exists and today's not completed
  React.useEffect(() => {
    const openIfNeeded = async () => {
      const user = auth.currentUser;
      if (!user || !pending?.matchId) return;

      try {
        const snap = await getDoc(doc(firestore, 'users', user.uid));
        const dk = todayKeyUTC();
        const completedOn = snap.exists() ? snap.data()?.dailyGuess?.completedOn : undefined;

        if (completedOn !== dk) {
          // Pass matchId/partner if your modal expects them
          router.push({
            pathname: '/(modals)/daily-guess',
            params: { matchId: pending.matchId, partnerUid: partnerUid ?? '' }
          } as any);
        }
      } catch {
        // swallow fetch errors; avoid blocking the UI
      }
    };

    if (pending?.status === 'pending_questionnaire') {
      openIfNeeded();
    }
  }, [pending?.matchId, pending?.status, partnerUid, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <View>
        <AdminButton />
      </View>
      <MatchTopSection />
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
