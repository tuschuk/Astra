/**
 * Generates the launch-library seed migration from the app's one-home catalog.
 *
 * Why this exists: CLAUDE.md's one-home rule. The 151 launch exercises live in
 * `frontend/src/library/` and nowhere else — a hand-written INSERT list would
 * be a mirrored copy, which is a bug. This script derives the SQL from the
 * catalog, so the database can never silently disagree with the app.
 *
 * What it emits: an idempotent upsert of every catalog exercise into
 * `public.exercises` — id (deterministic UUIDv5 of the slug, see
 * LIBRARY_EXERCISE_NAMESPACE in catalog.ts), slug, name, primary_muscle,
 * equipment, owner_id null. It UPSERTS ONLY: rows whose slug left the catalog
 * are never deleted or re-identified by a seed — removing or renaming a
 * library exercise is a deliberate content migration, because workout history
 * and PRs will reference these ids (see the plan file's grilling record).
 *
 * Usage (from the repo root):
 *   npx -y tsx@4 automation/scripts/generate-library-seed.ts backend/supabase/migrations/<timestamp>_library_seed.sql
 *
 * Self-checks before any file is written (the script refuses to emit a bad seed):
 *   - the shared UUIDv5 implementation (frontend/src/library/uuidv5.ts)
 *     reproduces the RFC 4122 test vector;
 *   - the row count equals the catalog's and is non-zero;
 *   - slugs are unique and well-formed;
 *   - no emitted name is an alias spelling ("Squats" must never become a row,
 *     or PR history forks across rows later).
 */
import { writeFileSync } from 'node:fs';
import { ALL_EXERCISES, slugify } from '../../frontend/src/library/catalog';
import { EXERCISE_NAME_ALIASES } from '../../frontend/src/library/exercises';
// The repo's one UUIDv5 implementation lives with the app, which computes the
// same ids on-device; this generator imports it and never keeps its own copy.
import { libraryExerciseId, uuidv5 } from '../../frontend/src/library/uuidv5';

// Self-check 1: the implementation must reproduce the RFC 4122 known answer.
const vector = uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com');
if (vector !== '2ed6657d-e927-568b-95e1-2665a8aea6a2') {
  throw new Error(`UUIDv5 self-check failed: got ${vector}`);
}

/** Escape a text value for a single-quoted SQL literal. */
const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;

// Self-check: the escaper must double embedded quotes (the one way SQL text breaks).
if (sq("O'Brien's") !== "'O''Brien''s'") throw new Error('SQL escaper self-check failed');

const rows = ALL_EXERCISES.map((e) => {
  const slug = slugify(e.name);
  if (slug !== e.id) throw new Error(`Catalog id for "${e.name}" is not its slug: ${e.id}`);
  // Keep in step with the CHECK constraint in 20261114120000_exercises_slug.sql.
  if (!/^[a-z0-9_]{1,80}$/.test(slug)) throw new Error(`Malformed slug: ${slug}`);
  return { id: libraryExerciseId(slug), slug, name: e.name, primary: e.primary, equipment: e.equipment };
});

// Self-check 2: nothing dropped, nothing doubled.
if (rows.length === 0 || rows.length !== ALL_EXERCISES.length) {
  throw new Error(`Row count ${rows.length} does not match catalog ${ALL_EXERCISES.length}`);
}
if (new Set(rows.map((r) => r.slug)).size !== rows.length) throw new Error('Duplicate slugs');
if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error('Duplicate ids');

// Self-check 3: alias spellings are lookups, never rows.
const aliasKeys = new Set(Object.keys(EXERCISE_NAME_ALIASES));
for (const r of rows) {
  if (aliasKeys.has(r.name.toLowerCase())) {
    throw new Error(`"${r.name}" is an alias spelling and must not become a row`);
  }
}

const values = rows
  .map((r) => `  (${sq(r.id)}, ${sq(r.slug)}, ${sq(r.name)}, ${sq(r.primary)}, ${sq(r.equipment)})`)
  .join(',\n');

const sqlOut = `-- ============================================================================
-- Launch library seed — GENERATED FILE, DO NOT EDIT BY HAND
-- ============================================================================
-- Generated from frontend/src/library/catalog.ts (the library's one home) by
--   npx -y tsx@4 automation/scripts/generate-library-seed.ts <this file>
-- ${rows.length} shared exercises (owner_id null). Each id is
-- uuidv5(LIBRARY_EXERCISE_NAMESPACE, slug), so the app derives the same id
-- offline. Idempotent: re-running updates names/muscles/equipment in place.
-- Seeds UPSERT ONLY — removing or renaming a library exercise is a deliberate
-- content migration (history references these ids), never a seed side effect.
insert into public.exercises (id, slug, name, primary_muscle, equipment)
values
${values}
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  primary_muscle = excluded.primary_muscle,
  equipment = excluded.equipment;
`;

const out = process.argv[2];
if (!out) throw new Error('Usage: generate-library-seed.ts <output.sql>');
writeFileSync(out, sqlOut);
console.log(`Wrote ${rows.length} library exercises to ${out}`);
