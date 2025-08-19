import { useEffect, useMemo, useState } from 'react';
import { QUESTION_POOL } from '../constants/questions';
import { todayKeyUTC, msUntilNextUtcMidnight } from '../utils/day';
import { pickNDeterministic } from '../utils/random';

export function useDailyQuestions(n = 3) {
  const [dayKey, setDayKey] = useState(todayKeyUTC());

  // flip at UTC midnight even if the app stays open
  useEffect(() => {
    const ms = msUntilNextUtcMidnight();
    const id = setTimeout(() => setDayKey(todayKeyUTC()), ms + 1000);
    return () => clearTimeout(id);
  }, [dayKey]);

  const questions = useMemo(
    () => pickNDeterministic(QUESTION_POOL, n, `day:${dayKey}`),
    [dayKey, n]
  );

  return { dayKey, questions };
}
