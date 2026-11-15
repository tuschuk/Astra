/**
 * The workout you are logging right now — the "active workout" — as the app holds it.
 *
 * What it is: a workout row, its exercises in order, and each exercise's sets in order. Screens
 * (from B09) read it and call its operations: add an exercise, log a set, repeat the last set,
 * fix or remove a set, reorder or remove an exercise, link exercises into a superset or unlink
 * them (B11), finish, or throw the whole thing away. A drop set needs no operation of its own:
 * each drop is an ordinary logged set carrying its drop number (see `nextDropPosition`).
 *
 * The rule that makes it survive a killed app (NFR-3): every operation is saved to the phone's
 * SQLite database FIRST, in one all-or-nothing transaction, and only then is the in-memory copy
 * rebuilt — by reading the workout back from SQLite. Memory is just a cache of the file. So if
 * the phone dies, runs out of battery or the app is swiped away at any moment, reopening the app
 * and calling `loadActiveWorkout` rebuilds exactly what the user last saw: nothing more, nothing
 * less.
 *
 * Sync: while the workout is in progress it lives only on the phone (written through the DAO's
 * draft path, never queued for upload). `finish` stamps the end time and queues the whole
 * workout for upload in a single transaction — the server only ever sees finished workouts.
 * See docs/feature_plans/active-workout-store.md for why.
 *
 * Every value is checked against the server's rules (`assertValidSetFields` in the shared
 * training-math module) before it is saved, so a set the server would refuse can never reach
 * the upload queue and block it.
 *
 * No React here: `subscribe` + `getSnapshot` are exactly what React's `useSyncExternalStore`
 * needs, so a screen can watch the store without this file knowing about screens.
 */
import {
  assertValidEntryNotes,
  assertValidSetFields,
  assertValidSupersetGroup,
  assertValidWorkoutNotes,
  assertValidWorkoutTitle,
  lbToKg,
  roundRpeForStorage,
  roundWeightKgForStorage,
  type WeightUnit,
} from '@training-math';

import {
  deleteDraftRowsTx,
  fromSqlRow,
  TABLE_COLUMNS,
  writeDraftRowsTx,
  writeLocalTree,
  type SetRow,
  type WorkoutExerciseRow,
  type WorkoutRow,
} from '@/db/dao';
import { placeholders, type SqlDriver, type SqlExecutor } from '@/db/driver';
import { newUuid } from '@/lib/ids';

/** One exercise in the active workout, with its sets ordered by position. */
export interface ActiveEntry extends WorkoutExerciseRow {
  sets: SetRow[];
}

/** Everything the active workout holds: the workout row and its exercises ordered by position. */
export interface ActiveWorkoutSnapshot {
  workout: WorkoutRow;
  entries: ActiveEntry[];
}

/**
 * What the lifter typed for one set. Every field is optional (a timed plank has no reps; a
 * bodyweight set has no weight). `weight` is in whatever unit the lifter entered it in — the
 * store converts it to kilograms for saving.
 */
export interface SetInput {
  reps?: number | null;
  weight?: { value: number; unit: WeightUnit } | null;
  rpe?: number | null;
  isWarmup?: boolean;
  /** Segment of a drop set: the top set leaves this empty, the drops are 1, 2, … */
  dropSetPosition?: number | null;
  /** Timed work: how long it took or lasted, in seconds. */
  durationSeconds?: number | null;
  /** Scored WOD work, as the lifter wrote it ("7 rounds + 12 reps"). Blank counts as none. */
  score?: string | null;
  /** The lifter's remark about this one set ("elbow twinged on rep 3"). Blank counts as none. */
  notes?: string | null;
}

/**
 * The drop number the next drop of an exercise's latest set gets (LOG-12). A drop set is saved
 * as separate rows: the top set has no drop number, the drops after it are 1, 2, 3 … So the
 * next drop is "one more than the last set's number", treating the top set as 0. Returns null
 * when the exercise has no set yet — there is nothing to drop from.
 *
 * Example: sets [8 × 225 (none), 8 × 185 (1)] → the next drop is 2.
 */
