// src/utils/createNotification.ts
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { firestore } from '../firebaseConfig';

export type NotifType =
  | 'friend_request'
  | 'friend_accepted'
  | 'match_found'
  | 'match_expired'
  | 'match_cancelled'
  | 'new_message';

export interface NotifPayload {
  type: NotifType;
  title: string;
  body: string;
  fromUid?: string;
  data?: Record<string, any>;
}

export async function createNotification(
  recipientUid: string,
  payload: NotifPayload
): Promise<void> {
  if (!recipientUid) return;
  await addDoc(collection(firestore, 'users', recipientUid, 'notifications'), {
    ...payload,
    read: false,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
}
