/**
 * useTrendData — what the profile's Trends tab (B46) knows and how it re-reads it.
 *
 * It holds the two charts' data (every session's volume, the e1RM picker's exercises, and the
 * picked exercise's e1RM history), the chosen time window, and the picked exercise. All of it is
 * read from the phone (`trendSeries`), so the tab works with no signal.
 *
 * `reload()` re-reads everything; ProfileView calls it each time the profile comes into view with
 * Trends open — which is how a workout just finished shows up as the newest point. It keeps the
 * lifter's picked exercise when that exercise still has history, otherwise picks the one trained
 * most recently. `selectExercise()` re-reads only that exercise's e1RM history. A failed first
 * read shows the error state (with Retry); a failed re-read or pick keeps what is already on
 * screen (the ProfileView rule), so good charts never blank out. Each read is
 * numbered; an answer that lands after a newer read was started is dropped (the ProfileView
 * pattern), so a slow read can never overwrite a fresher one.
 */
import { useCallback, useRef, useState } from 'react';

import type { SqlExecutor } from '@/db/driver';
import {
  e1rmSeries,
  trendExercises,
  volumeSeries,
  type TrendExercise,
  type TrendPoint,
  type TrendWindow,
} from '@/workout/trendSeries';

/** Where the Trends tab's data stands. */
export type TrendData =
  | { status: 'idle' | 'loading' | 'error' }
  | {
      status: 'ready';
      volume: TrendPoint[];
      exercises: TrendExercise[];
      /** The exercise the e1RM chart shows (null when no exercise has an e1RM yet). */
      exerciseId: string | null;
      /** Which exercise `e1rm` belongs to — differs from `exerciseId` while a new pick is being read. */
      e1rmFor: string | null;
      e1rm: TrendPoint[];
      /** When this was read (ms since 1970) — "now" for the 3 / 6 / 12-month windows. */
      readAtMs: number;
    };

/** What the hook hands ProfileView and the Trends section. */
export interface TrendDataHandle {
  data: TrendData;
  timeWindow: TrendWindow;
  setTimeWindow: (next: TrendWindow) => void;
  reload: () => Promise<void>;
  selectExercise: (exerciseId: string) => Promise<void>;
}

/**
 * Inputs: the phone's database (null while it is still opening, or when it couldn't be opened —
 * `dbFailed` says which), and the signed-in lifter. Only ProfileView's own profile uses it.
 */
export function useTrendData(db: SqlExecutor | null, userId: string | null, dbFailed: boolean): TrendDataHandle {
  const [data, setData] = useState<TrendData>({ status: 'idle' });
  const [timeWindow, setTimeWindow] = useState<TrendWindow>('all');
  const picked = useRef<string | null>(null);
  const generation = useRef({ all: 0, e1rm: 0 });

  const reload = useCallback(async () => {
    if (!db && !dbFailed) return; // the phone's database is still opening; this reruns when it's ready
    const mine = ++generation.current.all;
    const mineE1rm = ++generation.current.e1rm;
    setData((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    try {
      if (!db || !userId) throw new Error('The phone’s workout storage couldn’t be opened');
      const [volume, exercises] = await Promise.all([volumeSeries(db, userId), trendExercises(db, userId)]);
      const wanted = picked.current;
      const exerciseId = exercises.some((e) => e.exerciseId === wanted) ? wanted : (exercises[0]?.exerciseId ?? null);
      const e1rm = exerciseId ? await e1rmSeries(db, userId, exerciseId) : [];
      if (mine !== generation.current.all) return;
      const readAtMs = Date.now();
      if (mineE1rm !== generation.current.e1rm) {
        // The lifter picked another exercise while this ran; that pick's own read owns the e1RM chart.
        setData((prev) =>
          prev.status === 'ready'
            ? { ...prev, volume, exercises, readAtMs }
            : { status: 'ready', volume, exercises, exerciseId, e1rmFor: exerciseId, e1rm, readAtMs },
        );
        return;
      }
      picked.current = exerciseId;
      setData({ status: 'ready', volume, exercises, exerciseId, e1rmFor: exerciseId, e1rm, readAtMs });
    } catch (error: unknown) {
      if (mine !== generation.current.all) return;
      console.warn('Profile: trends could not be loaded', error);
      setData((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [db, userId, dbFailed]);

  const selectExercise = useCallback(
    async (exerciseId: string) => {
      if (!db || !userId) return;
      picked.current = exerciseId;
      const mine = ++generation.current.e1rm;
      setData((prev) => (prev.status === 'ready' ? { ...prev, exerciseId } : prev));
      try {
        const e1rm = await e1rmSeries(db, userId, exerciseId);
        if (mine !== generation.current.e1rm) return;
        setData((prev) => (prev.status === 'ready' ? { ...prev, exerciseId, e1rmFor: exerciseId, e1rm } : prev));
      } catch (error: unknown) {
        if (mine !== generation.current.e1rm) return;
        // Like a failed re-read anywhere on the profile: keep what was shown — here, the
        // exercise the chart was already drawing — rather than blanking good charts.
        console.warn('Profile: the e1RM history could not be loaded', error);
        setData((prev) => {
          if (prev.status !== 'ready') return prev;
          picked.current = prev.e1rmFor;
          return { ...prev, exerciseId: prev.e1rmFor };
        });
      }
    },
    [db, userId],
  );

  return { data, timeWindow, setTimeWindow, reload, selectExercise };
}
