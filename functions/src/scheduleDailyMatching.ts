import { onSchedule } from "firebase-functions/v2/scheduler";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

// Admin SDK init (bypasses Firestore rules for server writes)
if (!getApps().length) initializeApp();
const db = getFirestore();

/**
 * Scheduled daily matching at 1:00 AM America/Chicago
 * No gcloud needed: `firebase deploy --only functions` will create the Cloud Scheduler job automatically.
 */
export const scheduleDailyMatching = onSchedule(
  {
    schedule: "2 0 * * *",            // 1:00 AM every day
    timeZone: "America/Chicago",      // DST-safe
    retryCount: 3,                     // basic retries (optional)
    maxRetrySeconds: 60 * 10           // 10 minutes (optional)
  },
  async (event) => {
    // ---- Idempotency guard (one run per date) ----
    const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC date)
    const lockRef = db.doc(`locks/match-${todayKey}`);
    const lockSnap = await lockRef.get();
    if (lockSnap.exists) {
      // Already ran today (or running)
      return;
    }
    await lockRef.create({ createdAt: FieldValue.serverTimestamp() });

    // Update status
    const cfgRef = db.doc("config/global");
    await cfgRef.set({ status: "running" }, { merge: true });

    try {
      // 1) Load candidates you want to match (YOUR LOGIC)
      // const usersSnap = await db.collection('users').get();
      // 2) Compute matches (YOUR LOGIC)
      // 3) Write match results (YOUR LOGIC)

      // 4) Update the global clock so clients can count down
      const now = Timestamp.now();
      const next = Timestamp.fromMillis(next1amCentral(now.toMillis()));
      await cfgRef.set(
        { lastMatchAt: now, nextMatchAt: next, status: "done", error: FieldValue.delete() },
        { merge: true }
      );
    } catch (e: any) {
      await cfgRef.set({ status: "error", error: String(e?.message || e) }, { merge: true });
      throw e; // let the scheduler retry
    }
  }
);

// Compute the next 1:00 AM America/Chicago in UTC ms (DST-safe)
function next1amCentral(fromMs: number) {
  const from = new Date(fromMs);
  const targetToday = zonedMs(from, "America/Chicago", 1, 0, 0);
  return targetToday <= fromMs ? targetToday + 24 * 3600 * 1000 : targetToday;
}

/** Convert a wall-clock time in a TZ to the real UTC ms for that instant */
function zonedMs(d: Date, tz: string, hour: number, minute: number, second: number) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const y = Number(parts.year), m = Number(parts.month), day = Number(parts.day);
  const local = new Date(Date.UTC(y, m - 1, day, hour, minute, second));
  const asUTC = new Date(local.toLocaleString("en-US", { timeZone: "UTC" }));
  const asTZ  = new Date(local.toLocaleString("en-US", { timeZone: tz }));
  return local.getTime() + (asUTC.getTime() - asTZ.getTime());
}
