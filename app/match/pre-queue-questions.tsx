// app/match/pre-queue-questions.tsx
import React, { useState } from 'react';
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
import { router } from 'expo-router';
import { auth, firestore } from '../../src/firebaseConfig';
import { doc, setDoc } from 'firebase/firestore';
import { usePersistentMatch } from '../../src/hooks/usePersistentMatch';

const QUESTION_POOL: string[] = [
  "What's your hottest take on movies?",
  "If your job were a dish, what would it be and why?",
  "What's a famous dish from your culture?",
  "What's a lesser-known fact about your country?",
  "What's a stereotype about your culture?",
  "What's a stereotype about your job?",
  "Which popular movie do you think is mid, and why?",
  "What's a tradition you wish more people knew about?",
  "What holiday dish feels like home to you?",
  "What's a stereotype about your culture that's actually false?",
  "What word or phrase in your language do you say a lot, and what does it mean?",
  "What local superstition do you kind of believe?",
  "What law or custom where you live would outsiders find weird?",
  "What local scam should visitors watch for?",
  "What's your favorite rainy-day thing to do in your city?",
  "What's a slang term only locals use, and what does it mean?",
  "If your city were a smell, what would it be?",
  "What's your favorite book (right now)?",
  "Which movie do you wish you could see again for the first time, and why?",
  "Which city surprised you, and how?",
  "What souvenir do you actually use?",
  "What's one rule you live by?",
  'How would you define "success" in one sentence?',
  "What's a red flag you ignore every time?",
  "If your life were a genre, which would it be and why?",
  "What's a smell that instantly teleports you somewhere?",
  "What's the most \"you\" object on your desk, and why?",
  "If you could be born into a different religion, which would it be and why?",
  "Do you believe in a higher power? Why or why not (in one line)?",
  "Fate, free will, or a messy mix — what do you lean toward, and why?",
  "Do you think life has a purpose? Why or why not?",
  "What's a small ritual that centers you?",
  "What verse or quote stays with you?",
  "What's a belief you've outgrown, and what replaced it?",
  "What festival from your tradition would you share with everyone, and why?",
  "What one-sentence blessing would you give a friend?",
];

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const result: T[] = [];
  while (result.length < n && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(i, 1)[0]);
  }
  return result;
}

export default function PreQueueQuestionsScreen() {
  const uid = auth.currentUser?.uid ?? '';
  const { joinQueue } = usePersistentMatch();

  const [questions] = useState<string[]>(() => pickRandom(QUESTION_POOL, 3));
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const currentAnswer = answers[step]?.trim() ?? '';
  const allAnswered = questions.every((_, i) => (answers[i]?.trim().length ?? 0) > 0);
  const isLast = step === questions.length - 1;

  const goBack = () => {
    if (step > 0) {
      setStep((s) => s - 1);
    } else {
      router.back();
    }
  };

  const goNext = () => {
    if (currentAnswer.length === 0) return;
    setStep((s) => s + 1);
  };

  const handleSubmit = async () => {
    if (!allAnswered) {
      Alert.alert('Almost there', 'Please answer all three questions.');
      return;
    }
    if (!uid) {
      Alert.alert('Error', 'Not signed in.');
      return;
    }
    setSaving(true);
    try {
      await setDoc(
        doc(firestore, 'users', uid),
        {
          matchQA: {
            questions,
            answers: questions.map((_, i) => (answers[i] ?? '').trim()),
            savedAt: Date.now(),
          },
        },
        { merge: true }
      );

      const result = await joinQueue();
      if (result.status === 'matched') {
        Alert.alert("You're matched!", "Your 3-day anonymous chat has started. Tap Open on the home screen to chat.");
      } else if (result.status === 'queued') {
        Alert.alert('In queue', "We're looking for your match — you'll be notified when paired.");
      } else if (result.status === 'already_matched') {
        Alert.alert('Already matched', 'You already have an active match!');
      }
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to join queue.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header row */}
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
          <Text style={styles.title}>Before we find your match…</Text>
          <Text style={styles.subtitle}>
            Answer these 3 questions. Your anonymous match will see your answers.
          </Text>

          {/* Progress dots */}
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

          {/* Current question card */}
          <View style={styles.card}>
            <Text style={styles.qNum}>Question {step + 1} of 3</Text>
            <Text style={styles.qText}>{questions[step]}</Text>
            <TextInput
              style={styles.input}
              value={answers[step] ?? ''}
              onChangeText={(t) => setAnswers((prev) => ({ ...prev, [step]: t }))}
              placeholder="Your answer…"
              placeholderTextColor="#555"
              multiline
              autoFocus
            />
          </View>

          {/* Navigation button */}
          {isLast ? (
            <TouchableOpacity
              style={[styles.btn, (!allAnswered || saving) && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={!allAnswered || saving}
            >
              {saving ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.btnText}>Find My Match</Text>
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

          {/* Previously answered questions */}
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
    minHeight: 90,
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
  prevTitle: { color: '#555', fontSize: 12, fontWeight: '600', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
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
