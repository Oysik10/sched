import { useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore, functions } from '../firebaseConfig';
import {
  collection, query, where, onSnapshot, doc, Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

export type JoinResult = {
  status: 'matched' | 'queued' | 'already_matched';
  matchId?: string;
  partnerId?: string;
  expiresAt?: string;
};

export type PersistentMatchState = {
  loading: boolean;
  inQueue: boolean;
  hasMatch: boolean;
  partnerUid: string;
  expiresAt: Timestamp | null;
  isExpired: boolean;
  joinQueue: () => Promise<JoinResult>;
  leaveQueue: () => Promise<void>;
};

export function usePersistentMatch(): PersistentMatchState {
  const [uid, setUid] = useState('');
  const [matchLoading, setMatchLoading] = useState(true);
  const [inQueue, setInQueue] = useState(false);
  const [hasMatch, setHasMatch] = useState(false);
  const [partnerUid, setPartnerUid] = useState('');
  const [expiresAt, setExpiresAt] = useState<Timestamp | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  // Auth listener
  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? '')), []);

  // Real-time listener: is user in the persistent match queue?
  useEffect(() => {
    if (!uid) { setInQueue(false); return; }
    const qRef = doc(firestore, 'persistentMatchQueue', uid);
    return onSnapshot(qRef, (snap) => setInQueue(snap.exists()), () => setInQueue(false));
  }, [uid]);

  // Real-time listener: does user have an active match?
  useEffect(() => {
    if (!uid) {
      setHasMatch(false);
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
        let partner = '';
        let exp: Timestamp | null = null;

        snap.forEach((d) => {
          const data = d.data();
          if (data.active !== true) return;
          const expMs: number = data.expiresAt?.toMillis?.() ?? 0;
          if (expMs > nowMs) {
            found = true;
            partner = (data.participants as string[]).find((p) => p !== uid) ?? '';
            exp = data.expiresAt as Timestamp;
          }
        });

        setHasMatch(found);
        setPartnerUid(partner);
        setExpiresAt(exp);
        setIsExpired(false);
        setMatchLoading(false);
      },
      () => setMatchLoading(false),
    );

    return unsub;
  }, [uid]);

  // Schedule a local isExpired flip when the expiresAt timestamp arrives
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

  return {
    loading: matchLoading,
    inQueue,
    hasMatch,
    partnerUid,
    expiresAt,
    isExpired,
    joinQueue,
    leaveQueue,
  };
}
