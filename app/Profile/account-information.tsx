import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  getAuth,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from '../../src/firebaseConfig'; // adjust path if needed
import { router } from 'expo-router';

const AccountInformation = () => {
  const auth = getAuth();
  const user = auth.currentUser;

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadUserData = async () => {
      if (!user) return;
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        console.log('User data:', data);

        setName(`${data.firstName || ''} ${data.lastName || ''}`); // build name from real fields
        setUsername(data.username || '');
        setPhotoURL(data.photoURL || '');
      }
    };

    loadUserData();
  }, []);

  const checkUsernameTaken = async (newUsername: string) => {
    const q = query(collection(db, 'users'), where('username', '==', newUsername));
    const snapshot = await getDocs(q);
    return !snapshot.empty && snapshot.docs[0].id !== user?.uid;
  };

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Camera roll access is needed.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled) {
      setPhotoURL(result.assets[0].uri);
    }
  };

  const handleUpdate = async () => {
    try {
      setLoading(true);
      if (!user) return;

      if (!name || !username) {
        Alert.alert('Error', 'Please fill in all fields.');
        return;
      }

      const usernameTaken = await checkUsernameTaken(username);
      if (usernameTaken) {
        Alert.alert('Error', 'Username is already taken.');
        return;
      }

      await updateDoc(doc(db, 'users', user.uid), {
        name,
        username,
        photoURL,
      });

      if (newPassword && currentPassword) {
        const cred = EmailAuthProvider.credential(user.email!, currentPassword);
        await reauthenticateWithCredential(user, cred);
        await updatePassword(user, newPassword);
        Alert.alert('Success', 'Password updated.');
      }

      Alert.alert('Success', 'Profile updated.');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const promptDeleteWithPassword = () => {
    Alert.prompt(
      'Enter Password',
      'Please enter your current password to delete your account.',
      async (password) => {
        if (!password) return;
        try {
          const cred = EmailAuthProvider.credential(user?.email!, password);
          await reauthenticateWithCredential(user!, cred);
          await deleteUser(user!);
          Alert.alert('Deleted', 'Your account has been deleted.');
          router.replace('../../'); // adjust this route if needed
        } catch (error: any) {
          Alert.alert('Error', error.message);
        }
      },
      'secure-text'
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action is irreversible.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: promptDeleteWithPassword },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.profileSection}>
        <Image
          source={photoURL ? { uri: photoURL } : require('../../assets/avatar-placeholder.png')}
          style={styles.avatar}
        />
        <View>
          <Text style={styles.usernameText}>@{username || 'username'}</Text>
          <TouchableOpacity onPress={pickImage}>
            <Text style={styles.changePhoto}>Change Photo</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Enter your name" />

      <Text style={styles.label}>Username</Text>
      <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="Choose a username" />

      <Text style={styles.label}>New Password</Text>
      <TextInput
        style={styles.input}
        value={newPassword}
        onChangeText={setNewPassword}
        placeholder="Leave blank to keep current"
        secureTextEntry
      />

      <Text style={styles.label}>Current Password</Text>
      <TextInput
        style={styles.input}
        value={currentPassword}
        onChangeText={setCurrentPassword}
        placeholder="Required for password change or delete"
        secureTextEntry
      />

      {loading ? (
        <ActivityIndicator size="large" style={{ marginTop: 20 }} />
      ) : (
        <>
          <TouchableOpacity style={styles.updateButton} onPress={handleUpdate}>
            <Text style={styles.buttonText}>Update Account</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteAccount}>
            <Text style={styles.buttonText}>Delete Account</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 24,
    backgroundColor: '#fff',
    flex: 1,
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ccc',
    marginRight: 16,
  },
  usernameText: {
    fontSize: 18,
    fontWeight: '600',
  },
  changePhoto: {
    color: '#4f8ef7',
    marginTop: 4,
    fontSize: 14,
  },
  label: {
    fontSize: 15,
    marginBottom: 4,
    marginTop: 12,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  updateButton: {
    backgroundColor: '#3478f6',
    padding: 14,
    borderRadius: 10,
    marginTop: 24,
    alignItems: 'center',
  },
  deleteButton: {
    backgroundColor: '#ff3b30',
    padding: 14,
    borderRadius: 10,
    marginTop: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
});

export default AccountInformation;
