// src/dmUtils.ts
import {
  collection, query, where, getDocs, writeBatch, doc, limit, deleteDoc
} from 'firebase/firestore';
import { firestore } from './firebaseConfig';

/**
 * Deletes the DM thread (and all its items) between two users, if it exists.
 */
export async function deleteDmBetween(uid: string, otherId: string) {
  if (!uid || !otherId) return;

  // Find the thread by querying your own participation, then filtering for the other user.
  const q = query(collection(firestore, 'dms'), where('participants', 'array-contains', uid));
  const snap = await getDocs(q);
  const threadDoc = snap.docs.find(d => {
    const parts: string[] = (d.data() as any).participants || [];
    return parts.includes(uid) && parts.includes(otherId);
  });

  if (!threadDoc) return; // Nothing to delete

  const threadId = threadDoc.id;

  // Delete messages in batches
  while (true) {
    const itemsSnap = await getDocs(
      query(collection(firestore, 'dms', threadId, 'items'), limit(500))
    );
    if (itemsSnap.empty) break;

    const batch = writeBatch(firestore);
    itemsSnap.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // Delete the thread itself
  await deleteDoc(doc(firestore, 'dms', threadId));
}
