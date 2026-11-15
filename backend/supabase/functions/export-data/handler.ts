/**
 * What the `export-data` server function does with one request (B32, NFR-6 — "export training
 * data"), separated from the Deno wiring in `index.ts` so it can be tested with fakes (tests never
 * touch the real project).
 *
 * Why it exists: a lifter's training history belongs to them. This builds ONE JSON document
 * holding everything they own on Astra — every workout with its exercises and sets, every
 * personal record, every post-workout analysis, their custom exercises, profile, settings, body
 * data and the posts they authored — so they can keep it, move it, or read it without the app.
 * It is also the "save it first" step before deleting an account.
 *
 * Whose data: always and only the caller's. Every read is filtered by the caller's own id (or
 * walks down from rows that were), AND every read runs with the caller's login so the database's
 * security rules apply on top. The filter matters: those rules let a lifter SEE other people's
 * public workouts, so "everything readable" would not be "everything mine".
 *
 * What is left out, on purpose: follows, blocks, mutes, votes and comments (the social graph, not
 * training data — and votes/comments on posts that later became hidden can't be read back),
 * reports (moderation records), and photo files themselves (the document names each photo's
 * storage path; the picture bytes are not JSON).
 *
 * Weights are kilograms exactly as stored (`units: 'kg'`): an export is data, not a display.
 */

/** One database row, every column as the database returned it. */
export type Row = Record<string, unknown>;

/** Tables that hold at most one row per lifter, and the column naming whose it is. */
export type SingleRowTable = 'profiles' | 'user_settings' | 'user_body_data';
/** Tables a lifter owns many rows of, read by an owner column. */
export type OwnedTable = 'exercises' | 'workouts' | 'personal_records' | 'workout_analyses' | 'posts';
/** Tables reached through a parent: a workout's exercise entries, and an entry's sets. */
export type ChildTable = 'workout_exercises' | 'sets';

/** Most ids in one `in (…)` filter, so a request URL never grows too long. */
export const ID_CHUNK = 100;
/** Rows per page of a read — under the API's 1000-row response cap, so a full page means "maybe more". */
export const PAGE_ROWS = 500;

/** Which rows a page read matches: one column equal to a value, or one of a list of values. */
export type PageFilter = { column: string; eq: string } | { column: string; in: readonly string[] };

/** One page of a many-row read: rows `from`…`to` (inclusive) of the matches, ordered by `id`. */
export interface PageQuery {
  table: OwnedTable | ChildTable | 'flairs';
  columns: string;
  filter: PageFilter;
  from: number;
  to: number;
}

/**
 * The two database reads an export is built from, both run as the caller (index.ts); tests
 * pass fakes. Paging and id-chunking live here in the handler, not in the reads, so the tests
 * prove no history is ever cut off at the database API's row cap.
 */
export interface ExportDeps {
  /** The one row of `table` whose `column` equals `userId`, or null if there is none. */
  readOne(table: SingleRowTable, column: string, userId: string): Promise<Row | null>;
  /** One page of matching rows, ordered by id (see `PageQuery`). */
  readPage(query: PageQuery): Promise<Row[]>;
}

/** Splits a list into pieces of at most `size`. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every row matching `filter`, read page after page until a page comes back short. */
async function readAll(deps: ExportDeps, table: PageQuery['table'], columns: string, filter: PageFilter): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const page = await deps.readPage({ table, columns, filter, from, to: from + PAGE_ROWS - 1 });
    rows.push(...page);
    if (page.length < PAGE_ROWS) break;
  }
  return rows;
}

/** Every row whose `column` is one of `ids`, asked for in chunks of `ID_CHUNK` ids. */
async function readIn(deps: ExportDeps, table: PageQuery['table'], columns: string, column: string, ids: readonly string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const part of chunk(ids, ID_CHUNK)) rows.push(...(await readAll(deps, table, columns, { column, in: part })));
  return rows;
}

/** id → name for these rows of `table`. */
async function readNames(deps: ExportDeps, table: 'exercises' | 'flairs', ids: readonly string[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const row of await readIn(deps, table, 'id,name', 'id', ids)) names[String(row.id)] = String(row.name);
  return names;
}

/** A set, as it appears inside its exercise entry. */
export type ExportSet = Row;
/** An exercise entry of a workout, with its sets in logged order. */
export type ExportEntry = Row & { sets: ExportSet[] };
/** A workout, with its exercise entries in logged order. */
export type ExportWorkout = Row & { exercises: ExportEntry[] };

