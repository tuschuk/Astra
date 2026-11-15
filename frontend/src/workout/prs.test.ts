/**
 * Tests for PR persistence (B13 / LOG-4), on real SQLite through the real active-workout store:
 * finishing a workout writes exactly the record books it improved — the right kind, sourced
 * from the right set — and never writes one for a volume-only improvement, a warm-up or a
 * weightless set. Then the rows sync up and down through the fake server.
 */
import { describe, expect, it } from '@jest/globals';

import type { PersonalRecordRow } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { outboxSize } from '@/sync/outbox';
import { pullChanges } from '@/sync/pull';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createPreparedDb, steadyOptions } from '@/test-utils/loggerTestKit';
import { OTHER_USER_ID, USER_ID } from '@/test-utils/workoutFixtures';

import { startActiveWorkout, type SetInput } from './activeWorkout';
import {
  currentPrs,
  improvedRecords,
  personalRecordId,
  PR_RECORD_NAMESPACE,
  recomputeRecords,
  saveRecomputedRecordsTx,
} from './prs';

const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');
const PULLUPS = libraryExerciseId('pullups');

const kg = (reps: number, weight: number, extra: Partial<SetInput> = {}): SetInput => ({
  reps,
  weight: { value: weight, unit: 'kg' },
  ...extra,
});

/**
 * Logs and finishes one workout for `userId` on `day` (2026-11-DD); `plan` maps exercise ids to
 * the sets to log. Returns the saved set ids per exercise, in order.
 */
async function finishWorkout(
  db: SqlDriver,
  day: number,
  plan: [exerciseId: string, sets: SetInput[]][],
  userId = USER_ID,
): Promise<Record<string, string[]>> {
  const store = await startActiveWorkout(db, userId, steadyOptions(`2026-11-${String(day).padStart(2, '0')}T09:00:00.000Z`));
  const ids: Record<string, string[]> = {};
  for (const [exerciseId, sets] of plan) {
    const entry = await store.addExercise(exerciseId);
    for (const input of sets) (ids[exerciseId] ??= []).push((await store.logSet(entry.id, input)).id);
  }
  await store.finish();
  return ids;
}

/** Every stored record for (user, exercise) as compact [label, value, source] triples. */
async function books(db: SqlDriver, exerciseId: string, userId = USER_ID) {
  return (await currentPrs(db, userId, exerciseId)).map((r) => [
    r.kind === 'repMax' ? `${r.reps}RM` : r.kind,
    r.value_kg,
    r.source_set_id,
  ]);
}

/** How many record rows exist on the device in total. */
async function recordCount(db: SqlDriver): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('select count(*) as n from personal_records'))?.n ?? 0;
}