export function nextDropPosition(sets: readonly SetRow[]): number | null {
  const last = sets[sets.length - 1];
  if (!last) return null;
  return (last.drop_set_position ?? 0) + 1;
}

/**
 * Turns a saved set back into the `SetInput` that would save it again unchanged — so a screen
 * can change one thing about a set (e.g. flip its warm-up flag) by handing `updateSet` the rest
 * as it was, without knowing how sets are stored.
 *
 * The weight goes back in kilograms. That round-trips exactly: a stored weight is already
 * rounded to the server column's 2 decimals, and rounding it again changes nothing (the same
 * holds for RPE's 1 decimal).
 */
export function setInputFromRow(set: SetRow): SetInput {
  return {
    reps: set.reps,
    weight: set.weight_kg == null ? null : { value: set.weight_kg, unit: 'kg' },
    rpe: set.rpe,
    isWarmup: set.is_warmup,
    dropSetPosition: set.drop_set_position,
    durationSeconds: set.duration_seconds,
    score: set.score,
    // Kept, so flipping the warm-up flag (or any other edit) never wipes the set's note.
    notes: set.notes,
  };
}

/** Trims a typed text; an empty or all-space text becomes null ("no title", "no note"). */
function cleanText(text: string | null | undefined): string | null {
  return text?.trim() || null;
}

/** Where the active workout is in its life. Only an `active` workout can be changed. */
export type ActiveWorkoutStatus = 'active' | 'finished' | 'discarded';

/** Things a test (or a future caller) can swap in. */
export interface ActiveWorkoutOptions {
  /** The current time as ISO-8601 text. Defaults to the device clock. */
  clock?: () => string;
  /** Makes a new row id. Defaults to a random v4 UUID (src/lib/ids.ts). */
  mintId?: () => string;
}

/** The active workout and every operation on it (see the file comment). */
export interface ActiveWorkoutStore {
  /** The current state. The same object is returned until something changes. */
  getSnapshot(): ActiveWorkoutSnapshot;
  /** Calls `listener` after every change; returns a function that stops it. */
  subscribe(listener: () => void): () => void;
  /** `active` until `finish` or `discard`; after that every change is refused. */
  getStatus(): ActiveWorkoutStatus;
  /** Adds an exercise (from the library or the user's own) at the end. Returns its new entry. */
  addExercise(exerciseId: string): Promise<ActiveEntry>;
  /** Removes an exercise and all its sets; the exercises after it move up. */
  removeExercise(entryId: string): Promise<void>;
  /** Moves an exercise to `newPosition` (0 = first); the others shift to make room. */
  reorderExercise(entryId: string, newPosition: number): Promise<void>;
  /** Logs a new set at the end of an exercise. Returns the saved set. */
  logSet(entryId: string, input: SetInput): Promise<SetRow>;
  /** Replaces what a set says (fixing a typo); its place in the list is kept. */
  updateSet(setId: string, input: SetInput): Promise<SetRow>;
  /**
   * Replaces what several sets say, all in one transaction — e.g. marking every segment of a
   * drop set as a warm-up, so the drop set is never left half warm-up and half work.
   */
  updateSets(changes: readonly { setId: string; input: SetInput }[]): Promise<void>;
  /** Removes a set; the sets after it move up. */
  removeSet(setId: string): Promise<void>;
  /**
   * Removes several sets in one transaction (a whole drop set: its top set and every drop), so
   * a drop never outlives its top set and gets mistaken for part of the set before it.
   */
  removeSets(setIds: readonly string[]): Promise<void>;
  /**
   * Logs a copy of the exercise's last set — the one-tap "same again" (NFR-2). Everything the
   * set did is copied; its note is not (a remark belongs to the set it was written about).
   */
  repeatLastSet(entryId: string): Promise<SetRow>;
  /**
   * Names the workout ("Push day"), up to 100 characters (LOG-3). The text is trimmed; a blank
   * title clears it, and the saved workout then shows its date instead.
   */
  setTitle(title: string | null): Promise<void>;
  /** Writes a note on the whole workout, up to 2000 characters; blank clears it (LOG-3). */
  setNotes(notes: string | null): Promise<void>;
  /** Writes a note on one exercise of the workout, up to 1000 characters; blank clears it (LOG-3). */
  setEntryNotes(entryId: string, notes: string | null): Promise<void>;
  /**
   * Writes a note on one logged set, up to 500 characters; blank clears it (LOG-3). Only the
   * note changes: the rest of the set is read as it stands when this runs (after any change
   * queued before it), so a note saved a moment after flipping the warm-up flag can't flip it
   * back.
   */
  setSetNotes(setId: string, notes: string | null): Promise<void>;
  /**
   * Makes this exercise part of a superset with the exercise just above it (LOG-11): done
   * back-to-back, shown as one unit. If either is already in a superset, the other joins it (so
   * linking three in a row makes a tri-set). Refused for the first exercise, which has nothing
   * above it; does nothing if the two are already linked.
   */
  linkWithPrevious(entryId: string): Promise<void>;
  /**
   * Undoes the link between this exercise and the one just above it, splitting the superset
   * there: the exercises above stay together, this one and those below it stay together, and
   * whichever side is left with a single exercise stops being a superset. Does nothing if the
   * two weren't linked.
   */
  unlinkFromPrevious(entryId: string): Promise<void>;
  /** Ends the workout and hands it to sync. Returns the finished workout row. */
  finish(): Promise<WorkoutRow>;
  /** Deletes the in-progress workout from the phone entirely (never uploaded). */
  discard(): Promise<void>;
}

