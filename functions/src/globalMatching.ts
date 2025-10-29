// functions/src/your-file.ts
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp, WriteBatch } from "firebase-admin/firestore";

if (!getApps().length) initializeApp();
const db = getFirestore();

/** ---------- Time helpers (DST-safe for America/Chicago) ---------- */
function zonedMs(d: Date, tz: string, hour: number, minute: number, second: number) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const y = Number(parts.year), m = Number(parts.month), day = Number(parts.day);
  const local = new Date(Date.UTC(y, m - 1, day, hour, minute, second));
  const asUTC = new Date(local.toLocaleString("en-US", { timeZone: "UTC" }));
  const asTZ  = new Date(local.toLocaleString("en-US", { timeZone: tz }));
  return local.getTime() + (asUTC.getTime() - asTZ.getTime());
}
function next1amCentral(fromMs: number) {
  const from = new Date(fromMs);
  const targetToday = zonedMs(from, "America/Chicago", 1, 0, 0);
  return targetToday <= fromMs ? targetToday + 24 * 3600 * 1000 : targetToday;
}
const addMinutes = (d: Date, mins: number) => new Date(d.getTime() + mins * 60 * 1000);
const TS = (d: Date) => Timestamp.fromDate(d);

/** ---------- Matching logic plugged into your data model ---------- */
/**
 * Fetch queue, pair users sequentially (after shuffling), create /matches docs,
 * and delete paired queue docs. Leaves last odd user in the queue.
 */
async function pairAndWriteMatches(windowMinutes: number): Promise<number> {
  const queueSnap = await db.collection("matchQueue").get();
  const queue = queueSnap.docs.map(d => ({ uid: d.id, ...d.data() })) as Array<{ uid: string }>;

  if (queue.length < 2) return 0;

  // Shuffle for fairness
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }

  const start = new Date();
  const expiresAt = TS(addMinutes(start, windowMinutes));

  let pairs = 0;
  let batch: WriteBatch = db.batch();
  let ops = 0;

  for (let i = 0; i + 1 < queue.length; i += 2) {
    const a = queue[i], b = queue[i + 1];
    const matchId = [a.uid, b.uid].sort().join("_");

    // /matches/{matchId}
    const matchRef = db.collection("matches").doc(matchId);
    batch.set(matchRef, {
      participants: [a.uid, b.uid],
      createdAt: Timestamp.now(),
      expiresAt,           // clients/rules use this
      windowMinutes,
    }, { merge: true });

    // delete both queue docs
    batch.delete(db.collection("matchQueue").doc(a.uid));
    batch.delete(db.collection("matchQueue").doc(b.uid));

    pairs++;
    ops += 3;

    // Commit every ~400 ops to avoid batch limits (500)
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
  return pairs;
}

/** =========================
 *  1) Manual: runMatchingNow
 * =========================
 * Starts the window immediately, performs matching, and rolls nextMatchAt.
 * Idempotent per UTC date via a lock.
 */
export const runMatchingNow = onRequest(async (req, res) => {
  // Optional: add admin auth check here if you expose publicly.

  const todayKey = new Date().toISOString().slice(0, 10);
  const lockRef = db.doc(`locks/match-${todayKey}`);
  const lockSnap = await lockRef.get();
  if (lockSnap.exists) {
    res.status(200).send("Already processed today");
    return;
  }
  await lockRef.create({ createdAt: FieldValue.serverTimestamp() });

  const cfgRef = db.doc("config/global");
  const stateRef = db.doc("global/matchState");
  await cfgRef.set({ status: "running" }, { merge: true });

  try {
    const cfgSnap = await cfgRef.get();
    const cfg = (cfgSnap.exists ? cfgSnap.data() : {}) ?? {};
    const windowMinutes: number = Number.isInteger(cfg.windowMinutes) ? cfg.windowMinutes : 30;

    // Activate window
    const start = new Date();
    const end = addMinutes(start, windowMinutes);
    await stateRef.set({
      isActive: true,
      startedAt: TS(start),
      endsAt: TS(end),
      windowMinutes
    }, { merge: true });

    // Do the matching now
    const madePairs = await pairAndWriteMatches(windowMinutes);

    // Roll nextMatchAt to next 1:00 AM America/Chicago
    await cfgRef.set({
      lastMatchAt: Timestamp.now(),
      nextMatchAt: TS(new Date(next1amCentral(Date.now()))),
      status: "done",
      error: FieldValue.delete(),
      lastPairs: madePairs,
    }, { merge: true });

    res.status(200).send(`OK (pairs: ${madePairs})`);
    return;
  } catch (e: any) {
    await cfgRef.set({ status: "error", error: String(e?.message || e) }, { merge: true });
    res.status(500).send("Failed");
    return;
  }
});

