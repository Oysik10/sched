import { onSnapshot, doc } from "firebase/firestore";
import { firestore } from "../firebaseConfig";
import { useEffect, useState } from "react";

export function useGlobalCountdown() {
  const [nextAtMs, setNextAtMs] = useState<number | null>(null);

  useEffect(() => {
    const ref = doc(firestore, "config", "global");
    return onSnapshot(ref, (snap) => {
      const ts: any = snap.get("nextMatchAt");
      setNextAtMs(ts ? ts.toMillis() : null);
    });
  }, []);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const msLeft = nextAtMs ? Math.max(0, nextAtMs - now) : null;
  return { msLeft, nextAtMs };
}
