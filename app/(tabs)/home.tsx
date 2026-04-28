// app/(tabs)/home.tsx
import React, { useRef, useState } from 'react';
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
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../../src/firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { MatchTopSection } from '../../src/components/MatchTopSection';
import { usePersistentMatch } from '../../src/hooks/usePersistentMatch';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = SCREEN_W - 24; // 12px padding each side

/* ---------------- Admin button ---------------- */
function AdminButton() {
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [checking, setChecking] = React.useState(true);
  const router = useRouter();

  React.useEffect(() => {
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
      onPress={() => router.push('/admin/reports')}
      style={{ padding: 10, backgroundColor: '#1f2937', borderRadius: 8 }}
    >
      <Text style={{ color: '#fff', fontWeight: '700' }}>Open Admin Reports</Text>
    </TouchableOpacity>
  );
}

/* ---------------- Q&A swiper ---------------- */
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
        {items && (
          <Text style={styles.swiperPage}>{page + 1} / {items.length}</Text>
        )}
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
            onMomentumScrollEnd={(e) => {
              setPage(Math.round(e.nativeEvent.contentOffset.x / CARD_W));
            }}
            getItemLayout={(_, index) => ({
              length: CARD_W,
              offset: CARD_W * index,
              index,
            })}
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

/* ---------------- Match Q&A section ---------------- */
function MatchQASection() {
  const { hasMatch, partnerUid, isExpired, loading } = usePersistentMatch();
  const [myQA, setMyQA] = useState<QAData>(null);
  const [partnerQA, setPartnerQA] = useState<QAData>(null);
  const [fetching, setFetching] = useState(false);

  React.useEffect(() => {
    const uid = auth.currentUser?.uid ?? '';
    if (!hasMatch || isExpired || !uid) {
      setMyQA(null);
      setPartnerQA(null);
      return;
    }

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
        // ignore fetch errors
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
          </>
        }
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fetchingRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },

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
  qaCardNum: {
    color: '#CFAF45',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  qaQuestion: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  qaDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2a2a2a',
    marginBottom: 12,
  },
  qaAnswer: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },

  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2a2a2a' },
  dotActive: { backgroundColor: '#CFAF45' },
});
