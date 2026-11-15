/**
 * Tests for the `export-data` server function's decisions (B32, NFR-6 — "export produces the
 * user's complete training data"; step DoD "the export contains every workout, set and PR").
 *
 * The database is an in-memory fake that behaves like the real API where it matters: it answers
 * page reads in id order and never returns more than 1000 rows per request (the API's cap). The
 * fake lifter has enough history to need several pages and several id chunks, and a second
 * lifter's rows sit in the same tables — so the tests prove nothing is cut off and nothing of
 * anyone else leaks in. Nothing touches the real project.
 */
import { describe, expect, it } from '@jest/globals';

import { handleExportRequest, PAGE_ROWS, type ExportDeps, type PageQuery, type Row } from '../export-data/handler.ts';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SQUAT = 'e0000000-0000-4000-8000-000000000001';
const BENCH = 'e0000000-0000-4000-8000-000000000002';
const MY_CUSTOM = 'e0000000-0000-4000-8000-0000000000c1';
const MY_DELETED_CUSTOM = 'e0000000-0000-4000-8000-0000000000c2';
const OTHER_CUSTOM = 'e0000000-0000-4000-8000-0000000000c3';
const FLAIR_PR = 'f0000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-15T12:00:00.000Z');

/** The API's own per-request row cap. */
const API_ROW_CAP = 1000;

