# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — library DB seed session)

**The database is fully stood up for launch-scale identity + logging, the launch library lives
in it, and everything is MERGED:** at Tristen's direction, the whole stack (`ui-foundation` →
`supabase-schema` → `launch-library-seed` → `library-db-seed`) went into `main` as four `--no-ff`
merges, verified tree-identical to the stack tip, and `main` is pushed. The feature branches
still exist locally and on origin; delete them whenever. Everything below shipped on `main`.

**New on `library-db-seed`** (plan: `docs/feature_plans/library-db-seed.md`, grilled with
`mattpocock-skills:grilling` — autonomous mode: the LIB-7 handoff's delegated decisions stood in
for live answers — and two-axis reviewed with `mattpocock-skills:code-review`, findings fixed):

- `exercises.slug` migration: slug mandatory on library rows, forbidden on customs, partial
  unique index (`slug where owner_id is null`) = idempotent seeding + library-partition
  uniqueness. ERD updated in the same commit.
- **Identity contract:** a library row's `id` = `uuidv5(LIBRARY_EXERCISE_NAMESPACE, slug)`; the
  namespace constant lives in `frontend/src/library/catalog.ts`. The phone can derive ids
  offline with no sync round-trip. The uuidv5 implementation currently lives in the generator —
  moving it into `frontend/src/library/` when the logger needs it is in DEFERRED (move, not copy).
- **Generated seed:** `automation/scripts/generate-library-seed.ts` (run: `npx -y tsx@4 …`)
  emits `20261114120100_library_seed.sql` from the catalog — one home, never hand-copied;
  self-checks (RFC 4122 vector, count == catalog, slug uniqueness, no alias spellings, SQL
  escaper) refuse to write a bad seed. Upsert-only: seeds never delete or re-identify rows;
  renames are deliberate content migrations (see plan grilling record).
- **Applied and verified live** (Management API): 7/7 — 151 rows, idempotent re-run stays 151,
  `bench_press` id matches the derivation, DB slugs == generated file, simulated `authenticated`
  reads all 151 through RLS / `anon` reads zero, duplicate library slug rejected. Frontend:
  `tsc` clean, 47/47 Jest, lint clean (only change: the namespace constant export).
- Decisions closed: `equipment` stays free-text until LIB-5; no custom-name-collision constraint
  (RLS isolates customs; UX is LIB-5's call).

**Supabase MCP:** timed out on this session's startup — cause was `@latest` resolution/download
inside the 30s connect window. Fixed (separate commit): pinned to `0.17.0` + npx cache warmed.
Token is in `.env` and valid (used for all live work above). **Expect working MCP tools next
restart;** if it still times out, run
`npx -y @supabase/mcp-server-supabase@0.17.0 --project-ref=qczhvuzdxpmfztxrifyg` once by hand and
read its error.

**For Tristen:** (1) run the app on a device (`cd frontend && npx expo start`) — flips FND-1 and
FND-4 to Done; (2) still open: copy `automation/claude-settings.example.json` →
`.claude/settings.json`.

Next build items: FND-2 part 2 (auth screens + supabase-js), FND-3 (SQLite + sync — the device
mirror can now seed from the same catalog and reference the same deterministic ids), LOG-1/LOG-2.
