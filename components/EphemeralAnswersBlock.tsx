// components/EphemeralAnswersBlock.tsx
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  useWindowDimensions,
} from 'react-native';
import { auth, firestore } from '../src/firebaseConfig';
import { doc, onSnapshot, DocumentSnapshot } from 'firebase/firestore';

type Props = {
  partnerUid: string;
  questionSet: string[]; // today's 3 questions (UTC)
  title?: string;
};

const TAB_INNER_RATIO = 0.9;  // shrink tab content to 90% of screen
const MAX_TAB_WIDTH   = 560;  // cap on tablets

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
  if (!snap.exists()) return { completed: false, answers: Array(count).fill('Unanswered') };

  const epi = (snap.data() as any)?.ephemeralQA || {};
  const completed = epi?.completedOn === dayKey;

  const out = Array<string>(count).fill('Unanswered');
  const raw = epi?.answers;

  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw)) {
      for (let i = 0; i < Math.min(count, raw.length); i++) {
        const v = String(raw[i] ?? '').trim();
        if (v) out[i] = v;
      }
    } else {
      for (let i = 0; i < count; i++) {
        const v = String(raw[i] ?? '').trim();
        if (v) out[i] = v;
      }
    }
  }

  if (!completed) return { completed: false, answers: Array(count).fill('Unanswered') };
  return { completed: true, answers: out };
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

  const { width } = useWindowDimensions(); 
  const [pageWidth, setPageWidth] = useState(width); 

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

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement } = e.nativeEvent;
    const newPage = Math.round(contentOffset.x / layoutMeasurement.width);
    setPage(newPage);
  };

    const TabSheet = ({
    label,
    done,
    answers,
    }: {
    label: 'Partner' | 'You';
    done: boolean;
    answers: string[];
    }) => (
    <View style={[styles.sheetPage, { width: pageWidth }]}>
        <View
        style={[
            styles.tabInner,
            { width: Math.min(Math.round(pageWidth * TAB_INNER_RATIO), MAX_TAB_WIDTH) },
        ]}
        >
        <View style={styles.sheetHeader}>
            <Text style={styles.sheetLabel}>{label}</Text>
            <Text style={[styles.badge, done ? styles.badgeOk : styles.badgeWarn]}>
            {done ? 'Done' : 'Unanswered'}
            </Text>
        </View>

        {questionSet.map((q, i) => (
            <View key={i} style={styles.qaBlock}>
            <Text style={styles.qText}>{i + 1}. {q}</Text>
            <View
                style={[
                styles.answerBox,
                { width: '100%' },
                (!done || answers[i] === 'Unanswered') && styles.answerBoxDim,
                ]}
            >
                <Text
                style={[
                    styles.answerText,
                    (!done || answers[i] === 'Unanswered') && styles.answerTextDim,
                ]}
                >
                {answers[i] || 'Unanswered'}
                </Text>
            </View>
            </View>
        ))}
        </View>
    </View>
    );



  if (!uid || !partnerUid) return null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.dayKey}>{dayKey}</Text>
      </View>

      {/* Pager */}
    <ScrollView
    horizontal
    pagingEnabled
    showsHorizontalScrollIndicator={false}
    onMomentumScrollEnd={onScrollEnd}
    onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}
    >
    <TabSheet label="Partner" done={partnerDone} answers={partnerAnswers} />
    <TabSheet label="You"     done={meDone}      answers={myAnswers} />
    </ScrollView>




      {/* Bottom page indicator */}
      <View style={styles.indicatorRow}>
        <View style={[styles.indicatorDot, page === 0 && styles.indicatorActive]} />
        <View style={[styles.indicatorDot, page === 1 && styles.indicatorActive]} />
      </View>
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

  sheetPage: { paddingBottom: 12 },
  tabInner: { alignSelf: 'center', paddingHorizontal: 8 },

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
    alignSelf: 'center',
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

  indicatorRow: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexDirection: 'row',
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#d6d6d6',
  },
  indicatorActive: { backgroundColor: '#111' },
});
