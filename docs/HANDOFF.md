# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05–B11 merged; pipeline on B12)

**Seven pipeline steps are merged to `main`.** The P0 logging path is on screen (sign up / sign in →
Workout tab → full-screen logger → finish → saved workout) over the kill-safe device store and the
outbox sync engine; the logger handles warm-ups, bodyweight, RPE, supersets, drop sets and timed /
scored work. The pipeline is running **B12 workout-notes**. Gates are delegated to the session
(CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B11 supersets-dropsets-timed (merged, Gate 2 record):** one migration, `sets.score text`
(CHECK length ≤ 100), applied live by the builder via the Supabase MCP and confirmed at Gate 2;
device schema V2 + `TABLE_COLUMNS` + `limits.ts` carry it. Supersets: `linkWithPrevious` /
`unlinkFromPrevious` in the store own all group-number bookkeeping (merge / split at the card
boundary, orphan cleanup, rewrite-to-what-is-shown first); display merges adjacent same-group
runs into one Superset card. Drop sets: Drop button = `logSet` with the next `drop_set_position`;
grouped by strictly ascending position into one "Set n" / one chained saved row; removing the top
row removes the whole drop set (`removeSets`, atomic). Timed: a disclosure revealing Time
("4:32" → seconds) and Score boxes; `formatSet` prints `100 reps · 7:32`, `W · …`, `@ RPE n`,
score. The review caught two real bugs (orphaned drops mis-merging; superset link pulling a
moved-away exercise back in), both fixed with regression tests. Gate 2 reran in order: regenerate
typed routes → `tsc` clean → lint clean → Jest 47 suites / 459 tests on a cold cache; confirmed
`sets.score` live. **Gate 2 also renamed two migration files** to the versions Supabase recorded
(`20261114224613_signup_birthdate_gate.sql`, `20261115024010_sets_score.sql`) — the MCP assigns its
own version, and a mismatch would break `supabase db push`; the builder prompt now tells builders
to rename after `list_migrations`. Statuses: B11 Built; LOG-11, LOG-12 Built; LOG-13 In progress
(the feed half waits for B20).

**Earlier today:** B10 set-types (LOG-14, LOG-15 Built), B09 logger-screen (LOG-2, NFR-2 Built),
B08 active-workout-store (NFR-3 Built), B07 local-store-and-sync (FND-3 Built), B06 training-math,
B05 auth-and-signup. Details in each plan file.

**B12 workout-notes (built on branch `workout-notes`, awaiting Gate 2):** `sets.notes` (CHECK
≤ 500) applied live by the builder and the file named for the recorded version
(`20261115031049_sets_notes.sql`); device schema V3; four text caps in `limits.ts`; store
`setTitle` / `setNotes` / `setEntryNotes` / `setSetNotes`; Title + Notes boxes in the logger
header, exercise and per-set note boxes on each card, all autosaving through
`workout/useAutosaveText.ts`; Finish flushes every box and stops if one is refused; the saved
workout shows all three levels. Deviations (race-free `setSetNotes`, the autosave registry, the
refused-save handling) are recorded in the plan. Builder ran expo start → tsc → lint → Jest
(48 suites / 506 tests) green.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order for gates and builders: `expo start --offline` ~100 s → `tsc` → lint → Jest. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions: 4/5 (B05), 6 (B06), 7 (B07), 8 (B08), 9 (B09), 10 (B10), 11 (B11); B12 is next.
Reported costs: B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7,
B11 ≈ $14.9.

**Tristen's hands-on list:** (1) **device run** (`cd frontend && npx expo start`): sign up under
18 → refused; sign up 18+; kill and reopen still signed in; start a workout, add exercises (one
bodyweight), log sets incl. a warm-up, an RPE, a superset link, a drop set and a timed entry,
one-tap Repeat, force-kill mid-workout and relaunch → Resume shows everything; finish in airplane
mode, reconnect, see the workout once in Supabase; sign out / sign in. Flips B05–B11 and their
features to Done as each holds; the entry card's four header icons and two action rows need a
phone-width look. (2) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm
email" off (plan of record; the session's toggle was declined by the permission layer). (3) The
six external blockers. (4) Whether to grant `mmdc` to headless runs. (5) B10's reading — no
separate rep-record PR book for bodyweight movements — before B13 builds `personal_records`.

Next pipeline step after B12 merges: **B13 exercise-history-and-prs**.
