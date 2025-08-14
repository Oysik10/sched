import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity, Alert,
  Keyboard, Pressable
} from 'react-native';
import {
  collection, query, where, getDocs, doc, setDoc, deleteDoc, onSnapshot
} from 'firebase/firestore';
import { firestore, auth } from '../../src/firebaseConfig';
import { deleteDmBetween } from '../../src/dmUtils';

export default function SearchUsersScreen() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [followedUids, setFollowedUids] = useState<string[]>([]);
  const [followerUids, setFollowerUids] = useState<string[]>([]);

  // ref to manually blur the input on mount
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // start with cursor not in the search bar
    const id = setTimeout(() => inputRef.current?.blur(), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;

    const followingRef = collection(firestore, 'users', currentUid, 'following');
    const followersRef = collection(firestore, 'users', currentUid, 'followers');

    const unsubFollowing = onSnapshot(followingRef, (snap) => {
      setFollowedUids(snap.docs.map(d => d.id));
    });
    const unsubFollowers = onSnapshot(followersRef, (snap) => {
      setFollowerUids(snap.docs.map(d => d.id));
    });

    return () => {
      unsubFollowing();
      unsubFollowers();
    };
  }, []);

  const handleSearch = async () => {
    if (!search.trim()) return;
    setLoading(true);
    const usersRef = collection(firestore, 'users');
    const q = query(usersRef, where('username', '>=', search), where('username', '<=', search + '\uf8ff'));

    try {
      const snapshot = await getDocs(q);
      const matches = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(user => user.id !== auth.currentUser?.uid);
      setResults(matches);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSearch('');
    setResults([]);
    Keyboard.dismiss(); // hide cursor immediately
  };

  const handleAddFriend = async (friendUid: string) => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;

    try {
      await setDoc(doc(firestore, 'users', currentUid, 'following', friendUid), {
        followedUid: friendUid,
        createdAt: new Date(),
      });
      await setDoc(doc(firestore, 'users', friendUid, 'followers', currentUid), {
        followerUid: currentUid,
        createdAt: new Date(),
      });

      setFollowedUids(prev => [...new Set([...prev, friendUid])]);
    } catch (err) {
      console.error('Follow error:', err);
      Alert.alert('Error', 'Could not send friend request.');
    }
  };

  const handleUnfollow = async (friendUid: string) => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;

    try {
      await deleteDoc(doc(firestore, 'users', currentUid, 'following', friendUid));
      await deleteDoc(doc(firestore, 'users', friendUid, 'followers', currentUid));
      setFollowedUids(prev => prev.filter(uid => uid !== friendUid));
    } catch (err) {
      console.error('Unfollow error:', err);
      Alert.alert('Error', 'Could not cancel request.');
    }
  };

  const handleUnfriend = async (friendUid: string) => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;

    Alert.alert(
      'Unfriend',
      'Are you sure you want to remove this friend?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unfriend',
          style: 'destructive',
          onPress: async () => {
            try {
              // Remove friendship in both directions
              await Promise.all([
                deleteDoc(doc(firestore, 'users', currentUid, 'following', friendUid)),
                deleteDoc(doc(firestore, 'users', friendUid, 'followers', currentUid)),
                deleteDoc(doc(firestore, 'users', friendUid, 'following', currentUid)),
                deleteDoc(doc(firestore, 'users', currentUid, 'followers', friendUid)),
              ]);

              // Update local state
              setFollowedUids(prev => prev.filter(uid => uid !== friendUid));
              setFollowerUids(prev => prev.filter(uid => uid !== friendUid));

              // Delete the DM thread + messages
              await deleteDmBetween(currentUid, friendUid);

            } catch (err) {
              console.error('Unfriend error:', err);
              Alert.alert('Error', 'Could not unfriend.');
            }
          },
        },
      ]
    );
  };


  return (
    // Tap anywhere outside inputs to dismiss keyboard/cursor
    <Pressable style={styles.container} onPress={Keyboard.dismiss}>
      <Text style={styles.title}>Search Users</Text>

      <View style={styles.searchRow}>
        <Text style={styles.atSymbol}>@</Text>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Enter username"
          placeholderTextColor="#888"
          autoCapitalize="none"
          value={search}
          onChangeText={(text) =>
            setSearch(text.replace(/\s/g, '').toLowerCase())
          }
          onSubmitEditing={() => {
            Keyboard.dismiss();
            handleSearch();
          }}
          blurOnSubmit
        />

        {/* × clear button */}
        {search.length > 0 && (
          <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
            <Text style={styles.clearButtonText}>×</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.searchButton}
          onPress={() => {
            Keyboard.dismiss();
            handleSearch();
          }}
        >
          <Text style={styles.searchIcon}>Search</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <Text style={styles.status}>Searching...</Text>
      ) : results.length === 0 && search ? (
        <Text style={styles.status}>No users found.</Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isFollowing = followedUids.includes(item.id);
            const isFollower = followerUids.includes(item.id);
            const isFriends = isFollowing && isFollower;

            return (
              <TouchableOpacity activeOpacity={1} onPress={Keyboard.dismiss}>
                <View style={styles.userItem}>
                  <View style={styles.topRow}>
                    <View>
                      <Text style={styles.username}>@{item.username}</Text>
                      <Text style={styles.details}>{item.firstName} {item.lastName}</Text>
                    </View>
                    {isFriends && (
                      <View style={styles.friendsBadge}>
                        <Text style={styles.friendsBadgeText}>Friends ✓</Text>
                      </View>
                    )}
                  </View>

                  <TouchableOpacity
                    onPress={() => {
                      Keyboard.dismiss();
                      if (isFriends) return handleUnfriend(item.id);
                      if (isFollowing) return handleUnfollow(item.id);
                      return handleAddFriend(item.id);
                    }}
                    style={[
                      styles.addButton,
                      isFriends && { backgroundColor: '#3cab5b' },
                      !isFriends && isFollowing && { backgroundColor: '#444' },
                    ]}
                  >
                    <Text style={styles.addButtonText}>
                      {isFriends ? 'Unfriend' : isFollowing ? 'Sent' : 'Send Friend Request'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 20 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 8,
    borderColor: '#444',
    borderWidth: 1,
    marginBottom: 12,
    height: 48,
    paddingHorizontal: 12,
  },
  atSymbol: { color: '#888', fontSize: 16, marginRight: 4 },
  input: { flex: 1, color: '#fff', fontSize: 16 },

  // × clear button styling
  clearButton: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 6,
  },
  clearButtonText: { color: '#bbb', fontSize: 16, fontWeight: '600' },

  searchButton: {
    backgroundColor: '#3cab5b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 6,
  },
  searchIcon: { color: '#fff', fontSize: 16 },
  status: { color: '#888', textAlign: 'center', marginTop: 16 },
  userItem: {
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  username: { color: '#4f8ef7', fontSize: 16, fontWeight: '600' },
  details: { color: '#ccc', fontSize: 14, marginBottom: 8 },
  friendsBadge: {
    backgroundColor: '#16351f',
    borderColor: '#3cab5b',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  friendsBadgeText: { color: '#3cab5b', fontSize: 12, fontWeight: '700' },
  addButton: {
    backgroundColor: '#1e3a8a',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '500' },
});
