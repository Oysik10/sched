// app/(tabs)/home.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  StyleSheet,
  FlatList,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useRouter, router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../../src/firebaseConfig';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { MatchTopSection } from '../../src/components/MatchTopSection';
import { usePersistentMatch } from '../../src/hooks/usePersistentMatch';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = SCREEN_W - 24;

/* ---------------- Admin button ---------------- */
function AdminButton() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const nav = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setIsAdmin(false); setChecking(false); return; }
      const token = await u.getIdTokenResult(true);
      setIsAdmin(!!token.claims?.admin);
      setChecking(false);
    });
    return unsub;
  }, []);

  if (checking || !isAdmin) return null;
  return (
    <TouchableOpacity
      onPress={() => nav.push('/admin/reports')}
      style={{ padding: 10, backgroundColor: '#1f2937', borderRadius: 8 }}
    >
      <Text style={{ color: '#fff', fontWeight: '700' }}>Open Admin Reports</Text>
    </TouchableOpacity>
  );
}

/* ---------------- Q&A swiper (active match) ---------------- */
type QAData = { questions: string[]; answers: string[] } | null;

function QASwiper({ data, label }: { data: QAData; label: string }) {
  const [page, setPage] = useState(0);
  const listRef = useRef<FlatList>(null);

  const items = data?.questions?.length
    ? data.questions.map((q, i) => ({ q, a: data.answers?.[i] ?? '—' }))
    : null;

  return (
    <View style={styles.swiperSection}>
      <View style={styles.swiperHeader}>
        <Text style={styles.swiperLabel}>{label}</Text>
        {items && <Text style={styles.swiperPage}>{page + 1} / {items.length}</Text>}
      </View>
      {!items ? (
        <View style={styles.swiperEmpty}>
          <Text style={styles.swiperEmptyText}>No answers yet</Text>
        </View>
      ) : (
        <>
          <FlatList
            ref={listRef}
            data={items}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setPage(Math.round(e.nativeEvent.contentOffset.x / CARD_W))
            }
            getItemLayout={(_, index) => ({ length: CARD_W, offset: CARD_W * index, index })}
            renderItem={({ item, index }) => (
              <View style={[styles.qaCard, { width: CARD_W }]}>
                <Text style={styles.qaCardNum}>Q{index + 1}</Text>
                <Text style={styles.qaQuestion}>{item.q}</Text>
                <View style={styles.qaDivider} />
                <Text style={styles.qaAnswer}>{item.a}</Text>
              </View>
            )}
            keyExtractor={(_, i) => String(i)}
          />
          <View style={styles.dotsRow}>
            {items.map((_, i) => (
              <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

/* ---------------- Active-match Q&A section ---------------- */
function MatchQASection() {
  const { hasMatch, partnerUid, isExpired, loading } = usePersistentMatch();
  const [myQA, setMyQA] = useState<QAData>(null);
  const [partnerQA, setPartnerQA] = useState<QAData>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid ?? '';
    if (!hasMatch || isExpired || !uid) { setMyQA(null); setPartnerQA(null); return; }

    let cancelled = false;
    setFetching(true);
    (async () => {
      try {
        const fetches: Promise<any>[] = [getDoc(doc(firestore, 'users', uid))];
        if (partnerUid) fetches.push(getDoc(doc(firestore, 'users', partnerUid)));
        const [mySnap, partnerSnap] = await Promise.all(fetches);
        if (cancelled) return;
        setMyQA(mySnap.exists() ? (mySnap.data()?.matchQA ?? null) : null);
        setPartnerQA(partnerSnap?.exists() ? (partnerSnap.data()?.matchQA ?? null) : null);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hasMatch, isExpired, partnerUid]);

  if (loading || !hasMatch || isExpired) return null;
  if (fetching) {
    return (
      <View style={styles.fetchingRow}>
        <ActivityIndicator size="small" color="#CFAF45" />
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 4 }}>
      <QASwiper data={myQA} label="Your answers" />
      <QASwiper data={partnerQA} label="Match's answers" />
    </View>
  );
}

/* ---------------- Post-match guess section ---------------- */
type LastMatch = {
  matchId: string;
  partnerUid: string;
  active: boolean;
  expiresAtMs: number;
};

type PostGuess = {
  matchId: string;
  questions: string[];
  answers: string[];
  completedAt: number;
};

function isMatchOver(m: LastMatch): boolean {
  return !m.active || m.expiresAtMs < Date.now();
}

function PostMatchSection() {
  const uid = auth.currentUser?.uid ?? '';
  const [lastMatch, setLastMatch] = useState<LastMatch | null>(null);
  const [myGuess, setMyGuess] = useState<PostGuess | null>(null);
  const [partnerGuess, setPartnerGuess] = useState<PostGuess | null>(null);
  const [verdicts, setVerdicts] = useState<Record<number, boolean>>({});
  const [savingVerdict, setSavingVerdict] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  // Subscribe to most recent match
  useEffect(() => {
    if (!uid) { setLoadingData(false); return; }

    const q = query(
      collection(firestore, 'matches'),
      where('participants', 'array-contains', uid),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) { setLastMatch(null); setLoadingData(false); return; }
        const d = snap.docs[0];
        const data = d.data();
        setLastMatch({
          matchId: d.id,
          partnerUid: ((data.participants as string[]) || []).find((p) => p !== uid) ?? '',
          active: data.active === true,
          expiresAtMs: (data.expiresAt as Timestamp)?.toMillis?.() ?? 0,
        });
        setLoadingData(false);
      },
      () => setLoadingData(false)
    );
    return unsub;
  }, [uid]);

  // Fetch my post-match guess and partner's guess when last match is over
  useEffect(() => {
    if (!lastMatch || !isMatchOver(lastMatch) || !uid) {
      setMyGuess(null);
      setPartnerGuess(null);
      setVerdicts({});
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const fetches: Promise<any>[] = [
          getDoc(doc(firestore, 'users', uid)),
          lastMatch.partnerUid
            ? getDoc(doc(firestore, 'users', lastMatch.partnerUid))
            : Promise.resolve(null),
        ];
        const [mySnap, partnerSnap] = await Promise.all(fetches);
        if (cancelled) return;

        const myData = mySnap.exists() ? mySnap.data() : {};
        const myG = myData.postMatchGuess ?? null;
        setMyGuess(myG?.matchId === lastMatch.matchId ? myG : null);

        const partnerData = partnerSnap?.exists() ? partnerSnap.data() : {};
        const pG = partnerData?.postMatchGuess ?? null;
        setPartnerGuess(pG?.matchId === lastMatch.matchId ? pG : null);

        // Load saved verdicts
        const savedV = myData.postMatchVerdicts ?? null;
        if (savedV?.matchId === lastMatch.matchId && savedV.verdicts) {
          setVerdicts(savedV.verdicts as Record<number, boolean>);
        } else {
          setVerdicts({});
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [lastMatch, uid]);

  const saveVerdict = async (idx: number, correct: boolean) => {
    if (!lastMatch || !uid) return;
    const updated = { ...verdicts, [idx]: correct };
    setVerdicts(updated);
    setSavingVerdict(true);
    try {
      await setDoc(
        doc(firestore, 'users', uid),
        { postMatchVerdicts: { matchId: lastMatch.matchId, verdicts: updated } },
        { merge: true }
      );
    } catch {
      // revert optimistic update if failed
      setVerdicts(verdicts);
    } finally {
      setSavingVerdict(false);
    }
  };

  if (loadingData) return null;
  if (!lastMatch || !isMatchOver(lastMatch)) return null;

  const guessComplete = !!myGuess;
  const partnerDone = !!partnerGuess;

  return (
    <View style={styles.postSection}>
      {/* Section header */}
      <Text style={styles.postTitle}>Post-Match</Text>
      <Text style={styles.postSubtitle}>
        {lastMatch.active === false ? 'Match was cancelled' : 'Your 3-day match has ended'}
      </Text>

      {/* Your guess CTA */}
      <View style={styles.postCard}>
        <View style={styles.postCardHeader}>
          <Text style={styles.postCardTitle}>Your guesses about them</Text>
          {guessComplete && (
            <View style={styles.doneBadge}>
              <Text style={styles.doneBadgeText}>Done ✓</Text>
            </View>
          )}
        </View>

        {guessComplete ? (
          <View style={{ gap: 10 }}>
            {myGuess.questions.map((q, i) => (
              <View key={i} style={styles.guessRow}>
                <Text style={styles.guessQ}>{q}</Text>
                <Text style={styles.guessA}>{myGuess.answers[i]}</Text>
              </View>
            ))}
          </View>
        ) : (
          <>
            <Text style={styles.postCardHint}>
              Answer 2 quick questions about your anonymous match.
            </Text>
            <TouchableOpacity
              style={styles.guessBtn}
              onPress={() =>
                router.push(
                  `/match/post-match-guess?matchId=${lastMatch.matchId}&partnerUid=${lastMatch.partnerUid}` as any
                )
              }
            >
              <Text style={styles.guessBtnText}>Start Guess</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Partner's guesses about you */}
      <View style={styles.postCard}>
        <Text style={styles.postCardTitle}>Their guesses about you</Text>

        {!partnerDone ? (
          <Text style={styles.waitingText}>
            Waiting for your match to finish their guesses…
          </Text>
        ) : (
          <View style={{ gap: 12 }}>
            {partnerGuess.questions.map((q, i) => {
              const verdict = verdicts[i];
              const hasVerdict = verdict !== undefined;
              return (
                <View key={i} style={styles.verdictBlock}>
                  <Text style={styles.verdictQ}>{q}</Text>
                  <Text style={styles.verdictA}>"{partnerGuess.answers[i]}"</Text>
                  <View style={styles.verdictBtns}>
                    <TouchableOpacity
                      style={[
                        styles.verdictBtn,
                        styles.verdictCorrect,
                        hasVerdict && verdict !== true && styles.verdictBtnDim,
                        hasVerdict && verdict === true && styles.verdictCorrectActive,
                      ]}
                      onPress={() => saveVerdict(i, true)}
                      disabled={savingVerdict}
                    >
                      <Text style={[
                        styles.verdictBtnText,
                        hasVerdict && verdict === true && styles.verdictBtnTextActive,
                      ]}>
                        ✓ Correct
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.verdictBtn,
                        styles.verdictWrong,
                        hasVerdict && verdict !== false && styles.verdictBtnDim,
                        hasVerdict && verdict === false && styles.verdictWrongActive,
                      ]}
                      onPress={() => saveVerdict(i, false)}
                      disabled={savingVerdict}
                    >
                      <Text style={[
                        styles.verdictBtnText,
                        hasVerdict && verdict === false && styles.verdictBtnTextActive,
                      ]}>
                        ✗ Wrong
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

/* ---------------- Home screen ---------------- */
export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={
          <>
            <AdminButton />
            <MatchTopSection />
            <MatchQASection />
            <PostMatchSection />
          </>
        }
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

/* ---------------- Styles ---------------- */
const styles = StyleSheet.create({
  fetchingRow: { paddingVertical: 24, alignItems: 'center' },

  // Active-match Q&A swiper
  swiperSection: { marginBottom: 16 },
  swiperHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  swiperLabel: { color: '#888', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  swiperPage: { color: '#555', fontSize: 12 },
  swiperEmpty: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  swiperEmptyText: { color: '#444', fontSize: 14 },
  qaCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  qaCardNum: { color: '#CFAF45', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  qaQuestion: { color: '#aaa', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  qaDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#2a2a2a', marginBottom: 12 },
  qaAnswer: { color: '#fff', fontSize: 15, lineHeight: 22, fontWeight: '500' },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2a2a2a' },
  dotActive: { backgroundColor: '#CFAF45' },

  // Post-match section
  postSection: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 8,
  },
  postTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 2 },
  postSubtitle: { color: '#555', fontSize: 13, marginBottom: 14 },

  postCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    marginBottom: 12,
  },
  postCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  postCardTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  postCardHint: { color: '#666', fontSize: 13, marginBottom: 12, lineHeight: 18 },

  doneBadge: { backgroundColor: '#1a3a1a', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  doneBadgeText: { color: '#4ade80', fontSize: 12, fontWeight: '700' },

  guessBtn: {
    backgroundColor: '#CFAF45',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  guessBtnText: { color: '#000', fontWeight: '800', fontSize: 14 },

  guessRow: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#222',
  },
  guessQ: { color: '#555', fontSize: 12, marginBottom: 4 },
  guessA: { color: '#ddd', fontSize: 14, fontWeight: '500' },

  waitingText: { color: '#555', fontSize: 13, textAlign: 'center', paddingVertical: 12 },

  verdictBlock: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#222',
  },
  verdictQ: { color: '#777', fontSize: 12, marginBottom: 4 },
  verdictA: { color: '#fff', fontSize: 14, fontWeight: '500', marginBottom: 10, lineHeight: 20 },
  verdictBtns: { flexDirection: 'row', gap: 8 },
  verdictBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  verdictCorrect: { borderColor: '#2d5a2d', backgroundColor: '#0f1f0f' },
  verdictCorrectActive: { borderColor: '#4ade80', backgroundColor: '#1a3a1a' },
  verdictWrong: { borderColor: '#5a2d2d', backgroundColor: '#1f0f0f' },
  verdictWrongActive: { borderColor: '#f87171', backgroundColor: '#3a1a1a' },
  verdictBtnDim: { opacity: 0.35 },
  verdictBtnText: { color: '#666', fontSize: 13, fontWeight: '600' },
  verdictBtnTextActive: { color: '#fff' },
});
