// app/notifications.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../src/firebaseConfig';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { NotifType } from '../src/utils/createNotification';

type Notif = {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  read: boolean;
  createdAtMs: number;
  fromUid?: string;
  data?: Record<string, any>;
};

const TYPE_ICON: Record<NotifType, string> = {
  friend_request:  '👤',
  friend_accepted: '✅',
  match_found:     '🔗',
  match_expired:   '⏰',
  match_cancelled: '❌',
  new_message:     '💬',
};

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function NotificationsScreen() {
  const [uid, setUid] = useState('');
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? ''));
    return unsub;
  }, []);

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(firestore, 'users', uid, 'notifications'),
      orderBy('createdAtMs', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setNotifs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Notif[]);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [uid]);

  const markRead = useCallback(
    async (notif: Notif) => {
      if (!uid || notif.read) return;
      try {
        await updateDoc(doc(firestore, 'users', uid, 'notifications', notif.id), { read: true });
      } catch {}
    },
    [uid]
  );

  const handleTap = (notif: Notif) => {
    markRead(notif);
    switch (notif.type) {
      case 'friend_request':
      case 'friend_accepted':
        if (notif.fromUid) router.push(`/user/${notif.fromUid}` as any);
        break;
      case 'match_found':
      case 'match_expired':
      case 'match_cancelled':
        router.push('/(tabs)/home' as any);
        break;
      case 'new_message':
        if (notif.fromUid) router.push(`/dm/${notif.fromUid}` as any);
        break;
    }
  };

  const deleteNotif = async (id: string) => {
    if (!uid) return;
    try {
      await deleteDoc(doc(firestore, 'users', uid, 'notifications', id));
    } catch {}
  };

  const markAllRead = async () => {
    if (!uid) return;
    const unread = notifs.filter((n) => !n.read);
    if (!unread.length) return;
    const batch = writeBatch(firestore);
    unread.forEach((n) =>
      batch.update(doc(firestore, 'users', uid, 'notifications', n.id), { read: true })
    );
    try { await batch.commit(); } catch {}
  };

  const renderItem = ({ item }: { item: Notif }) => (
    <TouchableOpacity
      style={[styles.row, !item.read && styles.rowUnread]}
      activeOpacity={0.75}
      onPress={() => handleTap(item)}
    >
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>{TYPE_ICON[item.type] ?? '🔔'}</Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, !item.read && styles.titleUnread]} numberOfLines={1}>
            {item.title}
          </Text>
          {!item.read && <View style={styles.dot} />}
        </View>
        <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
        <Text style={styles.time}>{timeAgo(item.createdAtMs)}</Text>
      </View>

      <TouchableOpacity
        onPress={() => deleteNotif(item.id)}
        hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
        style={styles.deleteBtn}
      >
        <Text style={styles.deleteText}>×</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const hasUnread = notifs.some((n) => !n.read);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {hasUnread ? (
          <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 90 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#CFAF45" />
        </View>
      ) : notifs.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>No notifications yet.</Text>
        </View>
      ) : (
        <FlatList
          data={notifs}
          keyExtractor={(n) => n.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12 }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#555', fontSize: 15 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e1e',
  },
  backBtn: { padding: 4, width: 70 },
  backText: { color: '#CFAF45', fontSize: 15, fontWeight: '600' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  markAllBtn: { width: 90, alignItems: 'flex-end' },
  markAllText: { color: '#CFAF45', fontSize: 13 },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    gap: 10,
  },
  rowUnread: {
    borderColor: '#2a2a1a',
    backgroundColor: '#131208',
  },

  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: { fontSize: 18 },

  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 6 },
  title: { color: '#aaa', fontSize: 14, fontWeight: '600', flex: 1 },
  titleUnread: { color: '#fff' },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#CFAF45',
    flexShrink: 0,
  },
  body: { color: '#666', fontSize: 13, lineHeight: 18 },
  time: { color: '#444', fontSize: 11, marginTop: 4 },

  deleteBtn: { paddingLeft: 6, paddingTop: 2 },
  deleteText: { color: '#333', fontSize: 20, lineHeight: 22 },
});
