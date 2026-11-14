# supabase-schema — FND-2 (part 1): Supabase MCP hookup + core database schema

**Branch:** `supabase-schema` (based on `ui-foundation` — `main` predates the monorepo split)
**Build item:** FND-2 "Supabase project: Postgres schema, auth, storage, RLS baseline"
**Scope note:** FND-2's definition of done also includes account creation + sign-in in the app.
That is frontend auth work and is deliberately **not** in this branch (see Out of scope). FND-2
moves to *In progress*, not *Built*.

## Context

Tristen created the Supabase project (`qczhvuzdxpmfztxrifyg.supabase.co`) and attached it to this
repo. Nothing exists in `backend/` yet except the README mapping the intended structure. This
branch stands up: (1) the Supabase MCP server so future sessions can talk to the project directly,
(2) the local Supabase project structure (`supabase init`), and (3) the first migrations — identity
+ training-log core with RLS on every table.

## Constraints that shape this plan

- **Offline-first (NFR-1/NFR-3):** workout rows are created on-device first. All workout-tree
  tables use **client-generated UUID primary keys**, so sync is an idempotent upsert — no
  server-assigned IDs, no duplicate rows on retry. This is the schema-level half of FND-3.
- **RLS is the enforcement point** for everything sensitive (body data, private workouts). Every
  table gets RLS enabled in the same migration that creates it — no window where a table exists
  unprotected.
- **Weights stored in kg** (`numeric`), converted for display from `user_settings.unit`. One
  canonical unit in the database; the shared training-math module does conversion.
- **No speculation:** only tables the identity + logging features need now. Social (posts, votes,
  comments), Teams/Gyms (PostGIS), recovery logs, PR/derived tables, and Marketplace all land with
  their own features and their own plan files.

## 1. MCP hookup

Add to `.mcp.json` (project-scoped, committed — so **no secrets in it**):

```json
"supabase": {
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@supabase/mcp-server-supabase@latest",
           "--project-ref=qczhvuzdxpmfztxrifyg"],
  "env": { "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}" }
}
```

The token is a Supabase **personal access token** (dashboard → Account → Access Tokens), supplied
via the `SUPABASE_ACCESS_TOKEN` environment variable (set it user-level on Windows; `.env` is
already gitignored but `.mcp.json` env expansion reads the process environment, not `.env`).
MCP servers load at session start, so the server becomes usable **next session** — this session
cannot apply the migrations remotely; that's a documented handoff step.

## 2. Local Supabase structure

`npx supabase init` in `backend/` → `backend/supabase/config.toml` + folders, matching the README.
`functions/` stays empty this branch (no server function is needed by the schema).

## 3. Migrations

Two files in `backend/supabase/migrations/`, timestamped, heavily commented (Documentation rules
apply to SQL too):

### `..._identity.sql`
- `profiles` — 1:1 with `auth.users` (PK = `auth.users.id`, cascade delete). Public identity only:
  `username` (unique, case-insensitive via `citext`), `display_name`, `bio`, `avatar_url`,
  timestamps. Auto-created by a `security definer` trigger on `auth.users` insert.
- `user_body_data` — **separate table, not profile columns**, because sex/birthdate/bodyweight are
  sensitive (NFR-5): `sex`, `birthdate`, `bodyweight_kg`. RLS: owner-only read/write, no public
  policy at all. (Strength grades later read this server-side, never via client of another user.)
- `user_settings` — `unit` (`kg`/`lb`), `default_workout_visibility`. Owner-only. One row per
  user, created by the same trigger.
- `follows` — `(follower_id, followee_id)` PK, one-way (Strava model). RLS: insert/delete own
  follows; readable by either side.
- `blocks` — `(blocker_id, blocked_id)` PK. Owner-only read/write. Feed/visibility filtering
  consumes this later.
- 18+ gate (PRD) is an auth/onboarding concern, enforced at signup — `birthdate` lives in
  `user_body_data` for grades; the gate itself is frontend/auth-flow work, out of scope here.

### `..._training.sql`
- `exercises` — shared library + private custom: `name`, `primary_muscle`, `equipment`,
  `owner_id uuid null` (null = global library row). RLS: everyone authenticated reads global +
  their own; users insert/update/delete only their own. Library seeding is a later task (LIB
  items).
