# library-db-seed — seed the `exercises` table from the app's library module (LIB-7 DB side)

**Branch:** `library-db-seed` (stacked on `launch-library-seed`, which holds the TS module)
**Build items:** completes the DB half of LIB-7; prerequisite for FND-3 sync and LOG-2.
**Spec:** the LIB-7 DB handoff Tristen pasted (Nov 14, 2026) + `docs/feature_plans/launch-library-seed.md`.

## What this does

Puts the 151 launch-library exercises into `public.exercises` on the live project, with a stable
identity the phone can compute offline, generated from the one-home TS module — never hand-copied.

## Decisions (per the handoff's open questions + option picks)

1. **Identity: deterministic UUIDv5, precomputed by the generator.** Each library row's `id` is
   `uuidv5(LIBRARY_EXERCISE_NAMESPACE, slug)` — app and DB can derive the same id for `bench_press`
   independently, no sync round-trip. The namespace constant lives in
   `frontend/src/library/catalog.ts` (the catalog is the one home of library identity; the logger
   will import it when it needs offline ids). The generator computes the v5 UUIDs in JS and emits
   them as literals — **no `uuid-ossp` extension in the database** (no-speculation: the DB never
   needs to derive ids at runtime, only store them).
2. **`slug` column on `exercises`,** nullable, with `check ((owner_id is null) = (slug is not
   null))` — library rows must have a slug, customs must not (customs are born with
   client-generated uuids; a slug would be a second identity for no consumer). Partial unique
   index on `slug where owner_id is null` makes the seed upsert idempotent and is the library
   partition's uniqueness.
3. **Seed is a generated migration.** `automation/scripts/generate-library-seed.ts` (run with
   `npx tsx`; automation is exempt from app-stack rules) imports `ALL_EXERCISES` + namespace +
   `slugify` from `frontend/src/library/catalog.ts` and writes the migration file: an
   `insert ... on conflict (id) do update` of (id, slug, name, primary_muscle, equipment,
   owner_id=null). Regeneration after a future library change = run the script at a new migration
   filename; the upsert re-seeds idempotently.
4. **Aliases are not rows.** The generator consumes the deduplicated catalog, which never contains
   alias spellings; it also asserts no emitted name matches an alias key, so a future bad import
   fails generation rather than forking PR history (LOG-4).
5. **`equipment` stays free-text** (no CHECK/enum yet). The TS `Equipment` union is the vocabulary
   of the *launch library*; LIB-5 hasn't decided what customs may enter ("Other"? bands?). A CHECK
   added now would be guessed scope; LIB-5 owns it. Recorded here so the question is closed for
   this branch.
6. **No name-collision constraint for customs now.** A user may name a custom "Bench Press" — RLS
   already keeps customs private, so no cross-user confusion; whether to warn or block is LIB-5
   onboarding UX, not schema. Library-partition uniqueness (decision 2) is the only constraint
   added.

## Files

- `backend/supabase/migrations/20261114xxxxxx_exercises_slug.sql` — hand-written: `slug` column,
  pairing check, partial unique index. ERD updated in the same commit.
- `automation/scripts/generate-library-seed.ts` — the generator (run via pinned `npx -y tsx@4`).
  Self-verifying: asserts the RFC 4122 v5 test vector, row count == catalog length (> 0), slug
  uniqueness, no alias spellings, before writing a file. Emits upserts only — it never deletes or
  re-identifies rows (see Grilling record on renames).
- `backend/supabase/migrations/20261114xxxxxx_library_seed.sql` — generated output, committed
  (migrations must be in-repo and immutable once applied); header marks it generated + the command
  to regenerate.

## Testing & verification

- **Generator self-checks** (RFC v5 vector, count, uniqueness, no aliases) run on every
  generation — the generator refuses to write a bad seed. No Jest harness exists in `automation/`
  and standing one up for one dev script is speculation; the frontend's existing catalog tests
  already cover the data the generator consumes. (Deviation from "Jest for every function" noted
  deliberately.)
