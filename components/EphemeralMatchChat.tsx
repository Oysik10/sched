// components/EphemeralMatchChat.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform
} from 'react-native';
import { auth, firestore } from '../src/firebaseConfig';
import {
  addDoc, collection, deleteDoc, doc, getDocs, limit,
  onSnapshot, orderBy, query, runTransaction, serverTimestamp,
  setDoc, Timestamp, updateDoc, where, DocumentData
} from 'firebase/firestore';

type MatchDoc = {
  participants: string[];
  createdAt: any;
  expiresAt: Timestamp;
  aliases: Record<string, string>;
  active: boolean;
};

type Msg = {
  id?: string;
  text: string;
  senderId: string;
  createdAt: any;
  createdAtMs: number;
};

const ALIASES = [
  'Panda','Otter','Falcon','Koala','Mantis','Lynx','Orca','Coyote','Badger','Jay',
  'Robin','Kestrel','Bison','Marten','Osprey','Wren','Raven','Finch','Viper','Mako'
];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function randomAlias() {
  return ALIASES[Math.floor(Math.random() * ALIASES.length)];
}
function msLeft(expiresAt?: Timestamp | null) {
  if (!expiresAt) return 0;
  return expiresAt.toMillis() - Date.now();
}
function formatCountdown(ms: number) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

