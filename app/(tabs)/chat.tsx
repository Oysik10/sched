// app/(tabs)/chat.tsx
import React, { useEffect, useState, useRef } from 'react';
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
  TextInput,
  Keyboard,
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
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { router } from 'expo-router';
import { MatchTopSection } from '../../src/components/MatchTopSection';

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

type FriendProfile = {
  uid: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

export default function ChatScreen() {
  const [uid, setUid] = useState<string>('');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  const [profiles, setProfiles] = useState<
    Record<string, { username?: string; firstName?: string; lastName?: string }>
  >({});

  const [matchedPartnerIds, setMatchedPartnerIds] = useState<Set<string>>(new Set());

  // Friend search
  const [friendSearch, setFriendSearch] = useState('');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [, setLoadingFriends] = useState(false);
  const searchRef = useRef<TextInput>(null);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setUid(user?.uid ?? ''));
    return unsub;
  }, []);

  // Subscribe to DM threads
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
      () => setLoading(false)
    );
    return unsub;
  }, [uid]);

  // Fetch profiles for thread participants
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
            const snap = await getDoc(doc(firestore, 'users', pid));
            found[pid] = snap.exists() ? snap.data() : {};
          } catch {
            found[pid] = {};
          }
        })
      );
      if (!cancelled) setProfiles((prev) => ({ ...prev, ...found }));
    })();
    return () => { cancelled = true; };
  }, [threads, uid]);

  // Collect matched partner IDs
  useEffect(() => {
    if (!uid) { setMatchedPartnerIds(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const mSnap = await getDocs(
          query(collection(firestore, 'matches'), where('participants', 'array-contains', uid))
        );
        const ids = new Set<string>();
        mSnap.forEach((d) => {
          const ps: string[] = (d.data() as any)?.participants || [];
          const other = ps.find((p) => p !== uid);
          if (other) ids.add(other);
        });
        if (!cancelled) setMatchedPartnerIds(ids);
      } catch {
        if (!cancelled) setMatchedPartnerIds(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  // Load friends (mutual follows) on mount
  useEffect(() => {
    if (!uid) { setFriends([]); return; }
    let cancelled = false;
    setLoadingFriends(true);
    (async () => {
      try {
        const [followingSnap, followersSnap] = await Promise.all([
          getDocs(collection(firestore, 'users', uid, 'following')),
          getDocs(collection(firestore, 'users', uid, 'followers')),
        ]);
        const followingIds = new Set(followingSnap.docs.map((d) => d.id));
        const followerIds = new Set(followersSnap.docs.map((d) => d.id));
        const friendIds = [...followingIds].filter((id) => followerIds.has(id));

        const profiles: FriendProfile[] = await Promise.all(
          friendIds.map(async (fid) => {
            try {
              const snap = await getDoc(doc(firestore, 'users', fid));
              const data = snap.exists() ? (snap.data() as any) : {};
              return { uid: fid, username: data.username, firstName: data.firstName, lastName: data.lastName };
            } catch {
              return { uid: fid };
            }
          })
        );

        if (!cancelled) setFriends(profiles);
      } catch {
        if (!cancelled) setFriends([]);
      } finally {
        if (!cancelled) setLoadingFriends(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const displayName = (pid: string) => {
    if (pid === uid) return 'You';
    if (matchedPartnerIds.has(pid)) return 'Anonymous Match';
    const p = profiles[pid] || {};
    if (p.username) return `@${p.username}`;
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    return name || 'Unknown';
  };

  const formatTimestamp = (ms?: number) => {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch { return ''; }
  };

  const deleteConversation = async (threadId: string) => {
    const itemsRef = collection(firestore, 'dms', threadId, 'items');
    while (true) {
      const pageSnap = await getDocs(query(itemsRef, fsLimit(500)));
      if (pageSnap.empty) break;
      const batch = writeBatch(firestore);
      pageSnap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(firestore, 'dms', threadId));
  };

  const openThreadOptions = (thread: Thread, otherId: string) => {
    const onDelete = () => {
      Alert.alert(
        'Delete conversation',
        `Permanently delete this conversation?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try { await deleteConversation(thread.id); } catch {
                Alert.alert('Error', 'Could not delete conversation.');
              }
            },
          },
        ]
      );
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Delete Conversation'], destructiveButtonIndex: 1, cancelButtonIndex: 0, title: displayName(otherId) },
        (index) => { if (index === 1) onDelete(); }
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
      if (act?.type === 'report') return 'A message was reported';
      if (act?.type === 'reaction') {
        const actor = displayName(act.actorId);
        const short = (act.text || '').slice(0, 50);
        return `${actor} reacted ${act.emoji || '❤️'} to ${short ? `"${short}"` : 'this message'}`;
      }
      return item.lastMessage || '—';
    };

    const lastMsgMs = item.lastMessageAtMs ?? item.updatedAtMs ?? 0;
    const lastSeenMine = item.lastSeen?.[uid] ?? 0;
    const unread = item.lastSenderId !== uid && lastMsgMs > lastSeenMine;

    const handleOpenThread = async () => {
      if (!otherId) return;
      const now = Date.now();
      setThreads((prev) =>
        prev.map((t) =>
          t.id === item.id ? { ...t, lastSeen: { ...(t.lastSeen || {}), [uid]: now } } : t
        )
      );
      try {
        await updateDoc(doc(firestore, 'dms', item.id), { [`lastSeen.${uid}`]: now });
      } catch {}
      router.push(`/dm/${otherId}`);
    };

    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={handleOpenThread}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>A</Text>
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
              {makePreview()}
            </Text>
            <Text style={styles.time} numberOfLines={1}>{formatTimestamp(lastMsgMs)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // --- Friend search ---
  const filteredFriends = friendSearch.trim()
    ? friends.filter((f) => {
        const q = friendSearch.trim().toLowerCase();
        return (
          f.username?.toLowerCase().includes(q) ||
          f.firstName?.toLowerCase().includes(q) ||
          f.lastName?.toLowerCase().includes(q)
        );
      })
    : [];

  const friendDisplayName = (f: FriendProfile) => {
    const name = [f.firstName, f.lastName].filter(Boolean).join(' ');
    return name || f.uid.slice(0, 6) + '…';
  };

  const renderFriendResult = ({ item }: { item: FriendProfile }) => (
    <TouchableOpacity
      style={styles.friendResult}
      activeOpacity={0.75}
      onPress={() => {
        Keyboard.dismiss();
        setFriendSearch('');
        router.push(`/dm/${item.uid}`);
      }}
    >
      <View style={styles.friendAvatar}>
        <Text style={styles.friendAvatarText}>
          {(item.firstName?.[0] || item.username?.[0] || '?').toUpperCase()}
        </Text>
      </View>
      <View>
        <Text style={styles.friendName}>{friendDisplayName(item)}</Text>
        {item.username ? <Text style={styles.friendUsername}>@{item.username}</Text> : null}
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

  const visibleThreads = threads.filter((t) => {
    const other = (t.participants || []).find((p) => p !== uid);
    return !!other && matchedPartnerIds.has(other);
  });

  const showFriendResults = friendSearch.trim().length > 0;

  return (
    <View style={styles.container}>
      <MatchTopSection />

      {/* Friend search bar */}
      <View style={styles.searchWrap}>
        <TextInput
          ref={searchRef}
          style={styles.searchInput}
          placeholder="Search friends to message…"
          placeholderTextColor="#555"
          value={friendSearch}
          onChangeText={setFriendSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {friendSearch.length > 0 && (
          <TouchableOpacity onPress={() => setFriendSearch('')} style={styles.clearBtn}>
            <Text style={styles.clearText}>×</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Friend search results */}
      {showFriendResults ? (
        <View style={{ flex: 1 }}>
          {filteredFriends.length === 0 ? (
            <View style={[styles.center, { paddingTop: 24 }]}>
              <Text style={{ color: '#555' }}>No friends matching "{friendSearch}"</Text>
            </View>
          ) : (
            <FlatList
              data={filteredFriends}
              keyExtractor={(f) => f.uid}
              renderItem={renderFriendResult}
              contentContainerStyle={{ padding: 12 }}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      ) : (
        /* Anonymous match thread list */
        visibleThreads.length === 0 ? (
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
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Friend search bar
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222',
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 14 },
  clearBtn: { paddingLeft: 8, paddingVertical: 4 },
  clearText: { color: '#555', fontSize: 18 },

  // Friend result row
  friendResult: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    gap: 10,
  },
  friendAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarText: { color: '#e5e7eb', fontWeight: '700', fontSize: 15 },
  friendName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  friendUsername: { color: '#666', fontSize: 13, marginTop: 1 },

  // Thread row
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
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  avatarText: { color: '#e5e7eb', fontWeight: '700', fontSize: 14 },
  name: { color: '#fff', fontSize: 16, fontWeight: '700' },
  lastText: { color: '#bbb', marginTop: 2, flexShrink: 1 },
  time: { color: '#7c7c7c', marginTop: 2, marginLeft: 10, fontSize: 12 },
  topLine: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  bottomLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minWidth: 0 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3b82f6', marginLeft: 6 },
  nameUnread: { color: '#ffffff', fontWeight: '800' },
  lastTextUnread: { color: '#dbeafe' },
  more: { color: '#aaa', fontSize: 18, paddingHorizontal: 6, paddingVertical: 2 },
});
