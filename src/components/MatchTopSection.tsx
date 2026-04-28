import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { router } from 'expo-router';
import { auth, firestore } from '../firebaseConfig';
import { usePersistentMatch } from '../hooks/usePersistentMatch';

function formatExpiry(ts: Timestamp): string {
  const msLeft = ts.toMillis() - Date.now();
  if (msLeft <= 0) return 'Expired';
  const totalHours = Math.floor(msLeft / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((msLeft % 3_600_000) / 60_000);
  return `${totalHours}h ${mins}m left`;
}

export function MatchTopSection() {
  const {
    loading, inQueue, hasMatch, partnerUid, expiresAt, isExpired,
    joinQueue, leaveQueue,
  } = usePersistentMatch();
  const [uid, setUid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? ''));
    return unsub;
  }, []);

  const handleJoin = async () => {
    setBusy(true);
    try {
      const result = await joinQueue();
      if (result.status === 'matched') {
        Alert.alert("You're matched!", 'Your 3-day anonymous chat has started. Tap Open to chat.');
      } else if (result.status === 'queued') {
        Alert.alert('In queue', "We're looking for your match — you'll be notified when paired.");
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to join queue.');
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = () => {
    Alert.alert('Leave queue?', 'You will be removed from the matchmaking queue.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try { await leaveQueue(); } catch {}
          setBusy(false);
        },
      },
    ]);
  };

  const handleOpenChat = async () => {
    if (!uid || !partnerUid) return;
    const tid = [uid, partnerUid].sort().join('_');
    try {
      await setDoc(doc(firestore, 'dms', tid), { participants: [uid, partnerUid].sort() }, { merge: true });
    } catch {}
    router.push(`/dm/${partnerUid}`);
  };

  const subtitle = () => {
    if (loading) return 'Checking status…';
    if (isExpired) return 'Your 3-day match has ended';
    if (hasMatch) return expiresAt ? formatExpiry(expiresAt) : 'Tap to open chat';
    if (inQueue) return 'Looking for your match…';
    return 'Tap to find a 3-day anonymous match';
  };

  const ctaLabel = () => {
    if (loading || busy) return '…';
    if (isExpired) return 'Ended';
    if (hasMatch) return 'Open';
    if (inQueue) return 'Cancel';
    return 'Find Match';
  };

  const onPress = () => {
    if (loading || busy || isExpired) return;
    if (hasMatch) { handleOpenChat(); return; }
    if (inQueue) { handleLeave(); return; }
    handleJoin();
  };

  const tileColor = isExpired ? '#444' : '#CFAF45';
  const tileBorder = isExpired ? '#555' : '#d9c06a';

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        disabled={loading || isExpired || busy}
        style={{
          backgroundColor: tileColor,
          borderRadius: 12,
          padding: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tileBorder,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: '#111', fontSize: 16, fontWeight: '800' }}>Anonymous Match</Text>
            <Text style={{ color: '#222', marginTop: 2 }}>{subtitle()}</Text>
          </View>
          {!isExpired && (
            <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#111' }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{ctaLabel()}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}
