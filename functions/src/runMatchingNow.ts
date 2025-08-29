import { onRequest } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

if (!getApps().length) initializeApp();
const db = getFirestore();

export const runMatchingNow = onRequest(async (req, res) => {
  // (Optional) add auth check here if you expose this publicly

  const todayKey = new Date().toISOString().slice(0, 10);
  const lockRef = db.doc(`locks/match-${todayKey}`);
  const lockSnap = await lockRef.get();
  if (lockSnap.exists) {
    res.status(200).send("Already processed today");
    return; // ✅ don't return the Response object
  }

  await lockRef.create({ createdAt: FieldValue.serverTimestamp() });

  const cfgRef = db.doc("config/global");
  await cfgRef.set({ status: "running" }, { merge: true });

  try {
    // YOUR matching writes ...

    const now = Timestamp.now();
    const next = Timestamp.fromMillis(next1amCentral(now.toMillis()));
    await cfgRef.set(
      { lastMatchAt: now, nextMatchAt: next, status: "done", error: FieldValue.delete() },
      { merge: true }
    );

    res.status(200).send("OK");  // ✅ send, don't return
    return;
  } catch (e: any) {
    await cfgRef.set({ status: "error", error: String(e?.message || e) }, { merge: true });
    res.status(500).send("Failed"); // ✅ send, don't return
    return;
  }
});

// helpers
function next1amCentral(fromMs: number) {
  const from = new Date(fromMs);
  const targetToday = zonedMs(from, "America/Chicago", 1, 0, 0);
  return targetToday <= fromMs ? targetToday + 24 * 3600 * 1000 : targetToday;
}
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
