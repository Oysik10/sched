import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { auth, firestore } from '../src/firebaseConfig';
import { doc, onSnapshot, DocumentSnapshot } from 'firebase/firestore';

type Props = {
  partnerUid: string;
  questionSet: string[]; // pass the 3 questions for today (UTC)
  title?: string;        // optional header text
};

function todayKeyUTC() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function extractAnswersForDay(
  snap: DocumentSnapshot,
  dayKey: string,
  count: number
): { completed: boolean; answers: string[] } {
  if (!snap.exists()) {
    return { completed: false, answers: Array(count).fill('Unanswered') };
  }
  // Flexible read: array or record
  const data: any = snap.data();
  const epi = data?.ephemeralQA || {};
  const completed = epi?.completedOn === dayKey;

  const raw = epi?.answers;
  const arr: string[] = Array(count).fill('Unanswered');

  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw)) {
      for (let i = 0; i < Math.min(count, raw.length); i++) {
        const v = (raw[i] ?? '').toString().trim();
        if (v.length > 0) arr[i] = v;
      }
    } else {
      // record-like { 0: "...", 1: "...", 2: "..." }
      for (let i = 0; i < count; i++) {
        const v = (raw[i] ?? '').toString().trim();
        if (v.length > 0) arr[i] = v;
      }
    }
  }

  // If not completed for today, force all to "Unanswered"
  if (!completed) {
    return { completed: false, answers: Array(count).fill('Unanswered') };
  }
  return { completed: true, answers: arr };
}

export default function EphemeralAnswersBlock({
  partnerUid,
  questionSet,
  title = "Today's Q&A",
}: Props) {
  const uid = auth.currentUser?.uid ?? '';
  const dayKey = todayKeyUTC();
  const [page, setPage] = useState(0); // 0 = Partner, 1 = You

  const [partnerAnswers, setPartnerAnswers] = useState<string[]>(
    Array(questionSet.length).fill('Unanswered')
  );
  const [myAnswers, setMyAnswers] = useState<string[]>(
    Array(questionSet.length).fill('Unanswered')
  );

  const [partnerDone, setPartnerDone] = useState(false);
  const [meDone, setMeDone] = useState(false);

  // Live subscribe to both user docs
  useEffect(() => {
    if (!uid || !partnerUid) return;

    const unsubMe = onSnapshot(doc(firestore, 'users', uid), (snap) => {
      const { completed, answers } = extractAnswersForDay(snap, dayKey, questionSet.length);
      setMeDone(completed);
      setMyAnswers(answers);
    });

    const unsubPartner = onSnapshot(doc(firestore, 'users', partnerUid), (snap) => {
      const { completed, answers } = extractAnswersForDay(snap, dayKey, questionSet.length);
      setPartnerDone(completed);
      setPartnerAnswers(answers);
    });

    return () => {
      unsubMe?.();
      unsubPartner?.();
    };
  }, [uid, partnerUid, dayKey, questionSet.length]);

  // For the header badge and hint
  const headerLeft = useMemo(() => (page === 0 ? 'Partner' : 'Partner'), [page]);
  const headerRight = useMemo(() => (page === 1 ? 'You' : 'You'), [page]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement } = e.nativeEvent;
    const newPage = Math.round(contentOffset.x / layoutMeasurement.width);
    setPage(newPage);
  };

  if (!uid || !partnerUid) {
    return null;
  }

  const renderSheet = (label: string, done: boolean, answers: string[]) => (
    <View style={styles.sheet}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetLabel}>{label}</Text>
        <Text style={[styles.badge, done ? styles.badgeOk : styles.badgeWarn]}>
          {done ? 'Done' : 'Unanswered'}
        </Text>
      </View>

      {questionSet.map((q, i) => (
        <View key={i} style={styles.qaBlock}>
          <Text style={styles.qText}>{i + 1}. {q}</Text>
          <View style={[styles.answerBox, !done || answers[i] === 'Unanswered' ? styles.answerBoxDim : null]}>
            <Text style={[styles.answerText, !done || answers[i] === 'Unanswered' ? styles.answerTextDim : null]}>
              {answers[i] || 'Unanswered'}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.dayKey}>UTC {dayKey}</Text>
      </View>

      {/* Swipe hint / tabs */}
      <View style={styles.tabRow}>
        <Text style={[styles.tab, page === 0 && styles.tabActive]}>Partner</Text>
        <Text style={styles.dot}>•</Text>
        <Text style={[styles.tab, page === 1 && styles.tabActive]}>You</Text>
        <Text style={styles.hint}>{page === 0 ? '  (swipe →)' : '  (← swipe back)'}</Text>
      </View>

      {/* Horizontal pager */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
      >
        <View style={{ width: '100%' }}>
          {renderSheet('Partner', partnerDone, partnerAnswers)}
        </View>
        <View style={{ width: '100%' }}>
          {renderSheet('You', meDone, myAnswers)}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
    overflow: 'hidden',
    marginHorizontal: 12,
    marginTop: 12,
  },
  titleRow: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  title: { fontSize: 16, fontWeight: '800', color: '#111' },
  dayKey: { fontSize: 12, color: '#666' },

  tabRow: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: { fontSize: 13, color: '#888', fontWeight: '700' },
  tabActive: { color: '#111' },
  dot: { marginHorizontal: 6, color: '#bbb' },
  hint: { marginLeft: 6, color: '#999', fontSize: 12 },

  sheet: { paddingHorizontal: 12, paddingBottom: 12 },
  sheetHeader: {
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetLabel: { fontSize: 14, fontWeight: '700', color: '#111' },

  qaBlock: {
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
    backgroundColor: '#fff',
    padding: 12,
  },
  qText: { fontSize: 14, fontWeight: '600', color: '#111', marginBottom: 8 },

  answerBox: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
    padding: 10,
  },
  answerBoxDim: { backgroundColor: '#f6f6f6' },

  answerText: { fontSize: 14, color: '#111' },
  answerTextDim: { color: '#999', fontStyle: 'italic' },

  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '800',
  },
  badgeOk: { backgroundColor: '#e6ffed', color: '#0a7f2e' },
  badgeWarn: { backgroundColor: '#fff5f5', color: '#a61b1b' },
});
