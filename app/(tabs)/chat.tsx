import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
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
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { router } from 'expo-router';

type Thread = {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastSenderId?: string;
  updatedAt?: any; // Firestore Timestamp
};

type UserHit = {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

export default function ChatScreen() {
  // Auth-ready uid (don’t rely on auth.currentUser immediately)
  const [uid, setUid] = useState<string>('');

  // Inbox threads
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile cache for display names
  const [profiles, setProfiles] = useState<
    Record<string, { username?: string; firstName?: string; lastName?: string }>
  >({});

  // Search state
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserHit[]>([]);

  // Auth subscribe
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setUid(user?.uid ?? ''));
    return unsub;
  }, []);

  // Subscribe to my DM threads in real time
  useEffect(() => {
    if (!uid) return;
    // Query: all threads where I'm a participant, newest first
    const q = query(
      collection(firestore, 'dms'),
      where('participants', 'array-contains', uid),
      orderBy('updatedAtMs', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Thread[];
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

  // Fetch profiles for “other” participant(s) we don’t know yet
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

  const displayName = (pid: string) => {
    if (pid === uid) return 'You';
    const p = profiles[pid] || {};
    if (p.username) return `@${p.username}`;
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    return name || 'Unknown';
  };

  // -------- Username search (unchanged, debounced) --------
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
        const q = query(
          usersRef,
          where('username', '>=', term),
          where('username', '<=', term + '\uf8ff')
        );
        const snap = await getDocs(q);
        const hits: UserHit[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
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
  }, [search]);
  // --------------------------------------------------------

  // Render a single thread row (other user’s name + last message)
  const renderThread = ({ item }: { item: Thread }) => {
    const otherId = (item.participants || []).find((p) => p !== uid) || '';
    const lastText = item.lastMessage || '—';
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => router.push(`/dm/${otherId}`)}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {displayName(otherId).replace(/^@/, '').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>
            {displayName(otherId)}
          </Text>
          <Text style={styles.lastText} numberOfLines={1}>
            {lastText}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  // Render a user search hit
  const renderUser = ({ item }: { item: UserHit }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => router.push(`/dm/${item.id}`)}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(item.username?.[0] || item.firstName?.[0] || '?').toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.name} numberOfLines={1}>
          {item.username ? `@${item.username}` : 'Unknown'}
        </Text>
        <Text style={styles.lastText} numberOfLines={1}>
          {[item.firstName, item.lastName].filter(Boolean).join(' ') || '—'}
        </Text>
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
    <View style={styles.container}>
      {/* Search bar with @ prefix */}
      <View style={styles.searchRow}>
        <Text style={styles.atSymbol}>@</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search username"
          placeholderTextColor="#888"
          value={search}
          onChangeText={(v) => setSearch(v.replace(/\s/g, ''))}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {/* Results / Threads */}
      {showSearchResults ? (
        searching ? (
          <View style={styles.center}><ActivityIndicator /></View>
        ) : results.length === 0 ? (
          <View style={styles.center}><Text style={{ color: '#888' }}>No users found.</Text></View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(i) => i.id}
            renderItem={renderUser}
            contentContainerStyle={{ paddingHorizontal: 12 }}
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
          contentContainerStyle={{ paddingHorizontal: 12 }}
        />
      )}
    </View>
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
  name: { color: '#fff', fontSize: 16, fontWeight: '700' },
  lastText: { color: '#bbb', marginTop: 2 },
});
