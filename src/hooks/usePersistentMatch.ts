import { useEffect, useRef, useState, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore, functions } from '../firebaseConfig';
import {
  collection, query, where, onSnapshot, doc, Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { scheduleLocalNotification } from './useNotifications';

export type JoinResult = {
  status: 'matched' | 'queued' | 'already_matched';
  matchId?: string;
  partnerId?: string;
  expiresAt?: string;
};

export type CancelResult = {
  success: boolean;
  banned: boolean;
  cancellationsThisMonth: number;
};

export type PersistentMatchState = {
  loading: boolean;
  inQueue: boolean;
  hasMatch: boolean;
  matchId: string;
  partnerUid: string;
  expiresAt: Timestamp | null;
  isExpired: boolean;
  joinQueue: () => Promise<JoinResult>;
  leaveQueue: () => Promise<void>;
  cancelMatch: (reason: string) => Promise<CancelResult>;
};

export function usePersistentMatch(): PersistentMatchState {
  const [uid, setUid] = useState('');
  const [matchLoading, setMatchLoading] = useState(true);
  const [inQueue, setInQueue] = useState(false);
  const [hasMatch, setHasMatch] = useState(false);
  const [matchId, setMatchId] = useState('');
  const [partnerUid, setPartnerUid] = useState('');
  const [expiresAt, setExpiresAt] = useState<Timestamp | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? '')), []);

  useEffect(() => {
    if (!uid) { setInQueue(false); return; }
    const qRef = doc(firestore, 'persistentMatchQueue', uid);
    return onSnapshot(qRef, (snap) => setInQueue(snap.exists()), () => setInQueue(false));
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setHasMatch(false);
      setMatchId('');
      setPartnerUid('');
      setExpiresAt(null);
      setIsExpired(false);
      setMatchLoading(false);
      return;
    }

    setMatchLoading(true);
    const mQ = query(
      collection(firestore, 'matches'),
      where('participants', 'array-contains', uid),
      where('active', '==', true),
    );

    const unsub = onSnapshot(
      mQ,
      (snap) => {
        const nowMs = Date.now();
        let found = false;
        let mid = '';
        let partner = '';
        let exp: Timestamp | null = null;

        snap.forEach((d) => {
          const data = d.data();
          if (data.active !== true) return;
          const expMs: number = data.expiresAt?.toMillis?.() ?? 0;
          if (expMs > nowMs) {
            found = true;
            mid = d.id;
            partner = (data.participants as string[]).find((p) => p !== uid) ?? '';
            exp = data.expiresAt as Timestamp;
          }
        });

        setHasMatch(found);
        setMatchId(mid);
        setPartnerUid(partner);
        setExpiresAt(exp);
        setIsExpired(false);
        setMatchLoading(false);
      },
      () => setMatchLoading(false),
    );

    return unsub;
  }, [uid]);

  // Fire a local notification when a match is found (hasMatch flips false→true)
  const prevHasMatchRef = useRef(false);
  useEffect(() => {
    if (!matchLoading && hasMatch && !prevHasMatchRef.current) {
      scheduleLocalNotification(
        "You've been matched! 🔗",
        "Your 3-day anonymous chat has started. Tap to open.",
        { type: 'match_found' }
      );
    }
    prevHasMatchRef.current = hasMatch;
  }, [hasMatch, matchLoading]);

  // Fire a local notification when the match expires (isExpired flips false→true)
  const prevIsExpiredRef = useRef(false);
  useEffect(() => {
    if (isExpired && !prevIsExpiredRef.current) {
      scheduleLocalNotification(
        'Your match has ended ⏰',
        'Your 3-day anonymous chat has expired. Answer the post-match questions!',
        { type: 'match_expired' }
      );
    }
    prevIsExpiredRef.current = isExpired;
  }, [isExpired]);

  useEffect(() => {
    if (!expiresAt) { setIsExpired(false); return; }
    const msLeft = expiresAt.toMillis() - Date.now();
    if (msLeft <= 0) { setIsExpired(true); return; }
    const id = setTimeout(() => setIsExpired(true), msLeft);
    return () => clearTimeout(id);
  }, [expiresAt]);

  const joinQueue = useCallback(async (): Promise<JoinResult> => {
    if (!auth.currentUser) throw new Error('Not signed in — please restart the app and try again.');
    const fn = httpsCallable<object, JoinResult>(functions, 'joinMatchQueue');
    const result = await fn({});
    if (result.data.status === 'queued') setInQueue(true);
    return result.data;
  }, []);

  const leaveQueue = useCallback(async (): Promise<void> => {
    const fn = httpsCallable(functions, 'leaveMatchQueue');
    await fn({});
    setInQueue(false);
  }, []);

  const cancelMatch = useCallback(async (reason: string): Promise<CancelResult> => {
    if (!matchId) throw new Error('No active match to cancel');
    const fn = httpsCallable<object, CancelResult>(functions, 'cancelMatch');
    const result = await fn({ matchId, reason });
    // Optimistically clear match state
    setHasMatch(false);
    setMatchId('');
    setPartnerUid('');
    setExpiresAt(null);
    return result.data;
  }, [matchId]);

  return {
    loading: matchLoading,
    inQueue,
    hasMatch,
    matchId,
    partnerUid,
    expiresAt,
    isExpired,
    joinQueue,
    leaveQueue,
    cancelMatch,
  };
}
