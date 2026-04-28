// app/user/[uid].tsx
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../../src/firebaseConfig';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';

type Profile = {
  username?: string;
  firstName?: string;
  lastName?: string;
};

export default function UserProfileScreen() {
  const raw = useLocalSearchParams().uid;
  const theirUid = Array.isArray(raw) ? raw[0] : (raw ?? '');

  const [myUid, setMyUid] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [isFollowing, setIsFollowing] = useState(false); // I follow them
  const [isFollower, setIsFollower] = useState(false);   // They follow me
  const [isBlocked, setIsBlocked] = useState(false);

  const [busy, setBusy] = useState(false);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setMyUid(u?.uid ?? ''));
    return unsub;
  }, []);

  // Their profile
  useEffect(() => {
    if (!theirUid) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(firestore, 'users', theirUid));
        if (!cancelled) setProfile(snap.exists() ? (snap.data() as Profile) : {});
      } catch {
        if (!cancelled) setProfile({});
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();
    return () => { cancelled = true; };
  }, [theirUid]);

  // Subscribe to following/follower/blocked status
  useEffect(() => {
    if (!myUid || !theirUid) return;
    const unsubF = onSnapshot(
      doc(firestore, 'users', myUid, 'following', theirUid),
      (snap) => setIsFollowing(snap.exists()),
      () => setIsFollowing(false)
    );
    const unsubFr = onSnapshot(
      doc(firestore, 'users', myUid, 'followers', theirUid),
      (snap) => setIsFollower(snap.exists()),
      () => setIsFollower(false)
    );
    const unsubB = onSnapshot(
      doc(firestore, 'users', myUid, 'blocked', theirUid),
      (snap) => setIsBlocked(snap.exists()),
      () => setIsBlocked(false)
    );
    return () => { unsubF(); unsubFr(); unsubB(); };
  }, [myUid, theirUid]);

  const isFriends = isFollowing && isFollower;
  const requestSent = isFollowing && !isFollower;
  const theyFollowMe = !isFollowing && isFollower;

  const sendRequest = async () => {
    if (!myUid || !theirUid) return;
    setBusy(true);
    try {
      const now = new Date();
      await Promise.all([
        setDoc(doc(firestore, 'users', myUid, 'following', theirUid), { followedUid: theirUid, createdAt: now }),
        setDoc(doc(firestore, 'users', theirUid, 'followers', myUid), { followerUid: myUid, createdAt: now }),
      ]);
    } catch {
      Alert.alert('Error', 'Could not send friend request.');
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async () => {
    if (!myUid || !theirUid) return;
    setBusy(true);
    try {
      await Promise.all([
        deleteDoc(doc(firestore, 'users', myUid, 'following', theirUid)),
        deleteDoc(doc(firestore, 'users', theirUid, 'followers', myUid)),
      ]);
    } catch {
      Alert.alert('Error', 'Could not cancel request.');
    } finally {
      setBusy(false);
    }
  };

  const acceptRequest = async () => {
    // They follow me; I follow back to complete the friendship
    if (!myUid || !theirUid) return;
    setBusy(true);
    try {
      const now = new Date();
      await Promise.all([
        setDoc(doc(firestore, 'users', myUid, 'following', theirUid), { followedUid: theirUid, createdAt: now }),
        setDoc(doc(firestore, 'users', theirUid, 'followers', myUid), { followerUid: myUid, createdAt: now }),
      ]);
    } catch {
      Alert.alert('Error', 'Could not accept request.');
    } finally {
      setBusy(false);
    }
  };

  const unfriend = () => {
    Alert.alert('Unfriend', 'Remove this friend?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unfriend',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await Promise.all([
              deleteDoc(doc(firestore, 'users', myUid, 'following', theirUid)),
              deleteDoc(doc(firestore, 'users', theirUid, 'followers', myUid)),
              deleteDoc(doc(firestore, 'users', theirUid, 'following', myUid)),
              deleteDoc(doc(firestore, 'users', myUid, 'followers', theirUid)),
            ]);
          } catch {
            Alert.alert('Error', 'Could not unfriend.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const blockUser = () => {
    Alert.alert(
      'Block user?',
      `Blocking @${profile?.username ?? theirUid.slice(0, 6)} will remove any friendship and prevent them from messaging you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              // Remove friendship first
              await Promise.all([
                deleteDoc(doc(firestore, 'users', myUid, 'following', theirUid)).catch(() => {}),
                deleteDoc(doc(firestore, 'users', theirUid, 'followers', myUid)).catch(() => {}),
                deleteDoc(doc(firestore, 'users', theirUid, 'following', myUid)).catch(() => {}),
                deleteDoc(doc(firestore, 'users', myUid, 'followers', theirUid)).catch(() => {}),
              ]);
              // Then block
              await setDoc(doc(firestore, 'users', myUid, 'blocked', theirUid), {
                blockedUid: theirUid,
                createdAt: new Date(),
              });
            } catch {
              Alert.alert('Error', 'Could not block user.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const unblockUser = () => {
    Alert.alert('Unblock user?', 'They will be able to message you again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteDoc(doc(firestore, 'users', myUid, 'blocked', theirUid));
          } catch {
            Alert.alert('Error', 'Could not unblock.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const displayName = () => {
    if (!profile) return '';
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    return name || theirUid.slice(0, 6) + '…';
  };

  const friendBtnLabel = () => {
    if (busy) return '…';
    if (isFriends) return 'Unfriend';
    if (requestSent) return 'Request Sent';
    if (theyFollowMe) return 'Accept Request';
    return 'Send Friend Request';
  };

  const friendBtnColor = () => {
    if (isFriends) return '#1d3a27';
    if (requestSent) return '#1a1a2e';
    if (theyFollowMe) return '#1e3a8a';
    return '#1e3a8a';
  };

  const onFriendBtn = () => {
    if (busy) return;
    if (isFriends) return unfriend();
    if (requestSent) return cancelRequest();
    if (theyFollowMe) return acceptRequest();
    return sendRequest();
  };

  const initials = () => {
    if (profile?.firstName) return profile.firstName[0].toUpperCase();
    if (profile?.username) return profile.username[0].toUpperCase();
    return '?';
  };

  if (loadingProfile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <ActivityIndicator color="#CFAF45" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {/* Avatar */}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials()}</Text>
        </View>

        {/* Name + username */}
        <Text style={styles.displayName}>{displayName()}</Text>
        {profile?.username ? (
          <Text style={styles.username}>@{profile.username}</Text>
        ) : null}

        {/* Relationship badge */}
        {isFriends && (
          <View style={styles.friendsBadge}>
            <Text style={styles.friendsBadgeText}>Friends ✓</Text>
          </View>
        )}
        {theyFollowMe && !isFollowing && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>Sent you a friend request</Text>
          </View>
        )}

        {/* Friend request button */}
        {!isBlocked && (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: friendBtnColor() }]}
            onPress={onFriendBtn}
            disabled={busy}
            activeOpacity={0.75}
          >
            <Text style={styles.btnText}>{friendBtnLabel()}</Text>
          </TouchableOpacity>
        )}

        {/* Block / Unblock */}
        <TouchableOpacity
          style={[styles.btn, styles.blockBtn]}
          onPress={isBlocked ? unblockUser : blockUser}
          disabled={busy}
          activeOpacity={0.75}
        >
          <Text style={[styles.btnText, styles.blockBtnText]}>
            {isBlocked ? 'Unblock' : 'Block'}
          </Text>
        </TouchableOpacity>

        {isBlocked && (
          <Text style={styles.blockedNote}>
            You have blocked this user. They cannot message you.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  backBtn: { padding: 4, alignSelf: 'flex-start' },
  backText: { color: '#CFAF45', fontSize: 15, fontWeight: '600' },

  body: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 24,
  },

  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarText: { color: '#e5e7eb', fontWeight: '800', fontSize: 28 },

  displayName: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 4 },
  username: { color: '#888', fontSize: 15, marginBottom: 16 },

  friendsBadge: {
    backgroundColor: '#16351f',
    borderColor: '#3cab5b',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    marginBottom: 20,
  },
  friendsBadgeText: { color: '#3cab5b', fontSize: 13, fontWeight: '700' },

  pendingBadge: {
    backgroundColor: '#1a2540',
    borderColor: '#3b82f6',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    marginBottom: 20,
  },
  pendingBadgeText: { color: '#93c5fd', fontSize: 13, fontWeight: '600' },

  btn: {
    width: '100%',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  blockBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3a1a1a',
  },
  blockBtnText: { color: '#f87171' },

  blockedNote: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
  },
});
