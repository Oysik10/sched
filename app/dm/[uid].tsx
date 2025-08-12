// app/dm/[uid].tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Modal
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
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
  const [reactionDetailsFor, setReactionDetailsFor] = useState<Msg | null>(null);
  const [removing, setRemoving] = useState(false);
  const [uid, setUid] = useState<string>('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [otherProfile, setOtherProfile] = useState<{ username?: string; firstName?: string; lastName?: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const flatRef = useRef<FlatList>(null);

  const getDisplayName = (u: string) => {
  if (u === uid) return 'You';
  if (otherUid && u === otherUid) {
    const name =
      (otherProfile?.username && `@${otherProfile.username}`) ||
      [otherProfile?.firstName, otherProfile?.lastName].filter(Boolean).join(' ');
    return name || (u.slice(0, 6) + '…');
  }
  return u.slice(0, 6) + '…';
  };


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

  // --- Mark thread as read (clock-skew safe) ---
  const markThreadRead = async () => {
    if (!uid || !threadId) return;
    try {
      // Use the max of local time and the newest message's createdAt to avoid skew
      const latestMsgMs = messages.length ? messages[messages.length - 1].createdAt : 0;
      const safeSeen = Math.max(Date.now(), latestMsgMs);
      await setDoc(
        doc(firestore, 'dms', threadId),
        { [`lastSeen.${uid}`]: safeSeen },
        { merge: true }
      );
    } catch (e) {
      console.warn('markThreadRead failed:', e);
    }
  };

  // mark as read whenever this screen is focused
  useFocusEffect(
    React.useCallback(() => {
      markThreadRead();
      return () => {};
    }, [threadId, uid, messages.length]) // include messages.length so focus + already loaded msgs stamp accurately
  );

  // also mark as read when new messages arrive while you’re on this screen
  useEffect(() => {
    if (messages.length) markThreadRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const removeMyReaction = async (msg: Msg) => {
  if (!uid || !threadId) return;
  const mine = msg.reactions?.[uid];
  if (!mine) return; // nothing to remove
  try {
    setRemoving(true);
    const mref = doc(firestore, 'dms', threadId, 'items', msg.id);
    await updateDoc(mref, { [`reactions.${uid}`]: deleteField() });
    setReactionDetailsFor(null);
  } catch (e) {
    console.warn('Remove reaction failed:', e);
  } finally {
    setRemoving(false);
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

  const renderReactionsSummary = (msg: Msg, mine: boolean) => {
    const values = Object.values(msg.reactions || {});
    if (values.length === 0) return null;

    const counts = values.reduce<Record<string, number>>((acc, em) => {
      acc[em] = (acc[em] || 0) + 1;
      return acc;
    }, {});
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setReactionDetailsFor(msg)}
        style={[
          styles.reactionsBubble,
          mine ? { right: 6, alignSelf: 'flex-end' } : { left: 6, alignSelf: 'flex-start' },
        ]}
      >
        {entries.map(([em, n]) => (
          <View key={em} style={styles.reactionPillInline}>
            <Text style={styles.reactionText}>{em} {n > 1 ? n : ''}</Text>
          </View>
        ))}
      </TouchableOpacity>
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

  const handleBack = async () => {
    // Stamp read on the way out too, just in case
    await markThreadRead();
    router.back();
  };

return (
  <>
    {/* Tap anywhere to dismiss the reaction bar */}
    {reactingTo && (
      <View
        pointerEvents="auto"
        style={styles.dismissOverlay}
      >
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setReactingTo(null)} />
      </View>
    )}

    <Modal
      visible={!!reactionDetailsFor}
      transparent
      animationType="fade"
      onRequestClose={() => setReactionDetailsFor(null)}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Reactions</Text>

          {/* List who reacted with what */}
          <View style={{ gap: 8, marginTop: 8 }}>
            {Object.entries(reactionDetailsFor?.reactions || {}).map(([userId, em]) => (
              <View key={userId} style={styles.modalRow}>
                <Text style={styles.modalEmoji}>{em}</Text>
                <Text style={styles.modalText}>{getDisplayName(userId)}</Text>
              </View>
            ))}
          </View>

          {/* Remove my reaction (only shown if you reacted) */}
          {reactionDetailsFor?.reactions?.[uid] ? (
            <TouchableOpacity
              onPress={() => removeMyReaction(reactionDetailsFor!)}
              style={[styles.modalBtn, removing && { opacity: 0.6 }]}
              disabled={removing}
            >
              <Text style={styles.modalBtnText}>
                {removing ? 'Removing…' : 'Remove my reaction'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Close */}
          <TouchableOpacity onPress={() => setReactionDetailsFor(null)} style={styles.modalClose}>
            <Text style={styles.modalCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal><KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={{ paddingHorizontal: 10, paddingVertical: 6, width: 100 }}>
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
          onScrollBeginDrag={() => setReactingTo(null)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const mine = item.senderId === uid;
            const showBar = reactingTo === item.id;
            return (
              <View style={styles.msgWrapper}>
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

                {/* Message bubble */}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onLongPress={() => setReactingTo(showBar ? null : item.id)}
                  style={[styles.bubble, mine ? styles.mine : styles.theirs]}
                >
                  <Text style={styles.text}>{item.text}</Text>
                </TouchableOpacity>

                {/* Reaction summary OVER the top edge of the bubble */}
                {renderReactionsSummary(item, mine)}
              </View>
            );
          } }

          contentContainerStyle={{ padding: 12 }} />

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
            autoCapitalize="none" />
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
      </KeyboardAvoidingView></>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  
dismissOverlay: {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 10, // ⬅️ below reactionBar (20), above everything else
},


  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: '#222',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
    modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '86%',
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    borderColor: '#222',
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderBottomColor: '#1f1f1f',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalEmoji: { fontSize: 20 },
  modalText: { color: '#ddd', fontSize: 15 },
  modalBtn: {
    marginTop: 14,
    backgroundColor: '#30363d',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontWeight: '700' },
  modalClose: { marginTop: 10, alignItems: 'center' },
  modalCloseText: { color: '#9aa7b1' },


  reactionsBubble: {
    position: 'absolute',
    top: -10,                // overlaps the top edge of the bubble
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#1f2937',
    borderRadius: 14,
    // subtle shadow to lift above bubble
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },

    reactionPillInline: {
    backgroundColor: 'transparent', // pills merge into single bar; keep as-is or add mini chips per emoji
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 0,
  },

  reactionText: { color: '#fff' },

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
  
msgWrapper: {
  position: 'relative',
  marginBottom: 12,
  paddingTop: 8,         // gives space so the overlapped badge is inside hit box
  overflow: 'visible',   // extra-safe, esp. on Android
},

  // Reactions UI
  reactionBar: {
    backgroundColor: '#1f2937',
    borderRadius: 18,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginBottom: 4,
    flexDirection: 'row',
    gap: 6,
    zIndex: 20,          // ⬅️ keep the bar above the tap-catcher
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
