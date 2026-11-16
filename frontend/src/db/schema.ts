/**
 * The on-device database's tables, and the routine that creates or upgrades
 * them.
 *
 * What lives on the phone:
 *   - exercises, workouts, workout_exercises, sets — a local mirror of the
 *     server's training tables (backend/supabase/migrations/…_training.sql and
 *     …_exercises_slug.sql). Column names match the server's exactly, so
 *     syncing a row is a straight copy, not a translation.
 *     Custom exercises can be soft-deleted (`exercises.deleted_at`, version 11, B31).
 *   - personal_records — the lifter's current PRs per exercise (version 4, B13).
 *   - user_settings — the lifter's kg/lb choice (version 6, B15), who sees their new progress
 *     pics (version 10, B26) and their four push-notification switches (version 16, B47).
 *   - workout_analyses — each finished workout's post-workout analysis, as the
 *     server function wrote it (version 7, B18; download-only).
 *   - flairs — the server's list of post flairs (version 8, B21; download-only, replaced whole).
 *   - posts — the lifter's own posts: workout posts from the Post step (version 8, B21) and photo
 *     posts from Share a photo (version 9, B22). Upload-only.
 *   - programs, program_weeks, program_workouts, program_exercises — the lifter's own training
 *     programs (version 12, B34), synced both ways; soft-deleted through `deleted_at`.
 *   - program_runs — the lifter running one of those programs and where they are in it
 *     (version 13, B35), synced both ways; `workouts.program_workout_id` links a session to the
 *     program workout it was started from.
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

/**
 * Version 6 (B15): `user_settings` — the signed-in lifter's preferences, one row per user,
 * mirroring the server table of the same name (…_identity.sql). Only the columns the phone
 * syncs today: the kg/lb `unit` (and its `updated_at`); version 10 (B26) adds who sees new
 * progress pics. `default_workout_visibility` still has no reader on the phone (new workouts are
 * born public) and stays unmirrored. Synced by its own small push and pull phases (see
 * `db/userSettings.ts`), not the five-table machinery: this table is keyed by `user_id`, and
 * the server only lets the phone update it, never insert.
 */
const V6 = `
create table user_settings (
  user_id    text primary key not null,
  unit       text not null,
  updated_at text not null
);
`;

/**
 * Version 7 (B18): `workout_analyses` — the post-workout analysis of each finished workout,
 * mirroring the server table (…_workout_analyses.sql); `id` is the workout's id. Download-only:
 * the phone never writes it except to save a row the server sent (a download, or the server
 * function's reply), so it never gets outbox lines. `new_prs` holds the server's JSON list as
 * text, parsed where it is read (`analysis/analysis.ts`).
 */
const V7 = `
create table workout_analyses (
  id                 text primary key not null,
  user_id            text not null,
  engine_version     integer not null,
  total_volume_kg    real not null,
  total_sets         integer not null,
  working_sets       integer not null,
  duration_seconds   integer not null,
  new_prs            text not null,
  headline           text not null,
  message            text not null,
  workout_updated_at text not null,
  created_at         text not null,
  updated_at         text not null
);
create index workout_analyses_user_idx on workout_analyses (user_id);
`;

/**
 * Version 8 (B21): the two tables behind the Post step after Finish.
 *   - `flairs` — a copy of the server's founder-curated flair list ("WOD", "New PR", …), so the
 *     Post step can show its chips with no signal. Download-only and replaced whole on every
 *     download (the server table has no `updated_at` to bookmark). `upvotes_only` is 0/1.
 *   - `posts` — the lifter's OWN posts, written at the Post step and upload-only: the feed is
 *     read from the server, so nothing is ever downloaded into it. `workout_id` is unique, like
 *     the server's `posts_workout_unique` — one post per workout (the unique rule's own index
 *     also serves the "already posted?" lookup, so no second index).
 * Like the rest of the mirror, no foreign keys or CHECKs: the server enforces those.
 */
const V8 = `
create table flairs (
  id           text primary key not null,
  name         text not null,
  position     integer not null,
  upvotes_only integer not null
);

create table posts (
  id         text primary key not null,
  user_id    text not null,
  flair_id   text not null,
  workout_id text not null unique,
  visibility text not null,
  created_at text not null,
  updated_at text not null
);
`;

