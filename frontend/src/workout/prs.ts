/**
 * Personal records on the phone (LOG-4): working out which record books a finished workout
 * improved, and reading the lifter's current records back.
 *
 * What a "record" is here: one row per record book — user × exercise × kind (the heaviest
 * single, the heaviest weight for exactly N reps, the best estimated 1RM) — holding the current
 * best and the set that set it. The RULES for what counts as a PR (warm-ups never, volume never,
 * ties never) are not here: they live in `@training-math` (`recordBooks`, `beatsRecord`). This
 * file only runs the queries and turns the math's answer into rows.
 *
 * When records are computed: when a workout is finished (`activeWorkout.ts`'s `finish`), from the
 * lifter's whole history of each exercise in it, on the device — so it works offline — and saved
 * in the same transaction as the workout. Then they sync like any other table. And (B14) when a
 * past workout is edited or deleted (`editWorkout.ts`): `recomputeRecords` re-derives the touched
 * exercises' books from the remaining history, which may lower or remove a record too.
 *
 * Every query here is parameterized and filtered by the signed-in user's id (the device file can
 * still hold a previous account's rows).
 */
import {
  beatsRecord,
  compareRecordBooks,
  recordBooks,
  roundToIncrement,
  type PrKind,
  type RecordBook,
  type RefSet,
} from '@training-math';

import {
  deleteLocalRowsTx,
  fromSqlRow,
  TABLE_COLUMNS,
  writeLocalRowsTx,
  type PersonalRecordRow,
  type SetRow,
} from '@/db/dao';
import type { SqlExecutor } from '@/db/driver';
import { uuidv5 } from '@/library/uuidv5';

import { groupPrs, type ExercisePrs } from './prList';
import { enqueueTx } from '@/sync/outbox';

/**
 * The fixed namespace personal-record ids are made in. Never change it: every phone and the
 * server already hold rows whose ids were made with it.
 */
export const PR_RECORD_NAMESPACE = '6b3f1c2e-8a4d-4f7b-9e21-3c5d7a9b0e14';

/** The server column keeps 3 decimals (numeric(8,3)); values are rounded to that before compare and save. */
const VALUE_INCREMENT_KG = 0.001;

/**
 * The database id of one record book: the same user, exercise, kind and rep count always give
 * the same id, on every phone. Why: the row's identity IS the book — two phones that both
 * improve your 5-rep squat max offline upload to the same row (the later one wins) instead of
 * clashing as two "5RM" rows. `reps` is only part of a rep-max book's id.
 */
export function personalRecordId(userId: string, exerciseId: string, kind: PrKind, reps: number | null): string {
  const repPart = kind === 'repMax' && reps != null ? String(reps) : '';
  return uuidv5(PR_RECORD_NAMESPACE, `${userId}:${exerciseId}:${kind}:${repPart}`);
}

/**
 * The lifter's current records for one exercise, as stored on the phone, listed true 1RM,
 * e1RM, then rep maxes by rep count. Empty when nothing has been recorded yet. The logger's
 * panel, the history screen and the saved workout's PR badges all read this one function.
 */
export async function currentPrs(db: SqlExecutor, userId: string, exerciseId: string): Promise<PersonalRecordRow[]> {
  const columns = (TABLE_COLUMNS.personal_records as readonly string[]).join(', ');
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `select ${columns} from personal_records where user_id = ? and exercise_id = ?`,
    [userId, exerciseId],
  );
  return rows.map((r) => fromSqlRow('personal_records', r)).sort(compareRecordBooks);
}

/**
 * Every current record the lifter holds, one group per exercise (YOU-3, B25) — the own profile's
 * PR list, read from the phone so it works offline. Names come from the phone's exercise list
 * (the library plus the lifter's own customs); exercises are ordered by name and each one's
 * records in the usual record-book order (`groupPrs`, shared with another lifter's list so both
 * look the same). These are exactly the rows `improvedRecords` / `recomputeRecords` wrote — nothing
 * is recomputed here.
 */
export async function allCurrentPrs(db: SqlExecutor, userId: string): Promise<ExercisePrs[]> {
  const rows = await db.getAllAsync<{
    id: string;
    exercise_id: string;
    kind: PersonalRecordRow['kind'];
    reps: number | null;
    value_kg: number;
    exercise_name: string | null;
  }>(
    `select pr.id, pr.exercise_id, pr.kind, pr.reps, pr.value_kg, e.name as exercise_name
     from personal_records pr
     left join exercises e on e.id = pr.exercise_id and (e.owner_id is null or e.owner_id = ?)
     where pr.user_id = ?`,
    [userId, userId],
  );
  return groupPrs(
    rows.map((r) => ({
      exerciseId: r.exercise_id,
      exerciseName: typeof r.exercise_name === 'string' ? r.exercise_name : null,
      record: { id: r.id, kind: r.kind, reps: r.reps ?? null, value_kg: Number(r.value_kg) },
    })),
  );
}

