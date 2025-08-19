import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from '../firebaseConfig'; // adjust path
import {
  collection, getDocs, query, where, Timestamp, doc, getDoc, setDoc
} from 'firebase/firestore';
import { todayKeyUTC } from '../utils/day';

type MatchDoc = {
  participants: string[];
  createdAt?: any;
  expiresAt?: Timestamp | null;
  active?: boolean;
};

function msLeft(expiresAt?: Timestamp | null) {
  if (!expiresAt) return 0;
  return expiresAt.toMillis() - Date.now();
}
function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

export function useActiveEphemeralMatch() {
  const [uid, setUid] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const [hasActiveMatch, setHasActiveMatch] = useState(false);
  const [partnerUid, setPartnerUid] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<Timestamp | null>(null);

  const [meDone, setMeDone] = useState(false);
  const [partnerDone, setPartnerDone] = useState<boolean | null>(null);

  const dayKey = todayKeyUTC();

  // subscribe to auth
  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? '')), []);

  // fetch match + completion
  useEffect(() => {
    if (!uid) {
      setHasActiveMatch(false);
      setPartnerUid('');
      setExpiresAt(null);
      setMeDone(false);
      setPartnerDone(null);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        // me completion
        const meRef = doc(firestore, 'users', uid);
        const meSnap = await getDoc(meRef);
        setMeDone(meSnap.exists() && (meSnap.data()?.ephemeralQA?.completedOn === dayKey));

        // active match
        const mQ = query(
          collection(firestore, 'matches'),
          where('participants', 'array-contains', uid),
          where('active', '==', true),
        );
        const mSnap = await getDocs(mQ);

        let best: MatchDoc | null = null;
        let bestCreated = -1;
        let partner = '';
        let exp: Timestamp | null = null;

        mSnap.forEach((d) => {
          const data = d.data() as MatchDoc;
          if (data.active !== true || msLeft(data.expiresAt) <= 0) return;
          const created = (data.createdAt?.seconds ?? 0) as number;
          if (created >= bestCreated) {
            bestCreated = created;
            best = data;
            partner = (data.participants || []).find((p) => p !== uid) || '';
            exp = data.expiresAt ?? null;
          }
        });

        setHasActiveMatch(!!best && !!partner);
        setPartnerUid(partner || '');
        setExpiresAt(exp || null);

        if (partner) {
          const pSnap = await getDoc(doc(firestore, 'users', partner));
          setPartnerDone(pSnap.exists() && (pSnap.data()?.ephemeralQA?.completedOn === dayKey));
        } else {
          setPartnerDone(null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [uid, dayKey]);

  const ensureThreadIfBothDone = async () => {
    if (!uid || !partnerUid) return;
    const tid = threadIdFor(uid, partnerUid);
    await setDoc(
      doc(firestore, 'dms', tid),
      { participants: [uid, partnerUid].sort() },
      { merge: true }
    );
  };

  return {
    loading,
    uid,
    dayKey,
    hasActiveMatch,
    partnerUid,
    expiresAt,
    meDone,
    partnerDone,
    ensureThreadIfBothDone,
  };
}
