import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator
} from 'react-native';
import { router } from 'expo-router';
import { auth } from '../src/firebaseConfig';
import { firestore } from '../src/firebaseConfig';
import { doc, getDoc, getDocs, query, where, collection, updateDoc } from 'firebase/firestore';

// ---------- fuzzy helpers (same idea as AuthScreen) ----------
const SIMILARITY_THRESHOLD = 0.7;

function normalize(s: string) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function levenshtein(a: string, b: string) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}
function similarity(a: string, b: string) {
  const aa = normalize(a), bb = normalize(b);
  if (!aa || !bb) return 0;
  const dist = levenshtein(aa, bb);
  const maxLen = Math.max(aa.length, bb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}
function tooSimilar(username: string, firstName?: string, lastName?: string) {
  const u = normalize(username);
  const parts = [firstName, lastName].filter(Boolean) as string[];
  for (const p of parts) {
    const pn = normalize(p);
    if (!pn) continue;
    if (u.includes(pn) || pn.includes(u)) return true;
    if (similarity(u, pn) >= SIMILARITY_THRESHOLD) return true;
  }
  return false;
}
// -------------------------------------------------------------

const USERNAME_RE = /^[a-z0-9._]{3,20}$/;

export default function ChooseUsernameScreen() {
  const uid = auth.currentUser?.uid ?? null;
  const [profile, setProfile] = useState<{ firstName?: string; lastName?: string; username?: string } | null>(null);
  const [username, setUsername] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<null | boolean>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) {
      router.replace('/'); // not signed in
      return;
    }
    (async () => {
      const snap = await getDoc(doc(firestore, 'users', uid));
      if (!snap.exists()) {
        // No profile yet; still fine—just collect username
        setProfile({});
        return;
      }
      const data = snap.data() as any;
      setProfile({ firstName: data.firstName, lastName: data.lastName, username: data.username });
      if (data.username) setUsername(String(data.username));
    })();
  }, [uid]);

  // Normalize input: strip leading @, force lowercase
  const handleChange = (val: string) => {
    const cleaned = val.replace(/^@/, '').toLowerCase();
    setUsername(cleaned);
  };

  const formatValid = useMemo(() => USERNAME_RE.test(username), [username]);
  const similarBlocked = useMemo(
    () => tooSimilar(username, profile?.firstName, profile?.lastName),
    [username, profile?.firstName, profile?.lastName]
  );

  // Debounced availability check
  useEffect(() => {
    if (!username) {
      setAvailable(null);
      return;
    }
    if (!formatValid) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const q = query(collection(firestore, 'users'), where('username', '==', username));
        const snap = await getDocs(q);
        if (!cancelled) setAvailable(snap.empty);
      } catch (e) {
        if (!cancelled) setAvailable(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [username, formatValid]);

  const canSubmit = !!uid && formatValid && available === true && !similarBlocked && !busy;

  const onSave = async () => {
    if (!uid) return;
    if (!canSubmit) return;

    try {
      setBusy(true);
      await updateDoc(doc(firestore, 'users', uid), { username });
      Alert.alert('All set!', 'Your username has been saved.');
      router.replace('/home');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        <Text style={styles.title}>Choose a username</Text>
        <Text style={styles.subtitle}>Pick something unique. Avoid using your real name.</Text>

        <View style={styles.row}>
          <Text style={styles.at}>@</Text>
          <TextInput
            value={username}
            onChangeText={handleChange}
            placeholder="your.handle"
            placeholderTextColor="#777"
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { flex: 1 }]}
            maxLength={20}
          />
          {checking ? (
            <ActivityIndicator style={{ marginLeft: 8 }} />
          ) : available !== null ? (
            <Text style={[styles.indicator, available ? styles.ok : styles.bad]}>
              {available ? '✓' : '✗'}
            </Text>
          ) : null}
        </View>

        {!formatValid && username.length > 0 && (
          <Text style={styles.helper}>Use 3–20 chars: a–z, 0–9, dot or underscore.</Text>
        )}
        {similarBlocked && (
          <Text style={styles.warning}>
            This looks too similar to your name. Please choose something less identifiable.
          </Text>
        )}
        {available === false && (
          <Text style={styles.warning}>That username is taken. Try another.</Text>
        )}

        <TouchableOpacity style={[styles.button, !canSubmit && styles.buttonDisabled]} onPress={onSave} disabled={!canSubmit}>
          <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save & Continue'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  inner: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 28, color: '#fff', fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#aaa', textAlign: 'center', marginTop: 8, marginBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  at: { color: '#888', fontSize: 18, marginRight: 6 },
  input: {
    height: 48, borderRadius: 10, paddingHorizontal: 12,
    fontSize: 16, color: '#fff', borderWidth: 1, borderColor: '#444', backgroundColor: '#111',
  },
  indicator: { fontSize: 18, marginLeft: 8 },
  ok: { color: '#51ff87' },
  bad: { color: '#F44336' },
  helper: { color: '#bbb', marginTop: 4 },
  warning: { color: '#F44336', marginTop: 4 },
  button: {
    backgroundColor: '#1e3a8a', paddingVertical: 14,
    borderRadius: 10, alignItems: 'center', marginTop: 16,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
