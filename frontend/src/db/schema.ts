/**
 * The on-device database's tables, and the routine that creates or upgrades
 * them.
 *
 * What lives on the phone:
 *   - exercises, workouts, workout_exercises, sets — a local mirror of the
 *     server's training tables (backend/supabase/migrations/…_training.sql and
 *     …_exercises_slug.sql). Column names match the server's exactly, so
 *     syncing a row is a straight copy, not a translation.
 *   - personal_records — the lifter's current PRs per exercise (version 4, B13).
 *   - outbox — the list of local changes (uploads and, from version 5,
 *     deletions) not yet sent to the server (see `sync/outbox.ts`).
 *   - sync_state — small bookkeeping values, such as how far the last
 *     download got.
 *
 * The server's CHECK rules (rep counts ≥ 0, RPE 1–10, …) are deliberately NOT
 * repeated here: the server is where they are enforced, and a second copy
 * would be a second place for the rules to drift.
 *
 * Upgrades: SQLite keeps a version number in the file (`PRAGMA user_version`).
 * `MIGRATIONS[0]` takes a new file to version 1, `MIGRATIONS[1]` (added by a
 * later step) to version 2, and so on. A migration is never edited once it
 * has shipped — phones in the field have already run it.
 */
import type { SqlDriver } from './driver';

/** Version 1: the training mirror plus the sync bookkeeping tables. */
const V1 = `
create table exercises (
  id             text primary key not null,
  owner_id       text,
  name           text not null,
  primary_muscle text,
  equipment      text,
  slug           text,
  created_at     text not null,
  updated_at     text not null
);

create table workouts (
  id         text primary key not null,
  user_id    text not null,
  title      text,
  notes      text,
  started_at text not null,
  ended_at   text,
  visibility text not null default 'public',
  created_at text not null,
  updated_at text not null
);
create index workouts_user_idx on workouts (user_id, started_at);

create table workout_exercises (
  id             text primary key not null,
  workout_id     text not null references workouts (id) on delete cascade,
  -- Nullable like the server's (…_fix_exercise_delete.sql): deleting a custom
  -- exercise keeps the logged work with no exercise attached.
  exercise_id    text,
  position       integer not null,
  notes          text,
  superset_group integer,
  created_at     text not null,
  updated_at     text not null
);
create index workout_exercises_workout_idx on workout_exercises (workout_id);

create table sets (
  id                  text primary key not null,
  workout_exercise_id text not null references workout_exercises (id) on delete cascade,
  position            integer not null,
  reps                integer,
  weight_kg           real,
  rpe                 real,
  is_warmup           integer not null default 0,
  drop_set_position   integer,
  duration_seconds    integer,
  created_at          text not null,
  updated_at          text not null
);
create index sets_entry_idx on sets (workout_exercise_id);

-- One line per local change waiting to be pushed. Not unique per row on
-- purpose: an edit made while a push is in flight adds a newer line that the
-- push's acknowledgement does not delete (see sync/outbox.ts).
create table outbox (
  id        integer primary key autoincrement,
  tbl       text not null,
  row_id    text not null,
  queued_at text not null
);
create index outbox_row_idx on outbox (tbl, row_id);

create table sync_state (
  key   text primary key not null,
  value text
);
`;

/**
 * Version 2 (B11): a free-text `score` on each set, for WOD-style work that ends in a result
 * rather than reps ("7 rounds + 12 reps"). Mirrors the server's `…_sets_score.sql`.
 */
const V2 = `
alter table sets add column score text;
`;

/**
 * Version 3 (B12): a free-text `notes` on each set — the lifter's remark about that one set
 * ("elbow twinged on rep 3"). Mirrors the server's `…_sets_notes.sql`. Workouts and exercises
 * have had a `notes` column since version 1.
 */
const V3 = `
alter table sets add column notes text;
`;

/**
 * Version 4 (B13): `personal_records` — the lifter's current best in each record book (true
 * 1RM, rep max per rep count, estimated 1RM) per exercise, and the set that holds it. Mirrors
 * the server's `…_personal_records.sql`. Written on the phone when a workout is finished (see
 * `workout/prs.ts`) and synced like every other table. Like the rest of the mirror it has no
 * CHECKs or foreign keys: the server enforces those.
 */
const V4 = `
create table personal_records (
  id            text primary key not null,
  user_id       text not null,
  exercise_id   text not null,
  kind          text not null,
  reps          integer,
  value_kg      real not null,
  source_set_id text not null,
  created_at    text not null,
  updated_at    text not null
);
create index personal_records_user_exercise_idx on personal_records (user_id, exercise_id);
`;

/**
 * Version 5 (B14): each outbox line says WHAT to tell the server about its row — `upsert`
 * ("send this row as it is now") or `delete` ("this row is gone; delete it on the server").
 * Every line queued before B14 was an upload, which is exactly what the default makes it.
 * See `sync/outbox.ts` for why the two kinds are tracked separately.
 */
const V5 = `
alter table outbox add column op text not null default 'upsert';
`;

/** Every schema version, oldest first. Append only. */
export const MIGRATIONS: readonly string[] = [V1, V2, V3, V4, V5];

/** The schema version a fully upgraded database is at. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Brings the database file up to the newest schema.
 *
 * Reads the file's version, then runs each newer migration in its own
 * transaction together with the version bump — so an app killed mid-upgrade
 * either finished that migration or left the file exactly as it was, and the
 * next launch simply carries on.
 */
export async function migrate(db: SqlDriver): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('pragma user_version');
  const current = row?.user_version ?? 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    await db.withTransactionAsync(async (tx) => {
      await tx.execAsync(MIGRATIONS[version]);
      await tx.execAsync(`pragma user_version = ${version + 1}`);
    });
  }
}