/**
 * Version 9 (B22): posts can be photos. Mirrors the server's `…_post_images.sql`:
 *   - `kind` — 'workout' (every existing post, which the default fills in), 'progress-pic' or 'pr';
 *   - `workout_id` becomes optional — a photo post shares no workout. Still unique: SQLite, like
 *     Postgres, lets any number of rows hold null in a unique column;
 *   - `image_path` — where the photo goes in the server's `post-images` bucket
 *     (`<user_id>/<post_id>.<ext>`); null for workout posts.
 * SQLite cannot drop a NOT NULL in place, so the table is rebuilt: a new table, every row copied
 * across, the old one dropped and the new one renamed. It runs inside the migration's own
 * transaction, so a kill mid-way leaves version 8 exactly as it was. The photo's file on the phone
 * is not a column: its location follows from the post's id (`social/postImages.ts`).
 */
const V9 = `
create table posts_v9 (
  id         text primary key not null,
  user_id    text not null,
  flair_id   text not null,
  kind       text not null default 'workout',
  workout_id text unique,
  image_path text,
  visibility text not null,
  created_at text not null,
  updated_at text not null
);
insert into posts_v9 (id, user_id, flair_id, kind, workout_id, image_path, visibility, created_at, updated_at)
  select id, user_id, flair_id, 'workout', workout_id, null, visibility, created_at, updated_at from posts;
drop table posts;
alter table posts_v9 rename to posts;
`;

/**
 * Version 10 (B26): `user_settings.progress_pic_visibility` — who a NEW progress pic is shown to
 * ('private', 'followers' or 'public'), the lifter's choice in Settings → Privacy. Mirrored on the
 * phone because a progress pic can be posted with no signal and must know its visibility then
 * (`social/createPost.ts`). A plain add-column: existing rows get 'private', the same default as
 * the server's column.
 */
const V10 = `
alter table user_settings add column progress_pic_visibility text not null default 'private';
`;

/**
 * Version 11 (B31): `exercises.deleted_at` — when the lifter deleted one of their own custom
 * exercises (ISO-8601 text; null while it is live). Mirrors the server's
 * `…_exercises_soft_delete.sql`. A delete only stamps this, so the row stays and the lifter's
 * logged sessions and PRs keep its name; the Library and the logger's picker hide stamped rows
 * (`library/customExercises.ts`). Library rows never carry it.
 */
const V11 = `
alter table exercises add column deleted_at text;
`;

/**
 * Version 12 (B34): the lifter's training programs — `programs` → `program_weeks` →
 * `program_workouts` → `program_exercises`, mirroring the server's `…_programs.sql` column for
 * column. Authored on the phone (offline) and synced through the generic outbox like workouts.
 *
 * Like `personal_records`, these tables have NO local foreign keys — the parent links
 * (`program_id`, `program_week_id`, `program_workout_id`) and `exercise_id` are bare columns, and
 * the server's foreign keys are the enforcement point. Why: each table downloads on its own
 * bookmark, so a week another phone uploaded a moment after its new program can arrive before the
 * program does; a local foreign key would refuse that download page and fail the whole sync. Without
 * one, the early week simply waits unseen — every read walks down from the program — until its
 * program lands. Deletes are soft (`deleted_at`, ISO-8601 text), so nothing needs a cascade. All
 * reads and writes go through `programs/programs.ts`, which filters the deleted rows.
 */
const V12 = `
create table programs (
  id         text primary key not null,
  user_id    text not null,
  name       text not null,
  deleted_at text,
  created_at text not null,
  updated_at text not null
);
create index programs_user_idx on programs (user_id);

create table program_weeks (
  id         text primary key not null,
  program_id text not null,
  position   integer not null,
  deleted_at text,
  created_at text not null,
  updated_at text not null
);
create index program_weeks_program_idx on program_weeks (program_id);

create table program_workouts (
  id              text primary key not null,
  program_week_id text not null,
  name            text,
  position        integer not null,
  deleted_at      text,
  created_at      text not null,
  updated_at      text not null
);
create index program_workouts_week_idx on program_workouts (program_week_id);

create table program_exercises (
  id                 text primary key not null,
  program_workout_id text not null,
  exercise_id        text,
  position           integer not null,
  target_sets        integer not null,
  target_reps        integer,
  target_weight_kg   real,
  target_rpe         real,
  deleted_at         text,
  created_at         text not null,
  updated_at         text not null
);
create index program_exercises_workout_idx on program_exercises (program_workout_id);
`;