/** The device clock as ISO-8601 text. */
function systemClock(): string {
  return new Date().toISOString();
}

/** Reads one table's rows with a `where` clause, in the app's row shape. */
async function selectRows<T extends 'workouts' | 'workout_exercises' | 'sets'>(
  db: SqlExecutor,
  tbl: T,
  where: string,
  params: readonly (string | number)[],
) {
  const columns = (TABLE_COLUMNS[tbl] as readonly string[]).join(', ');
  const raw = await db.getAllAsync<Record<string, unknown>>(`select ${columns} from ${tbl} where ${where}`, params);
  return raw.map((r) => fromSqlRow(tbl, r));
}

/**
 * Reads one workout and everything in it from SQLite, ordered as the lifter sees it. Returns
 * null if the workout isn't there or belongs to someone else (the device file can still hold a
 * previous account's rows).
 */
async function readTree(db: SqlExecutor, userId: string, workoutId: string): Promise<ActiveWorkoutSnapshot | null> {
  const [workout] = await selectRows(db, 'workouts', 'id = ? and user_id = ?', [workoutId, userId]);
  if (!workout) return null;
  const entries = await selectRows(db, 'workout_exercises', 'workout_id = ? order by position, id', [workoutId]);
  const sets =
    entries.length === 0
      ? []
      : await selectRows(
          db,
          'sets',
          `workout_exercise_id in (${placeholders(entries.length)}) order by position, id`,
          entries.map((e) => e.id),
        );
  return {
    workout,
    entries: entries.map((e) => ({ ...e, sets: sets.filter((s) => s.workout_exercise_id === e.id) })),
  };
}

/** The user's newest unfinished workout's id, or null if every workout is finished. */
async function findActiveWorkoutId(db: SqlExecutor, userId: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    'select id from workouts where user_id = ? and ended_at is null order by started_at desc, id desc limit 1',
    [userId],
  );
  return row?.id ?? null;
}

/**
 * Turns what the lifter typed into the stored set columns: weight converted to kg and rounded
 * to the server column's 2 decimals, RPE rounded to its 1 decimal, then every value checked
 * against the server's rules. Throws a `RangeError` (before anything is saved) if one fails.
 */