describe('personalRecordId', () => {
  it('is the same for the same book and different for every other book', () => {
    const a = personalRecordId(USER_ID, BENCH, 'repMax', 5);
    expect(personalRecordId(USER_ID, BENCH, 'repMax', 5)).toBe(a);
    const others = [
      personalRecordId(USER_ID, BENCH, 'repMax', 3),
      personalRecordId(USER_ID, BENCH, 'true1rm', null),
      personalRecordId(USER_ID, BENCH, 'e1rm', null),
      personalRecordId(USER_ID, SQUAT, 'repMax', 5),
      personalRecordId(OTHER_USER_ID, BENCH, 'repMax', 5),
    ];
    expect(new Set([a, ...others]).size).toBe(6);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('ignores a stray rep count on a book that has none', () => {
    expect(personalRecordId(USER_ID, BENCH, 'e1rm', 5)).toBe(personalRecordId(USER_ID, BENCH, 'e1rm', null));
  });

  it('uses a fixed, valid namespace', () => {
    expect(PR_RECORD_NAMESPACE).toBe('6b3f1c2e-8a4d-4f7b-9e21-3c5d7a9b0e14');
  });
});

describe('PR detection on finish (step DoD)', () => {
  it('a heavier single flags a true 1RM (and an e1RM) sourced from that set', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [[BENCH, [kg(1, 100)]]]);
    const { [BENCH]: [single] } = await finishWorkout(db, 12, [[BENCH, [kg(1, 110)]]]);
    expect(await books(db, BENCH)).toEqual([
      ['true1rm', 110, single],
      ['e1rm', 110, single],
    ]);
  });

  it('a heavier 5 flags a 5-rep max with reps = 5 (and an e1RM)', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [[SQUAT, [kg(5, 120)]]]);
    const { [SQUAT]: [five] } = await finishWorkout(db, 12, [[SQUAT, [kg(5, 130)]]]);
    const rows = await currentPrs(db, USER_ID, SQUAT);
    const repMax = rows.find((r) => r.kind === 'repMax');
    expect(repMax).toMatchObject({ reps: 5, value_kg: 130, source_set_id: five });
    expect(rows.find((r) => r.kind === 'e1rm')).toMatchObject({ value_kg: 151.667, source_set_id: five });
    expect(rows.some((r) => r.kind === 'true1rm')).toBe(false);
  });

  it('a volume-only improvement writes no record row at all', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [[BENCH, [kg(5, 100)]]]);
    const before = await currentPrs(db, USER_ID, BENCH);
    await db.runAsync('delete from outbox');
    // Far more volume than last time — the same best weight × reps for six sets, plus lighter
    // fives — but no heavier weight at any rep count and no higher e1RM: no PR.
    await finishWorkout(db, 12, [[BENCH, [...Array.from({ length: 6 }, () => kg(5, 100)), kg(5, 90), kg(5, 90)]]]);
    expect(await currentPrs(db, USER_ID, BENCH)).toEqual(before);
    const queued = await db.getAllAsync("select tbl from outbox where tbl = 'personal_records'");
    expect(queued).toEqual([]);
  });

  it('a pure repeat of the stored best (more sets, same weight × reps) writes nothing new', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [[BENCH, [kg(5, 100)]]]);
    const before = await currentPrs(db, USER_ID, BENCH);
    await finishWorkout(db, 12, [[BENCH, Array.from({ length: 8 }, () => kg(5, 100))]]);
    expect(await currentPrs(db, USER_ID, BENCH)).toEqual(before);
  });

  it('warm-ups and weightless (bodyweight) sets never write a record', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [
      [BENCH, [kg(1, 200, { isWarmup: true }), kg(5, 150, { isWarmup: true })]],
      [PULLUPS, [{ reps: 20 }, { reps: 25 }]],
    ]);
    expect(await recordCount(db)).toBe(0);
  });

  it('a first-ever logged set fills every book it qualifies for', async () => {
    const db = await createPreparedDb();
    const { [BENCH]: [set] } = await finishWorkout(db, 10, [[BENCH, [kg(8, 60)]]]);
    expect(await books(db, BENCH)).toEqual([
      ['e1rm', 76, set],
      ['8RM', 60, set],
    ]);
  });

  it('a heavy set in today’s workout beats an earlier set of the same workout, sourced from the later one', async () => {
    const db = await createPreparedDb();
    const { [BENCH]: [, heavy] } = await finishWorkout(db, 10, [[BENCH, [kg(1, 100), kg(1, 105), kg(1, 105)]]]);
    expect(await books(db, BENCH)).toEqual([
      ['true1rm', 105, heavy],
      ['e1rm', 105, heavy],
    ]);
  });

  it('only counts the signed-in user’s history', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [[BENCH, [kg(1, 200)]]], OTHER_USER_ID);
    const { [BENCH]: [mine] } = await finishWorkout(db, 12, [[BENCH, [kg(1, 100)]]]);
    expect(await books(db, BENCH)).toEqual([
      ['true1rm', 100, mine],
      ['e1rm', 100, mine],
    ]);
    expect(await books(db, BENCH, OTHER_USER_ID)).toEqual([
      ['true1rm', 200, expect.any(String)],
      ['e1rm', 200, expect.any(String)],
    ]);
  });

  it('queues the records for upload in the same finish (they sync like any other row)', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [[BENCH, [kg(1, 100)]]]);
    const queued = await db.getAllAsync<{ tbl: string }>("select tbl from outbox where tbl = 'personal_records'");
    expect(queued).toHaveLength(2);
  });
});

