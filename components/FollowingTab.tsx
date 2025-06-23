import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { collection, getDocs, getDoc, doc, deleteDoc } from 'firebase/firestore';
import { firestore, auth } from '../src/firebaseConfig';

const FollowingTab = () => {
  const [following, setFollowing] = useState<any[]>([]);

  useEffect(() => {
    const loadFollowing = async () => {
      const currentUid = auth.currentUser?.uid;
      if (!currentUid) return;

      const snapshot = await getDocs(collection(firestore, 'users', currentUid, 'friends'));
      const users = await Promise.all(
        snapshot.docs.map(async (docRef) => {
          const userDoc = await getDoc(doc(firestore, 'users', docRef.id));
          return userDoc.exists() ? { id: docRef.id, ...userDoc.data() } : null;
        })
      );
      setFollowing(users.filter(Boolean));
    };

    loadFollowing();
  }, []);

  const handleUnfollow = async (uid: string) => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;
    await deleteDoc(doc(firestore, 'users', currentUid, 'friends', uid));
    setFollowing(prev => prev.filter(user => user.id !== uid));
  };

  const renderItem = ({ item }: any) => (
    <View style={styles.userItem}>
      <View>
        <Text style={styles.username}>{item.username}</Text>
        <Text style={styles.details}>{item.firstName} {item.lastName}</Text>
      </View>
      <TouchableOpacity onPress={() => handleUnfollow(item.id)} style={styles.unfollowButton}>
        <Text style={styles.unfollowText}>Unfollow</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <FlatList
      data={following}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListEmptyComponent={<Text style={styles.emptyText}>You're not following anyone.</Text>}
    />
  );
};

export default FollowingTab;

const styles = StyleSheet.create({
  userItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a1a',
    padding: 14,
    margin: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  username: { color: '#4f8ef7', fontSize: 16, fontWeight: '600' },
  details: { color: '#ccc', fontSize: 14 },
  unfollowButton: {
    backgroundColor: '#ff3b30',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  unfollowText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  emptyText: { textAlign: 'center', color: '#888', marginTop: 20 },
});