function setColumns(input: SetInput, position: number) {
  const weightKg =
    input.weight == null
      ? null
      : roundWeightKgForStorage(input.weight.unit === 'lb' ? lbToKg(input.weight.value) : input.weight.value);
  const rpe = input.rpe == null ? null : roundRpeForStorage(input.rpe);
  const columns = {
    position,
    reps: input.reps ?? null,
    weight_kg: weightKg,
    rpe,
    is_warmup: input.isWarmup ?? false,
    drop_set_position: input.dropSetPosition ?? null,
    duration_seconds: input.durationSeconds ?? null,
    score: cleanText(input.score),
    notes: cleanText(input.notes),
  };
  assertValidSetFields({
    position,
    reps: columns.reps,
    weightKg: columns.weight_kg,
    rpe: columns.rpe,
    dropSetPosition: columns.drop_set_position,
    durationSeconds: columns.duration_seconds,
    score: columns.score,
    notes: columns.notes,
  });
  return columns;
}

/**
 * The superset numbers rewritten to say exactly what the screen shows (the screen merges only
 * neighbours — see `supersetRuns` in format.ts): each run of two or more neighbours sharing a
 * number keeps it; an exercise not in such a run has none; and if one number is shared by two
 * separate runs (members moved apart), the later run gets a fresh number so they stay separate.
 *
 * Example: [1, null, 1] (a pair split by a move) → [null, null, null];
 *          [1, 1, null, 1, 1] → [1, 1, null, 2, 2].
 */
function asShown(groups: readonly (number | null)[]): (number | null)[] {
  const out: (number | null)[] = groups.map(() => null);
  const used = new Set<number>();
  let max = Math.max(0, ...groups.map((g) => g ?? 0));
  for (let start = 0; start < groups.length; ) {
    let end = start + 1;
    while (groups[start] != null && end < groups.length && groups[end] === groups[start]) end++;
    const group = groups[start];
    if (group != null && end - start > 1) {
      const number = used.has(group) ? ++max : group;
      used.add(number);
      for (let i = start; i < end; i++) out[i] = number;
    }
    start = end;
  }
  return out;
}

/**
 * Superset bookkeeping, as a pure function so it can be reasoned about (and tested through the
 * store) without a database: given each exercise's superset number in workout order, returns
 * the numbers after either linking exercise `index` to the one above it (`link`) or cutting
 * that link (`unlink`).
 *
 * The model: the link toggle on a card is a hinge between that card and the one above it.
 *   - Linking merges the run above the hinge with the run starting at it. The run keeps the
 *     number the one above already has; if it has none, this exercise's own; if neither has
 *     one, a fresh number (the biggest number in the workout + 1, so it can't collide).
 *   - Unlinking gives the exercises from the hinge down to the end of that run a fresh number,
 *     leaving the ones above it with the old number.
 *   - Afterwards any number held by only one exercise is cleared — a superset of one isn't a
 *     superset, and leaving it would make a later link re-join a stranger.
 *
 * "Run" means consecutive exercises sharing a number. Before either action the numbers are
 * first made to match what the screen shows (`asShown`): reordering never rewrites groups, so
 * an exercise moved away from its superset still carries the number; left in place, a later
 * link could pull a far-away stray back in and make a tri-set the lifter never built.
 */
function relinkSupersets(stored: readonly (number | null)[], index: number, action: 'link' | 'unlink'): (number | null)[] {
  const groups = asShown(stored);
  const next = [...groups];
  const fresh = (): number => {
    const group = Math.max(0, ...next.map((g) => g ?? 0)) + 1;
    assertValidSupersetGroup(group);
    return group;
  };
  // Indexes of the run that starts at `index` (just `index` when it has no group).
  const runFromHinge: number[] = [index];
  for (let i = index + 1; groups[index] != null && i < groups.length && groups[i] === groups[index]; i++) {
    runFromHinge.push(i);
  }
  if (action === 'link') {
    const target = groups[index - 1] ?? groups[index] ?? fresh();
    next[index - 1] = target;
    for (const i of runFromHinge) next[i] = target;
  } else {
    const group = fresh();
    for (const i of runFromHinge) next[i] = group;
  }
  // Clear any number only one exercise still holds.
  const counts = new Map<number, number>();
  for (const g of next) if (g != null) counts.set(g, (counts.get(g) ?? 0) + 1);
  return next.map((g) => (g != null && counts.get(g) === 1 ? null : g));
}

