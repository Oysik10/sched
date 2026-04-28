// app/(tabs)/chat.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { auth, firestore } from '../../src/firebaseConfig';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  doc,
  getDoc,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  writeBatch,
  limit as fsLimit,
  setDoc,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { router } from 'expo-router';

type Thread = {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastSenderId?: string;
  updatedAt?: any;
  updatedAtMs?: number;
  lastSeen?: Record<string, number>;
  lastActivity?: {
    type: 'message' | 'reaction' | 'report';
    actorId: string;
    emoji?: string;
    text?: string;
    atMs?: number;
  };
  lastMessageAtMs?: number;
};

// ---------- Anonymous Match Top Section helpers ----------

function todayKeyUTC() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function msLeft(expiresAt: any) {
  if (!expiresAt || typeof expiresAt.toMillis !== 'function') return 0;
  return expiresAt.toMillis() - Date.now();
}

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

// Check if both users finished today's questions
async function bothCompletedToday(uidA: string, uidB: string) {
  const aRef = doc(firestore, 'users', uidA);
  const bRef = doc(firestore, 'users', uidB);
  const [aSnap, bSnap] = await Promise.all([getDoc(aRef), getDoc(bRef)]);
  const aDone = aSnap.exists() && (aSnap.data()?.ephemeralQA?.completedOn === todayKeyUTC());
  const bDone = bSnap.exists() && (bSnap.data()?.ephemeralQA?.completedOn === todayKeyUTC());
  return [aDone, bDone] as const;
}

