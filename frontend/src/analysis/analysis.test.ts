/**
 * Tests for the phone side of the post-workout analysis (B18): the offline computation, the
 * stored copy, the screen's freshness rule, and the sync engine's request pass — end to end
 * against the fake server, which runs the same shared rules the real server function does.
 * Real SQLite (node driver), never the live project.
 */
import { describe, expect, it } from '@jest/globals';
import { ANALYSIS_ENGINE_VERSION } from '@analysis';

import { prepareDatabase } from '@/db/database';
import { getRowsByIds, upsertRows, type WorkoutRow } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { SyncEngine } from '@/sync/engine';
import { outboxSize } from '@/sync/outbox';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { steadyOptions } from '@/test-utils/loggerTestKit';
import { USER_ID } from '@/test-utils/workoutFixtures';
import { startActiveWorkout } from '@/workout/activeWorkout';
import { deleteWorkout, openWorkoutForEdit } from '@/workout/editWorkout';
import { currentPrs } from '@/workout/prs';

import {
  ANALYSIS_BATCH_LIMIT,
  analysisForScreen,
  hasPendingInputs,
  localAnalysis,
  storedAnalysis,
  workoutsNeedingAnalysis,
} from './analysis';

const SQUAT = libraryExerciseId('squat');
const BENCH = libraryExerciseId('bench_press');

/** A fresh phone, a fake server that knows the library exercises' names, and an engine. */
async function setup(server = new FakeServer()) {
  const db = await prepareDatabase(createNodeSqliteDriver());
  const library = await getRowsByIds(db, 'exercises', [SQUAT, BENCH]);
  server.seed('exercises', library);
  const logs: string[] = [];
  const engine = new SyncEngine({ db, transport: server, userId: USER_ID, debounceMs: 10, log: (m) => logs.push(m) });
  return { db, server, engine, logs };
}

/** Finishes a workout: squat warm-up 10×20 kg, 5×100 kg, 3×120 kg; bench 8 reps bodyweight. */
async function finishSession(db: SqlDriver, start = '2026-11-14T09:00:00.000Z'): Promise<string> {
  const store = await startActiveWorkout(db, USER_ID, steadyOptions(start));
  const squat = await store.addExercise(SQUAT);
  await store.logSet(squat.id, { reps: 10, weight: { value: 20, unit: 'kg' }, isWarmup: true });
  await store.logSet(squat.id, { reps: 5, weight: { value: 100, unit: 'kg' } });
  await store.logSet(squat.id, { reps: 3, weight: { value: 120, unit: 'kg' } });
  const bench = await store.addExercise(BENCH);
  await store.logSet(bench.id, { reps: 8 });
  const workout = await store.finish();
  return workout.id;
}

describe('localAnalysis — the offline computation (ANA-2)', () => {
  it('matches the logged data exactly, and its PRs are the saved workout’s badge rows', async () => {
    const { db } = await setup();
    const id = await finishSession(db);
    const analysis = await localAnalysis(db, USER_ID, id);
    // 5×100 + 3×120 = 860 kg; the warm-up and the bodyweight set add nothing.
    expect(analysis?.total_volume_kg).toBe(860);
    expect(analysis?.total_sets).toBe(4);
    expect(analysis?.working_sets).toBe(3);
    // steadyOptions moves one minute per clock reading; the workout spans its readings.
    const w = await db.getFirstAsync<{ started_at: string; ended_at: string }>('select started_at, ended_at from workouts');
    expect(analysis?.duration_seconds).toBe((Date.parse(w!.ended_at) - Date.parse(w!.started_at)) / 1000);
    expect(analysis?.headline).toMatch(/personal record/);

    // One rule everywhere: the analysis's PRs are exactly the records citing this workout's sets.
    const setIds = new Set(
      (await db.getAllAsync<{ id: string }>('select id from sets')).map((s) => s.id),
    );
    const badges = [...(await currentPrs(db, USER_ID, SQUAT)), ...(await currentPrs(db, USER_ID, BENCH))].filter((r) =>
      setIds.has(r.source_set_id),
    );
    expect(analysis?.new_prs.map((p) => `${p.kind}:${p.reps}:${p.value_kg}`).sort()).toEqual(
      badges.map((b) => `${b.kind}:${b.reps}:${b.value_kg}`).sort(),
    );
    expect(analysis?.new_prs.every((p) => p.exercise_name === 'Squat')).toBe(true);
  });

  it('is null for an unfinished workout, a missing one, or another user’s', async () => {
    const { db } = await setup();
    const draft = await startActiveWorkout(db, USER_ID, steadyOptions());
    expect(await localAnalysis(db, USER_ID, draft.getSnapshot().workout.id)).toBeNull();
    expect(await localAnalysis(db, USER_ID, 'missing')).toBeNull();
    await draft.discard();
    const id = await finishSession(db);
    expect(await localAnalysis(db, 'someone-else', id)).toBeNull();
  });
});

