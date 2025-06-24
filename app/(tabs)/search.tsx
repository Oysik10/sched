import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import {
  collection, query, where, getDocs, doc, setDoc, getDoc, deleteDoc
} from 'firebase/firestore';
import { firestore } from '../../src/firebaseConfig';
import { auth } from '../../src/firebaseConfig';

export default function SearchUsersScreen() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [followedUids, setFollowedUids] = useState<string[]>([]);

  useEffect(() => {
    const fetchFollowing = async () => {
      const currentUid = auth.currentUser?.uid;
      if (!currentUid) return;
      const snapshot = await getDocs(collection(firestore, 'users', currentUid, 'following'));
      setFollowedUids(snapshot.docs.map(doc => doc.id));
    };
    fetchFollowing();
  }, []);

  const handleSearch = async () => {
    if (!search.trim()) return;
    setLoading(true);
    const usersRef = collection(firestore, 'users');
    const q = query(usersRef, where('username', '>=', search), where('username', '<=', search + '\uf8ff'));

    try {
      const snapshot = await getDocs(q);
      const matches = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(user => user.id !== auth.currentUser?.uid);
      setResults(matches);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
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

      setFollowedUids(prev => [...prev, friendUid]);
    } catch (err) {
      console.error('Follow error:', err);
      Alert.alert('Error', 'Could not follow user.');
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
      Alert.alert('Error', 'Could not unfollow user.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Search Users</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter username"
        placeholderTextColor="#888"
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={handleSearch}
      />
      {loading ? (
        <Text style={styles.status}>Searching...</Text>
      ) : results.length === 0 && search ? (
        <Text style={styles.status}>No users found.</Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isFollowing = followedUids.includes(item.id);
            return (
              <View style={styles.userItem}>
                <Text style={styles.username}>@{item.username}</Text>
                <Text style={styles.details}>{item.firstName} {item.lastName}</Text>
                <TouchableOpacity
                  onPress={() =>
                    isFollowing ? handleUnfollow(item.id) : handleAddFriend(item.id)
                  }
                  style={[
                    styles.addButton,
                    isFollowing && { backgroundColor: '#444' }
                  ]}
                >
                  <Text style={styles.addButtonText}>
                    {isFollowing ? 'Following' : 'Start Following'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 20 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  input: {
    height: 48, backgroundColor: '#111', color: '#fff', borderRadius: 8,
    paddingHorizontal: 12, borderColor: '#444', borderWidth: 1,
    marginBottom: 12,
  },
  status: { color: '#888', textAlign: 'center', marginTop: 16 },
  userItem: {
    backgroundColor: '#1a1a1a', padding: 12, borderRadius: 8,
    marginBottom: 10,
  },
  username: { color: '#4f8ef7', fontSize: 16, fontWeight: '600' },
  details: { color: '#ccc', fontSize: 14, marginBottom: 8 },
  addButton: {
    backgroundColor: '#1e3a8a',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '500' },
});
