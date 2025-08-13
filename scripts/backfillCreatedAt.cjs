// scripts/backfillCreatedAt.cjs
const admin = require('firebase-admin');
const path = require('path');

// Load the service account JSON (path is relative to THIS file)
const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// CONFIG
const PAGE_SIZE = 500;      // read up to 500 docs at a time
const BATCH_LIMIT = 450;    // write no more than 450 updates per batch

async function backfill() {
  console.log('Starting backfill of createdAt for collectionGroup("items")…');

  let lastDoc = null;
  let totalChecked = 0;
  let totalUpdated = 0;

  while (true) {
    let q = db.collectionGroup('items').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const toUpdate = [];
    snap.docs.forEach((doc) => {
      totalChecked += 1;
      const createdAt = doc.get('createdAt');

      // We want to update ONLY if missing or null or wrong type
      const needs = !createdAt || !(createdAt instanceof admin.firestore.Timestamp);
      if (needs) toUpdate.push(doc.ref);
    });

    // Write in sub-batches to respect 500-write limit
    for (let i = 0; i < toUpdate.length; i += BATCH_LIMIT) {
      const slice = toUpdate.slice(i, i + BATCH_LIMIT);
      if (slice.length === 0) continue;

      const batch = db.batch();
      slice.forEach((ref) => {
        batch.update(ref, { createdAt: admin.firestore.FieldValue.serverTimestamp() });
      });
      await batch.commit();
      totalUpdated += slice.length;
      console.log(`Committed ${slice.length} updates (updated so far: ${totalUpdated})`);
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(`Scanned ${totalChecked} docs so far…`);
  }

  console.log(`Done. Scanned ${totalChecked} docs; updated ${totalUpdated} docs without createdAt.`);
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
