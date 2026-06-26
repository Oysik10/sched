import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  Platform, ActionSheetIOS,
} from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { router } from 'expo-router';
import { auth, firestore } from '../firebaseConfig';
import { usePersistentMatch } from '../hooks/usePersistentMatch';

const CANCEL_REASONS = [
  'Inappropriate behavior',
  'Not comfortable continuing',
  'I know this person',
  'Other',
];

function formatExpiry(ts: Timestamp): string {
  const msLeft = ts.toMillis() - Date.now();
  if (msLeft <= 0) return 'Expired';
  const totalSecs = Math.floor(msLeft / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return `${mins}m ${secs}s left`;
  const totalHours = Math.floor(mins / 60);
  const remMins = mins % 60;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days}d ${hours}h left`;
  return `${totalHours}h ${remMins}m left`;
}

export function MatchTopSection() {
  const {
    loading, inQueue, pendingMatch, hasMatch, partnerUid, expiresAt, isExpired,
    cancelMatch, cancelPending,
  } = usePersistentMatch();
  const [uid, setUid] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? ''));
    return unsub;
  }, []);

  // Tick every second while a match is active so the countdown updates live
  useEffect(() => {
    if (!hasMatch || !expiresAt || isExpired) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasMatch, expiresAt, isExpired]);

  const isSearching = pendingMatch || inQueue;

  const handleJoin = () => {
    router.push('/match/pre-queue-questions' as any);
  };

  const handleCancelSearch = () => {
    if (Platform.OS === 'web') {
      if (!window.confirm('Stop searching? You will leave the matchmaking queue.')) return;
      setBusy(true);
      cancelPending().catch(() => {}).finally(() => setBusy(false));
      return;
    }
    Alert.alert('Stop searching?', 'Leave the matchmaking queue?', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try { await cancelPending(); } catch {}
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

  const confirmCancel = (reason: string) => {
    if (Platform.OS === 'web') {
      if (!window.confirm('Cancel match? This permanently deletes all messages and cannot be undone.')) return;
      setBusy(true);
      cancelMatch(reason)
        .then((result) => {
          if (result.banned) {
            window.alert('You have been banned from matching for 30 days due to too many cancellations.');
          } else if (result.cancellationsThisMonth === 2) {
            window.alert('Warning: one more cancellation this month will result in a 30-day ban.');
          }
        })
        .catch((e: any) => window.alert(e?.message ?? 'Failed to cancel match.'))
        .finally(() => setBusy(false));
      return;
    }
    Alert.alert(
      'Leave match?',
      'This permanently deletes all messages between you and cannot be undone.',
      [
        { text: 'Keep match', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const result = await cancelMatch(reason);
              if (result.banned) {
                Alert.alert('You have been banned', 'You cancelled 3 matches this month. You cannot find new matches for 30 days.');
              } else if (result.cancellationsThisMonth === 2) {
                Alert.alert('Warning', 'This is your 2nd cancellation this month. One more will result in a 30-day ban.');
              }
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Failed to leave match.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const handleLeaveMatch = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Why are you leaving?',
          options: [...CANCEL_REASONS, 'Cancel'],
          cancelButtonIndex: CANCEL_REASONS.length,
        },
        (index) => {
          if (index < CANCEL_REASONS.length) confirmCancel(CANCEL_REASONS[index]);
        }
      );
    } else if (Platform.OS === 'web') {
      // Multi-button Alert doesn't work in browsers — skip the reason picker
      confirmCancel('Other');
    } else {
      Alert.alert(
        'Why are you leaving?',
        undefined,
        [
          ...CANCEL_REASONS.map((r) => ({ text: r, onPress: () => confirmCancel(r) })),
          { text: 'Cancel', style: 'cancel' as const },
        ]
      );
    }
  };

  const subtitle = () => {
    if (loading) return 'Checking status…';
    if (isExpired) return 'Your match has ended';
    if (hasMatch) return expiresAt ? formatExpiry(expiresAt) : 'Tap to open chat';
    if (isSearching) return 'Finding your match…';
    return 'Tap to find an anonymous match';
  };

  const ctaLabel = () => {
    if (loading || busy) return '…';
    if (isExpired) return 'Ended';
    if (hasMatch) return 'Open';
    if (isSearching) return 'Cancel';
    return 'Find Match';
  };

  const onPress = () => {
    if (loading || busy || isExpired) return;
    if (hasMatch) { handleOpenChat(); return; }
    if (isSearching) { handleCancelSearch(); return; }
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

      {hasMatch && !isExpired && !loading && (
        <TouchableOpacity
          onPress={handleLeaveMatch}
          disabled={busy}
          style={{
            marginTop: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#3a1a1a',
            backgroundColor: '#1f0f0f',
            paddingVertical: 10,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#f87171', fontSize: 14, fontWeight: '700' }}>Cancel Match</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
