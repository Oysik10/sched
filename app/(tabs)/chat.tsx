// app/(tabs)/chat.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
  ActionSheetIOS,
  Keyboard,
  Pressable,
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
  setDoc, // ✅ keep a single import here
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { router, useFocusEffect } from 'expo-router';

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

type UserHit = {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

// ---- Anonymous Match Top Section (golden tile → go to DM) ----

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function msLeft(expiresAt: any) {
  if (!expiresAt || typeof expiresAt.toMillis !== 'function') return 0;
  return expiresAt.toMillis() - Date.now();
}

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

// ✅ Helper: check if both users finished today's questions
async function bothCompletedToday(uidA: string, uidB: string) {
  const aRef = doc(firestore, 'users', uidA);
  const bRef = doc(firestore, 'users', uidB);
  const [aSnap, bSnap] = await Promise.all([getDoc(aRef), getDoc(bRef)]);
  const aDone = aSnap.exists() && (aSnap.data()?.ephemeralQA?.completedOn === todayKey());
  const bDone = bSnap.exists() && (bSnap.data()?.ephemeralQA?.completedOn === todayKey());
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
          setAlreadyAnswered(completedOn === todayKey());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

// ⛔ Gate the golden tile so it won't open DM unless both are done
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
      Alert.alert("Almost there", "Your partner hasn’t finished today’s questions yet. The chat will appear once they’re done.");
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

export default function ChatScreen() {
  const [uid, setUid] = useState<string>('');

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  const [profiles, setProfiles] = useState<
    Record<string, { username?: string; firstName?: string; lastName?: string }>
  >({});

  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserHit[]>([]);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [matchedPartnerIds, setMatchedPartnerIds] = useState<Set<string>>(new Set()); // ✅ stays here

  // Ref for the search input so we can blur it on screen focus
  const searchRef = useRef<TextInput>(null);

  // Always start with the search bar blurred when this screen becomes active
  useFocusEffect(
    useCallback(() => {
      const id = setTimeout(() => searchRef.current?.blur(), 0);
      return () => clearTimeout(id);
    }, [])
  );

  // Followers/following to compute mutuals
  useEffect(() => {
    if (!uid) return;

    const followersRef = collection(firestore, 'users', uid, 'followers');
    const followingRef = collection(firestore, 'users', uid, 'following');

    let followers = new Set<string>();
    let following = new Set<string>();

    const recompute = () => {
      const mutuals = new Set<string>();
      followers.forEach((id) => {
        if (following.has(id)) mutuals.add(id);
      });
      setFriendIds(mutuals);
    };

    const unsubFollowers = onSnapshot(followersRef, (snap) => {
      followers = new Set(snap.docs.map((d) => d.id));
      recompute();
    });

    const unsubFollowing = onSnapshot(followingRef, (snap) => {
      following = new Set(snap.docs.map((d) => d.id));
      recompute();
    });

    return () => {
      unsubFollowers();
      unsubFollowing();
    };
  }, [uid]);

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

  // Fetch profiles for “other” participant(s)
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

  // ✅ TOP-LEVEL: collect every partner ever matched with me (active or past)
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
    // Inbox-only rule: if this is a matched partner, show Anonymous Match
    if (matchedPartnerIds.has(pid)) return 'Anonymous Match';

    const p = profiles[pid] || {};
    if (p.username) return `@${p.username}`;
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    return name || 'Unknown';
  };

  // Username search (debounced; ALWAYS exclude self and non-mutuals)
  useEffect(() => {
    const term = search.trim().replace(/^@/, '').toLowerCase();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const usersRef = collection(firestore, 'users');
        const qy = query(
          usersRef,
          where('username', '>=', term),
          where('username', '<=', term + '\uf8ff')
        );
        const snap = await getDocs(qy);
        const hits: UserHit[] = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((u) => u.id !== uid)
          .filter((u) => friendIds.has(u.id));
        if (!cancelled) setResults(hits);
      } catch (e) {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, uid, friendIds]);

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
      const otherId = (item.participants || []).find((p) => p !== uid) || '';
      if (!otherId) return;

      // If this is an Anonymous Match thread, block unless both finished today
      if (matchedPartnerIds.has(otherId)) {
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
            Alert.alert("Almost there", "Your partner hasn’t finished today’s questions yet. The chat will unlock once they’re done.");
            return;
          }
          // else: both done → continue to open the thread
        } catch {
          Alert.alert("Error", "Could not verify question status. Please try again.");
          return;
        }
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
            {matchedPartnerIds.has(otherId)
              ? 'A'
              : displayName(otherId).replace(/^@/, '').slice(0, 1).toUpperCase()}
          </Text>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.topLine}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
              <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
                {displayName(otherId)}
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

  const renderUser = ({ item }: { item: UserHit }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => {
        Keyboard.dismiss();
        router.push(`/dm/${item.id}`);
      }}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(item.username?.[0] || item.firstName?.[0] || '?').toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.topLine}>
          <Text style={styles.name} numberOfLines={1}>
            {item.username ? `@${item.username}` : 'Unknown'}
          </Text>
          <Text style={styles.time} />
        </View>
        <View style={styles.bottomLine}>
          <Text style={styles.lastText} numberOfLines={1}>
            {[item.firstName, item.lastName].filter(Boolean).join(' ') || '—'}
          </Text>
          <Text style={styles.time} />
        </View>
      </View>
    </TouchableOpacity>
  );

  if (!uid || loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  const showSearchResults = search.trim().length > 0;

  return (
    <Pressable style={styles.container} onPress={Keyboard.dismiss}>
      {/* Anonymous match lives at the very top (golden) */}
      <EphemeralMatchTopSection uid={uid} />

      {/* Search bar with @ prefix */}
      <View style={styles.searchRow}>
        <Text style={styles.atSymbol}>@</Text>
        <TextInput
          ref={searchRef}
          style={[styles.searchInput, { paddingRight: 24 }]}
          placeholder="Search username"
          placeholderTextColor="#888"
          value={search}
          onChangeText={(v) => setSearch(v.replace(/\s/g, '').toLowerCase())}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          blurOnSubmit
          onSubmitEditing={Keyboard.dismiss}
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              setSearch('');
              router.replace('/chat');
            }}
            style={{ position: 'absolute', right: 12, padding: 4 }}
          >
            <Text style={{ color: '#888', fontSize: 16 }}>×</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Results / Threads */}
      {showSearchResults ? (
        searching ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : results.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ color: '#888' }}>No users found.</Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(i) => i.id}
            renderItem={renderUser}
            contentContainerStyle={{ paddingHorizontal: 12 }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          />
        )
      ) : threads.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: '#888' }}>No messages yet.</Text>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.id}
          renderItem={renderThread}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 10,
    borderColor: '#222',
    borderWidth: 1,
    margin: 12,
    height: 44,
    paddingHorizontal: 12,
  },
  atSymbol: { color: '#888', fontSize: 16, marginRight: 6 },
  searchInput: { flex: 1, color: '#fff', fontSize: 16 },

  // list rows
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

  // text
  name: { color: '#fff', fontSize: 16, fontWeight: '700' },
  lastText: { color: '#bbb', marginTop: 2, flexShrink: 1 },
  time: { color: '#7c7c7c', marginTop: 2, marginLeft: 10, fontSize: 12 },

  // layout lines
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

  // unread styling
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

  // options button
  more: {
    color: '#aaa',
    fontSize: 18,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