- **Live verification** via the Management API (same path as the FND-2 session): apply both
  migrations; `count(*) where owner_id is null` = 151; re-run the seed upsert → still 151
  (idempotent); spot-check `bench_press` id equals the generator's uuid; RLS smoke check — as a
  simulated `authenticated` role, library rows are readable; `anon` sees none.
- Tests never touch the live project *as test fixtures* — the Management API apply is deployment +
  verification of real migrations, the same as FND-2's probe, not a Jest test.

## Verification results (Nov 14, 2026)

Applied live via the Management API (the MCP server timed out at session start; fixed by pinning
its version — committed separately from this branch's feature work, since it is unrelated
tooling). 7/7 checks passed: 151 library rows; re-running the full seed leaves exactly 151
(idempotent); `bench_press` carries the uuidv5 id the app will derive; DB slugs exactly match the
generated file; simulated `authenticated` role reads all 151 through RLS while `anon` reads zero;
a duplicate library slug is rejected by the partial unique index. Frontend untouched behaviorally:
`tsc` clean, 47/47 Jest, lint clean.

Review notes (two-axis review, both agents reported): the seed migration was regenerated by the
reviewer and matched the committed file byte-for-byte. Wording deviation accepted: the INSERT
omits `owner_id`, relying on the column's null default — behaviorally identical to the plan's
"owner_id=null"; left as-is because the migration is already applied and applied migrations are
immutable. The generator's `uuidv5` will need a frontend home when the logger computes ids
on-device — recorded in DEFERRED so it becomes a move, not a mirrored copy.

## Out of scope

Pattern/muscle-intensity/coaching content in the DB (decided app-side for launch, per the
handoff); custom-exercise UX rules (LIB-5); SQLite mirror + sync (FND-3); any frontend behavior
change (the app keeps reading the bundled catalog until FND-3).

## Grilling record

Run via `mattpocock-skills:grilling` in an autonomous session: the LIB-7 DB handoff had already
delegated the open decisions here, so each frontier question was answered from that spec or from
verified facts rather than a live interview; anything that would genuinely need Tristen is in the
session report. Questions that changed the plan:

- **"What happens when the founder renames an exercise?"** — Exposed a real hazard: the id is
  `uuidv5(ns, slugify(name))`, so a rename changes the slug and therefore the id — a re-seed would
  insert a NEW row and strand the old one (and any history pointing at it). Settled: renames are a
  deliberate content migration (rename-in-place keeping the old slug, or alias + row migration),
  never an accidental side effect of re-running the generator. To enforce that, **the seed never
  deletes or re-identifies**: absent slugs are left alone. The generator cannot see the database,
  so orphan detection (library slugs in the DB that the catalog no longer has) belongs to the
  post-re-seed live verification, not to generation. Recorded as a rule in the generated file's
  header.
- **"Hardcoded 151 breaks the promised regeneration path."** — Right: the self-check asserts the
  emitted row count equals `ALL_EXERCISES.length` and is > 0 (151 today), plus slug uniqueness and
  the alias assertion. The frontend's 47 existing catalog tests are what pin the catalog's actual
  content.
- **"Is exporting an unused namespace constant from `catalog.ts` speculative?"** — No: it is the
  identity contract itself, and the catalog is that contract's one home. The logger imports it
  when it needs offline ids; a constant is not infrastructure.
- **"Why commit generated SQL instead of generating at apply time?"** — Applied migrations are
  immutable history and must be reviewable in-repo; the generator is how the file is *written*,
  git is how it *ships*.
- **"Does `on conflict (id) do update` clobber `created_at` or fight the slug index?"** — No:
  the update list excludes `created_at` (and `updated_at` is trigger-maintained); id = f(slug)
  with slug uniqueness asserted at generation, so the partial index can't conflict with a
  different id.
- **"Equipment CHECK now?" / "custom name collisions?"** — both stay as the handoff leaned:
  free-text until LIB-5 settles the customs vocabulary; no collision constraint beyond the
  library partition (RLS already isolates customs per user). Closed for this branch.