/** =================================
 *  2) Scheduler: scheduleDailyMatching
 * =================================
 * Runs every 5 minutes to:
 *  - end the window when past endsAt,
 *  - start the window at nextMatchAt (daily 1:00 AM Central),
 *  - perform matching at start,
 *  - and keep /config/global.nextMatchAt correct.
 */
export const scheduleDailyMatching = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "UTC",
    region: "us-central1",
    retryCount: 3,
    maxRetrySeconds: 60 * 10,
  },
  async () => {
    const cfgRef = db.doc("config/global");
    const stateRef = db.doc("global/matchState");

    const [cfgSnap, stateSnap] = await Promise.all([cfgRef.get(), stateRef.get()]);
    const cfg = (cfgSnap.exists ? cfgSnap.data() : {}) ?? {};
    const state = (stateSnap.exists ? stateSnap.data() : {}) ?? {};

    const enabled: boolean = cfg.enabled ?? true;
    const windowMinutes: number = Number.isInteger(cfg.windowMinutes) ? cfg.windowMinutes : 30;
    if (!enabled) return;

    const nowTs = Timestamp.now();
    const nowMs = nowTs.toMillis();

    const isActive: boolean = !!state.isActive;
    const endsAt: Timestamp | undefined = state.endsAt;
    let nextMatchAt: Timestamp | undefined = cfg.nextMatchAt;

    // 0) Seed nextMatchAt if missing
    if (!nextMatchAt) {
      nextMatchAt = TS(new Date(next1amCentral(nowMs)));
      await cfgRef.set({ nextMatchAt }, { merge: true });
    }

    // 1) If active and overdue, end the window
    if (isActive && endsAt && endsAt.toMillis() <= nowMs) {
      await stateRef.set({ isActive: false }, { merge: true });
      // nothing else to do this tick
      return;
    }

    // 2) If it's time to start and not active → start + match + roll next
    if (!isActive && nextMatchAt && nextMatchAt.toMillis() <= nowMs) {
      await cfgRef.set({ status: "running" }, { merge: true });

      const start = new Date();
      const end = addMinutes(start, windowMinutes);

      // Activate window
      await stateRef.set({
        isActive: true,
        startedAt: TS(start),
        endsAt: TS(end),
        windowMinutes
      }, { merge: true });

      // Perform matching at the start of the window
      const madePairs = await pairAndWriteMatches(windowMinutes);

      // Roll nextMatchAt to next daily 1am Central
      await cfgRef.set({
        lastMatchAt: nowTs,
        nextMatchAt: TS(new Date(next1amCentral(nowMs + 1000))),
        status: "done",
        error: FieldValue.delete(),
        lastPairs: madePairs,
      }, { merge: true });

      return;
    }

    // 3) Backstop: if active but endsAt missing, ensure it exists
    if (isActive && !endsAt) {
      const end = addMinutes(new Date(), windowMinutes);
      await stateRef.set({ endsAt: TS(end), windowMinutes }, { merge: true });
    }
  }
);
