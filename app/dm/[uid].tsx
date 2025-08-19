// app/dm/[uid].tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, Modal, Alert
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { auth, firestore } from '../../src/firebaseConfig';
import {
  addDoc, collection, doc, getDoc, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, updateDoc, deleteField,
  limit, getDocs, deleteDoc, Timestamp, startAfter, where
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Keyboard, Pressable } from 'react-native';

type Msg = {
  id: string;
  text: string;
  senderId: string;
  createdAt: any;
  createdAtMs?: number;
  reactions?: Record<string, string>;
  replyTo?: { msgId: string; text: string; senderId: string };
  reported?: {
    status: 'reported' | 'reviewed' | 'dismissed';
    reportedBy: string[];
    reportedAtMs?: number;
    hiddenFor?: Record<string, boolean>;
  };
};

const REACTION_SET = ['❤️','👍','😂','😮','😢','🔥','👏'] as const;
const COMPOSER_EMOJI = ['😀','😂','😍','👍','🙏','🔥','❤️','🎉','😮','😢'] as const;
const PAGE = 40;
const HEADER_H = 52;

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

function toMs(val: any): number {
  if (typeof val === 'number') return val;
  if (val && typeof val.toMillis === 'function') return val.toMillis();
  return 0;
}
function getMs(m: Msg): number {
  return toMs(m.createdAtMs ?? m.createdAt);
}

