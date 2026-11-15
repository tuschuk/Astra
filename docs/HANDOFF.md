# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05, B06, B07 merged; pipeline on B08)

**Three pipeline steps are merged to `main`; the pipeline is running B08 active-workout-store.**
Gates are delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is
at the end.

**B07 local-store-and-sync (merged, Gate 2 record):** expo-sqlite device store
(`frontend/src/db/`: serialized driver, `PRAGMA user_version` schema runner, DAO with the
touch-the-root invariant), outbox push/pull sync engine (`frontend/src/sync/`) mounted via
`useSync` in the root layout, library seeded on first launch under the server's uuidv5 ids,
`uuidv5` moved into `frontend/src/library/uuidv5.ts` (regenerated seed byte-identical to the
committed migration), session store moved to `expo-sqlite/kv-store` (AsyncStorage removed). No
server migration. Eight build deviations recorded in the plan file; the two that matter: push omits
`updated_at` (server stamps it, so offline rows are never behind another device's cursor) and
roots are re-touched after children land. Gate 2 reran Jest 34 suites / 266 tests on a cold cache,
lint clean, tsc clean after regenerating the stale `.expo/types/router.d.ts` (the builder prompt
now tells builders how). Statuses: B07 Built; FND-3 Built; NFR-1, NFR-3 In progress.

**B06 training-math (merged):** the one math module at
`backend/supabase/functions/_shared/training-math/`, imported as `@training-math`; TK-1..4, LOG-4,
LOG-6 In progress (math proven, screens pending). **B05 auth-and-signup (merged):** migration
applied and probed live; B05 / FND-2 / NFR-8 Built, device run pending.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Session
helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`,
`trigger`). Executions: 4/5 (B05), 6 (B06), 7 (B07); B08 is next. Costs so far (as reported by
`claude -p`): B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2.

**B08 active-workout-store** — the in-progress workout domain store on top of B07's `writeLocal`:
resume-on-launch, simulated force-kill test (NFR-3), v4 id minting via `expo-crypto`, repeat-set.
Rules for it recorded by B07: write only through the DAO (never raw SQL) so touch-the-root holds;
every UI query filters by the signed-in `user_id`; validate before `writeLocal` through the shared
training-math `validate` module so a server-refused row never wedges the outbox.

**Tristen's hands-on list:** (1) device runs — sign up under 18 → refused, sign up 18+, kill app,
reopen still signed in, sign out, sign in — flips B05 / FND-2 / NFR-8 and FND-1 / FND-4 to Done;
once B09 ships a logger screen, the airplane-mode workout check flips FND-3; (2) Supabase
Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of record; the
session's toggle was declined by the permission layer); (3) the six external blockers; (4) whether
to grant `mmdc` to headless runs.

Next pipeline step after B08 merges: **B09 logger-screen**.
