// app/admin/reports.tsx
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, FlatList, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { auth, firestore } from '../../src/firebaseConfig'; // 👈 adjust to your path if needed
import {
  collection, doc, onSnapshot, orderBy, query, where, updateDoc, deleteDoc, setDoc
} from 'firebase/firestore';

type ReportStatus = 'open' | 'review_pending' | 'actioned' | 'dismissed' | 'reviewed';

type Report = {
  id: string;
  type: 'dm_message';
  threadId: string;
  messageId: string;
  offenderId: string;
  reporterId: string;
  text?: string;
  createdAtMs: number;
  status: ReportStatus;
};

type MatchState = {
  isActive: boolean;
  startedAt?: any;       // ISO string OR Firestore Timestamp
  endsAt?: any;          // ISO string OR Firestore Timestamp
  windowMinutes?: number;
};

const MATCH_DOC_PATH = ['global', 'matchState'] as const;

export default function AdminReportsScreen() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Global Match state ---
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [toggling, setToggling] = useState(false);
  const [remaining, setRemaining] = useState<string | null>(null);

  // Helpers to coerce Firestore Timestamp or ISO string to Date
  function toDate(val?: any): Date | null {
    if (!val) return null;
    // Firestore Timestamp has toDate()
    // @ts-ignore
    if (val?.toDate) return val.toDate();
    const d = new Date(val);
    return isNaN(d as any) ? null : d;
  }

  // 1) Gate: only allow admins to view this screen
  useEffect(() => {
    const run = async () => {
      const user = auth.currentUser;
      if (!user) {
        router.replace('/'); // not signed in
        return;
      }
      const token = await user.getIdTokenResult(true);
      if (!token.claims?.admin) {
        router.replace('/'); // signed in but not admin
        return;
      }
      setIsAdmin(true);
      setChecking(false);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Subscribe to reports once we know the user is admin
  useEffect(() => {
    if (!isAdmin) return;
    const qy = query(
      collection(firestore, 'reports'),
      where('status', 'in', ['open', 'review_pending']),
      orderBy('createdAtMs', 'desc')
    );
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Report, 'id'>) })) as Report[];
        setReports(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [isAdmin]);

  // 3) Subscribe to global match state
  useEffect(() => {
    if (!isAdmin) return;
    const ref = doc(firestore, ...MATCH_DOC_PATH);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setMatchState(snap.data() as MatchState);
      } else {
        setMatchState({ isActive: false });
      }
    });
    return unsub;
  }, [isAdmin]);

  // 4) Live countdown while global match is active
  useEffect(() => {
    if (!matchState?.isActive) {
      setRemaining(null);
      return;
    }
    const ends = toDate(matchState.endsAt);
    if (!ends) {
      setRemaining(null);
      return;
    }
    const id = setInterval(() => {
      const ms = ends.getTime() - Date.now();
      if (ms <= 0) {
        setRemaining('0:00');
        clearInterval(id);
        return;
      }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${m}:${s.toString().padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(id);
  }, [matchState?.isActive, matchState?.endsAt]);

  const markReviewed = async (reportId: string) => {
    try {
      await updateDoc(doc(firestore, 'reports', reportId), { status: 'reviewed' as ReportStatus });
      setReports((prev) => prev.map(r => r.id === reportId ? { ...r, status: 'reviewed' } : r));
    } catch (e) {
      Alert.alert('Error', 'Could not mark reviewed.');
    }
  };

  const removeMessage = async (threadId: string, msgId: string, reportId: string) => {
    Alert.alert('Remove message?', 'This will delete the offending message for all participants.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(firestore, 'dms', threadId, 'items', msgId));
            await updateDoc(doc(firestore, 'reports', reportId), { status: 'actioned' as ReportStatus });
            setReports((prev) => prev.map(r => r.id === reportId ? { ...r, status: 'actioned' } : r));
          } catch (e) {
            Alert.alert('Error', 'Could not remove the message.');
          }
        }
      }
    ]);
  };

  const startGlobalMatch = async (windowMinutes = 30) => {
    try {
      setToggling(true);
      const now = new Date();
      const ends = new Date(now.getTime() + windowMinutes * 60 * 1000);
      const payload: MatchState = {
        isActive: true,
        startedAt: now.toISOString(),
        endsAt: ends.toISOString(),
        windowMinutes,
      };
      await fetch("https://us-central1-better-cc0f9.cloudfunctions.net/runMatchingNow", {
        method: "POST",
      });
      Alert.alert('✅ Global Match Started', `Window: ${windowMinutes} min`);
    } catch (e: any) {
      console.error('startGlobalMatch error:', e?.code, e?.message);
      Alert.alert('⚠️ Error', 'Could not start the global match.');
    } finally {
      setToggling(false);
    }
  };

  const endGlobalMatch = async () => {
    try {
      setToggling(true);
      await setDoc(doc(firestore, ...MATCH_DOC_PATH), { isActive: false }, { merge: true });
      Alert.alert('✅ Global Match Ended', 'The session is now closed.');
    } catch (e: any) {
      console.error('endGlobalMatch error:', e?.code, e?.message);
      Alert.alert('⚠️ Error', 'Could not end the global match.');
    } finally {
      setToggling(false);
    }
  };

  const renderItem = ({ item }: { item: Report }) => {
    return (
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.badge}>{item.status}</Text>
          <Text style={styles.time}>{new Date(item.createdAtMs).toLocaleString()}</Text>
        </View>

        <View style={styles.meta}>
          <Text style={styles.metaText}><Text style={styles.dim}>Thread: </Text>{item.threadId}</Text>
          <Text style={styles.metaText}><Text style={styles.dim}>Message: </Text>{item.messageId}</Text>
          <Text style={styles.metaText}><Text style={styles.dim}>Reporter: </Text>{item.reporterId}</Text>
          <Text style={styles.metaText}><Text style={styles.dim}>Offender: </Text>{item.offenderId}</Text>
        </View>

        <View style={styles.blob}>
          <Text style={styles.blobTitle}>Reported text</Text>
          <Text style={styles.blobText}>{item.text || '— empty —'}</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity onPress={() => markReviewed(item.id)} style={[styles.btn, styles.btnNeutral]}>
            <Text style={styles.btnText}>Mark Reviewed</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => removeMessage(item.threadId, item.messageId, item.id)} style={[styles.btn, styles.btnDanger]}>
            <Text style={styles.btnText}>Remove Message</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.dim}>Checking admin access…</Text>
      </View>
    );
  }

  if (!isAdmin) {
    // We redirect above; this is just a safe fallback
    return null;
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const isActive = !!matchState?.isActive;
  const windowText = matchState?.windowMinutes ? `${matchState.windowMinutes}m` : null;
  const endsAtDate = toDate(matchState?.endsAt);
  const endsText = endsAtDate ? endsAtDate.toLocaleTimeString() : null;
  const startedAtDate = toDate(matchState?.startedAt);
  const startedText = startedAtDate ? startedAtDate.toLocaleTimeString() : '—';

  return (
    <View style={styles.screen}>
      {/* Header with Global Match controls */}
      <View style={[styles.card, { marginBottom: 12 }]}>
        <View style={styles.rowBetween}>
          <Text style={styles.title}>Admin · Report Review</Text>
          <Text style={[styles.badge, { backgroundColor: isActive ? '#064e3b' : '#1f2937' }]}>
            {isActive ? 'global: ACTIVE' : 'global: idle'}
          </Text>
        </View>

        <View style={{ marginTop: 10 }}>
          {isActive ? (
            <>
              <Text style={styles.dim}>
                Started {startedText}
                {endsText ? ` · Ends ${endsText}` : ''}
                {windowText ? ` · Window ${windowText}` : ''}
              </Text>
              <View style={[styles.actions, { marginTop: 8 }]}>
                {/* Non-pressable info pill showing state + countdown */}
                <TouchableOpacity disabled style={[styles.btn, styles.btnActiveInfo]}>
                  <Text style={styles.btnText}>
                    Global Match Active{remaining ? ` · ${remaining} left` : ''}
                  </Text>
                </TouchableOpacity>

                {/* End button */}
                <TouchableOpacity
                  disabled={toggling}
                  onPress={endGlobalMatch}
                  style={[styles.btn, styles.btnDanger]}
                >
                  <Text style={styles.btnText}>{toggling ? 'Ending…' : 'End Global Match'}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity
                disabled={toggling}
                onPress={() => startGlobalMatch(30)} // default window
                style={[styles.btn, styles.btnPrimary]}
              >
                <Text style={styles.btnText}>{toggling ? 'Starting…' : 'Start Global Match'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={toggling}
                onPress={() => startGlobalMatch(60)}
                style={[styles.btn, styles.btnNeutral]}
              >
                <Text style={styles.btnText}>{toggling ? '…' : 'Start 60m Window'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Reports list */}
      {reports.length === 0 ? (
        <View style={styles.center}><Text style={styles.dim}>No open reports.</Text></View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', padding: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  card: { backgroundColor: '#0b0b0b', borderColor: '#222', borderWidth: 1, borderRadius: 14, padding: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { color: '#e5e7eb', backgroundColor: '#1f2937', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden', fontWeight: '700' },
  time: { color: '#9aa7b1', fontSize: 12 },
  meta: { marginTop: 8, gap: 2 },
  metaText: { color: '#cbd5e1' },
  dim: { color: '#9aa7b1' },
  blob: { marginTop: 8, backgroundColor: '#111', borderColor: '#222', borderWidth: 1, borderRadius: 10, padding: 10 },
  blobTitle: { color: '#9aa7b1', fontSize: 12, marginBottom: 4, textTransform: 'uppercase' },
  blobText: { color: '#e5e7eb' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10 },
  btnNeutral: { backgroundColor: '#374151' },
  btnDanger: { backgroundColor: '#7f1d1d' },
  btnPrimary: { backgroundColor: '#065f46' },
  btnActiveInfo: { backgroundColor: '#065f46', opacity: 0.9 },
  btnText: { color: '#fff', fontWeight: '700' },
});