/**
 * Version 13 (B35): running a program. Mirrors the server's `…_program_runs.sql`:
 *   - `program_runs` — each time the lifter started running one of their programs: which
 *     program, the next session's week and workout POSITIONS, and when the run started and
 *     ended (null while active). Never deleted — a run ends. Synced both ways like the program
 *     tables; all reads and writes go through `programs/programRuns.ts`.
 *   - `workouts.program_workout_id` — the program workout a session was started from (null for an
 *     ordinary workout). Finishing such a workout moves the run on (see `programRuns.ts`).
 * Both are bare columns with no local foreign keys, for the same reason as V12: a downloaded run
 * or workout can name a program row this phone hasn't downloaded yet.
 */
const V13 = `
create table program_runs (
  id                    text primary key not null,
  user_id               text not null,
  program_id            text not null,
  next_week_position    integer not null,
  next_workout_position integer not null,
  started_at            text not null,
  ended_at              text,
  created_at            text not null,
  updated_at            text not null
);
create index program_runs_user_idx on program_runs (user_id);

alter table workouts add column program_workout_id text;
`;

/**
 * Version 14 (B39): program visibility. Mirrors the server's `…_program_visibility.sql`:
 *   - `programs.visibility` — who besides the author may see the program: 'private' (only them),
 *     'followers', 'team' (the Teams they shared it with) or 'published' (anyone). Every program
 *     already on the phone becomes private, matching the server's default. The lifter changes it
 *     offline like any other program edit and it syncs. Which Teams a program is shared with is
 *     NOT stored on the phone — that list lives online only (`social/programShares.ts`).
 */
const V14 = `
alter table programs add column visibility text not null default 'private';
`;

/**
 * Version 15 (B42): the analysis trend. Mirrors the server's `…_analysis_trend.sql` — six
 * nullable number columns on `workout_analyses`: the trend's window size and averages (null
 * below the threshold) and this session's own average RPE and load per rep. Existing rows (all
 * made by engine version 1) get nulls; the analysis request pass re-requests them because their
 * `engine_version` is older, and the screen shows the phone's own version-2 computation meanwhile.
 * Still download-only — no outbox lines, ever.
 */
const V15 = `
alter table workout_analyses add column trend_sessions integer;
alter table workout_analyses add column trend_volume_avg_kg real;
alter table workout_analyses add column trend_rpe_avg real;
alter table workout_analyses add column trend_load_per_rep_avg_kg real;
alter table workout_analyses add column session_rpe_avg real;
alter table workout_analyses add column session_load_per_rep_kg real;
`;

/**
 * Version 16 (B47): the lifter's four push-notification switches on `user_settings`, mirroring
 * the server's `…_push_notifications.sql` — whether a push is sent when someone follows them,
 * comments on their post, upvotes their post, or posts to one of their Teams. 1 = on, 0 = off
 * (SQLite has no true/false). Every existing row gets 1 for all four, the server's default: a
 * switch exists to stop a notification, and nobody has turned one off yet. Saved offline and
 * synced like the unit; the server reads its own copy when it decides whether to send.
 */
const V16 = `
alter table user_settings add column notify_follows integer not null default 1;
alter table user_settings add column notify_comments integer not null default 1;
alter table user_settings add column notify_votes integer not null default 1;
alter table user_settings add column notify_team_pushes integer not null default 1;
`;

/** Every schema version, oldest first. Append only. */
export const MIGRATIONS: readonly string[] = [V1, V2, V3, V4, V5, V6, V7, V8, V9, V10, V11, V12, V13, V14, V15, V16];

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