- `workouts` — client-UUID PK, `user_id`, `title`, `notes`, `started_at`, `ended_at`,
  `visibility` enum (`public` / `followers` / `private`), timestamps. RLS read: owner, or
  `public`, or `followers` + an accepted row in `follows` — and never when a block exists in
  either direction. Write: owner only, and `user_id` must equal `auth.uid()` on insert.
- `workout_exercises` — entries within a workout: client-UUID PK, `workout_id`, `exercise_id`,
  `position`, `notes`, `superset_group smallint null`. RLS delegates to the parent workout
  (`exists` subquery).
- `sets` — client-UUID PK, `workout_exercise_id`, `position`, `reps`, `weight_kg`, `rpe`
  (0.5 steps, check 1–10), `is_warmup`, `drop_set_position smallint null` (segments of a drop
  set), `duration_seconds int null` (timed/WOD-style work). RLS delegates up the tree.
- `updated_at` maintained by the `moddatetime` extension trigger on every mutable table.
- Helper: `private.workout_readable(workout_id)` function (or inline `exists` clauses — decided
  at implementation time by what keeps policies readable) so `workout_exercises`/`sets` policies
  don't triple-copy the visibility logic.

## Out of scope (this branch)

- Frontend auth screens / supabase-js wiring (FND-2 part 2 — next branch; also where the anon key
  enters `frontend/`).
- Applying migrations to the remote project (needs the access token → next session via MCP, or
  Tristen runs `npx supabase link && npx supabase db push` from `backend/`).
- Storage buckets (avatars land with profile editing; progress pics with YOU items).
- PRs/derived tables, posts/feed, Teams/Gyms/PostGIS, recovery logs, Marketplace, DMs.
- Exercise library seed data.

## Testing

No Jest surface: this branch is SQL DDL + config. Real verification = applying migrations to the
project and probing RLS, which needs the token. Documented as the first follow-up. (When server
functions land, their tests use fakes per CLAUDE.md.)

## Verification (done Nov 14, 2026 — deviation from "next session")

Tristen pasted the access token mid-session, so verification happened immediately via the
Management API instead of waiting for the MCP: both migrations applied, then a 30-assertion live
RLS probe with two throwaway users (signup trigger, body-data privacy, profile/settings ownership,
custom-exercise privacy, private → followers → public workout visibility incl. sets, write
ownership, blocking semantics incl. auto-unfollow and re-follow refusal, anonymous access,
account-deletion cascade). **30/30 passed**; probe users deleted afterwards, project left clean.

The probe caught one real bug, fixed as migration `20261114110000_fix_exercise_delete.sql`:
`workout_exercises.exercise_id` had no ON DELETE action, so deleting an account whose custom
exercise appeared in a workout failed on the FK (breaks NFR-6 account deletion). Now nullable +
`on delete set null` — history survives, the entry just loses its exercise link (name snapshot
idea noted in DEFERRED).

## Grilling notes (self-grill — `mattpocock-skills:grilling` is not installed in this session; flagged to Tristen)

- **"Why not the whole data-model sketch now?"** — Because empty social/geo tables would sit
  unverified and constrain features that haven't been planned. No-speculation rule wins; each
  domain migrates with its feature.
- **"Trigger on `auth.users` is magic"** — considered doing profile creation client-side; rejected:
  a client crash after signup leaves an account with no profile row. DB trigger is atomic with
  signup.
- **"Why `citext` for username instead of `lower()` index?"** — citext keeps uniqueness *and*
  lookups case-insensitive with zero app code; it's a stock Postgres extension Supabase ships.
- **"Client-generated PKs let a client collide UUIDs"** — collision probability is negligible and
  the PK constraint turns a collision into a rejected insert, not corruption. RLS prevents
  *malicious* collision against other users' rows (insert policy requires ownership).
- **"Should bodyweight be a log, not a column?"** — Yes eventually (trends need history), but the
  logging feature that would write that history doesn't exist. Single current value now; a
  `bodyweight_log` can supersede it when REC/YOU items land. Noted in DEFERRED.
- **"`rpe` check 1–10 excludes RPE 0 / RIR?"** — PRD says RPE optional; null covers "not rated".
  Range matches the standard Borg CR10 lifting scale.
