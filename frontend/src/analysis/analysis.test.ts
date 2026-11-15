/**
 * Tests for the phone side of the post-workout analysis (B18): the offline computation, the
 * stored copy, the screen's freshness rule, and the sync engine's request pass — end to end
 * against the fake server, which runs the same shared rules the real server function does.
 * Real SQLite (node driver), never the live project.
 */
import { describe, expect, it } from '@jest/globals';

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
