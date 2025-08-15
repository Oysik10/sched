// app/settings/blocked.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity, Alert } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../../src/firebaseConfig';
import { collection, getDocs, doc, getDoc, deleteDoc } from 'firebase/firestore';
import { useRouter } from 'expo-router';

type BlockedHit = {
  id: string;            // blocked userId (document id)
  username?: string;
  firstName?: string;
  lastName?: string;
};

export default function BlockedUsersScreen() {
  const router = useRouter();
  const [uid, setUid] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<BlockedHit[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setUid(user?.uid ?? ''));
    return unsub;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!uid) return;
      setLoading(true);
      try {
        const snap = await getDocs(collection(firestore, 'users', uid, 'blocked'));
        const ids = snap.docs.map(d => d.id);

        const profiles: BlockedHit[] = [];
        await Promise.all(ids.map(async (bid) => {
          try {
            const ps = await getDoc(doc(firestore, 'users', bid));
            const p = ps.exists() ? (ps.data() as any) : {};
            profiles.push({
              id: bid,
              username: p.username,
              firstName: p.firstName,
              lastName: p.lastName,
            });
          } catch {
            profiles.push({ id: bid });
          }
        }));

        if (!cancelled) setBlocked(profiles);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [uid]);

  const displayName = useCallback((u: BlockedHit) => {
    if (u.username) return `@${u.username}`;
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
    return name || (u.id.slice(0, 6) + '…');
  }, []);

  const onUnblock = (targetId: string) => {
    Alert.alert('Unblock user?', 'They will be able to message you again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(firestore, 'users', uid, 'blocked', targetId));
            setBlocked(prev => prev.filter(b => b.id !== targetId));
          } catch {
            Alert.alert('Error', 'Could not unblock user.');
          }
        }
      }
    ]);
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Blocked users</Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : blocked.length === 0 ? (
        <Text style={styles.dim}>You haven’t blocked anyone.</Text>
      ) : (
        <FlatList
          data={blocked}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.name}>{displayName(item)}</Text>
              <TouchableOpacity onPress={() => onUnblock(item.id)} style={styles.btnOutline}>
                <Text style={styles.btnOutlineText}>Unblock</Text>
              </TouchableOpacity>
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', padding: 14 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderTopColor: '#1b1b1b', borderTopWidth: StyleSheet.hairlineWidth,
  },
  name: { color: '#fff', fontSize: 16 },

  btnOutline: { borderColor: '#374151', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnOutlineText: { color: '#e5e7eb', fontWeight: '700' },

  dim: { color: '#9aa7b1' },
});