/**
 * Starts a blank workout for `userId` (LOG-1's "start an empty workout") and returns its store.
 * The workout is saved to the phone immediately, public by default, with no title yet.
 *
 * Refuses (throws) if this user already has an unfinished workout: the screen must decide
 * whether to resume it (`loadActiveWorkout`) or throw it away (`discard`) — the store never
 * quietly creates a second active workout.
 */
export async function startActiveWorkout(
  db: SqlDriver,
  userId: string,
  options: ActiveWorkoutOptions = {},
): Promise<ActiveWorkoutStore> {
  const clock = options.clock ?? systemClock;
  const mintId = options.mintId ?? newUuid;
  const now = clock();
  const workout: WorkoutRow = {
    id: mintId(),
    user_id: userId,
    title: null,
    notes: null,
    started_at: now,
    ended_at: null,
    visibility: 'public',
    created_at: now,
    updated_at: now,
  };
  await db.withTransactionAsync(async (tx) => {
    // Checked inside the transaction so two quick starts can't both pass.
    if (await findActiveWorkoutId(tx, userId)) {
      throw new Error('A workout is already in progress; resume or discard it before starting another');
    }
    await writeDraftRowsTx(tx, 'workouts', [workout], now);
  });
  const snapshot = await readTree(db, userId, workout.id);
  if (!snapshot) throw new Error('The new workout could not be read back from the device');
  return createStore(db, userId, snapshot, clock, mintId);
}

/**
 * Finds `userId`'s unfinished workout on the phone and rebuilds its store — what the app does on
 * launch to pick up where the lifter left off, even after the app was killed. Returns null when
 * there is no workout in progress.
 *
 * If more than one unfinished workout exists (not possible through this store), the newest is
 * returned and the others are left untouched — never silently deleted.
 */
export async function loadActiveWorkout(
  db: SqlDriver,
  userId: string,
  options: ActiveWorkoutOptions = {},
): Promise<ActiveWorkoutStore | null> {
  const id = await findActiveWorkoutId(db, userId);
  if (!id) return null;
  const snapshot = await readTree(db, userId, id);
  if (!snapshot) return null;
  return createStore(db, userId, snapshot, options.clock ?? systemClock, options.mintId ?? newUuid);
}

