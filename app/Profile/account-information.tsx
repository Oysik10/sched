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
  Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
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
import { db, auth } from '../../src/firebaseConfig';
import { router } from 'expo-router';

const USERNAME_RE = /^[a-z0-9._]{3,20}$/; // 3–20 chars, lowercase, digits, dot, underscore
const PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d).{9,}$/; // >8 chars (min 9), at least one uppercase & one number

// --- helpers for “username not similar to name” ---
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const nameTokens = (fullName: string) =>
  fullName
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^a-z0-9]/g, ''))
    .filter(t => t.length >= 3);

const isUsernameTooSimilarToName = (handle: string, fullName: string) => {
  const h = normalize(handle);
  const tokens = nameTokens(fullName);
  // block if username contains any name token (≥3 chars)
  return tokens.some(t => h.includes(t));
};

const AccountInformation = () => {
  const [user, setUser] = useState(auth.currentUser);

  const [name, setName] = useState(''); // read-only display
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [loading, setLoading] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<null | boolean>(null);

  // Password modal state
  const [pwModalVisible, setPwModalVisible] = useState(false);
  const [pwInput, setPwInput] = useState('');

  // keep user in sync across auth state changes
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(setUser);
    return unsub;
  }, []);

  // Load profile
  useEffect(() => {
    const loadUserData = async () => {
      if (!user) return;

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists()) return;

        const data = userDoc.data() as any;
        const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
        setName(fullName);
        setUsername((data.username || '').toLowerCase());
        setPhotoURL(data.photoURL || '');
      } catch (e: any) {
        console.warn('Failed to load user data:', e?.message || e);
      }
    };

    loadUserData();
  }, [user]);

  // Debounced username availability + similarity check
  useEffect(() => {
    let cancelled = false;

    const checkAvailability = async () => {
      const handle = username.trim().toLowerCase();
      if (!handle || !USERNAME_RE.test(handle)) {
        setUsernameAvailable(null);
        return;
      }

      try {
        const q = query(collection(db, 'users'), where('username', '==', handle));
        const snapshot = await getDocs(q);
        const isTaken = snapshot.docs.some((d) => d.id !== user?.uid);
        if (!cancelled) setUsernameAvailable(!isTaken);
      } catch {
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

    // validate username rules
    const handle = username.trim().toLowerCase();
    if (!handle) {
      Alert.alert('Error', 'Username is required.');
      return;
    }
    if (!USERNAME_RE.test(handle)) {
      Alert.alert(
        'Invalid username',
        'Use 3–20 characters: lowercase letters, numbers, dot, or underscore.'
      );
      return;
    }
    if (isUsernameTooSimilarToName(handle, name)) {
      Alert.alert('Invalid username', 'Username must not be similar to your name.');
      return;
    }
    if (usernameAvailable === false) {
      Alert.alert('Error', 'Username is already taken.');
      return;
    }

    // validate password rules if changing
    const wantsPasswordChange = Boolean(newPassword);
    if (wantsPasswordChange) {
      if (!user.email) {
        Alert.alert(
          'Unsupported for this account',
          'This account does not have an email/password sign-in method.'
        );
        return;
      }
      if (!PASSWORD_RE.test(newPassword)) {
        Alert.alert(
          'Weak password',
          'Password must be more than 8 characters (min 9), include at least one uppercase letter and one number.'
        );
        return;
      }
    }

    // Show password modal for re-auth (email/password accounts)
    if (user.email) {
      setPwInput('');
      setPwModalVisible(true);
    } else {
      // OAuth-only: just update username/photo
      await performUpdateWithoutReauth(handle);
    }
  };

  const performUpdateWithoutReauth = async (normalizedHandle: string) => {
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', user!.uid), {
        username: normalizedHandle,
        photoURL,
      });
      if (newPassword) {
        Alert.alert('Note', 'Password cannot be changed for this sign-in method.');
      }
      Alert.alert('Success', 'Profile updated.');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const performUpdateWithPassword = async () => {
    if (!user) return;
    if (!user.email) {
      setPwModalVisible(false);
      await performUpdateWithoutReauth(username.trim().toLowerCase());
      return;
    }
    const currentPassword = pwInput;
    if (!currentPassword) return;

    const normalizedHandle = username.trim().toLowerCase();

    setLoading(true);
    try {
      // re-authenticate
      const cred = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, cred);

      // update Firestore profile
      await updateDoc(doc(db, 'users', user.uid), {
        username: normalizedHandle,
        photoURL,
      });

      // update password if requested
      if (newPassword) {
        await updatePassword(user, newPassword);
        Alert.alert('Success', 'Password updated.');
      }

      Alert.alert('Success', 'Profile updated.');
      setPwModalVisible(false);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const promptDeleteWithPassword = async () => {
    const current = auth.currentUser;
    if (!current) {
      if (Platform.OS === 'web') window.alert('Session expired. Please sign in again.');
      else Alert.alert('Session expired', 'Please sign in again.');
      router.replace('/');
      return;
    }
    if (!current.email) {
      if (Platform.OS === 'web') window.alert('This account does not have an email/password sign-in method.');
      else Alert.alert('Unsupported for this account', 'This account does not have an email/password sign-in method.');
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
    } else if (Platform.OS === 'web') {
      if (!window.confirm('Delete your account? This cannot be undone and will permanently delete all your data.')) return;
      const password = window.prompt('Enter your password to confirm:');
      if (!password) return;
      await actuallyDeleteAccount(password);
    } else {
      Alert.alert(
        'Delete Account',
        'Are you sure? This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => {
            Alert.prompt?.(
              'Enter Password',
              'Enter your current password to confirm.',
              async (pw) => { if (pw) await actuallyDeleteAccount(pw); },
              'secure-text'
            );
          }},
        ]
      );
    }
  };

  const actuallyDeleteAccount = async (password: string) => {
    const current = auth.currentUser;
    if (!current?.email) {
      if (Platform.OS === 'web') window.alert('Session expired. Please sign in again.');
      else Alert.alert('Session expired', 'Please sign in again.');
      router.replace('/');
      return;
    }

    try {
      setLoading(true);
      const cred = EmailAuthProvider.credential(current.email, password);
      await reauthenticateWithCredential(current, cred);
      await deleteDoc(doc(db, 'users', current.uid));
      await deleteUser(current);
      if (Platform.OS === 'web') window.alert('Your account has been deleted.');
      else Alert.alert('Deleted', 'Your account has been deleted.');
      router.replace('../..');
    } catch (error: any) {
      if (Platform.OS === 'web') window.alert(error?.message || 'Could not delete account.');
      else Alert.alert('Error', error?.message || 'Could not delete account.');
    } finally {
      setLoading(false);
    }
  };

  // live hints for validation
  const handle = username.trim().toLowerCase();
  const usernameSimilar = handle ? isUsernameTooSimilarToName(handle, name) : false;
  const passwordValid = newPassword ? PASSWORD_RE.test(newPassword) : true;

  return (
    <View style={styles.container}>
      {/* Profile / avatar */}
      <View className="profileSection" style={styles.profileSection}>
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

      {/* Name (read-only) */}
      <Text style={styles.label}>Name</Text>
      <View style={styles.readonlyBox}>
        <Text style={styles.readonlyText}>{name || 'Unnamed'}</Text>
      </View>

      {/* Username */}
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
        {username.length > 0 && usernameAvailable !== null && !usernameSimilar && (
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
      {username.length > 0 && usernameSimilar && (
        <Text style={{ color: '#F44336', marginTop: 4 }}>
          Username must not be similar to your name.
        </Text>
      )}

      {/* New Password */}
      <Text style={styles.label}>New Password</Text>
      <TextInput
        style={styles.input}
        value={newPassword}
        onChangeText={setNewPassword}
        placeholder="Leave blank to keep current"
        secureTextEntry
      />
      {newPassword.length > 0 && !passwordValid && (
        <Text style={{ color: '#F44336', marginTop: 4 }}>
          Password must be more than 8 characters (min 9) and include at least one uppercase letter and one number.
        </Text>
      )}

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

      {/* Password modal for re-auth (cross-platform) */}
      <Modal
        transparent
        visible={pwModalVisible}
        animationType="fade"
        onRequestClose={() => setPwModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Password</Text>
            <Text style={styles.modalDesc}>Enter your current password to update your account.</Text>
            <TextInput
              style={styles.input}
              value={pwInput}
              onChangeText={setPwInput}
              placeholder="Current password"
              secureTextEntry
              autoFocus
            />
            <View style={styles.modalRow}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setPwModalVisible(false)}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalConfirm]} onPress={performUpdateWithPassword}>
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  readonlyBox: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fafafa',
  },
  readonlyText: {
    fontSize: 16,
    color: '#333',
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

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalDesc: {
    fontSize: 14,
    color: '#444',
    marginBottom: 10,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  modalCancel: {
    backgroundColor: '#eee',
  },
  modalConfirm: {
    backgroundColor: '#3478f6',
  },
  modalBtnText: {
    color: '#111',
    fontWeight: '600',
  },
});

export default AccountInformation;
