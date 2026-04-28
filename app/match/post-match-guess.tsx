// app/match/post-match-guess.tsx
import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { auth, firestore } from '../../src/firebaseConfig';
import { doc, setDoc } from 'firebase/firestore';
import { GUESS_QUESTION_POOL } from '../../src/constants/guessQuestions';
import { pickNDeterministic } from '../../src/utils/random';

export default function PostMatchGuessScreen() {
  const { matchId, partnerUid } = useLocalSearchParams<{ matchId: string; partnerUid: string }>();
  const uid = auth.currentUser?.uid ?? '';

  const questions = useMemo(
    () => pickNDeterministic(GUESS_QUESTION_POOL, 2, `postguess:${matchId}:${uid}`),
    [matchId, uid]
  );

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const currentAnswer = answers[step]?.trim() ?? '';
  const allAnswered = questions.every((_, i) => (answers[i]?.trim().length ?? 0) > 0);
  const isLast = step === questions.length - 1;

  const goBack = () => {
    if (step > 0) setStep((s) => s - 1);
    else router.back();
  };

  const goNext = () => {
    if (currentAnswer.length > 0) setStep((s) => s + 1);
  };

  const handleSubmit = async () => {
    if (!allAnswered || !uid || !matchId) return;
    setSaving(true);
    try {
      await setDoc(
        doc(firestore, 'users', uid),
        {
          postMatchGuess: {
            matchId,
            questions,
            answers: questions.map((_, i) => (answers[i] ?? '').trim()),
            completedAt: Date.now(),
          },
        },
        { merge: true }
      );
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save your answers.');
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn} disabled={saving}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.stepLabel}>{step + 1} / {questions.length}</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Guess about your match</Text>
          <Text style={styles.subtitle}>
            Your match ended. Answer 2 questions about them — they'll see if you were right.
          </Text>

          <View style={styles.dotsRow}>
            {questions.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === step && styles.dotActive,
                  i < step && styles.dotDone,
                ]}
              />
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.qNum}>Question {step + 1} of {questions.length}</Text>
            <Text style={styles.qText}>{questions[step]}</Text>
            <TextInput
              style={styles.input}
              value={answers[step] ?? ''}
              onChangeText={(t) => setAnswers((prev) => ({ ...prev, [step]: t }))}
              placeholder="Your guess…"
              placeholderTextColor="#555"
              multiline
              autoFocus
            />
          </View>

          {isLast ? (
            <TouchableOpacity
              style={[styles.btn, (!allAnswered || saving) && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={!allAnswered || saving}
            >
              {saving ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.btnText}>Submit Guesses</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.btn, currentAnswer.length === 0 && styles.btnDisabled]}
              onPress={goNext}
              disabled={currentAnswer.length === 0}
            >
              <Text style={styles.btnText}>Next →</Text>
            </TouchableOpacity>
          )}

          {step > 0 && (
            <View style={styles.prevSection}>
              <Text style={styles.prevTitle}>Your answers so far</Text>
              {questions.slice(0, step).map((q, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.prevCard}
                  onPress={() => setStep(i)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.prevQ}>{q}</Text>
                  <Text style={styles.prevA}>{answers[i]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: { padding: 4 },
  backText: { color: '#CFAF45', fontSize: 15, fontWeight: '600' },
  stepLabel: { color: '#555', fontSize: 13 },

  content: { paddingHorizontal: 16, paddingBottom: 48, paddingTop: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888', lineHeight: 20, marginBottom: 24 },

  dotsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2a2a2a' },
  dotActive: { width: 28, backgroundColor: '#CFAF45' },
  dotDone: { backgroundColor: '#444' },

  card: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 16,
  },
  qNum: {
    color: '#CFAF45',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  qText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 26, marginBottom: 16 },
  input: {
    minHeight: 80,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    padding: 12,
    color: '#fff',
    fontSize: 15,
    textAlignVertical: 'top',
    lineHeight: 22,
  },

  btn: {
    backgroundColor: '#CFAF45',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  btnDisabled: { backgroundColor: '#2a2a2a' },
  btnText: { color: '#000', fontWeight: '800', fontSize: 16 },

  prevSection: { marginTop: 8 },
  prevTitle: {
    color: '#555',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  prevCard: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  prevQ: { color: '#555', fontSize: 12, marginBottom: 4 },
  prevA: { color: '#ccc', fontSize: 14 },
});
