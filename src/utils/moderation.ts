import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebaseConfig';

type ModerationResult = { flagged: boolean; reasons: string[] };

const BLOCKED_PATTERNS: RegExp[] = [
  /\bn[i1!][g9]{2}[ae3]r/i,
  /\bf[a@4]g{1,2}[o0]t/i,
  /\bc[u*][n]t\b/i,
  /\bk[i1]k[e3]\b/i,
  /\bch[i1]nk\b/i,
  /\bsp[i1]c\b/i,
  /\bw[e3]tb[a@4]ck\b/i,
];

function localFilter(text: string): string | null {
  for (const pat of BLOCKED_PATTERNS) {
    if (pat.test(text)) return 'prohibited language';
  }
  return null;
}

let _fn: ReturnType<typeof httpsCallable<{ text: string }, ModerationResult>> | null = null;
function getModerateFn() {
  if (!_fn) _fn = httpsCallable<{ text: string }, ModerationResult>(functions, 'moderateMessage');
  return _fn;
}

export async function checkMessage(text: string): Promise<{ blocked: boolean; reason: string | null }> {
  const localReason = localFilter(text);
  if (localReason) return { blocked: true, reason: localReason };

  try {
    const result = await getModerateFn()({ text });
    const { flagged, reasons } = result.data;
    return { blocked: flagged, reason: flagged ? reasons.join(', ') : null };
  } catch {
    return { blocked: false, reason: null };
  }
}
