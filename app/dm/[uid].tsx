// app/dm/[uid].tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { auth, firestore } from '../../src/firebaseConfig';
import {
  addDoc, collection, doc, getDoc, onSnapshot,
  orderBy, query, serverTimestamp, setDoc
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

type Msg = {
  id: string;
  text: string;
  senderId: string;
  createdAt: number;          // client ms timestamp for reliable sorting
  timestamp?: any;            // server timestamp for backend truth / rules
};

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

export default function DMScreen() {
  // --- Resolve route param to a string (handles string[]) ---
  const rawParam = useLocalSearchParams().uid as string | string[] | undefined;
  const otherUid = Array.isArray(rawParam) ? rawParam[0] : (rawParam ?? '');

  const [uid, setUid] = useState<string>('');                   // <- auth-ready uid
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [otherProfile, setOtherProfile] = useState<{ username?: string; firstName?: string; lastName?: string } | null>(null);
  const flatRef = useRef<FlatList>(null);

  // Wait for auth to be ready
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? '');
    });
    return unsub;
  }, []);

  const threadId = useMemo(() => (uid && otherUid ? threadIdFor(uid, otherUid) : ''), [uid, otherUid]);

  // Load other user's profile
  useEffect(() => {
    if (!otherUid) return;
    (async () => {
      try {
        const uref = doc(firestore, 'users', otherUid);
        const snap = await getDoc(uref);
        setOtherProfile(snap.exists() ? (snap.data() as any) : {});
      } catch (e) {
        console.warn('Profile load failed:', e);
        setOtherProfile({});
      }
    })();
  }, [otherUid]);

  // Ensure thread doc exists (helps with rules & metadata)
  useEffect(() => {
    if (!threadId) return;
    (async () => {
      try {
        const tref = doc(firestore, 'dms', threadId);
        await setDoc(
          tref,
          {
            participants: [uid, otherUid].sort(),
            updatedAt: serverTimestamp(),
            updatedAtMs: Date.now(),  
          },
          { merge: true }
        );
      } catch (e) {
        console.warn('Create/merge thread failed:', e);
      }
    })();
  }, [threadId, uid, otherUid]);

  // Stream messages (order by client createdAt to avoid null serverTimestamp issues)
  useEffect(() => {
    if (!threadId) return;
    const q = query(
      collection(firestore, 'dms', threadId, 'items'),
      orderBy('createdAt', 'asc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Msg[];
        setMessages(list);
        setLoading(false);
        // scroll after data in case list grew
        requestAnimationFrame(() => flatRef.current?.scrollToEnd({ animated: true }));
      },
      (err) => {
        console.warn('Message stream error:', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [threadId]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || !uid || !threadId) return;

    try {
      setSending(true);
      const now = Date.now();

      // write message
      await addDoc(collection(firestore, 'dms', threadId, 'items'), {
        text: trimmed,
        senderId: uid,
        createdAt: now,              // used for ordering
        timestamp: serverTimestamp() // canonical time
      });

      // update thread "updatedAt" so inbox lists can sort
      await setDoc(
        doc(firestore, 'dms', threadId),
        { lastMessage: trimmed, lastSenderId: uid, updatedAt: serverTimestamp(), updatedAtMs: Date.now() },
        { merge: true }
      );

      setText('');
      // scroll after send
      requestAnimationFrame(() => flatRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      console.warn('DM send failed:', e);
    } finally {
      setSending(false);
    }
  };

  const displayName =
    (otherProfile?.username && `@${otherProfile.username}`) ||
    [otherProfile?.firstName, otherProfile?.lastName].filter(Boolean).join(' ') ||
    'Chat';

  if (!uid || !otherUid) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: '#888' }}>Sign in to chat.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  const sendDisabled = !text.trim() || !threadId || sending;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: 10, paddingVertical: 6, width: 60 }}>
          <Text style={{ color: '#4f8ef7', fontWeight: '700' }}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{displayName}</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Messages */}
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => {
          const mine = item.senderId === uid;
          return (
            <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text style={styles.text}>{item.text}</Text>
            </View>
          );
        }}
        contentContainerStyle={{ padding: 12 }}
      />

      {/* Composer */}
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="iMessage…"
          placeholderTextColor="#888"
          style={styles.input}
          onSubmitEditing={() => (!sendDisabled ? send() : undefined)}
          returnKeyType="send"
        />
        <TouchableOpacity
          onPress={send}
          style={[styles.sendBtn, sendDisabled && { opacity: 0.5 }]}
          disabled={sendDisabled}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>{sending ? 'Sending…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: '#222',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    paddingRight: 60, // balance back button width
  },

  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    marginBottom: 8,
    maxWidth: '78%',
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: '#1e3a8a',
    borderTopRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#333',
    borderTopLeftRadius: 4,
  },
  text: { color: '#fff', fontSize: 16 },

  inputRow: {
    flexDirection: 'row',
    padding: 10,
    borderTopColor: '#222',
    borderTopWidth: 1,
    backgroundColor: '#111',
  },
  input: {
    flex: 1,
    height: 40,
    color: '#fff',
    backgroundColor: '#222',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  sendBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
});
