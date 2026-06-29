import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  Alert, ScrollView, Image,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import {
  signInWithEmailAndPassword,
  signInWithCredential,
  signInWithPopup,
  GoogleAuthProvider,
} from 'firebase/auth';
import { auth } from '../src/firebaseConfig';
import { router } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '../src/firebaseConfig';

WebBrowser.maybeCompleteAuthSession();

const SIMILARITY_THRESHOLD = 0.7; // >= 0.7 is "too similar"

// ------- fuzzy helpers -------
function normalize(s: string) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]/g, ''); // keep alphanumerics
}
function levenshtein(a: string, b: string) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // delete
        dp[i][j - 1] + 1,      // insert
        dp[i - 1][j - 1] + cost // substitute
      );
    }
  }
  return dp[m][n];
}
function similarity(aRaw: string, bRaw: string) {
  const a = normalize(aRaw), b = normalize(bRaw);
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}
function usernameTooSimilar(username?: string, firstName?: string, lastName?: string) {
  const u = normalize(username || '');
  if (!u) return false; // no username handled upstream
  const parts = [firstName, lastName].filter(Boolean) as string[];
  if (parts.length === 0) return false;

  // Direct containment check (very permissive)
  for (const p of parts) {
    const pn = normalize(p);
    if (!pn) continue;
    if (u.includes(pn) || pn.includes(u)) return true;
    if (similarity(u, pn) >= SIMILARITY_THRESHOLD) return true;
  }
  return false;
}
// ------- end helpers -------

const AuthScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [, response, promptAsync] = Google.useAuthRequest({
    clientId: '892513267453-frkm0qkpvbi5nitjgchb9mt4g8sq3hc0.apps.googleusercontent.com',
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential)
        .then(() => postSignInRoute())
        .catch((e) => Alert.alert('Google Sign-in failed', e.message));
    }
  }, [response]);

  const handleGoogleSignIn = () => {
    if (Platform.OS === 'web') {
      signInWithPopup(auth, new GoogleAuthProvider())
        .then(() => postSignInRoute())
        .catch((e) => window.alert('Google Sign-in failed: ' + e.message));
    } else {
      promptAsync();
    }
  };

  const postSignInRoute = async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        router.replace('/home');
        return;
      }
      const snap = await getDoc(doc(firestore, 'users', uid));

      // If no profile doc, force username route (you can decide a different onboarding route)
      if (!snap.exists()) {
        router.replace('/username'); // <-- adjust if your route differs
        return;
      }

      const data = snap.data() as {
        username?: string;
        firstName?: string;
        lastName?: string;
      };

      const needsUsername =
        !data?.username ||
        usernameTooSimilar(data.username, data.firstName, data.lastName);

      if (needsUsername) {
        router.replace('/username'); // <-- adjust route as needed
      } else {
        router.replace('/home');
      }
    } catch (e: any) {
      console.warn('Post-signin profile check failed:', e?.message || e);
      // Fail-open to home to avoid lockouts; change to a safer default if you prefer
      router.replace('/home');
    }
  };

  const handleEmailLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      await postSignInRoute();
    } catch (err: any) {
      Alert.alert('Login failed', err.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}></Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor="#888"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor="#888"
          secureTextEntry
          style={styles.input}
        />

        <TouchableOpacity style={styles.button} onPress={handleEmailLogin}>
          <Text style={styles.buttonText}>Login with Email</Text>
        </TouchableOpacity>

        <Text style={styles.orText}>OR</Text>

        <TouchableOpacity
          style={[styles.button, styles.googleButton]}
          onPress={handleGoogleSignIn}
        >
          <Image
            source={{
              uri: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Google_%22G%22_Logo.svg/512px-Google_%22G%22_Logo.svg.png',
            }}
            style={styles.googleLogo}
          />
          <Text style={styles.googleButtonText}>Continue with Google</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/forgot')} style={{ marginTop: 12 }}>
          <Text style={{ color: '#4f8ef7', textAlign: 'center' }}>
            Forgot Password?
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/signup')} style={styles.signupLink}>
          <Text style={styles.signupText}>
            Don't have an account? <Text style={{ color: '#4f8ef7' }}>Create one</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default AuthScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  scrollContainer: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 32, textAlign: 'center' },
  label: { fontSize: 14, color: '#ccc', marginBottom: 6, marginTop: 12 },
  input: {
    height: 48, borderColor: '#444', borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, fontSize: 16, color: '#fff', backgroundColor: '#111',
  },
  button: {
    backgroundColor: '#1e3a8a', paddingVertical: 14,
    borderRadius: 10, alignItems: 'center', marginTop: 24
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  orText: { textAlign: 'center', marginVertical: 18, color: '#888', fontSize: 14 },
  googleButton: { backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 10 },
  googleLogo: { width: 20, height: 20, marginRight: 10 },
  googleButtonText: { color: '#000', fontSize: 16, fontWeight: '600' },
  signupLink: { marginTop: 24, alignItems: 'center' },
  signupText: { color: '#ccc', fontSize: 14 },
});
