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
 * in the same transaction as the workout. Then they sync like any other table.
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

import { fromSqlRow, TABLE_COLUMNS, type PersonalRecordRow, type SetRow } from '@/db/dao';
import type { SqlExecutor } from '@/db/driver';
import { uuidv5 } from '@/library/uuidv5';

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
  const reps = book.kind === 'repMax' ? book.reps : null;
  const valueKg = roundToIncrement(book.valueKg, VALUE_INCREMENT_KG);
  const existing = stored.find((r) => r.kind === book.kind && (r.reps ?? null) === reps);
  if (!beatsRecord(valueKg, existing?.value_kg)) return null;
  return {
    id: personalRecordId(userId, exerciseId, book.kind, reps),
    user_id: userId,
    exercise_id: exerciseId,
    kind: book.kind,
    reps,
    value_kg: valueKg,
    source_set_id: book.ref,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}
