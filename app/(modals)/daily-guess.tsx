import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, BackHandler
} from 'react-native';
import { router, useNavigation } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../../src/firebaseConfig';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { todayKeyUTC } from '../../src/utils/day';
import { pickNDeterministic } from '../../src/utils/random';
import { GUESS_QUESTION_POOL } from '../../src/constants/guessQuestions';

export default function DailyGuessModal() {
  const [uid, setUid] = useState(auth.currentUser?.uid ?? '');
  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? '')), []);
  const dayKey = todayKeyUTC();
  const question = pickNDeterministic(GUESS_QUESTION_POOL, 1, `guess:${dayKey}`)[0];

  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);
  const [canExit, setCanExit] = useState(false); // becomes true once answered today

  const nav = useNavigation();

  // Block leaving until answered
  useEffect(() => {
    const sub = nav.addListener('beforeRemove', (e) => {
      if (canExit) return;
      e.preventDefault();
    });

    const back = BackHandler.addEventListener('hardwareBackPress', () => !canExit);
    return () => {
      sub && (sub as any)(); // remove
      back.remove();
    };
  }, [nav, canExit]);

  // If already answered today, auto close
  useEffect(() => {
    if (!uid) return;
    (async () => {
      const uRef = doc(firestore, 'users', uid);
      const snap = await getDoc(uRef);
      const completedOn = snap.exists() ? (snap.data()?.dailyGuess?.completedOn as string | undefined) : undefined;
      if (completedOn === dayKey) {
        setCanExit(true);
        router.back();
      }
    })();
  }, [uid, dayKey]);

  const submit = async () => {
    if (!uid || !answer.trim()) return;
    setSaving(true);
    try {
      const uRef = doc(firestore, 'users', uid);
      await setDoc(
        uRef,
        {
          dailyGuess: {
            completedOn: dayKey,
            q: question,
            a: answer.trim(),
            qKey: `guess:${dayKey}`,
          },
        },
        { merge: true }
      );
      setCanExit(true);
      router.back();
    } catch (e) {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.backdrop} />

      <View style={styles.card}>
        <Text style={styles.header}>Daily Guess</Text>
        <Text style={styles.sub}>Same for everyone • UTC {dayKey}</Text>

        <View style={styles.qWrap}>
          <Text style={styles.qText}>{question}</Text>
        </View>

        <TextInput
          value={answer}
          onChangeText={setAnswer}
          placeholder="Type your answer…"
          placeholderTextColor="#9CA3AF"
          style={styles.input}
          multiline
          autoFocus
        />

        <TouchableOpacity
          style={[styles.btn, (!answer.trim() || saving) && styles.btnDisabled]}
          onPress={submit}
          disabled={!answer.trim() || saving}
        >
          <Text style={styles.btnText}>{saving ? 'Saving…' : 'Submit'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  card: {
    width: '90%',
    maxWidth: 560,
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  header: { fontSize: 18, fontWeight: '800', color: '#111' },
  sub: { fontSize: 12, color: '#6b7280', marginTop: 2 },

  qWrap: {
    marginTop: 12,
    backgroundColor: '#fafafa',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    padding: 12,
  },
  qText: { fontSize: 15, fontWeight: '600', color: '#111' },

  input: {
    marginTop: 12,
    minHeight: 80,
    maxHeight: 160,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 10,
    fontSize: 14,
    color: '#111',
    backgroundColor: '#f9fafb',
  },
  btn: {
    marginTop: 12,
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '800' },
});