describe('the request pass and the screen (ANA-1, step DoD)', () => {
  it('offline: the screen shows the local analysis; on reconnect one sync stores exactly one, identical row', async () => {
    const { db, server, engine } = await setup();
    server.offline = true;
    const id = await finishSession(db);
    await engine.syncNow();
    expect(server.analyses.size).toBe(0);
    const offline = await analysisForScreen(db, USER_ID, id);
    expect(offline?.source).toBe('local');

    server.offline = false;
    const run = await engine.syncNow();
    expect(run.analysis).toEqual({ saved: 1, failed: 0 });
    expect(server.analyses.size).toBe(1);
    const shown = await analysisForScreen(db, USER_ID, id);
    expect(shown?.source).toBe('stored');
    // The server's row equals the phone's own computation, field for field.
    expect(shown?.analysis).toEqual(await localAnalysis(db, USER_ID, id));

    // Repeated syncs ask nothing more and keep one row.
    const requests = server.analysisRequests.length;
    await engine.syncNow();
    await engine.syncNow();
    expect(server.analysisRequests.length).toBe(requests);
    expect(server.analyses.size).toBe(1);
  });

  it('a failed request is logged and retried by the next sync', async () => {
    const { db, server, engine, logs } = await setup();
    const id = await finishSession(db);
    server.failAnalyses = true;
    const first = await engine.syncNow();
    expect(first.analysis).toEqual({ saved: 0, failed: 1 });
    expect(logs.some((l) => /analysis/.test(l))).toBe(true);
    expect(await storedAnalysis(db, USER_ID, id)).toBeNull();
    server.failAnalyses = false;
    expect((await engine.syncNow()).analysis).toEqual({ saved: 1, failed: 0 });
    expect(await storedAnalysis(db, USER_ID, id)).not.toBeNull();
  });

  it('the server function refuses to analyze a workout for anyone but its owner', async () => {
    const { db, server, engine } = await setup();
    const id = await finishSession(db);
    await engine.syncNow();
    const before = server.analyses.get(id);
    server.callerId = '22222222-2222-4222-8222-222222222222';
    await expect(server.requestAnalysis(id)).rejects.toThrow('404');
    expect(server.analyses.get(id)).toEqual(before);
  });

  it('skips the pass when the download failed', async () => {
    const { db, server, engine } = await setup();
    await finishSession(db);
    server.pullWorkoutAnalyses = async () => {
      throw new Error('Network request failed');
    };
    const run = await engine.syncNow();
    expect(run.pullError).toBeDefined();
    expect(run.analysis).toBeNull();
    expect(server.analysisRequests).toEqual([]);
  });

  it('an edit makes the analysis stale: shown locally until synced, then recomputed in place (G5)', async () => {
    const { db, server, engine } = await setup();
    const id = await finishSession(db);
    await engine.syncNow();
    const before = await storedAnalysis(db, USER_ID, id);
    expect(before?.total_volume_kg).toBe(860);

    // Edit the synced workout: one more 5×100 kg squat set.
    const store = await openWorkoutForEdit(db, USER_ID, id, steadyOptions('2026-11-14T12:00:00.000Z'));
    await store!.logSet(store!.getSnapshot().entries[0].id, { reps: 5, weight: { value: 100, unit: 'kg' } });
    expect(await hasPendingInputs(db, id)).toBe(true);
    const pending = await analysisForScreen(db, USER_ID, id);
    expect(pending?.source).toBe('local');
    expect(pending?.analysis.total_volume_kg).toBe(1360);
    expect(await workoutsNeedingAnalysis(db, USER_ID)).toEqual([]); // unsent edit: not yet

    await engine.syncNow();
    expect(await outboxSize(db)).toBe(0);
    expect(server.analyses.size).toBe(1);
    const after = await analysisForScreen(db, USER_ID, id);
    expect(after?.source).toBe('stored');
    expect(after?.analysis.total_volume_kg).toBe(1360);
    expect(after?.analysis.total_sets).toBe(5);
    expect(server.analyses.get(id)?.created_at).toBe((await db.getFirstAsync<{ c: string }>(
      'select created_at as c from workout_analyses',
    ))?.c);
  });

  it('a second (or reinstalled) phone downloads the analysis instead of asking for it again', async () => {
    const first = await setup();
    const id = await finishSession(first.db);
    await first.engine.syncNow();
    const requests = first.server.analysisRequests.length;

    const second = await setup(first.server);
    const run = await second.engine.syncNow();
    expect(run.pull?.workout_analyses).toBe(1);
    expect(first.server.analysisRequests.length).toBe(requests);
    expect((await analysisForScreen(second.db, USER_ID, id))?.source).toBe('stored');
    expect((await storedAnalysis(second.db, USER_ID, id))?.new_prs).toEqual(
      (await storedAnalysis(first.db, USER_ID, id))?.new_prs,
    );
  });

  it('deleting the workout deletes its analysis on this phone, the server, and other phones', async () => {
    const first = await setup();
    const id = await finishSession(first.db);
    await first.engine.syncNow();
    const second = await setup(first.server);
    await second.engine.syncNow();
    expect(await storedAnalysis(second.db, USER_ID, id)).not.toBeNull();

    await deleteWorkout(first.db, USER_ID, id);
    expect(await first.db.getFirstAsync('select count(*) as n from workout_analyses')).toEqual({ n: 0 });
    await first.engine.syncNow();
    expect(first.server.analyses.size).toBe(0);
    await second.engine.syncNow();
    expect(await second.db.getFirstAsync('select count(*) as n from workout_analyses')).toEqual({ n: 0 });
  });
});