/** A sortable fake id with a prefix, e.g. id('w', 7) → "w-000007". */
function id(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

/**
 * A fake database: `workouts` workouts for ME (each with `entries` exercise entries of `sets`
 * sets), `prs` personal records, a few customs, analyses and posts — plus one public workout,
 * a custom, a PR and a post belonging to OTHER. Returns the deps and a log of every read.
 */
function fakeWorld({ workouts = 60, entries = 3, sets = 7, prs = 600 } = {}) {
  const tables: Record<string, Row[]> = {
    profiles: [
      { id: ME, username: 'me', display_name: 'Me', bio: null, avatar_url: null },
      { id: OTHER, username: 'other', display_name: 'Other', bio: null, avatar_url: null },
    ],
    user_settings: [{ user_id: ME, unit: 'kg', progress_pic_visibility: 'private' }],
    user_body_data: [{ user_id: ME, sex: null, birthdate: '1990-01-01', bodyweight_kg: 80 }],
    exercises: [
      { id: SQUAT, owner_id: null, name: 'Back Squat', deleted_at: null },
      { id: BENCH, owner_id: null, name: 'Bench Press', deleted_at: null },
      { id: MY_CUSTOM, owner_id: ME, name: 'Zercher Squat', deleted_at: null },
      { id: MY_DELETED_CUSTOM, owner_id: ME, name: 'Old Thing', deleted_at: '2026-11-01T00:00:00Z' },
      { id: OTHER_CUSTOM, owner_id: OTHER, name: 'Secret Lift', deleted_at: null },
    ],
    workouts: [],
    workout_exercises: [],
    sets: [],
    personal_records: [],
    workout_analyses: [],
    posts: [],
    flairs: [
      { id: FLAIR_PR, name: 'PR' },
      { id: 'f0000000-0000-4000-8000-000000000009', name: 'Unused' },
    ],
  };
  const movements = [SQUAT, BENCH, MY_CUSTOM, MY_DELETED_CUSTOM];
  for (let w = 0; w < workouts; w += 1) {
    const wid = id('w', w);
    // Started in reverse id order, so sorting by start time is visibly not the id order.
    tables.workouts.push({ id: wid, user_id: ME, started_at: `2026-${String(12 - (w % 12)).padStart(2, '0')}-01T${String(w % 24).padStart(2, '0')}:00:00Z`, visibility: 'public' });
    tables.workout_analyses.push({ id: wid, user_id: ME, headline: `Workout ${w}` });
    for (let e = 0; e < entries; e += 1) {
      const eid = id(`we${w}`, e);
      tables.workout_exercises.push({ id: eid, workout_id: wid, exercise_id: movements[e % movements.length], position: entries - e });
      for (let s = 0; s < sets; s += 1) {
        tables.sets.push({ id: id(`s${w}-${e}`, s), workout_exercise_id: eid, position: sets - s, reps: 5, weight_kg: 100 + s });
      }
    }
  }
  for (let p = 0; p < prs; p += 1) {
    tables.personal_records.push({ id: id('pr', p), user_id: ME, exercise_id: p % 2 ? SQUAT : BENCH, kind: 'e1rm', value_kg: 100 + p });
  }
  tables.posts.push({ id: 'p-mine', user_id: ME, workout_id: id('w', 0), flair_id: FLAIR_PR, kind: 'workout', image_path: null });
  tables.posts.push({ id: 'p-photo', user_id: ME, workout_id: null, flair_id: null, kind: 'image', image_path: `${ME}/p-photo.jpg` });

  // The other lifter: a PUBLIC workout (readable by ME under the real security rules — the
  // export must still leave it out), its entry and set, a PR and a post.
  tables.workouts.push({ id: 'w-other', user_id: OTHER, started_at: '2026-06-01T00:00:00Z', visibility: 'public' });
  tables.workout_exercises.push({ id: 'we-other', workout_id: 'w-other', exercise_id: OTHER_CUSTOM, position: 1 });
  tables.sets.push({ id: 's-other', workout_exercise_id: 'we-other', position: 1, reps: 1, weight_kg: 300 });
  tables.personal_records.push({ id: 'pr-other', user_id: OTHER, exercise_id: SQUAT, kind: 'e1rm', value_kg: 300 });
  tables.posts.push({ id: 'p-other', user_id: OTHER, workout_id: 'w-other', flair_id: FLAIR_PR, kind: 'workout', image_path: null });

  const pageReads: PageQuery[] = [];
  const oneReads: { table: string; column: string; value: string }[] = [];

  const deps: ExportDeps = {
    async readOne(table, column, value) {
      oneReads.push({ table, column, value });
      return tables[table].find((r) => r[column] === value) ?? null;
    },
    async readPage(query) {
      pageReads.push(query);
      const { filter } = query;
      const matches = tables[query.table]
        .filter((r) => ('eq' in filter ? r[filter.column] === filter.eq : filter.in.includes(String(r[filter.column]))))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const want = query.to - query.from + 1;
      return matches.slice(query.from, query.from + Math.min(want, API_ROW_CAP));
    },
  };
  return { deps, tables, pageReads, oneReads };
}

/** Every set in the document, flattened. */
function allSets(doc: Awaited<ReturnType<typeof handleExportRequest>>['body']): Row[] {
  return doc.workouts.flatMap((w) => w.exercises.flatMap((e) => e.sets));
}

describe('handleExportRequest', () => {
  it('contains every workout, set and PR of a history that spans many pages and id chunks', async () => {
    const { deps, tables } = fakeWorld();
    const { status, body } = await handleExportRequest({ id: ME, email: 'me@example.com' }, deps, NOW);

    expect(status).toBe(200);
    const mySets = tables.sets.filter((s) => s.id !== 's-other');
    expect(mySets.length).toBeGreaterThan(2 * PAGE_ROWS); // the fixture really needs paging
    expect(body.workouts).toHaveLength(60);
    expect(body.workouts.flatMap((w) => w.exercises)).toHaveLength(180);
    expect(new Set(allSets(body).map((s) => s.id))).toEqual(new Set(mySets.map((s) => s.id)));
    expect(allSets(body)).toHaveLength(mySets.length);
    expect(body.personalRecords).toHaveLength(600);
    expect(new Set(body.personalRecords.map((r) => r.id)).size).toBe(600);
    expect(body.analyses).toHaveLength(60);
  });

  it('pages through each table, never asking for more than one page at a time', async () => {
    const { deps, pageReads } = fakeWorld();
    await handleExportRequest({ id: ME, email: null }, deps, NOW);
    const prReads = pageReads.filter((q) => q.table === 'personal_records');
    expect(prReads.map((q) => q.from)).toEqual([0, PAGE_ROWS]); // 600 rows → a full page, then the rest
    for (const q of pageReads) expect(q.to - q.from + 1).toBe(PAGE_ROWS);
    // 180 entry ids → two chunks; each chunk's sets (700 and 560) needs two pages.
    const setReads = pageReads.filter((q) => q.table === 'sets');
    expect(setReads).toHaveLength(4);
  });

  it('includes nothing of another lifter, even their public workout', async () => {
    const { deps } = fakeWorld();
    const { body } = await handleExportRequest({ id: ME, email: null }, deps, NOW);
    const text = JSON.stringify(body);
    for (const theirs of ['w-other', 'we-other', 's-other', 'pr-other', 'p-other', 'Secret Lift', OTHER]) {
      expect(text).not.toContain(theirs);
    }
  });

  it('asks only for the caller’s rows: every owner filter is the caller, every child filter their own ids', async () => {
    const { deps, pageReads, oneReads, tables } = fakeWorld();
    await handleExportRequest({ id: ME, email: null }, deps, NOW);
    expect(oneReads.every((r) => r.value === ME)).toBe(true);
    for (const q of pageReads) if ('eq' in q.filter) expect(q.filter.eq).toBe(ME);
    const myWorkoutIds = new Set(tables.workouts.filter((w) => w.user_id === ME).map((w) => w.id));
    for (const q of pageReads.filter((r) => r.table === 'workout_exercises')) {
      if ('in' in q.filter) for (const wid of q.filter.in) expect(myWorkoutIds.has(wid)).toBe(true);
    }
  });

  it('nests entries and sets in logged order and lists workouts oldest first', async () => {
    const { deps } = fakeWorld({ workouts: 3, prs: 0 });
    const { body } = await handleExportRequest({ id: ME, email: null }, deps, NOW);
    const starts = body.workouts.map((w) => String(w.started_at));
    expect(starts).toEqual([...starts].sort());
    for (const w of body.workouts) {
      expect(w.exercises.map((e) => e.position)).toEqual([1, 2, 3]);
      for (const e of w.exercises) {
        expect(e.workout_id).toBe(w.id);
        expect(e.sets.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        for (const s of e.sets) expect(s.workout_exercise_id).toBe(e.id);
      }
    }
  });

  it('carries the profile, settings, body data, posts and customs — deleted customs included', async () => {
    const { deps } = fakeWorld({ workouts: 1, prs: 1 });
    const { body } = await handleExportRequest({ id: ME, email: 'me@example.com' }, deps, NOW);
    expect(body).toMatchObject({
      format: 'astra-export',
      version: 1,
      exportedAt: '2026-11-15T12:00:00.000Z',
      units: 'kg',
      user: { id: ME, email: 'me@example.com' },
      profile: { id: ME, username: 'me' },
      settings: { user_id: ME, unit: 'kg' },
      bodyData: { user_id: ME, bodyweight_kg: 80 },
    });
    expect(body.customExercises.map((c) => c.id).sort()).toEqual([MY_CUSTOM, MY_DELETED_CUSTOM]);
    expect(body.posts.map((p) => p.id).sort()).toEqual(['p-mine', 'p-photo']);
    expect(body.posts.find((p) => p.id === 'p-photo')?.image_path).toBe(`${ME}/p-photo.jpg`);
  });

  it('names the library exercises and flairs the history points at, and nothing else', async () => {
    const { deps } = fakeWorld({ workouts: 1, prs: 2 });
    const { body } = await handleExportRequest({ id: ME, email: null }, deps, NOW);
    // Customs are exported in full, so they're not repeated in the name map.
    expect(body.exerciseNames).toEqual({ [SQUAT]: 'Back Squat', [BENCH]: 'Bench Press' });
    expect(body.flairs).toEqual({ [FLAIR_PR]: 'PR' });
  });

  it('exports an empty account as empty lists, without asking for any child rows', async () => {
    const { deps, pageReads, tables } = fakeWorld({ workouts: 0, prs: 0 });
    tables.posts = tables.posts.filter((p) => p.user_id !== ME);
    tables.exercises = tables.exercises.filter((e) => e.owner_id !== ME);
    tables.user_body_data = [];
    const { body } = await handleExportRequest({ id: ME, email: null }, deps, NOW);
    expect(body.workouts).toEqual([]);
    expect(body.personalRecords).toEqual([]);
    expect(body.customExercises).toEqual([]);
    expect(body.bodyData).toBeNull();
    expect(body.exerciseNames).toEqual({});
    expect(body.flairs).toEqual({});
    expect(pageReads.some((q) => q.table === 'workout_exercises' || q.table === 'sets' || q.table === 'flairs')).toBe(false);
  });

  it('throws when a read fails, so the function answers a retryable server error', async () => {
    const { deps } = fakeWorld({ workouts: 2, prs: 0 });
    const failing: ExportDeps = {
      ...deps,
      readPage: async (q) => {
        if (q.table === 'sets') throw new Error('Reading sets failed: boom');
        return deps.readPage(q);
      },
    };
    await expect(handleExportRequest({ id: ME, email: null }, failing, NOW)).rejects.toThrow('Reading sets failed');
  });
});
