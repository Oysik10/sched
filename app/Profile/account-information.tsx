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
  Platform,
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
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../../src/firebaseConfig';
import { router } from 'expo-router';

const USERNAME_RE = /^[a-z0-9._]{3,20}$/; // 3–20 chars, lowercase, digits, dot, underscore

const AccountInformation = () => {
  const auth = getAuth();
  const [user, setUser] = useState(auth.currentUser);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [loading, setLoading] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<null | boolean>(null);

  // keep user in sync across auth state changes
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(setUser);
    return unsub;
  }, [auth]);

  // Load profile
  useEffect(() => {
    const loadUserData = async () => {
      if (!user) return;

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists()) return;

        const data = userDoc.data() as any;
        setName(`${data.firstName || ''} ${data.lastName || ''}`.trim());
        setUsername((data.username || '').toLowerCase());
        setPhotoURL(data.photoURL || '');
      } catch (e: any) {
        console.warn('Failed to load user data:', e?.message || e);
      }
    };

    loadUserData();
  }, [user]);

  // Debounced username availability
  useEffect(() => {
    let cancelled = false;

    const checkAvailability = async () => {
      const handle = username.trim().toLowerCase();
      if (!handle) {
        setUsernameAvailable(null);
        return;
      }
      if (!USERNAME_RE.test(handle)) {
        setUsernameAvailable(null);
        return;
      }

      try {
        const q = query(collection(db, 'users'), where('username', '==', handle));
        const snapshot = await getDocs(q);
        // if a doc exists but it's your own UID, it's still available to you
        const isTaken = snapshot.docs.some((d) => d.id !== user?.uid);
        if (!cancelled) setUsernameAvailable(!isTaken);
      } catch (e) {
        if (!cancelled) setUsernameAvailable(null);
      }
    };

    const t = setTimeout(checkAvailability, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [username, user?.uid]);

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
      // Note: this is a local URI. To persist, upload to Storage and save the public URL.
    }
  };

  const handleUpdate = async () => {
    if (!user) {
      Alert.alert('Session expired', 'Please sign in again.');
      router.replace('/');
      return;
    }

    if (!name.trim() || !username.trim()) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }

    // normalize username
    const handle = username.trim().toLowerCase();
    if (!USERNAME_RE.test(handle)) {
      Alert.alert(
        'Invalid username',
        'Use 3–20 characters: lowercase letters, numbers, dot, or underscore.'
      );
      return;
    }

    if (usernameAvailable === false) {
      Alert.alert('Error', 'Username is already taken.');
      return;
    }

    // If changing password, ensure currentPassword provided and email exists
    const wantsPasswordChange = Boolean(newPassword);
    if (wantsPasswordChange && !currentPassword) {
      Alert.alert('Missing password', 'Please enter your current password.');
      return;
    }
    if (wantsPasswordChange && !user.email) {
      Alert.alert(
        'Unsupported for this account',
        'This account does not have an email/password sign-in method.'
      );
      return;
    }

    setLoading(true);
    try {
      // Update profile fields in Firestore
      await updateDoc(doc(db, 'users', user.uid), {
        name: name.trim(),
        username: handle,
        photoURL,
      });

      if (wantsPasswordChange) {
        const cred = EmailAuthProvider.credential(user.email!, currentPassword);
        await reauthenticateWithCredential(user, cred);
        await updatePassword(user, newPassword);
        Alert.alert('Success', 'Password updated.');
      }

      Alert.alert('Success', 'Profile updated.');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Delete account flow (with password prompt for email/password users)
  const promptDeleteWithPassword = () => {
    if (!user) {
      Alert.alert('Session expired', 'Please sign in again.');
      router.replace('/');
      return;
    }
    if (!user.email) {
      Alert.alert(
        'Unsupported for this account',
        'This account does not have an email/password sign-in method.'
      );
      return;
    }

    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Enter Password',
        'Please enter your current password to delete your account.',
        async (password) => {
          if (!password) return;
          await actuallyDeleteAccount(password);
        },
        'secure-text'
      );
    } else {
      // Simple fallback for Android/web where Alert.prompt isn’t available
      Alert.alert(
        'Delete Account',
        'Password re-authentication is required. Please go to Settings > Security to re-authenticate, then try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const actuallyDeleteAccount = async (password: string) => {
    const current = getAuth().currentUser;
    if (!current) {
      Alert.alert('Session expired', 'Please sign in again.');
      router.replace('/');
      return;
    }
    if (!current.email) {
      Alert.alert('Unsupported', 'This account has no email/password sign-in.');
      return;
    }

    try {
      setLoading(true);
      const cred = EmailAuthProvider.credential(current.email, password);
      await reauthenticateWithCredential(current, cred);

      // Delete Firestore doc first, then Auth user
      await deleteDoc(doc(db, 'users', current.uid));
      await deleteUser(current);

      Alert.alert('Deleted', 'Your account has been deleted.');
      router.replace('../..');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not delete account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.profileSection}>
        <Image
          source={photoURL ? { uri: photoURL } : require('../../assets/avatar-placeholder.png')}
          style={styles.avatar}
        />
        <View>
          <Text style={styles.usernameText}>
            @{username && username.trim() !== '' ? username : 'loading...'}
          </Text>
          <TouchableOpacity onPress={pickImage}>
            <Text style={styles.changePhoto}>Change Photo</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Enter your name"
      />

      <Text style={styles.label}>Username</Text>
      <View style={styles.usernameRow}>
        <Text style={styles.at}>@</Text>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={username}
          onChangeText={(v) => setUsername(v.replace(/^@/, '').toLowerCase())}
          placeholder="Choose a username"
          autoCapitalize="none"
        />
        {username.length > 0 && usernameAvailable !== null && (
          <Text style={[styles.icon, usernameAvailable ? styles.valid : styles.invalid]}>
            {usernameAvailable ? '✓' : '✗'}
          </Text>
        )}
      </View>
      {username.length > 0 && !USERNAME_RE.test(username) && (
        <Text style={{ color: '#F44336', marginTop: 4 }}>
          Use 3–20 characters: lowercase letters, numbers, dot, or underscore.
        </Text>
      )}

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

          <TouchableOpacity style={styles.deleteButton} onPress={promptDeleteWithPassword}>
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
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  at: {
    fontSize: 18,
    paddingHorizontal: 6,
    color: '#333',
  },
  icon: {
    fontSize: 18,
    marginLeft: 8,
  },
  valid: { color: '#4CAF50' },
  invalid: { color: '#F44336' },
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