/** The parts of a set the PR math reads, plus its id (the proof a record points at). */
type FoldSet = Pick<SetRow, 'id' | 'reps' | 'weight_kg' | 'is_warmup'>;

/** A set as the math module's fold wants it, labelled with its id. */
function toRefSet(set: FoldSet): RefSet<string> {
  return { reps: set.reps, weightKg: set.weight_kg, isWarmup: set.is_warmup, ref: set.id };
}

/**
 * Every set of `exerciseId` in the user's FINISHED workouts, oldest first, in logged order.
 * The `ended_at is not null` filter leaves out both the workout being finished right now (still
 * a draft when this runs) and any stray unfinished drafts — the caller adds today's sets itself.
 */
async function finishedHistory(db: SqlExecutor, userId: string, exerciseId: string): Promise<FoldSet[]> {
  const rows = await db.getAllAsync<{ id: string; reps: number | null; weight_kg: number | null; is_warmup: number }>(
    `select s.id, s.reps, s.weight_kg, s.is_warmup
     from sets s
     join workout_exercises we on we.id = s.workout_exercise_id
     join workouts w on w.id = we.workout_id
     where w.user_id = ? and w.ended_at is not null and we.exercise_id = ?
     order by w.started_at, w.id, we.position, we.id, s.position, s.id`,
    [userId, exerciseId],
  );
  return rows.map((r) => ({ ...r, is_warmup: r.is_warmup === 1 }));
}

/** One exercise of the workout being finished: which exercise, and its sets in logged order. */
export interface FinishingEntry {
  exercise_id: string | null;
  sets: readonly FoldSet[];
}

/**
 * The record rows a workout about to be finished should write — only books it (or earlier
 * history) improved past what the phone has stored.
 *
 * Inputs: the database, the lifter, the finishing workout's exercises with their sets (from the
 * active-workout store, in workout order), and the time to stamp new rows with.
 * Output: new or improved `personal_records` rows; nothing for a book that didn't move.
 *
 * For each distinct exercise (an exercise slot with no exercise — a deleted custom — is skipped):
 *   1. fold the full finished history PLUS today's sets through `recordBooks`, so every book
 *      comes back with the set that holds it;
 *   2. read the stored records;
 *   3. keep only books whose value beats the stored one (or that have none).
 * Step 3 never lowers a record. That is what lets the very first finish after this feature
 * shipped fill in records from older history (pointing at the older sets, so today's lighter
 * set is not wrongly badged), and what stops a phone that hasn't finished downloading from
 * overwriting a better record with a worse one.
 */
export async function improvedRecords(
  db: SqlExecutor,
  userId: string,
  entries: readonly FinishingEntry[],
  now: string,
): Promise<PersonalRecordRow[]> {
  const exerciseIds = [...new Set(entries.map((e) => e.exercise_id).filter((id): id is string => id != null))];
  const rows: PersonalRecordRow[] = [];
  for (const exerciseId of exerciseIds) {
    const today = entries.filter((e) => e.exercise_id === exerciseId).flatMap((e) => e.sets);
    const history = [...(await finishedHistory(db, userId, exerciseId)), ...today];
    const books = recordBooks(history.map(toRefSet));
    const stored = await currentPrs(db, userId, exerciseId);
    for (const book of books) {
      const row = rowIfImproved(userId, exerciseId, book, stored, now);
      if (row) rows.push(row);
    }
  }
  return rows;
}

/** The row to write for one folded book, or null when the stored record already holds. */
function rowIfImproved(
  userId: string,
  exerciseId: string,
  book: RecordBook<string>,
  stored: readonly PersonalRecordRow[],
  now: string,
): PersonalRecordRow | null {
  const existing = storedBookFor(book, stored);
  const row = bookRow(userId, exerciseId, book, existing, now);
  return beatsRecord(row.value_kg, existing?.value_kg) ? row : null;
}

/** The stored record of the same book (same kind, same rep count) as `book`, if any. */
function storedBookFor(book: RecordBook<string>, stored: readonly PersonalRecordRow[]): PersonalRecordRow | undefined {
  const reps = book.kind === 'repMax' ? book.reps : null;
  return stored.find((r) => r.kind === book.kind && (r.reps ?? null) === reps);
}