export default function EphemeralMatchChat({ onExit }: { onExit?: () => void }) {
  const uid = auth.currentUser?.uid ?? null;

  const [status, setStatus] = useState<'idle'|'matching'|'matched'|'expired'|'error'>('idle');
  const [error, setError] = useState<string>('');
  const [matchId, setMatchId] = useState<string>('');
  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [partnerUid, setPartnerUid] = useState<string>('');
  const [countdown, setCountdown] = useState<string>('—');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const flatRef = useRef<FlatList<Msg>>(null);

  // ---- Helpers ----
  const ensureInQueue = async (myUid: string) => {
    await setDoc(doc(firestore, 'matchQueue', myUid), {
      uid: myUid,
      createdAt: serverTimestamp(),
    }, { merge: true });
  };

  // Check if I already have an active match (prevents multiple partners in 24h)
  const findExistingActiveMatch = async (myUid: string) => {
    const mCol = collection(firestore, 'matches');
    const q = query(mCol, where('participants', 'array-contains', myUid), where('active', '==', true));
    const snap = await getDocs(q);
    // pick the newest active one
    const docSnap = snap.docs.sort((a, b) => (a.data().createdAt?.seconds ?? 0) - (b.data().createdAt?.seconds ?? 0)).pop();
    if (!docSnap) return null;
    const data = docSnap.data() as MatchDoc;
    if (msLeft(data.expiresAt) <= 0) return null;
    return { id: docSnap.id, data };
  };

  // Try to claim a partner from the queue (other user does NOT need to be online)
  const tryClaimPartner = async (myUid: string) => {
    // don’t create new if I already have an active one
    const existing = await findExistingActiveMatch(myUid);
    if (existing) {
      setMatchId(existing.id);
      const other = existing.data.participants.find(p => p !== myUid) || '';
      setPartnerUid(other);
      return true;
    }

    // list a few oldest queue entries
    const qRef = collection(firestore, 'matchQueue');
    const qSnap = await getDocs(query(qRef, orderBy('createdAt', 'asc'), limit(10)));
    const candidateDoc = qSnap.docs.find(d => (d.data() as DocumentData)?.uid !== myUid);
    if (!candidateDoc) return false;

    const candidateRef = candidateDoc.ref;
    const otherUid = (candidateDoc.data() as DocumentData).uid as string;

    // Create match & remove both from queue atomically
    const result = await runTransaction(firestore, async (tx) => {
      // re-read both queue docs
      const otherSnap = await tx.get(candidateRef);
      const myQueueRef = doc(firestore, 'matchQueue', myUid);
      const mySnap = await tx.get(myQueueRef);

      // other still in queue?
      if (!otherSnap.exists()) return null;

      // check again that I still have no active match
      // (best-effort: client-side precheck above; here we just rely on queue)
      const matchesRef = collection(firestore, 'matches');
      const newMatchRef = doc(matchesRef);

      const myAlias = randomAlias();
      const theirAlias = randomAlias();
      const now = Date.now();
      const expiresAt = Timestamp.fromMillis(now + ONE_DAY_MS);

      tx.set(newMatchRef, {
        participants: [myUid, otherUid],
        createdAt: serverTimestamp(),
        expiresAt,
        aliases: { [myUid]: myAlias, [otherUid]: theirAlias },
        active: true,
      } as MatchDoc);

      // remove both queue entries (requires rule allowing delete)
      if (mySnap.exists()) tx.delete(myQueueRef);
      tx.delete(candidateRef);

      return newMatchRef.id;
    });

    if (result) {
      setMatchId(result);
      setPartnerUid(otherUid);
      return true;
    }
    return false;
  };

  // ---------- Matching flow ----------
  useEffect(() => {
    if (!uid) {
      setStatus('error');
      setError('You must be signed in.');
      return;
    }
    setStatus('matching');

    let unsubMatchQuery: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        // 1) ensure I’m in the queue now (so others can grab me even if I leave)
        await ensureInQueue(uid);

        // 2) If I already have an active match, latch onto it
        const existing = await findExistingActiveMatch(uid);
        if (existing) {
          setMatchId(existing.id);
          const other = existing.data.participants.find(p => p !== uid) || '';
          setPartnerUid(other);
        }

        // 3) keep listening for any active match that includes me
        const mCol = collection(firestore, 'matches');
        const mQ = query(mCol, where('participants', 'array-contains', uid), where('active', '==', true));
        unsubMatchQuery = onSnapshot(mQ, (snap) => {
          const docs = snap.docs;
          if (!docs.length) return;
          const d = docs.sort((a,b) => (a.data().createdAt?.seconds ?? 0) - (b.data().createdAt?.seconds ?? 0)).pop()!;
          const data = d.data() as MatchDoc;
          const other = data.participants.find(p => p !== uid) || '';
          setMatchId(d.id);
          setPartnerUid(other);
        });

        // 4) every 3s try to claim a partner proactively
        pollTimer = setInterval(() => {
          // don’t spam once matched
          if (matchId) return;
          tryClaimPartner(uid).catch(() => {});
        }, 3000);
      } catch (e: any) {
        setStatus('error');
        setError(e?.message ?? 'Failed to start matching.');
      }
    })();

    return () => {
      if (unsubMatchQuery) unsubMatchQuery();
      if (pollTimer) clearInterval(pollTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Load match doc & messages when matchId is known
  useEffect(() => {
    if (!matchId || !uid) return;

    const mRef = doc(firestore, 'matches', matchId);
    const unsubMatch = onSnapshot(mRef, (snap) => {
      if (!snap.exists()) {
        setStatus('error');
        setError('Match not found.');
        return;
      }
      const data = snap.data() as MatchDoc;
      setMatch(data);

      const left = msLeft(data.expiresAt);
      if (left <= 0 || data.active === false) {
        setStatus('expired');
      } else {
        setStatus('matched');
      }
    });

    const msgsRef = collection(firestore, 'matches', matchId, 'messages');
    const unsubMsgs = onSnapshot(query(msgsRef, orderBy('createdAt', 'asc')), (snap) => {
      const rows: Msg[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as Msg) }));
      setMessages(rows);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    });

    return () => {
      unsubMatch();
      unsubMsgs();
    };
  }, [matchId, uid]);

  // Countdown ticker
  useEffect(() => {
    if (!match?.expiresAt) return;
    const interval = setInterval(() => {
      const left = msLeft(match?.expiresAt);
      setCountdown(formatCountdown(left));
      if (left <= 0) setStatus('expired');
    }, 1000);
    return () => clearInterval(interval);
  }, [match?.expiresAt]);

  const myAlias = useMemo(() => (match && uid ? match.aliases?.[uid] ?? 'You' : 'You'), [match, uid]);
  const partnerAlias = useMemo(() => (match && partnerUid ? match.aliases?.[partnerUid] ?? 'Partner' : 'Partner'), [match, partnerUid]);
  const canSend = status === 'matched';

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || !uid || !matchId || !canSend) return;
    try {
      setSending(true);
      const now = Date.now();
      await addDoc(collection(firestore, 'matches', matchId, 'messages'), {
        text: trimmed,
        senderId: uid,
        createdAt: serverTimestamp(),
        createdAtMs: now,
      } as Msg);
      setText('');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
    } finally {
      setSending(false);
    }
  };

  const leaveQueue = async () => {
    if (!uid) return;
    try { await deleteDoc(doc(firestore, 'matchQueue', uid)); } catch {}
  };

  const lockIfExpired = async () => {
    if (!matchId) return;
    try { await updateDoc(doc(firestore, 'matches', matchId), { active: false }); } catch {}
  };
  useEffect(() => { if (status === 'expired') lockIfExpired(); }, [status]);

  // UI
  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Couldn’t start a match</Text>
        <Text style={styles.sub}>{error || 'Unknown error.'}</Text>
        <TouchableOpacity style={styles.button} onPress={onExit}>
          <Text style={styles.buttonText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!matchId) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={[styles.sub, { marginTop: 12 }]}>Looking for a partner…</Text>
        <TouchableOpacity style={[styles.linkBtn, { marginTop: 12 }]} onPress={leaveQueue}>
          <Text style={[styles.sub, { textDecorationLine: 'underline' }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const expired = status === 'expired';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
      keyboardVerticalOffset={Platform.select({ ios: 64, android: 0 })}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{expired ? 'Match ended' : 'Anonymous Match'}</Text>
        <Text style={styles.sub}>
          {expired ? 'Your 24h window is over.' : `Time left: ${countdown}`}
        </Text>
        <Text style={[styles.sub, { marginTop: 6 }]}>
          You are <Text style={styles.alias}>{myAlias}</Text>, they are <Text style={styles.alias}>{partnerAlias}</Text>.
        </Text>
      </View>

      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(m) => m.id!}
        contentContainerStyle={{ padding: 12, paddingBottom: 8 }}
        renderItem={({ item }) => {
          const mine = item.senderId === uid;
          return (
            <View style={[styles.bubble, mine ? styles.bubbleRight : styles.bubbleLeft]}>
              <Text style={styles.bubbleSender}>{mine ? myAlias : partnerAlias}</Text>
              <Text style={styles.bubbleText}>{item.text}</Text>
            </View>
          );
        }}
        onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
      />

      <View style={[styles.inputRow, expired && { opacity: 0.5 }]}>
        <TextInput
          style={styles.input}
          placeholder={expired ? 'Chat locked' : 'Type a message…'}
          editable={!expired && !sending}
          multiline
          value={text}
          onChangeText={setText}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!canSend || !text.trim()) && { opacity: 0.4 }]}
          onPress={send}
          disabled={!canSend || !text.trim()}
        >
          <Text style={styles.sendBtnText}>{sending ? '…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footerRow}>
        <TouchableOpacity style={styles.linkBtn} onPress={onExit}>
          <Text style={[styles.sub, { textDecorationLine: 'underline' }]}>Close</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingHorizontal: 16, paddingTop: 16 },
  title: { fontSize: 18, fontWeight: '700' },
  sub: { fontSize: 14, color: '#666' },
  alias: { fontWeight: '600', color: '#111' },
  bubble: { maxWidth: '78%', marginVertical: 6, padding: 10, borderRadius: 12 },
  bubbleLeft: { alignSelf: 'flex-start', backgroundColor: '#f1f1f1' },
  bubbleRight: { alignSelf: 'flex-end', backgroundColor: '#dfefff' },
  bubbleSender: { fontSize: 11, color: '#444', marginBottom: 4 },
  bubbleText: { fontSize: 15, color: '#111' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, backgroundColor: 'white' },
  sendBtn: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#111', borderRadius: 10 },
  sendBtnText: { color: 'white', fontWeight: '600' },
  footerRow: { padding: 12, alignItems: 'center' },
  button: { marginTop: 12, backgroundColor: '#111', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  buttonText: { color: '#fff', fontWeight: '600' },
  linkBtn: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
});
