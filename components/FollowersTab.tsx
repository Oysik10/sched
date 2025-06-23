import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { collection, getDocs, getDoc, doc } from 'firebase/firestore';
import { firestore, auth } from '../src/firebaseConfig';

const FollowersTab = () => {
  const [followers, setFollowers] = useState<any[]>([]);

  useEffect(() => {
    const loadFollowers = async () => {
      const currentUid = auth.currentUser?.uid;
      if (!currentUid) return;

      const snapshot = await getDocs(collection(firestore, 'users', currentUid, 'followers'));
      const users = await Promise.all(
        snapshot.docs.map(async (docRef) => {
          const userDoc = await getDoc(doc(firestore, 'users', docRef.id));
          return userDoc.exists() ? { id: docRef.id, ...userDoc.data() } : null;
        })
      );
      setFollowers(users.filter(Boolean));
    };

    loadFollowers();
  }, []);

  const renderItem = ({ item }: any) => (
    <View style={styles.userItem}>
      <View>
        <Text style={styles.username}>{item.username}</Text>
        <Text style={styles.details}>{item.firstName} {item.lastName}</Text>
      </View>
    </View>
  );

  return (
    <FlatList
      data={followers}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListEmptyComponent={<Text style={styles.emptyText}>No one is following you.</Text>}
    />
  );
};

export default FollowersTab;

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
  emptyText: { textAlign: 'center', color: '#888', marginTop: 20 },
});