describe('workoutsNeedingAnalysis', () => {
  it(`asks for at most ${ANALYSIS_BATCH_LIMIT} per sync, newest first, so a backlog catches up over a few syncs`, async () => {
    const { db } = await setup();
    const workouts: WorkoutRow[] = Array.from({ length: 25 }, (_, i) => ({
      id: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      user_id: USER_ID,
      title: null,
      notes: null,
      started_at: new Date(Date.parse('2026-11-01T09:00:00.000Z') + i * 86_400_000).toISOString(),
      ended_at: new Date(Date.parse('2026-11-01T10:00:00.000Z') + i * 86_400_000).toISOString(),
      visibility: 'public',
      program_workout_id: null,
      created_at: '2026-11-01T09:00:00.000Z',
      updated_at: '2026-11-01T09:00:00.000Z',
    }));
    await upsertRows(db, 'workouts', workouts);
    const batch = await workoutsNeedingAnalysis(db, USER_ID);
    expect(batch).toHaveLength(10);
    expect(batch[0]).toBe(workouts[24].id);
    expect(batch[9]).toBe(workouts[15].id);
  });

  it('includes a finished pre-B18 workout with no analysis, and never another user’s or a draft', async () => {
    const { db } = await setup();
    const id = await finishSession(db);
    await db.runAsync('delete from outbox'); // as if synced long ago
    const draft = await startActiveWorkout(db, USER_ID, steadyOptions('2026-11-15T09:00:00.000Z'));
    expect(await workoutsNeedingAnalysis(db, USER_ID)).toEqual([id]);
    expect(await workoutsNeedingAnalysis(db, 'someone-else')).toEqual([]);
    expect(draft.getSnapshot().workout.ended_at).toBeNull();
  });
});