/**
 * The `personal_records` row for one folded book — its fixed id, the value rounded to the
 * column's 3 decimals, the set holding it — keeping the stored row's `created_at` (when the
 * book was first set) if there is one. Shared by the finish path and the edit path.
 */
function bookRow(
  userId: string,
  exerciseId: string,
  book: RecordBook<string>,
  existing: PersonalRecordRow | undefined,
  now: string,
): PersonalRecordRow {
  const reps = book.kind === 'repMax' ? book.reps : null;
  return {
    id: personalRecordId(userId, exerciseId, book.kind, reps),
    user_id: userId,
    exercise_id: exerciseId,
    kind: book.kind,
    reps,
    value_kg: roundToIncrement(book.valueKg, VALUE_INCREMENT_KG),
    source_set_id: book.ref,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}

/**
 * What a forced recompute found needs changing (B14). Three kinds of change, because each must
 * reach the server differently:
 *   - `upserts` — a new book, a raised value, or the same value now held by a different set:
 *     sent as a plain upload. Kept a plain upload on purpose: if another phone has meanwhile
 *     set an even higher record, the server's keep-best rule keeps that one;
 *   - `demotions` — a book whose value went DOWN (the record-holding set was deleted or edited
 *     lighter, so the next best takes over): sent as a delete and then an upload of the same
 *     row id. The server's keep-best rule only guards updates, so delete-then-insert is the one
 *     way a legitimate lowering gets through it (see push.ts);
 *   - `removals` — ids of books that no longer exist at all (the only 5-rep set was deleted):
 *     deleted locally and on the server.
 */
export interface RecomputedRecords {
  upserts: PersonalRecordRow[];
  demotions: PersonalRecordRow[];
  removals: string[];
}

/**
 * Re-derives the lifter's record books for the given exercises from their ENTIRE finished
 * history, and says how the stored records must change to match — raising, lowering or
 * removing them. This is the counterpart of `improvedRecords` for when history itself changed
 * (a past workout was edited or deleted, LOG-9); `improvedRecords` only ever raises, and is
 * still what finishing uses.
 *
 * Inputs: an open transaction (so the read sees the edit being saved in it), the lifter, the
 * exercises whose history changed, and the time to stamp rows with. Reads only — apply the
 * answer with `saveRecomputedRecordsTx` in the same transaction.
 *
 * Values are compared after rounding both sides to the column's 3 decimals; what counts as a
 * record at all (warm-ups never, ties keep the earlier set) is decided by the math module's
 * `recordBooks`, not here.
 */
export async function recomputeRecords(
  tx: SqlExecutor,
  userId: string,
  exerciseIds: Iterable<string>,
  now: string,
): Promise<RecomputedRecords> {
  const out: RecomputedRecords = { upserts: [], demotions: [], removals: [] };
  for (const exerciseId of new Set(exerciseIds)) {
    const books = recordBooks((await finishedHistory(tx, userId, exerciseId)).map(toRefSet));
    const stored = await currentPrs(tx, userId, exerciseId);
    const kept = new Set<string>();
    for (const book of books) {
      const existing = storedBookFor(book, stored);
      const row = bookRow(userId, exerciseId, book, existing, now);
      kept.add(row.id);
      if (!existing) {
        out.upserts.push(row);
        continue;
      }
      const storedValue = roundToIncrement(existing.value_kg, VALUE_INCREMENT_KG);
      if (row.value_kg === storedValue && row.source_set_id === existing.source_set_id) continue;
      (row.value_kg >= storedValue ? out.upserts : out.demotions).push(row);
    }
    for (const record of stored) if (!kept.has(record.id)) out.removals.push(record.id);
  }
  return out;
}

/**
 * Saves a recompute's answer on the phone and queues it for the server, inside the caller's
 * transaction: upserts are written and queued as uploads; demotions are written and queued as
 * a delete line followed by an upload line (in that order — see `RecomputedRecords`); removals
 * are deleted and queued as deletes. The caller tells the sync listeners after committing.
 */
export async function saveRecomputedRecordsTx(tx: SqlExecutor, changes: RecomputedRecords, now: string): Promise<void> {
  await writeLocalRowsTx(tx, 'personal_records', changes.upserts, now);
  for (const row of changes.demotions) await enqueueTx(tx, 'personal_records', row.id, now, 'delete');
  await writeLocalRowsTx(tx, 'personal_records', changes.demotions, now);
  await deleteLocalRowsTx(tx, 'personal_records', changes.removals, now);
}