describe('improvedRecords — seeding and the never-lower rule', () => {
  /** A finished workout written straight into SQLite, as if it predated B13 (no records). */
  async function legacyWorkout(db: SqlDriver, day: number, sets: { reps: number; kg: number }[]): Promise<string[]> {
    const ids = await finishWorkout(db, day, [[BENCH, sets.map((s) => kg(s.reps, s.kg))]]);
    await db.runAsync('delete from personal_records');
    await db.runAsync("delete from outbox where tbl = 'personal_records'");
    return ids[BENCH];
  }

  it('seeds books from older history, sourced from the historical set — today’s lighter set gets nothing', async () => {
    const db = await createPreparedDb();
    const [old] = await legacyWorkout(db, 1, [{ reps: 1, kg: 100 }]);
    await finishWorkout(db, 12, [[BENCH, [kg(1, 80)]]]);
    expect(await books(db, BENCH)).toEqual([
      ['true1rm', 100, old],
      ['e1rm', 100, old],
    ]);
  });

  it('never writes a value below the stored one', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [[BENCH, [kg(1, 90)]]]);
    // A better record arrived from another device (pulled), without its sets on this phone.
    const stored = await currentPrs(db, USER_ID, BENCH);
    await db.runAsync("update personal_records set value_kg = 100 where kind = 'true1rm'");
    const rows = await improvedRecords(db, USER_ID, [{ exercise_id: BENCH, sets: [] }], '2026-11-14T10:00:00.000Z');
    expect(rows.filter((r) => r.kind === 'true1rm')).toEqual([]);
    expect(stored).toHaveLength(2);
  });

  it('skips an exercise slot with no exercise (a deleted custom)', async () => {
    const db = await createPreparedDb();
    const set = { id: 's1', reps: 1, weight_kg: 100, is_warmup: false };
    expect(await improvedRecords(db, USER_ID, [{ exercise_id: null, sets: [set] }], '2026-11-14T10:00:00.000Z')).toEqual(
      [],
    );
  });

  it('rounds to the column’s 3 decimals, so a stored value is never "beaten" by its own float', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [[BENCH, [kg(5, 100)]]]);
    const e1rm = (await currentPrs(db, USER_ID, BENCH)).find((r) => r.kind === 'e1rm') as PersonalRecordRow;
    expect(e1rm.value_kg).toBe(116.667);
    const again = await improvedRecords(db, USER_ID, [{ exercise_id: BENCH, sets: [] }], '2026-11-14T10:00:00.000Z');
    expect(again).toEqual([]);
  });

  it('keeps created_at when a book improves, and stamps it fresh for a new book', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [[BENCH, [kg(1, 100)]]]);
    const first = (await currentPrs(db, USER_ID, BENCH))[0];
    await finishWorkout(db, 12, [[BENCH, [kg(1, 110)]]]);
    const second = (await currentPrs(db, USER_ID, BENCH))[0];
    expect(second.id).toBe(first.id);
    expect(second.created_at).toBe(first.created_at);
    expect(second.updated_at > first.updated_at).toBe(true);
  });
});

describe('records through sync', () => {
  it('push lands each record once, after its set; a retry duplicates nothing', async () => {
    const db = await createPreparedDb();
    const server = new FakeServer();
    await finishWorkout(db, 10, [[BENCH, [kg(5, 100)]]]);
    // The server refuses a record whose set is not there (its FK) — success proves the order.
    const result = await pushOutbox(db, server);
    expect(result.pushed.personal_records).toBe(2);
    expect(server.tables.personal_records.size).toBe(2);
    const calls = server.upsertCalls.map((c) => c.tbl);
    expect(calls.indexOf('personal_records')).toBeGreaterThan(calls.indexOf('sets'));

    await server.upsert('personal_records', [...server.tables.personal_records.values()].map(({ updated_at: _u, ...r }) => r));
    expect(server.tables.personal_records.size).toBe(2);
    expect(await outboxSize(db)).toBe(0);
  });

  it('a pull brings another device’s records down', async () => {
    const source = await createPreparedDb();
    const server = new FakeServer();
    await finishWorkout(source, 10, [[BENCH, [kg(1, 140)]]]);
    await pushOutbox(source, server);

    const fresh = await createPreparedDb();
    const result = await pullChanges(fresh, server, USER_ID);
    expect(result.personal_records).toBe(2);
    expect((await books(fresh, BENCH)).map((b) => [b[0], b[1]])).toEqual([
      ['true1rm', 140],
      ['e1rm', 140],
    ]);
  });

  it('a fresh device pushing a lower value cannot lower the server’s record (keep-best), and the pull repairs it', async () => {
    const server = new FakeServer();
    const strong = await createPreparedDb();
    await finishWorkout(strong, 10, [[BENCH, [kg(1, 140)]]]);
    await pushOutbox(strong, server);

    // A second phone signs in and finishes a lighter single BEFORE its first download.
    const fresh = await createPreparedDb();
    await finishWorkout(fresh, 12, [[BENCH, [kg(1, 100)]]]);
    await pushOutbox(fresh, server);
    const id = personalRecordId(USER_ID, BENCH, 'true1rm', null);
    expect(server.tables.personal_records.get(id)?.value_kg).toBe(140);

    await pullChanges(fresh, server, USER_ID);
    expect((await books(fresh, BENCH)).find((b) => b[0] === 'true1rm')?.[1]).toBe(140);
  });
});