function formatTimestamp(ms: number, { withSeconds = false, includeDate = true }: { withSeconds?: boolean; includeDate?: boolean } = {}) {
  const d = new Date(ms);
  const opts: Intl.DateTimeFormatOptions = includeDate
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: withSeconds ? '2-digit' : undefined }
    : { hour: 'numeric', minute: '2-digit', second: withSeconds ? '2-digit' : undefined };
  return d.toLocaleString(undefined, opts);
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
  const [selectedForReaction, setSelectedForReaction] = useState<Msg | null>(null);
  const [replyingTo, setReplyingTo] = useState<Msg | null>(null);

  const flatRef = useRef<FlatList>(null);
  const initialScrolledRef = useRef(false);
  const lastPreviewMsgIdRef = useRef<string | null>(null);
  const [oldestCursor, setOldestCursor] = useState<number | null>(null);


  const insets = useSafeAreaInsets();
  // ✅ Header is INSIDE this screen, so we do NOT add any vertical offset here.
  const keyboardOffset = 0;

  // anonymous-match username hiding
  const [hideUsernameForOther, setHideUsernameForOther] = useState(false);

  const getDisplayName = (u: string) => {
    if (u === uid) return 'You';
    if (u === otherUid && hideUsernameForOther) return 'Anonymous Match';
    if (otherUid && u === otherUid) {
      const name =
        (otherProfile?.username && `@${otherProfile.username}`) ||
        [otherProfile?.firstName, otherProfile?.lastName].filter(Boolean).join(' ');
      return name || (u.slice(0, 6) + '…');
    }
    return u.slice(0, 6) + '…';
  };

  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setUid(user?.uid ?? ''));
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
      } catch {
        setOtherProfile({});
      }
    })();
  }, [otherUid]);

  // Ensure thread doc exists
  useEffect(() => {
    if (!threadId) return;
    (async () => {
      try {
        await setDoc(
          doc(firestore, 'dms', threadId),
          { participants: [uid, otherUid].sort() },
          { merge: true }
        );
      } catch {}
    })();
  }, [threadId, uid, otherUid]);

  // Stream messages (DESC: newest first)
  useEffect(() => {
    if (!threadId) return;
    const qy = query(
      collection(firestore, 'dms', threadId, 'items'),
      orderBy('createdAt', 'desc'),
      limit(PAGE)
    );
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Msg[];
        setMessages(list); // newest is at index 0
        const last = list[list.length - 1]; // this is the OLDEST of this page
        setOldestCursor(last ? getMs(last) : null);
        setHasMore(list.length === PAGE);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [threadId]);

  // Auto-scroll to bottom when the thread first loads / changes
  useEffect(() => {
    if (!messages.length) return;
    if (!initialScrolledRef.current) {
      requestAnimationFrame(() => {
        flatRef.current?.scrollToIndex({ index: 0, animated: false });
        initialScrolledRef.current = true;
      });
    }
  }, [messages.length, threadId]);

  // Also keep the bottom in view if keyboard opens (common chat UX)
  useEffect(() => {
    if (keyboardOpen && messages.length) {
      requestAnimationFrame(() => {
        flatRef.current?.scrollToIndex({ index: 0, animated: true });
      });
    }
  }, [keyboardOpen, messages.length]);

  const reportMessage = async (msg: Msg) => {
    if (!uid || !threadId) return;
    const now = Date.now();
    const mref = doc(firestore, 'dms', threadId, 'items', msg.id);

    try {
      await setDoc(
        mref,
        {
          reported: {
            status: 'reported',
            reportedAtMs: now,
            hiddenFor: { ...(msg.reported?.hiddenFor ?? {}), [uid]: true },
          },
        },
        { merge: true }
      );
    } catch (e: any) {
      console.log('[report/hide] failed:', e?.code, e?.message);
      throw e;
    }

    try {
      await addDoc(collection(firestore, 'reports'), {
        type: 'dm_message',
        threadId,
        messageId: msg.id,
        offenderId: msg.senderId,
        reporterId: uid,
        text: msg.text ?? '',
        createdAtMs: now,
        replyTo: msg.replyTo ?? null,
        status: 'open',
      });
    } catch (e: any) {
      console.log('[report/log] failed (non-fatal):', e?.code, e?.message);
    }

    try {
      await setDoc(
        doc(firestore, 'dms', threadId),
        {
          updatedAt: serverTimestamp(),
          updatedAtMs: now,
          lastActivity: { type: 'report', actorId: uid, text: 'A message was reported', atMs: now },
        },
        { merge: true }
      );
    } catch (e: any) {
      console.log('[report/thread lastActivity] failed (non-fatal):', e?.code, e?.message);
    }
  };

  // Build display rows with separators based on DESC data
  type Row =
    | { type: 'separator'; key: string; atMs: number }
    | ({ type: 'message' } & Msg);

  const SEPARATOR_GAP_MS = 10 * 60 * 1000;

  const displayRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    let prevMs: number | null = null;

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const curMs = getMs(m);
      if (i !== 0 && prevMs !== null && (prevMs - curMs) >= SEPARATOR_GAP_MS) {
        rows.push({ type: 'separator', key: `sep-${curMs}`, atMs: curMs });
      }
      rows.push({ type: 'message', ...m });
      prevMs = curMs;
    }
    return rows;
  }, [messages]);

  // Load older messages for DESC order
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadOlder = async () => {
    if (!threadId || !oldestCursor || loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const olderQ = query(
        collection(firestore, 'dms', threadId, 'items'),
        orderBy('createdAt', 'desc'),
        startAfter(Timestamp.fromMillis(oldestCursor)),
        limit(PAGE)
      );
      const snap = await getDocs(olderQ);
      const older = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Msg[];
      if (older.length === 0) { setHasMore(false); return; }
      setMessages((prev) => [...prev, ...older]);
      const last = older[older.length - 1];
      setOldestCursor(last ? getMs(last) : null);
    } finally {
      setLoadingMore(false);
    }
  };

  // Mark thread read
  const markThreadRead = async () => {
    if (!uid || !threadId) return;
    try {
      const latest = messages[0];
      const latestMsgMs = latest ? getMs(latest) : 0;
      const safeSeen = Math.max(Date.now(), latestMsgMs);
      await setDoc(doc(firestore, 'dms', threadId), { [`lastSeen.${uid}`]: safeSeen }, { merge: true });
    } catch {}
  };

  useFocusEffect(
    React.useCallback(() => {
      markThreadRead();
      return () => {};
    }, [threadId, uid, messages.length])
  );
  useEffect(() => {
    if (messages.length) markThreadRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Keep thread preview in sync if last message changes
  const refreshThreadPreview = async () => {
    if (!threadId) return;
    try {
      const latestQ = query(
        collection(firestore, 'dms', threadId, 'items'),
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      const snap = await getDocs(latestQ);
      const now = Date.now();

      if (snap.empty) {
        await updateDoc(doc(firestore, 'dms', threadId), {
          updatedAt: serverTimestamp(),
          updatedAtMs: now,
          lastMessage: deleteField(),
          lastSenderId: deleteField(),
          lastMessageAtMs: deleteField(),
          lastActivity: { type: 'cleanup', atMs: now },
        });
        lastPreviewMsgIdRef.current = '__empty__';
      } else {
        const d = snap.docs[0];
        const m = d.data() as Msg;
        const latestMs = getMs(m);
        await updateDoc(doc(firestore, 'dms', threadId), {
          updatedAt: serverTimestamp(),
          updatedAtMs: now,
          lastMessage: m.text || '',
          lastSenderId: m.senderId || '',
          lastMessageAtMs: latestMs,
          lastActivity: { type: 'message', actorId: m.senderId, text: m.text || '', atMs: latestMs },
        });
        lastPreviewMsgIdRef.current = d.id;
      }
    } catch (e) {
      console.warn('refreshThreadPreview failed:', e);
    }
  };

  useEffect(() => {
    const latest = messages[0];
    const latestId = latest?.id ?? '__empty__';
    if (lastPreviewMsgIdRef.current !== latestId) {
      refreshThreadPreview();
    }
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reactions
  const removeMyReaction = async (msg: Msg) => {
    if (!uid || !threadId) return;
    const mine = msg.reactions?.[uid];
    if (!mine) return;
    try {
      setRemoving(true);
      const now = Date.now();
      await updateDoc(doc(firestore, 'dms', threadId, 'items', msg.id), { [`reactions.${uid}`]: deleteField() });
      await updateDoc(doc(firestore, 'dms', threadId), {
        updatedAt: serverTimestamp(), updatedAtMs: now, lastActivity: deleteField(),
      });
      setReactionDetailsFor(null);
    } finally {
      setRemoving(false);
    }
  };

  const toggleReaction = async (msg: Msg, emoji: string) => {
    if (!uid || !threadId) return;
    try {
      const mref = doc(firestore, 'dms', threadId, 'items', msg.id);
      const current = msg.reactions || {};
      const mine = current[uid];
      const now = Date.now();

      if (mine === emoji) {
        await updateDoc(mref, { [`reactions.${uid}`]: deleteField() });
        await updateDoc(doc(firestore, 'dms', threadId), {
          updatedAt: serverTimestamp(), updatedAtMs: now, lastActivity: deleteField(),
        });
      } else {
        await updateDoc(mref, { [`reactions.${uid}`]: emoji });
        await setDoc(
          doc(firestore, 'dms', threadId),
          {
            updatedAt: serverTimestamp(),
            updatedAtMs: now,
            lastActivity: { type: 'reaction', actorId: uid, emoji, text: msg.text || '', msgId: msg.id, atMs: now },
          },
          { merge: true }
        );
      }
      setSelectedForReaction(null);
    } catch (e) {
      console.warn('Reaction failed:', e);
    }
  };

  // Message actions
  const startReply = (msg: Msg) => {
    setReplyingTo(msg);
    setSelectedForReaction(null);
  };

  const confirmDelete = (msg: Msg) => {
    if (msg.senderId !== uid) return;
    Alert.alert('Delete message?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMessage(msg) },
    ]);
  };

  const deleteMessage = async (msg: Msg) => {
    if (!threadId) return;
    try {
      await deleteDoc(doc(firestore, 'dms', threadId, 'items', msg.id));
      await refreshThreadPreview();
    } catch (e) {
      console.warn('deleteMessage failed:', e);
    } finally {
      setSelectedForReaction(null);
      if (replyingTo?.id === msg.id) setReplyingTo(null);
    }
  };

  // Send
  const send = async () => {
    const trimmed = text.trim();
    if (!uid || !threadId || !trimmed) return;

    try {
      setSending(true);
      const now = Date.now();

      const payload: any = {
        text: trimmed,
        senderId: uid,
        createdAt: serverTimestamp(),
        createdAtMs: now,
      };
      if (replyingTo) {
        payload.replyTo = {
          msgId: replyingTo.id,
          text: replyingTo.text,
          senderId: replyingTo.senderId,
        };
      }

      await addDoc(collection(firestore, 'dms', threadId, 'items'), payload);

      await setDoc(
        doc(firestore, 'dms', threadId),
        {
          lastMessage: trimmed,
          lastSenderId: uid,
          lastMessageAtMs: now,
          updatedAt: serverTimestamp(),
          updatedAtMs: now,
          lastActivity: { type: 'message', actorId: uid, text: trimmed, atMs: now, replyToId: replyingTo?.id || null },
        },
        { merge: true }
      );

      setText('');
      setPickerOpen(false);
      setReplyingTo(null);

      // Always snap to newest after send
      requestAnimationFrame(() => {
        flatRef.current?.scrollToIndex({ index: 0, animated: true });
      });
    } catch (e) {
      console.warn('DM send failed:', e);
    } finally {
      setSending(false);
    }
  };

  const headerTitle = hideUsernameForOther
    ? 'Anonymous Match'
    : (
        (otherProfile?.username && `@${otherProfile.username}`) ||
        [otherProfile?.firstName, otherProfile?.lastName].filter(Boolean).join(' ') ||
        'Chat'
      );

  const sendDisabled = !text.trim() || !threadId || sending;

  const handleBack = async () => {
    await markThreadRead();
    router.back();
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

  const renderReplyPreview = (msg: Msg) => {
    if (!msg.replyTo) return null;
    const name = getDisplayName(msg.replyTo.senderId);
    return (
      <View style={styles.replyPreview}>
        <View style={styles.replyBar} />
        <Text style={styles.replyTitle}>{name}</Text>
        <Text style={styles.replyText} numberOfLines={1}>{msg.replyTo.text}</Text>
      </View>
    );
  };

  // Hide username for matched partners
  useEffect(() => {
    if (!uid || !otherUid) { setHideUsernameForOther(false); return; }

    let cancelled = false;
    (async () => {
      try {
        const mSnap = await getDocs(
          query(collection(firestore, 'matches'), where('participants', 'array-contains', uid))
        );
        let matched = false;
        mSnap.forEach((d) => {
          const ps: string[] = (d.data() as any)?.participants || [];
          if (ps.includes(otherUid)) matched = true;
        });
        if (!cancelled) setHideUsernameForOther(matched);
      } catch {
        if (!cancelled) setHideUsernameForOther(false);
      }
    })();

    return () => { cancelled = true; };
  }, [uid, otherUid]);

  return (
    <>
      {/* Reactions details modal */}
      <Modal
        visible={!!reactionDetailsFor}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionDetailsFor(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reactions</Text>
            <View style={{ gap: 8, marginTop: 8 }}>
              {Object.entries(reactionDetailsFor?.reactions || {}).map(([userId, em]) => (
                <View key={userId} style={styles.modalRow}>
                  <Text style={styles.modalEmoji}>{em}</Text>
                  <Text style={styles.modalText}>{getDisplayName(userId)}</Text>
                </View>
              ))}
            </View>
            {reactionDetailsFor?.reactions?.[uid] ? (
              <TouchableOpacity
                onPress={() => removeMyReaction(reactionDetailsFor!)}
                style={[styles.modalBtn, removing && { opacity: 0.6 }]}
                disabled={removing}
              >
                <Text style={styles.modalBtnText}>{removing ? 'Removing…' : 'Remove my reaction'}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => setReactionDetailsFor(null)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Long-press modal */}
      <Modal
        visible={!!selectedForReaction}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedForReaction(null)}
      >
        <BlurView intensity={30} tint="dark" style={styles.reactionOverlay}>
          <TouchableOpacity style={styles.overlayTouchable} activeOpacity={1} onPress={() => setSelectedForReaction(null)} />

          {selectedForReaction && (
            <View style={styles.focusCard}>
              <Text style={styles.modalTimestamp}>
                {formatTimestamp(getMs(selectedForReaction), { includeDate: true, withSeconds: true })}
              </Text>

              <View style={styles.reactionBarModal}>
                {REACTION_SET.map((em) => (
                  <TouchableOpacity
                    key={em}
                    onPress={() => toggleReaction(selectedForReaction, em)}
                    style={styles.reactionBtnModal}
                  >
                    <Text style={{ fontSize: 26 }}>{em}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={[styles.bubble, selectedForReaction.senderId === uid ? styles.mine : styles.theirs]}>
                {renderReplyPreview(selectedForReaction)}
                <Text style={styles.text}>{selectedForReaction.text}</Text>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => startReply(selectedForReaction)}
                >
                  <Text style={styles.actionText}>Reply</Text>
                </TouchableOpacity>

                {selectedForReaction.senderId !== uid && (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#3a243a' }]}
                    onPress={async () => {
                      try {
                        await reportMessage(selectedForReaction);
                        setSelectedForReaction(null);
                        Alert.alert('Reported', 'The message has been reported.');
                      } catch (e) {
                        Alert.alert('Error', 'Could not report the message. Try again.');
                      }
                    }}
                  >
                    <Text style={[styles.actionText, { color: '#fbcfe8' }]}>Report</Text>
                  </TouchableOpacity>
                )}
                {selectedForReaction.senderId === uid && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionDanger]}
                    onPress={() => confirmDelete(selectedForReaction)}
                  >
                    <Text style={[styles.actionText, styles.actionDangerText]}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.overlayTouchable} activeOpacity={1} onPress={() => setSelectedForReaction(null)} />
        </BlurView>
      </Modal>

      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]} // ✅ safe top, no arbitrary 40
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? keyboardOffset : 0} // ✅ 0 offset
      >
        <View style={{ flex: 1 }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleBack} style={{ paddingHorizontal: 10, paddingVertical: 6, width: 100 }}>
              <Text style={{ color: '#4f8ef7', fontWeight: '700' }}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>{headerTitle}</Text>
            <View style={{ width: 60 }} />
          </View>

          {/* Messages (DESC data, inverted list) */}
          <FlatList
            ref={flatRef}
            data={displayRows}
            inverted
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            keyExtractor={(row) => row.type === 'separator' ? row.key : row.id}
            onScroll={({ nativeEvent }) => {
              if (nativeEvent.contentOffset.y <= 24 && hasMore && !loadingMore) loadOlder();
            }}
            onContentSizeChange={() => {
              // ensure latest is at bottom if we haven't scrolled yet
              if (!initialScrolledRef.current && messages.length) {
                flatRef.current?.scrollToIndex({ index: 0, animated: false });
                initialScrolledRef.current = true;
              }
            }}
            scrollEventThrottle={16}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12 }}
            ListFooterComponent={
              loadingMore ? (
                <View style={{ paddingVertical: 10 }}><ActivityIndicator /></View>
              ) : !hasMore ? (
                <View style={{ paddingVertical: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#666' }}>No older messages</Text>
                </View>
              ) : (
                <View style={{ height: 4 }} />
              )
            }
            renderItem={({ item }) => {
              if (item.type === 'separator') {
                return (
                  <View style={styles.timeSeparator}>
                    <Text style={styles.timeSeparatorText}>
                      {formatTimestamp(item.atMs, { includeDate: true })}
                    </Text>
                  </View>
                );
              }

              const mine = item.senderId === uid;
              const isHiddenForMe = !!item.reported?.hiddenFor?.[uid];

              return (
                <View style={styles.msgWrapper}>
                  <TouchableOpacity
                    activeOpacity={isHiddenForMe ? 1 : 0.8}
                    onLongPress={() => !isHiddenForMe && setSelectedForReaction(item)}
                    disabled={isHiddenForMe}
                    style={[styles.bubble, mine ? styles.mine : styles.theirs]}
                  >
                    {renderReplyPreview(item)}
                    {isHiddenForMe ? (
                      <Text style={[mine ? styles.myText : styles.theirText, { opacity: 0.7, fontStyle: 'italic' }]}>
                        This message was reported.
                      </Text>
                    ) : (
                      <Text style={mine ? styles.myText : styles.theirText}>
                        {item.text}
                      </Text>
                    )}
                  </TouchableOpacity>

                  {!isHiddenForMe && renderReactionsSummary(item, mine)}
                </View>
              );
            }}
          />

          {/* Composer banner for reply */}
          {replyingTo && (
            <View style={styles.banner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>Replying to {getDisplayName(replyingTo.senderId)}</Text>
                <Text style={styles.bannerText} numberOfLines={1}>{replyingTo.text}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setReplyingTo(null)}
                style={styles.bannerClose}
              >
                <Text style={{ color: '#9aa7b1', fontWeight: '700' }}>×</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Composer */}
          <View style={[styles.inputRow, { paddingBottom: Math.max(6, insets.bottom ? insets.bottom * 0.25 : 6), paddingTop: 6 }]}>
            <TouchableOpacity onPress={() => setPickerOpen((v) => !v)} style={styles.emojiToggle}>
              <Text style={{ fontSize: 20 }}>😊</Text>
            </TouchableOpacity>

            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={replyingTo ? 'Reply…' : 'Message…'}
              placeholderTextColor="#888"
              style={styles.input}
              multiline
              blurOnSubmit={false}
              returnKeyType="default"
              textAlignVertical="center"
              autoCapitalize="none"
            />

            <TouchableOpacity
              onPress={send}
              style={[styles.sendBtn, sendDisabled && { opacity: 0.5 }]}
              disabled={sendDisabled}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>
                {sending ? 'Sending…' : 'Send'}
              </Text>
            </TouchableOpacity>
          </View>

          {keyboardOpen && (
            <Pressable
              onPress={Keyboard.dismiss}
              style={styles.keyboardDismissOverlay}
              pointerEvents="auto"
            />
          )}

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
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' }, // paddingTop set dynamically
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    height: HEADER_H,
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

  // Timestamp separators
  timeSeparator: {
    alignSelf: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  timeSeparatorText: { color: '#bfbfbf', fontSize: 12, fontWeight: '600' },

  msgWrapper: {
    position: 'relative',
    marginBottom: 12,
    paddingTop: 8,
    overflow: 'visible',
  },

  keyboardDismissOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: HEADER_H,
    bottom: 56,
    backgroundColor: 'transparent',
    zIndex: 50,
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
  myText: { color: '#e0f2fe', fontSize: 16 },
  theirText: { color: '#f1f5f9', fontSize: 16 },

  reactionsBubble: {
    position: 'absolute',
    top: -10,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#1f2937',
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    zIndex: 30,
    elevation: 12,
  },
  reactionPillInline: {
    backgroundColor: 'transparent',
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 0,
  },
  reactionText: { color: '#fff' },

  replyPreview: {
    borderLeftWidth: 3,
    borderLeftColor: '#6b7280',
    paddingLeft: 8,
    marginBottom: 4,
  },
  replyBar: { width: 0, height: 0 },
  replyTitle: { color: '#c3dafe', fontSize: 12, marginBottom: 2 },
  replyText: { color: '#ccc', fontSize: 12 },

  // Composer
  inputRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    backgroundColor: '#111',
    alignItems: 'center',
    minHeight: 34,
    gap: 6,
    borderTopColor: '#222',
    paddingVertical: 4,
    borderTopWidth: 1,
  },
  emojiToggle: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222',
  },
  input: {
    flex: 1,
    height: 30,
    color: '#fff',
    backgroundColor: '#222',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  sendBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
    height: 30,
  },
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

  // Reply banner
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0b0b0b',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  bannerTitle: { color: '#c3dafe', fontWeight: '700' },
  bannerText: { color: '#aaa' },
  bannerClose: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center',
  },

  // Generic modal styles
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  modalCard: {
    width: '86%', backgroundColor: '#111', borderRadius: 14, padding: 16, borderColor: '#222',
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6,
    borderBottomColor: '#1f1f1f', borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalEmoji: { fontSize: 20 },
  modalText: { color: '#ddd', fontSize: 15 },
  modalBtn: {
    marginTop: 14, backgroundColor: '#30363d', borderRadius: 8, paddingVertical: 10, alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontWeight: '700' },
  modalClose: { marginTop: 10, alignItems: 'center' },
  modalCloseText: { color: '#9aa7b1' },

  reactionOverlay: {
    flex: 1, justifyContent: 'center', paddingHorizontal: 24,
  },
  overlayTouchable: { flex: 1 },
  focusCard: {
    alignSelf: 'stretch',
    backgroundColor: '#0d0d0d',
    borderColor: '#222',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
  },
  modalTimestamp: {
    alignSelf: 'center',
    color: '#9aa7b1',
    fontSize: 12,
    marginBottom: 8,
  },
  reactionBarModal: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#1f2937',
    borderRadius: 24,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
  },
  reactionBtnModal: { paddingHorizontal: 6, paddingVertical: 2 },

  actionRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    gap: 8,
  },
  actionBtn: {
    backgroundColor: '#1f2937',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    minWidth: 88,
    alignItems: 'center',
  },
  actionText: { color: '#e5e7eb', fontWeight: '700' },
  actionDanger: { backgroundColor: '#2b1c1c' },
  actionDangerText: { color: '#fca5a5' },
});