/** Builds the store object around a snapshot already read from SQLite. */
function createStore(
  db: SqlDriver,
  userId: string,
  initial: ActiveWorkoutSnapshot,
  clock: () => string,
  mintId: () => string,
): ActiveWorkoutStore {
  const workoutId = initial.workout.id;
  let snapshot = initial;
  let status: ActiveWorkoutStatus = 'active';
  const listeners = new Set<() => void>();
  // Operations run one at a time, in call order, so two quick taps can't both read the same
  // "next position" and collide.
  let tail: Promise<unknown> = Promise.resolve();

  /** Tells every subscriber (a screen, from B09) that the snapshot changed. */
  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  /** Re-reads the workout from SQLite and publishes it as the new snapshot. */
  async function refresh(): Promise<void> {
    const next = await readTree(db, userId, workoutId);
    if (!next) throw new Error('The active workout is no longer on the device');
    snapshot = next;
    notify();
  }

  /**
   * Runs one operation in turn: refuses if the workout is no longer active, otherwise runs
   * `work` (which saves to SQLite) and then rebuilds the snapshot from SQLite. If `work` throws,
   * its transaction has rolled back and the snapshot is left as it was.
   *
   * `pick` turns `work`'s result (usually a new row's id) into what the caller gets back, read
   * from the rebuilt snapshot — so callers receive exactly what SQLite holds. `reread: false` is
   * only for `discard`, after which there is nothing left to read.
   */
  function mutate<T, R = T>(
    work: () => Promise<T>,
    { reread = true, pick }: { reread?: boolean; pick?: (value: T) => R } = {},
  ): Promise<R> {
    const run = async (): Promise<R> => {
      if (status !== 'active') throw new Error(`This workout is ${status} and can no longer be changed`);
      const value = await work();
      if (reread) await refresh();
      else notify();
      return pick ? pick(value) : (value as unknown as R);
    };
    const result = tail.then(run, run);
    tail = result.catch(() => undefined);
    return result;
  }

  /** Finds an exercise of THIS workout by id; throws for an id from anywhere else. */
  function entryById(entryId: string): ActiveEntry {
    const entry = snapshot.entries.find((e) => e.id === entryId);
    if (!entry) throw new Error(`No exercise ${entryId} in this workout`);
    return entry;
  }

  /** Finds a set of THIS workout by id, with the exercise it belongs to; throws otherwise. */
  function setById(setId: string): { entry: ActiveEntry; set: SetRow } {
    for (const entry of snapshot.entries) {
      const set = entry.sets.find((s) => s.id === setId);
      if (set) return { entry, set };
    }
    throw new Error(`No set ${setId} in this workout`);
  }

  /**
   * Re-numbers exercises 0, 1, 2, … in the given order, saving only those whose number changed,
   * so positions always stay a gap-free 0…n-1 after a remove or a move.
   */
  async function renumberEntriesTx(tx: SqlExecutor, ordered: readonly ActiveEntry[], now: string): Promise<void> {
    const changed = ordered
      .map(({ sets: _nested, ...entry }, position) => ({ ...entry, position }))
      .filter((entry, i) => entry.position !== ordered[i].position);
    await writeDraftRowsTx(tx, 'workout_exercises', changed, now);
  }

  /** The same gap-free re-numbering for one exercise's sets. */
  async function renumberSetsTx(tx: SqlExecutor, ordered: readonly SetRow[], now: string): Promise<void> {
    const changed = ordered
      .map((set, position) => ({ ...set, position }))
      .filter((set, i) => set.position !== ordered[i].position);
    await writeDraftRowsTx(tx, 'sets', changed, now);
  }

  /** Saves a new set at the end of `entry`. */
  async function appendSet(entry: ActiveEntry, columns: ReturnType<typeof setColumns>): Promise<SetRow> {
    const now = clock();
    const set: SetRow = { id: mintId(), workout_exercise_id: entry.id, ...columns, created_at: now, updated_at: now };
    await db.withTransactionAsync((tx) => writeDraftRowsTx(tx, 'sets', [set], now));
    return set;
  }

  /**
   * Deletes the given sets (from any exercises of this workout) and closes the gaps in each
   * affected exercise's set numbers — all in one transaction.
   */
  async function deleteSets(setIds: readonly string[]): Promise<void> {
    const doomed = new Set(setIds.map((id) => setById(id).set.id));
    const affected = snapshot.entries.filter((e) => e.sets.some((s) => doomed.has(s.id)));
    const now = clock();
    await db.withTransactionAsync(async (tx) => {
      await deleteDraftRowsTx(tx, 'sets', [...doomed]);
      for (const entry of affected) {
        await renumberSetsTx(
          tx,
          entry.sets.filter((s) => !doomed.has(s.id)),
          now,
        );
      }
    });
  }

  /** Each exercise's superset number, in workout order. */
  function supersetGroups(): (number | null)[] {
    return snapshot.entries.map((e) => e.superset_group);
  }

  /**
   * Saves new superset numbers (one per exercise, in workout order), writing only the exercises
   * whose number changed — all in one transaction, so a superset is never half-linked.
   */
  async function saveSupersetGroups(groups: readonly (number | null)[]): Promise<void> {
    const now = clock();
    const changed = snapshot.entries.flatMap(({ sets: _nested, ...entry }, i) =>
      entry.superset_group === groups[i] ? [] : [{ ...entry, superset_group: groups[i] }],
    );
    await db.withTransactionAsync((tx) => writeDraftRowsTx(tx, 'workout_exercises', changed, now));
  }

  /**
   * Replaces what one set says, keeping its id and place: `inputFor` gets the set as it stands
   * now and returns what it should say. Every value is checked before anything is saved.
   * Returns the set's id. Only call it inside `mutate`, so "as it stands now" is after every
   * earlier queued change.
   */
  async function rewriteSet(setId: string, inputFor: (set: SetRow) => SetInput): Promise<string> {
    const { set } = setById(setId);
    const now = clock();
    const updated: SetRow = { ...set, ...setColumns(inputFor(set), set.position), updated_at: now };
    await db.withTransactionAsync((tx) => writeDraftRowsTx(tx, 'sets', [updated], now));
    return set.id;
  }

  /** Saves a change to the workout row itself (its title or note), in one transaction. */
  async function saveWorkoutRow(change: Partial<Pick<WorkoutRow, 'title' | 'notes'>>): Promise<void> {
    const now = clock();
    await db.withTransactionAsync((tx) => writeDraftRowsTx(tx, 'workouts', [{ ...snapshot.workout, ...change }], now));
  }

  /** The saved copy of a set (used after `refresh`), so callers get exactly what SQLite holds. */
  function savedSet(setId: string): SetRow {
    return setById(setId).set;
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getStatus: () => status,

    addExercise: (exerciseId) =>
      mutate(async () => {
        const now = clock();
        const entry: WorkoutExerciseRow = {
          id: mintId(),
          workout_id: workoutId,
          exercise_id: exerciseId,
          position: snapshot.entries.length,
          notes: null,
          superset_group: null,
          created_at: now,
          updated_at: now,
        };
        await db.withTransactionAsync(async (tx) => {
          // The phone has no foreign key to exercises, but the server does: an unknown id (or
          // someone else's custom exercise) would be refused at upload and block the queue.
          const exercise = await tx.getFirstAsync<{ id: string }>(
            'select id from exercises where id = ? and (owner_id is null or owner_id = ?)',
            [exerciseId, userId],
          );
          if (!exercise) throw new Error(`Exercise ${exerciseId} is not in this user's library`);
          await writeDraftRowsTx(tx, 'workout_exercises', [entry], now);
        });
        return entry.id;
      }, { pick: entryById }),

    removeExercise: (entryId) =>
      mutate(async () => {
        const entry = entryById(entryId);
        const rest = snapshot.entries.filter((e) => e.id !== entry.id);
        const now = clock();
        await db.withTransactionAsync(async (tx) => {
          await deleteDraftRowsTx(tx, 'workout_exercises', [entry.id]);
          await renumberEntriesTx(tx, rest, now);
        });
      }),

    reorderExercise: (entryId, newPosition) =>
      mutate(async () => {
        const entry = entryById(entryId);
        const last = snapshot.entries.length - 1;
        if (!Number.isInteger(newPosition) || newPosition < 0 || newPosition > last) {
          throw new RangeError(`newPosition must be a whole number from 0 to ${last}, got ${newPosition}`);
        }
        const order = snapshot.entries.filter((e) => e.id !== entry.id);
        order.splice(newPosition, 0, entry);
        const now = clock();
        await db.withTransactionAsync((tx) => renumberEntriesTx(tx, order, now));
      }),

    logSet: (entryId, input) =>
      mutate(async () => {
        const entry = entryById(entryId);
        return (await appendSet(entry, setColumns(input, entry.sets.length))).id;
      }, { pick: savedSet }),

    updateSet: (setId, input) => mutate(() => rewriteSet(setId, () => input), { pick: savedSet }),

    updateSets: (changes) =>
      mutate(async () => {
        const now = clock();
        // Every value is checked before anything is written; one bad value saves none.
        const updated = changes.map(({ setId, input }) => {
          const { set } = setById(setId);
          return { ...set, ...setColumns(input, set.position) };
        });
        await db.withTransactionAsync((tx) => writeDraftRowsTx(tx, 'sets', updated, now));
      }),

    removeSet: (setId) => mutate(() => deleteSets([setId])),

    removeSets: (setIds) => mutate(() => deleteSets(setIds)),

    repeatLastSet: (entryId) =>
      mutate(async () => {
        const entry = entryById(entryId);
        const previous = entry.sets[entry.sets.length - 1];
        if (!previous) throw new Error('This exercise has no set to repeat yet');
        // The previous set's values were checked when it was saved; only the position is new.
        const columns = {
          position: entry.sets.length,
          reps: previous.reps,
          weight_kg: previous.weight_kg,
          rpe: previous.rpe,
          is_warmup: previous.is_warmup,
          drop_set_position: previous.drop_set_position,
          duration_seconds: previous.duration_seconds,
          score: previous.score,
          // Deliberately NOT copied: a note is the lifter's remark about that one set ("elbow
          // twinged on rep 3"), not part of its performance — one tap must not duplicate it onto
          // a set it wasn't said about. (`setInputFromRow` keeps notes on purpose; see there.)
          notes: null,
        };
        assertValidSetFields({ position: columns.position });
        return (await appendSet(entry, columns)).id;
      }, { pick: savedSet }),

    setTitle: (title) =>
      mutate(async () => {
        const cleaned = cleanText(title);
        assertValidWorkoutTitle(cleaned);
        await saveWorkoutRow({ title: cleaned });
      }),

    setNotes: (notes) =>
      mutate(async () => {
        const cleaned = cleanText(notes);
        assertValidWorkoutNotes(cleaned);
        await saveWorkoutRow({ notes: cleaned });
      }),

    setEntryNotes: (entryId, notes) =>
      mutate(async () => {
        const { sets: _nested, ...entry } = entryById(entryId);
        const cleaned = cleanText(notes);
        assertValidEntryNotes(cleaned);
        const now = clock();
        await db.withTransactionAsync((tx) =>
          writeDraftRowsTx(tx, 'workout_exercises', [{ ...entry, notes: cleaned }], now),
        );
      }),

    setSetNotes: (setId, notes) =>
      mutate(async () => {
        // The set is read inside the queue, so it is as every earlier change left it.
        await rewriteSet(setId, (set) => ({ ...setInputFromRow(set), notes }));
      }),

    linkWithPrevious: (entryId) =>
      mutate(async () => {
        const entry = entryById(entryId);
        if (entry.position === 0) throw new Error('The first exercise has no exercise above it to superset with');
        const above = snapshot.entries[entry.position - 1];
        if (above.superset_group != null && above.superset_group === entry.superset_group) return;
        await saveSupersetGroups(relinkSupersets(supersetGroups(), entry.position, 'link'));
      }),

    unlinkFromPrevious: (entryId) =>
      mutate(async () => {
        const entry = entryById(entryId);
        const above = snapshot.entries[entry.position - 1];
        if (!above || entry.superset_group == null || above.superset_group !== entry.superset_group) return;
        await saveSupersetGroups(relinkSupersets(supersetGroups(), entry.position, 'unlink'));
      }),

    finish: () =>
      mutate(async () => {
        const now = clock();
        // The server requires ended_at >= started_at; a device clock that jumped backwards must
        // not turn into an upload the server refuses forever, so the end is never before the start.
        const endedAt = Date.parse(now) < Date.parse(snapshot.workout.started_at) ? snapshot.workout.started_at : now;
        const workout: WorkoutRow = { ...snapshot.workout, ended_at: endedAt };
        await writeLocalTree(
          db,
          {
            workouts: [workout],
            workout_exercises: snapshot.entries.map(({ sets: _nested, ...entry }) => entry),
            sets: snapshot.entries.flatMap((e) => e.sets),
          },
          { now },
        );
        status = 'finished';
      }, { pick: () => snapshot.workout }),

    discard: () =>
      mutate(
        async () => {
          // Deleting the workout removes its entries and sets with it (the foreign keys cascade).
          await db.withTransactionAsync((tx) => deleteDraftRowsTx(tx, 'workouts', [workoutId]));
          status = 'discarded';
        },
        { reread: false },
      ),
  };
}