describe('recomputeRecords (B14) — the forced recompute after history changed', () => {
  const NOW = '2026-11-20T09:00:00.000Z';

  it('finds nothing to change when the stored books already match the history', async () => {
    const db = await createPreparedDb();
    await finishWorkout(db, 10, [[SQUAT, [kg(5, 100), kg(1, 140)]]]);
    expect(await recomputeRecords(db, USER_ID, [SQUAT], NOW)).toEqual({ upserts: [], demotions: [], removals: [] });
  });

  it('sorts each change by how it must reach the server: new or raised, lowered, or gone', async () => {
    const db = await createPreparedDb();
    const sets = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100), kg(3, 110), kg(5, 90)]]]);
    const [five100, three110, five90] = sets[SQUAT];
    // History changes underneath the stored books (as an edit or delete would leave it):
    await db.runAsync('update sets set weight_kg = 80 where id = ?', [five100]); // 5RM holder lighter
    await db.runAsync('delete from sets where id = ?', [three110]); // the only triple gone
    await db.runAsync("update sets set reps = 2 where id = ?", [five90]); // a new 2-rep book

    const changes = await recomputeRecords(db, USER_ID, [SQUAT], NOW);
    const label = (r: PersonalRecordRow) => (r.kind === 'repMax' ? `${r.reps}RM` : r.kind);
    expect(changes.upserts.map(label)).toEqual(['2RM']);
    expect(changes.demotions.map((r) => [label(r), r.value_kg, r.source_set_id])).toEqual(
      expect.arrayContaining([['5RM', 80, five100]]),
    );
    expect(changes.removals).toContain(personalRecordId(USER_ID, SQUAT, 'repMax', 3));
    // A demoted book keeps its identity and when it was first set.
    const demoted = changes.demotions.find((r) => label(r) === '5RM')!;
    expect(demoted.id).toBe(personalRecordId(USER_ID, SQUAT, 'repMax', 5));
    expect(demoted.created_at).not.toBe(NOW);
  });

  it('an equal value now held by a different set is a plain upsert, not a demotion', async () => {
    const db = await createPreparedDb();
    const sets = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100), kg(5, 100)]]]);
    const [first, second] = sets[SQUAT];
    expect((await books(db, SQUAT)).find((b) => b[0] === '5RM')?.[2]).toBe(first); // ties keep the earlier set
    await db.runAsync('update sets set weight_kg = 60 where id = ?', [first]);
    const changes = await recomputeRecords(db, USER_ID, [SQUAT], NOW);
    expect(changes.demotions).toEqual([]);
    expect(changes.upserts.find((r) => r.kind === 'repMax' && r.reps === 5)?.source_set_id).toBe(second);
  });

  it('saveRecomputedRecordsTx queues a demotion as delete then upsert, and a removal as a delete', async () => {
    const db = await createPreparedDb();
    const sets = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100), kg(3, 110)]]]);
    await finishWorkout(db, 11, [[SQUAT, [kg(5, 90)]]]);
    await db.runAsync('delete from outbox');
    await db.runAsync('delete from sets where id in (?, ?)', sets[SQUAT]);

    await db.withTransactionAsync(async (tx) =>
      saveRecomputedRecordsTx(tx, await recomputeRecords(tx, USER_ID, [SQUAT], NOW), NOW),
    );
    const fiveRm = personalRecordId(USER_ID, SQUAT, 'repMax', 5);
    const threeRm = personalRecordId(USER_ID, SQUAT, 'repMax', 3);
    const lines = await db.getAllAsync<{ row_id: string; op: string }>(
      "select row_id, op from outbox where tbl = 'personal_records' order by id",
    );
    expect(lines.filter((l) => l.row_id === fiveRm).map((l) => l.op)).toEqual(['delete', 'upsert']);
    expect(lines.filter((l) => l.row_id === threeRm).map((l) => l.op)).toEqual(['delete']);
    expect((await books(db, SQUAT)).find((b) => b[0] === '5RM')?.[1]).toBe(90);
    expect((await books(db, SQUAT)).map((b) => b[0])).not.toContain('3RM');
  });
});