/** The whole export document (version 1). */
export interface ExportDocument {
  format: 'astra-export';
  version: 1;
  exportedAt: string;
  units: 'kg';
  user: { id: string; email: string | null };
  profile: Row | null;
  settings: Row | null;
  bodyData: Row | null;
  /** The lifter's own exercises, including deleted ones — old workouts still name them. */
  customExercises: Row[];
  /** Oldest first. */
  workouts: ExportWorkout[];
  personalRecords: Row[];
  analyses: Row[];
  posts: Row[];
  /** Names of the library exercises the workouts and records point at, so the file reads alone. */
  exerciseNames: Record<string, string>;
  /** Names of the flairs the posts carry. */
  flairs: Record<string, string>;
}

/** The function's answer. */
export type ExportResponse = { status: 200; body: ExportDocument };

/** The distinct non-empty string values of `key` across `rows`. */
function distinct(rows: readonly Row[], key: string): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value === 'string' && value !== '') out.add(value);
  }
  return [...out];
}

/** Sort helper: by a numeric `position`, then id, so nested lists come out in logged order. */
function byPosition(a: Row, b: Row): number {
  const pa = typeof a.position === 'number' ? a.position : 0;
  const pb = typeof b.position === 'number' ? b.position : 0;
  return pa - pb || String(a.id).localeCompare(String(b.id));
}

/** Sort helper: a workout's start time (oldest first), then id. */
function byStart(a: Row, b: Row): number {
  return String(a.started_at ?? '').localeCompare(String(b.started_at ?? '')) || String(a.id).localeCompare(String(b.id));
}

/**
 * Builds the caller's export (see the file comment).
 *
 * Inputs: the caller's id and email (as the auth server verified their login), the database
 * reads, and the time to stamp the document with. Output: a 200 with the document. Database
 * failures are thrown for index.ts to report as a server error (the app just asks again).
 */
export async function handleExportRequest(
  user: { id: string; email: string | null },
  deps: ExportDeps,
  now: Date = new Date(),
): Promise<ExportResponse> {
  const me = user.id;

  const [profile, settings, bodyData, customExercises, workouts, personalRecords, analyses, posts] = await Promise.all([
    deps.readOne('profiles', 'id', me),
    deps.readOne('user_settings', 'user_id', me),
    deps.readOne('user_body_data', 'user_id', me),
    readAll(deps, 'exercises', '*', { column: 'owner_id', eq: me }),
    readAll(deps, 'workouts', '*', { column: 'user_id', eq: me }),
    readAll(deps, 'personal_records', '*', { column: 'user_id', eq: me }),
    readAll(deps, 'workout_analyses', '*', { column: 'user_id', eq: me }),
    readAll(deps, 'posts', '*', { column: 'user_id', eq: me }),
  ]);

  // Down the tree: the caller's workouts → their exercise entries → those entries' sets. Only
  // ids that came from the caller's own workouts are ever asked for.
  const workoutIds = distinct(workouts, 'id');
  const entries = await readIn(deps, 'workout_exercises', '*', 'workout_id', workoutIds);
  const entryIds = distinct(entries, 'id');
  const sets = await readIn(deps, 'sets', '*', 'workout_exercise_id', entryIds);

  const setsByEntry = new Map<string, Row[]>();
  for (const set of sets) {
    const key = String(set.workout_exercise_id);
    setsByEntry.set(key, [...(setsByEntry.get(key) ?? []), set]);
  }
  const entriesByWorkout = new Map<string, ExportEntry[]>();
  for (const entry of entries) {
    const key = String(entry.workout_id);
    const withSets: ExportEntry = { ...entry, sets: (setsByEntry.get(String(entry.id)) ?? []).sort(byPosition) };
    entriesByWorkout.set(key, [...(entriesByWorkout.get(key) ?? []), withSets]);
  }
  const nested: ExportWorkout[] = [...workouts]
    .sort(byStart)
    .map((w) => ({ ...w, exercises: (entriesByWorkout.get(String(w.id)) ?? []).sort(byPosition) }));

  // Names for the library movements the history points at (customs are already in full above).
  const customIds = new Set(distinct(customExercises, 'id'));
  const namedIds = [...new Set([...distinct(entries, 'exercise_id'), ...distinct(personalRecords, 'exercise_id')])].filter(
    (id) => !customIds.has(id),
  );
  const exerciseNames = await readNames(deps, 'exercises', namedIds);
  const flairs = await readNames(deps, 'flairs', distinct(posts, 'flair_id'));

  return {
    status: 200,
    body: {
      format: 'astra-export',
      version: 1,
      exportedAt: now.toISOString(),
      units: 'kg',
      user: { id: me, email: user.email },
      profile,
      settings,
      bodyData,
      customExercises,
      workouts: nested,
      personalRecords,
      analyses,
      posts,
      exerciseNames,
      flairs,
    },
  };
}
