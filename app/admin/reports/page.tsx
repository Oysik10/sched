"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, onSnapshot, orderBy, query, updateDoc, where, addDoc, serverTimestamp
} from "firebase/firestore";
import { firestore } from "../../../src/firebaseConfig"; 
import { getAuth, onAuthStateChanged } from "firebase/auth";

type Report = {
  id: string;
  type: "dm_message";
  threadId: string;
  messageId: string;
  offenderId: string;
  reporterId: string;
  text: string;
  replyTo?: any;
  createdAtMs: number;
  status: "open" | "review_pending" | "actioned" | "dismissed";
  labels?: string[];
  actionLog?: Array<{ by: string; action: string; atMs: number; notes?: string }>;
};

export default function ReportsAdminPage() {
  const [uid, setUid] = useState<string>("");
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    const auth = getAuth();
    return onAuthStateChanged(auth, (u) => setUid(u?.uid ?? ""));
  }, []);

  // Subscribe to open/pending reports
  useEffect(() => {
    const reportsRef = collection(firestore, "reports");
    // status IN ['open','review_pending']
    const qy = query(
      reportsRef,
      where("status", "in", ["open", "review_pending"]),
      orderBy("createdAtMs", "desc")
    );
    const unsub = onSnapshot(qy, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Report[];
      setReports(rows);
    });
    return unsub;
  }, []);

  const formatTime = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  // ---- Admin actions (require admin claim via Security Rules) ----
  const logAction = async (reportId: string, by: string, action: string, notes?: string) => {
    const repRef = doc(firestore, "reports", reportId);
    await updateDoc(repRef, {
      actionLog: (window as any).firebase?.firestore?.FieldValue?.arrayUnion?.({ by, action, atMs: Date.now(), notes })
    } as any);
  };

  const dismiss = async (r: Report) => {
    await updateDoc(doc(firestore, "reports", r.id), { status: "dismissed" });
    await logAction(r.id, uid, "dismiss");
  };

  const softRemoveForAll = async (r: Report) => {
    // Hide message for both participants (and keep original text only in the report)
    const msgRef = doc(firestore, "dms", r.threadId, "items", r.messageId);
    await updateDoc(msgRef, {
      reported: {
        status: "reviewed",
        reportedAtMs: r.createdAtMs,
        reportedBy: [r.reporterId],
        hiddenFor: { [r.offenderId]: true, [r.reporterId]: true },
      },
    } as any);

    // Optional: write a system activity on thread
    await updateDoc(doc(firestore, "dms", r.threadId), {
      lastActivity: { type: "report", actorId: uid, text: "A message was removed", atMs: Date.now() },
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
    } as any);

    await updateDoc(doc(firestore, "reports", r.id), { status: "actioned" });
    await logAction(r.id, uid, "soft_remove");
  };

  const warnUser = async (r: Report, notes?: string) => {
    // Add a strike to offender
    await addDoc(collection(firestore, "users", r.offenderId, "strikes"), {
      reason: "policy_violation",
      reportId: r.id,
      atMs: Date.now(),
      notes: notes || null,
    });
    await updateDoc(doc(firestore, "reports", r.id), { status: "actioned" });
    await logAction(r.id, uid, "warn", notes);
  };

  const tempSuspend = async (r: Report, days = 7) => {
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    await updateDoc(doc(firestore, "users", r.offenderId), { suspendedUntilMs: until } as any);
    await updateDoc(doc(firestore, "reports", r.id), { status: "actioned" });
    await logAction(r.id, uid, `temp_suspend_${days}d`);
  };

  const banUser = async (r: Report) => {
    await updateDoc(doc(firestore, "users", r.offenderId), { banned: true } as any);
    await updateDoc(doc(firestore, "reports", r.id), { status: "actioned" });
    await logAction(r.id, uid, "ban");
  };

  // Simple label for quick categorization
  const label = async (r: Report, tag: string) => {
    const repRef = doc(firestore, "reports", r.id);
    await updateDoc(repRef, {
      labels: (window as any).firebase?.firestore?.FieldValue?.arrayUnion?.(tag)
    } as any);
    await logAction(r.id, uid, `label_${tag}`);
  };

  const rows = useMemo(() => reports, [reports]);

  return (
    <div className="p-4 text-white">
      <h1 className="text-xl font-bold mb-4">Admin · Report Review</h1>

      {rows.length === 0 ? (
        <div className="text-gray-400">No open reports.</div>
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-2xl border border-neutral-800 p-4 bg-neutral-950">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  <span className="mr-2">#{r.id.slice(0, 6)}</span>
                  <span>{formatTime(r.createdAtMs)}</span>
                </div>
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    r.status === "open" ? "bg-amber-900/40 text-amber-200"
                    : r.status === "review_pending" ? "bg-purple-900/40 text-purple-200"
                    : r.status === "actioned" ? "bg-green-900/40 text-green-200"
                    : "bg-gray-800 text-gray-300"
                  }`}
                >
                  {r.status}
                </span>
              </div>

              <div className="mt-3 text-sm text-gray-300">
                <div><b>Thread:</b> {r.threadId}</div>
                <div><b>Message:</b> {r.messageId}</div>
                <div><b>Offender:</b> {r.offenderId}</div>
                <div><b>Reporter:</b> {r.reporterId}</div>
              </div>

              <div className="mt-3 p-3 rounded bg-neutral-900 border border-neutral-800">
                <div className="text-xs uppercase text-gray-400 mb-1">Reported text</div>
                <div className="text-gray-100">{r.text || <i className="text-gray-400">— empty —</i>}</div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => label(r, "harassment")} className="px-2 py-1 rounded bg-neutral-800 text-xs">label: harassment</button>
                <button onClick={() => label(r, "hate")} className="px-2 py-1 rounded bg-neutral-800 text-xs">label: hate</button>
                <button onClick={() => label(r, "spam")} className="px-2 py-1 rounded bg-neutral-800 text-xs">label: spam</button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => softRemoveForAll(r)} className="px-3 py-2 rounded bg-red-700 hover:bg-red-600 text-sm font-semibold">Remove for all</button>
                <button onClick={() => warnUser(r)} className="px-3 py-2 rounded bg-amber-700 hover:bg-amber-600 text-sm font-semibold">Warn</button>
                <button onClick={() => tempSuspend(r, 7)} className="px-3 py-2 rounded bg-purple-700 hover:bg-purple-600 text-sm font-semibold">Suspend 7d</button>
                <button onClick={() => banUser(r)} className="px-3 py-2 rounded bg-fuchsia-700 hover:bg-fuchsia-600 text-sm font-semibold">Ban</button>
                <button onClick={() => dismiss(r)} className="px-3 py-2 rounded bg-neutral-700 hover:bg-neutral-600 text-sm font-semibold">Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
