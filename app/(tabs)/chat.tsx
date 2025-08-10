// app/(tabs)/chat.tsx
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
import { router } from 'expo-router';

const CHAT_ID = 'global';

type Msg = {
  id: string;
  text: string;
  senderId: string;
  timestamp?: any; // Firestore Timestamp
};

type SenderPreview = {
  senderId: string;
  lastText: string;
  lastAt?: number; // millis
};

type UserHit = {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

export default function ChatScreen() {
  const me = auth.currentUser?.uid ?? null;

  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<
    Record<string, { username?: string; firstName?: string; lastName?: string }>
  >({});

  // search state
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserHit[]>([]);

  // Subscribe to all messages in the room
  useEffect(() => {
    const q = query(collection(firestore, 'messages', CHAT_ID, 'items'), orderBy('timestamp', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Msg[];
        setMessages(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  // Compute the latest message per sender
  const previews: SenderPreview[] = useMemo(() => {
    const map = new Map<string, SenderPreview>();
    for (const m of messages) {
      const t = m.timestamp?.toMillis ? m.timestamp.toMillis() : 0;
      const prev = map.get(m.senderId);
      if (!prev || t >= (prev.lastAt ?? -1)) {
        map.set(m.senderId, { senderId: m.senderId, lastText: m.text, lastAt: t });
      }
    }
    return Array.from(map.values()).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
  }, [messages]);

  // Fetch profiles for any sender we don't know yet
  useEffect(() => {
    const unknown = previews.map((p) => p.senderId).filter((id) => !(id in profiles));
    if (unknown.length === 0) return;

    let cancelled = false;
    (async () => {
      const found: Record<string, any> = {};
      await Promise.all(
        unknown.map(async (uid) => {
          try {
            const uref = doc(firestore, 'users', uid);
            const snap = await getDoc(uref);
            found[uid] = snap.exists() ? snap.data() : {};
          } catch {
            found[uid] = {};
          }
        })
      );
      if (!cancelled) setProfiles((prev) => ({ ...prev, ...found }));
    })();

    return () => {
      cancelled = true;
    };
  }, [previews, profiles]);

  const displayName = (uid: string) => {
    if (uid === me) return 'You';
    const p = profiles[uid] || {};
    if (p.username) return `@${p.username}`;
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    return name || 'Unknown';
  };

  // ---- Search users by @username (debounced) ----
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
        // username prefix query
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
  // -----------------------------------------------

  const renderPreview = ({ item }: { item: SenderPreview }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => router.push(`/dm/${item.senderId}`)}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {displayName(item.senderId).replace(/^@/, '').slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.name} numberOfLines={1}>
          {displayName(item.senderId)}
        </Text>
        <Text style={styles.lastText} numberOfLines={1}>
          {item.lastText}
        </Text>
      </View>
    </TouchableOpacity>
  );

    const renderUser = ({ item }: { item: UserHit }) => (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => router.push(`/dm/${item.id}`)}  // ✅ use id
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

  if (loading) {
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

      {/* Results / Previews */}
      {showSearchResults ? (
        searching ? (
          <View style={styles.center}><ActivityIndicator /></View>
        ) : results.length === 0 ? (
          <View style={styles.center}><Text style={{ color: '#888' }}>No users found.</Text></View>
        ) : (
        <FlatList<UserHit>
          data={results}
          keyExtractor={(i) => i.id}           // ✅ id for user hits
          renderItem={renderUser}
        />
        )
      ) : previews.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: '#888' }}>No messages yet.</Text>
        </View>
      ) : (
      <FlatList<SenderPreview>
        data={previews}
        keyExtractor={(i) => i.senderId}     // ✅ senderId for previews
        renderItem={renderPreview}
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