/** One logged squat set: reps, kg (omit for bodyweight), RPE (omit for none). */
type LoggedSet = { reps: number; kg?: number; rpe?: number };

/** Finishes a squat-only workout starting at `start` with the given sets (none = an empty finish). */
async function finishWith(db: SqlDriver, start: string, loggedSets: LoggedSet[]): Promise<string> {
  const store = await startActiveWorkout(db, USER_ID, steadyOptions(start));
  if (loggedSets.length > 0) {
    const squat = await store.addExercise(SQUAT);
    for (const s of loggedSets) {
      await store.logSet(squat.id, { reps: s.reps, weight: s.kg == null ? undefined : { value: s.kg, unit: 'kg' }, rpe: s.rpe });
    }
  }
  return (await store.finish()).id;
}

const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}T09:00:00.000Z`;

describe('the trend (B42, ANA-5 / LOG-10)', () => {
  /**
   * Five qualifying sessions and one empty finish, then today (volume / mean RPE / load per rep):
   *   d1 3×100 @9 → 300 / 9 / 100     d2 8×50, 8×50 → 800 / – / 50    d3 5×120 → 600 / – / 120
   *   d4 10×60 @7 → 600 / 7 / 60      d5 empty (excluded)            d6 5×100 @8 ×2 → 1000 / 8 / 100
   *   today 5×110 @8.5, 5×110 @9 → 1100 / 8.75 / 110
   * Averages over 5 sessions: volume 3300 / 5 = 660; RPE (9 + 7 + 8) / 3 = 8; load (100 + 50 +
   * 120 + 60 + 100) / 5 = 86.
   */
  async function seedHistory(db: SqlDriver) {
    const ids = {
      d1: await finishWith(db, day(1), [{ reps: 3, kg: 100, rpe: 9 }]),
      d2: await finishWith(db, day(2), [{ reps: 8, kg: 50 }, { reps: 8, kg: 50 }]),
      d3: await finishWith(db, day(3), [{ reps: 5, kg: 120 }]),
      d4: await finishWith(db, day(4), [{ reps: 10, kg: 60, rpe: 7 }]),
      d5: await finishWith(db, day(5), []),
      d6: await finishWith(db, day(6), [{ reps: 5, kg: 100, rpe: 8 }, { reps: 5, kg: 100, rpe: 8 }]),
      today: await finishWith(db, day(7), [{ reps: 5, kg: 110, rpe: 8.5 }, { reps: 5, kg: 110, rpe: 9 }]),
    };
    return ids;
  }

  it('above the threshold the numbers match the history, and the server row equals the phone’s computation', async () => {
    const { db, server, engine } = await setup();
    const ids = await seedHistory(db);
    const local = await localAnalysis(db, USER_ID, ids.today);
    expect(local).toMatchObject({
      engine_version: ANALYSIS_ENGINE_VERSION,
      total_volume_kg: 1100,
      trend_sessions: 5,
      trend_volume_avg_kg: 660,
      trend_rpe_avg: 8,
      trend_load_per_rep_avg_kg: 86,
      session_rpe_avg: 8.75,
      session_load_per_rep_kg: 110,
    });

    await engine.syncNow();
    expect(server.analyses.size).toBe(7);
    for (const id of Object.values(ids)) {
      const shown = await analysisForScreen(db, USER_ID, id);
      expect(shown?.source).toBe('stored');
      expect(shown?.analysis).toEqual(await localAnalysis(db, USER_ID, id));
    }
  });

  it('below the threshold the trend columns are null on the stored row (d6 has 4 qualifying before it)', async () => {
    const { db, engine } = await setup();
    const ids = await seedHistory(db);
    await engine.syncNow();
    expect(await storedAnalysis(db, USER_ID, ids.d6)).toMatchObject({
      trend_sessions: null,
      trend_volume_avg_kg: null,
      trend_rpe_avg: null,
      trend_load_per_rep_avg_kg: null,
      session_rpe_avg: 8,
      session_load_per_rep_kg: 100,
    });
    // The empty d5 is computed against d1..d4 (4) — also absent.
    expect((await storedAnalysis(db, USER_ID, ids.d5))?.trend_sessions).toBeNull();
  });

  it('both paths pick the same window over downloaded rows with mixed stamp formats, a tie and the scan cap', async () => {
    // 45 one-set workouts seeded on the server (as another phone would have uploaded them). Some
    // stamps are "+00:00" with microseconds, some "Z"; workouts 20 and 21 share one instant written
    // both ways (a tie broken by id). A fresh phone downloads them all.
    const server = new FakeServer();
    const wid = (i: number) => `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const eid = (i: number) => `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const sid = (i: number) => `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const startOf = (i: number) => {
      const ms = Date.parse('2026-09-01T09:00:00.000Z') + (i === 21 ? 20 : i) * 86_400_000;
      const iso = new Date(ms).toISOString();
      if (i === 20) return iso.replace('.000Z', '+00:00'); // the same instant as 21's "…000Z"
      return i % 2 === 0 ? iso.replace('.000Z', '.000123+00:00') : iso;
    };
    const N = 45;
    const rows = Array.from({ length: N }, (_, i) => i);
    server.seed(
      'workouts',
      rows.map((i) => ({
        id: wid(i),
        user_id: USER_ID,
        title: null,
        notes: null,
        started_at: startOf(i),
        ended_at: new Date(Date.parse(startOf(i)) + 3_600_000).toISOString(),
        visibility: 'private' as const,
        program_workout_id: null,
        created_at: startOf(i),
      })),
    );
    server.seed(
      'workout_exercises',
      rows.map((i) => ({ id: eid(i), workout_id: wid(i), exercise_id: SQUAT, position: 0, notes: null, superset_group: null, created_at: startOf(i) })),
    );
    server.seed(
      'sets',
      rows.map((i) => ({
        id: sid(i),
        workout_exercise_id: eid(i),
        position: 0,
        reps: 1 + (i % 5),
        weight_kg: 50 + i,
        rpe: i % 3 === 0 ? null : 6 + (i % 4),
        is_warmup: false,
        drop_set_position: null,
        duration_seconds: null,
        score: null,
        notes: null,
        created_at: startOf(i),
      })),
    );
    const { db, engine } = await setup(server);
    await engine.syncNow(); // downloads everything, then analyzes the newest 10
    for (const target of [wid(N - 1), wid(21), wid(20)]) {
      const fromServer = await server.requestAnalysis(target);
      const { created_at: _c, updated_at: _u, ...stored } = fromServer;
      const local = await localAnalysis(db, USER_ID, target);
      expect({ ...stored, new_prs: JSON.parse(stored.new_prs) }).toEqual(local);
      expect(local?.trend_sessions).toBe(10);
    }
  });

  it('a stored version-1 row: the screen shows the local version-2 trend at once, and the pass re-requests it', async () => {
    const { db, server, engine } = await setup();
    const ids = await seedHistory(db);
    await engine.syncNow();
    await engine.syncNow(); // the download bookmark catches up with the rows the pass saved
    // As if made before B42, on the server and on this phone: engine version 1, no trend.
    const v1 = {
      engine_version: 1,
      trend_sessions: null,
      trend_volume_avg_kg: null,
      trend_rpe_avg: null,
      trend_load_per_rep_avg_kg: null,
      session_rpe_avg: null,
      session_load_per_rep_kg: null,
    };
    for (const [id, row] of server.analyses) server.analyses.set(id, { ...row, ...v1 });
    await db.runAsync(
      `update workout_analyses set engine_version = 1, trend_sessions = null, trend_volume_avg_kg = null,
       trend_rpe_avg = null, trend_load_per_rep_avg_kg = null, session_rpe_avg = null, session_load_per_rep_kg = null`,
    );
    const shown = await analysisForScreen(db, USER_ID, ids.today);
    expect(shown?.source).toBe('local');
    expect(shown?.analysis.trend_sessions).toBe(5);

    const needing = await workoutsNeedingAnalysis(db, USER_ID);
    expect(needing[0]).toBe(ids.today); // newest first, as ever
    expect(needing).toHaveLength(7);
    const requests = server.analysisRequests.length;
    await engine.syncNow();
    expect(server.analysisRequests.length).toBe(requests + 7);
    const after = await analysisForScreen(db, USER_ID, ids.today);
    expect(after?.source).toBe('stored');
    expect(after?.analysis.engine_version).toBe(ANALYSIS_ENGINE_VERSION);
    expect(after?.analysis.trend_sessions).toBe(5);
    expect(await workoutsNeedingAnalysis(db, USER_ID)).toEqual([]);
  });

  it('version-1 rows obey the batch cap, newest first, and the unsent-changes guard — a new workout goes first', async () => {
    const { db } = await setup();
    // 13 synced workouts; the 12 older carry version-1 analyses, the newest (index 12) has none.
    const workouts: WorkoutRow[] = Array.from({ length: 13 }, (_, i) => ({
      id: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      user_id: USER_ID,
      title: null,
      notes: null,
      started_at: new Date(Date.parse('2026-10-01T09:00:00.000Z') + i * 86_400_000).toISOString(),
      ended_at: new Date(Date.parse('2026-10-01T10:00:00.000Z') + i * 86_400_000).toISOString(),
      visibility: 'public',
      program_workout_id: null,
      created_at: '2026-10-01T09:00:00.000Z',
      updated_at: '2026-10-01T09:00:00.000Z',
    }));
    await upsertRows(db, 'workouts', workouts);
    for (const w of workouts.slice(0, 12)) {
      await db.runAsync(
        `insert into workout_analyses (id, user_id, engine_version, total_volume_kg, total_sets, working_sets,
           duration_seconds, new_prs, headline, message, workout_updated_at, created_at, updated_at)
         values (?, ?, 1, 0, 0, 0, 3600, '[]', 'h', 'm', ?, ?, ?)`,
        [w.id, USER_ID, w.updated_at, w.updated_at, w.updated_at],
      );
    }
    // A newer workout still waiting to upload is skipped, version or not.
    const pending = await finishWith(db, day(1), [{ reps: 5, kg: 100 }]);

    const batch = await workoutsNeedingAnalysis(db, USER_ID);
    expect(batch).not.toContain(pending);
    expect(batch).toEqual(workouts.slice(3).reverse().map((w) => w.id));
    expect(batch[0]).toBe(workouts[12].id); // the never-analyzed newest leads the upgrade wave
  });

  it('a row from NEWER rules than this app is kept, not re-requested', async () => {
    const { db, engine } = await setup();
    const id = await finishWith(db, day(1), [{ reps: 5, kg: 100 }]);
    await engine.syncNow();
    await db.runAsync('update workout_analyses set engine_version = ?', [ANALYSIS_ENGINE_VERSION + 1]);
    expect(await workoutsNeedingAnalysis(db, USER_ID)).toEqual([]);
    expect((await analysisForScreen(db, USER_ID, id))?.source).toBe('stored');
  });
});

describe('storedAnalysis', () => {
  it('round-trips the PR list through the text column, and reads a bad one as no PRs', async () => {
    const { db, engine } = await setup();
    const id = await finishSession(db);
    await engine.syncNow();
    const stored = await storedAnalysis(db, USER_ID, id);
    expect(stored?.new_prs).toEqual((await localAnalysis(db, USER_ID, id))?.new_prs);
    await db.runAsync("update workout_analyses set new_prs = 'not json'");
    expect((await storedAnalysis(db, USER_ID, id))?.new_prs).toEqual([]);
    expect(await storedAnalysis(db, 'someone-else', id)).toBeNull();
  });
});
