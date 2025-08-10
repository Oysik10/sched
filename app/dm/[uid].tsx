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
  orderBy, query, serverTimestamp
} from 'firebase/firestore';

type Msg = {
  id: string;
  text: string;
  senderId: string;
  timestamp?: any;
};

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

export default function DMScreen() {
  // --- Resolve route param to a string (handles string[]) ---
  const rawParam = useLocalSearchParams().uid as string | string[] | undefined;
  const otherUid = Array.isArray(rawParam) ? rawParam[0] : (rawParam ?? '');

  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [otherProfile, setOtherProfile] = useState<{ username?: string; firstName?: string; lastName?: string } | null>(null);
  const flatRef = useRef<FlatList>(null);

  const me = auth.currentUser?.uid ?? '';
  const threadId = useMemo(() => (me && otherUid ? threadIdFor(me, otherUid) : ''), [me, otherUid]);

  // Load other user's profile
  useEffect(() => {
    if (!otherUid) return;
    (async () => {
      try {
        const uref = doc(firestore, 'users', otherUid);
        const snap = await getDoc(uref);
        setOtherProfile(snap.exists() ? (snap.data() as any) : {});
      } catch {
        setOtherProfile({});
      }
    })();
  }, [otherUid]);

  // Stream messages
  useEffect(() => {
    if (!threadId) return;
    const q = query(collection(firestore, 'dms', threadId, 'items'), orderBy('timestamp', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Msg[];
        setMessages(list);
        setLoading(false);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [threadId]);

  const send = async () => {
    const trimmed = text.trim();
    const user = auth.currentUser; // fresh check
    if (!trimmed || !user || !threadId) return;

    try {
      setSending(true);
      await addDoc(collection(firestore, 'dms', threadId, 'items'), {
        text: trimmed,
        senderId: user.uid,
        timestamp: serverTimestamp(),
      });
      setText('');
      // scroll after send
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
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

  if (!me || !otherUid) {
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
          const mine = item.senderId === me;
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
