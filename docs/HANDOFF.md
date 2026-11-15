# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05–B10 merged; pipeline on B11)

**Six pipeline steps are merged to `main`.** The P0 logging path is on screen (sign up / sign in →
Workout tab → full-screen logger → finish → saved workout) over the kill-safe device store and the
outbox sync engine, and the logger now handles warm-ups, bodyweight exercises and RPE. The pipeline
is running **B11 supersets-dropsets-timed**. Gates are delegated to the session (CLAUDE.md,
"Autonomous sessions"). Tristen's hands-on list is at the end.

**B10 set-types (merged, Gate 2 record):** `volume.ts` in `@training-math` (`setVolumeKg`,
`sessionVolumeKg`; warm-ups, weightless and partial-rep sets count 0, same countable-set rule as
`classifyPrs`); entry card gains an RPE box, a sticky Warm-up chip, a per-set W toggle (via
`updateSet` + the pure `setInputFromRow` helper) and an "added weight" box for Bodyweight
equipment; `formatSet` prints `W · 8 × 135 lb` / `5 × 225 lb @ RPE 8`; the "last time" line
drops warm-ups. No migration. Settled product reading, recorded for Tristen: **no separate
rep-record PR book for bodyweight movements** (the PRD's PR list is weight-based) — B13 builds
`personal_records` against the three existing kinds; overrule before B13 if that is wrong. Gate 2
reran in order: regenerate typed routes → `tsc` clean → lint clean → Jest 47 suites / 408 tests on
a cold cache. Statuses: B10 Built; LOG-14, LOG-15 Built; LOG-10 In progress (analysis use is B42).

**Earlier today:** B09 logger-screen (LOG-2, NFR-2 Built), B08 active-workout-store (NFR-3
Built), B07 local-store-and-sync (FND-3 Built), B06 training-math, B05 auth-and-signup
(migration applied and probed live). Details in each plan file.

**B11 supersets-dropsets-timed** (planning now): group exercises into a superset
(`superset_group`), record each drop of a drop set (`drop_set_position`), timed / WOD-style entries
(`duration_seconds`, plus a score column by migration if needed). Notes for its planner: the
columns already ride through store, limits and sync; `limits.ts` validates `drop_set_position ≥ 1`
and `duration_seconds ≥ 0`; if a migration is needed, the builder applies it live via the Supabase
MCP (allowlisted) and updates `limits.ts` in the same commit.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order for gates and builders: `expo start --offline` ~100 s → `tsc` → lint → Jest (Jest rewrites
the generated typed-routes file). Session helper: `automation/state/pipe.mjs` (gitignored;
`latest`, `approve <id>`, `retry <id>`, `trigger`). Executions: 4/5 (B05), 6 (B06), 7 (B07),
8 (B08), 9 (B09), 10 (B10); B11 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2,
B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7.

**Tristen's hands-on list:** (1) **device run** (`cd frontend && npx expo start`): sign up under
18 → refused; sign up 18+; kill and reopen still signed in; start a workout, add two exercises
(one bodyweight), log sets incl. a warm-up and an RPE, one-tap Repeat, force-kill mid-workout and
relaunch → Resume shows everything; finish in airplane mode, reconnect, see the workout once in
Supabase; sign out / sign in. Flips B05–B10 and FND-1..4, NFR-1..3, NFR-8, LOG-2, LOG-14, LOG-15
to Done as each holds. (2) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm
email" off (plan of record; the session's toggle was declined by the permission layer). (3) The
six external blockers. (4) Whether to grant `mmdc` to headless runs. (5) The bodyweight
rep-record decision above, before B13.

Next pipeline step after B11 merges: **B12 workout-notes**.
