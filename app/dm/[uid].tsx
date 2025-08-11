// app/dm/[uid].tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { auth, firestore } from '../../src/firebaseConfig';
import {
  addDoc, collection, doc, getDoc, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, updateDoc, deleteField
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

type Msg = {
  id: string;
  text: string;
  senderId: string;
  createdAt: number;          // client ms timestamp for reliable sorting
  timestamp?: any;            // server timestamp for backend truth / rules
  reactions?: Record<string, string>; // userId -> emoji
};

const REACTION_SET = ['❤️','👍','😂','😮','😢','🔥','👏'] as const;
const COMPOSER_EMOJI = ['😀','😂','😍','👍','🙏','🔥','❤️','🎉','😮','😢'] as const;

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

export default function DMScreen() {
  const rawParam = useLocalSearchParams().uid as string | string[] | undefined;
  const otherUid = Array.isArray(rawParam) ? rawParam[0] : (rawParam ?? '');

  const [uid, setUid] = useState<string>('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [otherProfile, setOtherProfile] = useState<{ username?: string; firstName?: string; lastName?: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);            // composer emoji row
  const [reactingTo, setReactingTo] = useState<string | null>(null); // msg.id currently showing reaction bar
  const flatRef = useRef<FlatList>(null);

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

  // Stream messages
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

      await addDoc(collection(firestore, 'dms', threadId, 'items'), {
        text: trimmed,
        senderId: uid,
        createdAt: now,
        timestamp: serverTimestamp()
      });

      await setDoc(
        doc(firestore, 'dms', threadId),
        { lastMessage: trimmed, lastSenderId: uid, updatedAt: serverTimestamp(), updatedAtMs: Date.now() },
        { merge: true }
      );

      setText('');
      setPickerOpen(false);
      requestAnimationFrame(() => flatRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      console.warn('DM send failed:', e);
    } finally {
      setSending(false);
    }
  };

  // --- Reactions ---
  const toggleReaction = async (msg: Msg, emoji: string) => {
    if (!uid || !threadId) return;
    try {
      const mref = doc(firestore, 'dms', threadId, 'items', msg.id);
      const current = msg.reactions || {};
      const mine = current[uid];

      if (mine === emoji) {
        // remove my reaction
        await updateDoc(mref, { [`reactions.${uid}`]: deleteField() });
      } else {
        // set/replace my reaction
        await updateDoc(mref, { [`reactions.${uid}`]: emoji });
      }
      setReactingTo(null);
    } catch (e) {
      console.warn('Reaction failed:', e);
    }
  };

  const renderReactionsSummary = (msg: Msg) => {
    const values = Object.values(msg.reactions || {});
    if (values.length === 0) return null;

    // count by emoji
    const counts = values.reduce<Record<string, number>>((acc, em) => {
      acc[em] = (acc[em] || 0) + 1;
      return acc;
    }, {});
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    return (
      <View style={styles.reactionsRow}>
        {entries.map(([em, n]) => (
          <View key={em} style={styles.reactionPill}>
            <Text style={styles.reactionText}>{em} {n > 1 ? n : ''}</Text>
          </View>
        ))}
      </View>
    );
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
        <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: 10, paddingVertical: 6, width: 100 }}>
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
          const showBar = reactingTo === item.id;
          return (
            <View>
              {/* Reaction picker bar on long-press */}
              {showBar && (
                <View style={[styles.reactionBar, mine ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
                  {REACTION_SET.map((em) => (
                    <TouchableOpacity key={em} onPress={() => toggleReaction(item, em)} style={styles.reactionBtn}>
                      <Text style={{ fontSize: 18 }}>{em}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <TouchableOpacity
                activeOpacity={0.8}
                onLongPress={() => setReactingTo(showBar ? null : item.id)}
                style={[styles.bubble, mine ? styles.mine : styles.theirs]}
              >
                <Text style={styles.text}>{item.text}</Text>
              </TouchableOpacity>

              {/* Reaction summary under the bubble */}
              {renderReactionsSummary(item)}
            </View>
          );
        }}
        contentContainerStyle={{ padding: 12 }}
      />

      {/* Composer */}
      <View style={styles.inputRow}>
        {/* Toggle emoji row */}
        <TouchableOpacity onPress={() => setPickerOpen((v) => !v)} style={styles.emojiToggle}>
          <Text style={{ fontSize: 20 }}>😊</Text>
        </TouchableOpacity>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="iMessage…"
          placeholderTextColor="#888"
          style={styles.input}
          onSubmitEditing={() => (!sendDisabled ? send() : undefined)}
          returnKeyType="send"
          autoCapitalize="none"
        />
        <TouchableOpacity
          onPress={send}
          style={[styles.sendBtn, sendDisabled && { opacity: 0.5 }]}
          disabled={sendDisabled}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>{sending ? 'Sending…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>

      {/* Simple emoji row for composing */}
      {pickerOpen && (
        <View style={styles.emojiRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {COMPOSER_EMOJI.map((em) => (
              <TouchableOpacity key={em} onPress={() => setText((t) => t + em)} style={styles.emojiItem}>
                <Text style={{ fontSize: 22 }}>{em}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
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
    paddingRight: 60,
  },

  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    marginBottom: 6,
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

  // Reactions UI
  reactionBar: {
    backgroundColor: '#1f2937',
    borderRadius: 18,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginBottom: 4,
    flexDirection: 'row',
    gap: 6,
  },
  reactionBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reactionsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  reactionPill: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  reactionText: { color: '#fff' },

  inputRow: {
    flexDirection: 'row',
    padding: 10,
    borderTopColor: '#222',
    borderTopWidth: 1,
    backgroundColor: '#111',
    alignItems: 'center',
    gap: 8,
  },
  emojiToggle: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222',
  },
  input: {
    flex: 1,
    height: 40,
    color: '#fff',
    backgroundColor: '#222',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  sendBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
    height: 40,
  },

  // Composer emoji row
  emojiRow: {
    borderTopColor: '#222',
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#0b0b0b',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  emojiItem: {
    marginRight: 8,
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#161616',
  },
});