function EphemeralMatchTopSection({ uid }: { uid: string }) {
  const [loading, setLoading] = useState(true);
  const [hasActiveMatch, setHasActiveMatch] = useState(false);
  const [partnerUid, setPartnerUid] = useState<string>('');
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // 1) Find active unexpired match
        const mQ = query(
          collection(firestore, 'matches'),
          where('participants', 'array-contains', uid),
          where('active', '==', true)
        );
        const mSnap = await getDocs(mQ);

        let active = false;
        let other = '';
        mSnap.forEach((d) => {
          const data: any = d.data();
          if (msLeft(data.expiresAt) > 0 && data.active === true) {
            active = true;
            other = (data.participants || []).find((p: string) => p !== uid) || '';
          }
        });

        if (!cancelled) {
          setHasActiveMatch(active);
          setPartnerUid(other);
        }

        // 2) Check if questions done today
        const uRef = doc(firestore, 'users', uid);
        const uSnap = await getDoc(uRef);
        const completedOn = uSnap.exists()
          ? (uSnap.data()?.ephemeralQA?.completedOn as string | undefined)
          : undefined;

        if (!cancelled) {
          setAlreadyAnswered(completedOn === todayKeyUTC());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Gate the golden tile so it won't open DM unless both are done
  const onPressTile = async () => {
    if (!uid) return;

    // No active match → go start/continue questions
    if (!hasActiveMatch || !partnerUid) {
      router.push('/match/questions');
      return;
    }

    // Active match → allow only if both finished today
    try {
      const [meDone, partnerDone] = await bothCompletedToday(uid, partnerUid);
      if (!meDone) {
        Alert.alert(
          "Answer today’s quick questions",
          "You need to finish today’s questions to access the anonymous chat.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Answer now", onPress: () => router.push('/match/questions') }
          ]
        );
        return;
      }
      if (!partnerDone) {
        Alert.alert(
          "Almost there",
          "Your partner hasn’t finished today’s questions yet. The chat will appear once they’re done."
        );
        return;
      }

      // Both done → ensure thread exists then go to DM
      try {
        const tid = threadIdFor(uid, partnerUid);
        await setDoc(doc(firestore, 'dms', tid), { participants: [uid, partnerUid].sort() }, { merge: true });
      } catch {}
      router.push(`/dm/${partnerUid}`);
    } catch {
      Alert.alert("Error", "Could not verify question status. Please try again.");
    }
  };

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPressTile}
        disabled={loading}
        style={{
          backgroundColor: '#CFAF45', // golden
          borderRadius: 12,
          padding: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: '#d9c06a',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: '#111', fontSize: 16, fontWeight: '800' }}>
              Anonymous Match
            </Text>
            {loading ? (
              <Text style={{ color: '#222', marginTop: 2 }}>Checking status…</Text>
            ) : hasActiveMatch && partnerUid ? (
              <Text style={{ color: '#222', marginTop: 2 }}>Tap to open your chat</Text>
            ) : alreadyAnswered ? (
              <Text style={{ color: '#222', marginTop: 2 }}>Questions done — tap to proceed</Text>
            ) : (
              <Text style={{ color: '#222', marginTop: 2 }}>Tap to answer quick questions & start</Text>
            )}
          </View>
          <View
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: '#111',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '800' }}>
              {loading ? '…' : hasActiveMatch && partnerUid ? 'Open' : 'Start'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// ---------- Main Chat Screen (ONLY anonymous matches) ----------

export default function ChatScreen() {
  const [uid, setUid] = useState<string>('');

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  const [profiles, setProfiles] = useState<
    Record<string, { username?: string; firstName?: string; lastName?: string }>
  >({});

  // All userIds you've ever been matched with (active or past)
  const [matchedPartnerIds, setMatchedPartnerIds] = useState<Set<string>>(new Set());

  // Auth subscribe
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setUid(user?.uid ?? ''));
    return unsub;
  }, []);

  // Subscribe to my DM threads (order by activity time)
  useEffect(() => {
    if (!uid) return;
    const qy = query(
      collection(firestore, 'dms'),
      where('participants', 'array-contains', uid),
      orderBy('lastMessageAtMs', 'desc')
    );
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Thread[];
        list.sort(
          (a, b) =>
            (b.lastMessageAtMs ?? b.updatedAtMs ?? 0) -
            (a.lastMessageAtMs ?? a.updatedAtMs ?? 0)
        );
        setThreads(list);
        setLoading(false);
      },
      (e) => {
        console.warn('Inbox stream error:', e);
        setLoading(false);
      }
    );
    return unsub;
  }, [uid]);

  // Fetch profiles for “other” participant(s) (still needed for display fallback)
  useEffect(() => {
    if (!uid || threads.length === 0) return;
    const needed = new Set<string>();
    for (const t of threads) {
      for (const p of t.participants || []) {
        if (p !== uid && !(p in profiles)) needed.add(p);
      }
    }
    if (needed.size === 0) return;

    let cancelled = false;
    (async () => {
      const found: Record<string, any> = {};
      await Promise.all(
        Array.from(needed).map(async (pid) => {
          try {
            const uref = doc(firestore, 'users', pid);
            const snap = await getDoc(uref);
            found[pid] = snap.exists() ? snap.data() : {};
          } catch {
            found[pid] = {};
          }
        })
      );
      if (!cancelled) setProfiles((prev) => ({ ...prev, ...found }));
    })();

    return () => {
      cancelled = true;
    };
  }, [threads, uid, profiles]);

  // Collect every partner ever matched with me (via matches collection)
  useEffect(() => {
    if (!uid) {
      setMatchedPartnerIds(new Set());
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const mSnap = await getDocs(
          query(collection(firestore, 'matches'), where('participants', 'array-contains', uid))
        );
        const setIds = new Set<string>();
        mSnap.forEach((d) => {
          const ps: string[] = (d.data() as any)?.participants || [];
          const other = ps.find((p) => p !== uid);
          if (other) setIds.add(other);
        });
        if (!cancelled) setMatchedPartnerIds(setIds);
      } catch {
        if (!cancelled) setMatchedPartnerIds(new Set());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  const displayName = (pid: string) => {
    if (pid === uid) return 'You';
    // ✅ If this is a matched partner, show Anonymous Match label only
    if (matchedPartnerIds.has(pid)) return 'Anonymous Match';

    // Fallback (should not be used if you only render matched threads)
    const p = profiles[pid] || {};
    if (p.username) return `@${p.username}`;
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    return name || 'Unknown';
  };

  const formatTimestamp = (ms?: number) => {
    if (!ms) return '';
    try {
      const d = new Date(ms);
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const deleteConversation = async (threadId: string) => {
    try {
      const itemsRef = collection(firestore, 'dms', threadId, 'items');
      while (true) {
        const pageSnap = await getDocs(query(itemsRef, fsLimit(500)));
        if (pageSnap.empty) break;
        const batch = writeBatch(firestore);
        pageSnap.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(doc(firestore, 'dms', threadId));
    } catch (e) {
      console.warn('Failed to delete conversation:', e);
      throw e;
    }
  };

  const openThreadOptions = (thread: Thread, otherId: string) => {
    const onDelete = () => {
      Alert.alert(
        'Delete conversation',
        `This will permanently delete your conversation with ${displayName(otherId)} for you. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteConversation(thread.id);
              } catch {
                Alert.alert('Error', 'Could not delete conversation. Please try again.');
              }
            },
          },
        ]
      );
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Delete Conversation'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 0,
          title: displayName(otherId),
        },
        (index) => {
          if (index === 1) onDelete();
        }
      );
    } else {
      Alert.alert(displayName(otherId), '', [
        { text: 'Delete Conversation', style: 'destructive', onPress: onDelete },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const renderThread = ({ item }: { item: Thread }) => {
    const otherId = (item.participants || []).find((p) => p !== uid) || '';

    const makePreview = () => {
      const act = item.lastActivity;
      if (act?.type === 'report') {
        return 'A message was reported';
      }
      if (act?.type === 'reaction') {
        const actor = displayName(act.actorId);
        const em = act.emoji || '❤️';
        const snippet = (act.text || '').trim();
        const short = snippet.length > 50 ? snippet.slice(0, 50) + '…' : snippet;
        return `${actor} reacted ${em} to ${short ? `"${short}"` : 'this message'}`;
      }
      return item.lastMessage || '—';
    };

    const lastMsgMs = item.lastMessageAtMs ?? item.updatedAtMs ?? 0;
    const lastText = makePreview();
    const lastSeenMine = item.lastSeen?.[uid] ?? 0;
    const unread = item.lastSenderId !== uid && lastMsgMs > lastSeenMine;

    const handleOpenThread = async () => {
      if (!otherId) return;

      // ✅ This thread is already guaranteed to be a matched partner (see visibleThreads),
      // but we still gate by daily questions:
      try {
        const [meDone, partnerDone] = await bothCompletedToday(uid, otherId);
        if (!meDone) {
          Alert.alert(
            "Answer today’s quick questions",
            "You need to finish today’s questions to access the anonymous chat.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Answer now", onPress: () => router.push('/match/questions') }
            ]
          );
          return;
        }
        if (!partnerDone) {
          Alert.alert(
            "Almost there",
            "Your partner hasn’t finished today’s questions yet. The chat will unlock once they’re done."
          );
          return;
        }
      } catch {
        Alert.alert("Error", "Could not verify question status. Please try again.");
        return;
      }

      const now = Date.now();

      // 1) Optimistically mark read locally
      setThreads((prev) =>
        prev.map((t) =>
          t.id === item.id
            ? { ...t, lastSeen: { ...(t.lastSeen || {}), [uid]: now } }
            : t
        )
      );

      // 2) Persist read state
      try {
        await updateDoc(doc(firestore, 'dms', item.id), { [`lastSeen.${uid}`]: now });
      } catch (err) {
        console.warn('Error marking thread as read:', err);
      }

      // 3) Navigate to the DM
      router.push(`/dm/${otherId}`);
    };

    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={handleOpenThread}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {/* Always show 'A' for Anonymous Match */}
            {'A'}
          </Text>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.topLine}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
              <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
                Anonymous Match
              </Text>
              {unread && <View style={styles.unreadDot} />}
            </View>
            <TouchableOpacity
              onPress={() => openThreadOptions(item, otherId)}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Text style={styles.more}>⋯</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bottomLine}>
            <Text style={[styles.lastText, unread && styles.lastTextUnread]} numberOfLines={1}>
              {lastText}
            </Text>
            <Text style={styles.time} numberOfLines={1}>
              {formatTimestamp(lastMsgMs)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (!uid || loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  // ✅ Only show threads whose "other participant" is a matched partner
  const visibleThreads = threads.filter((t) => {
    const other = (t.participants || []).find((p) => p !== uid);
    return !!other && matchedPartnerIds.has(other);
  });

  return (
    <View style={styles.container}>
      {/* Anonymous match tile at top */}
      <EphemeralMatchTopSection uid={uid} />

      {/* No search bar, no username search, no friend DMing */}

      {visibleThreads.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: '#888' }}>No anonymous chats yet.</Text>
        </View>
      ) : (
        <FlatList
          data={visibleThreads}
          keyExtractor={(t) => t.id}
          renderItem={renderThread}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, paddingTop: 12 }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderColor: '#222',
    borderWidth: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: { color: '#e5e7eb', fontWeight: '700', fontSize: 14 },

  name: { color: '#fff', fontSize: 16, fontWeight: '700' },
  lastText: { color: '#bbb', marginTop: 2, flexShrink: 1 },
  time: { color: '#7c7c7c', marginTop: 2, marginLeft: 10, fontSize: 12 },

  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  bottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: 0,
  },

  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
    marginLeft: 6,
  },
  nameUnread: {
    color: '#ffffff',
    fontWeight: '800',
  },
  lastTextUnread: {
    color: '#dbeafe',
  },

  more: {
    color: '#aaa',
    fontSize: 18,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
