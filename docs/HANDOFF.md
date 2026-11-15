# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05–B13 merged; pipeline on B14)

**Nine pipeline steps are merged to `main`.** The P0 logging path is on screen (sign up / sign in →
Workout tab → full-screen logger → finish → saved workout with PR badges → exercise history) over
the kill-safe device store and the outbox sync engine; the logger handles warm-ups, bodyweight,
RPE, supersets, drop sets, timed / scored work, title and notes at every level, and shows last
time + current PRs per exercise. The pipeline is running **B14 edit-delete-workouts**. Gates are
delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B13 exercise-history-and-prs (merged, Gate 2 record):** migration
`20261115035806_personal_records.sql` (applied live, file named to the recorded version): enum
`pr_kind` (`true1rm`, `repMax`, `e1rm` — exactly `PrKind`), table `personal_records` (one
current-best row per user × exercise × kind [× reps], deterministic uuidv5 id, `value_kg
numeric(8,3)`, `source_set_id` cascade), owner-only RLS with `private.owns_set` on writes, silent
keep-best trigger, unique book index. Confirmed live at Gate 2 (policies, triggers, indexes,
enum). Device schema V4 mirror; `SYNC_ORDER` gains the table after `sets`; third pull cursor.
`@training-math/prs.ts` gains the source-tracking `recordBooks` fold (`recordsFromSets` rebuilt
over it), `beatsRecord`, `compareRecordBooks`. `frontend/src/workout/prs.ts`: `finish()`
recomputes each finished exercise's books from full finished history + the snapshot, writes only
improvements, in the same transaction as the tree. UI: PR line + History link on the entry card,
`app/exercise-history/[exerciseId].tsx`, `PR · 5RM` badges on the saved workout. Eight build
deviations recorded (extra indexes, two math helpers, ties left to B14). Gate 2 reran in order:
regenerate typed routes (150 s was needed; 100 s once wasn't) → `tsc` clean → lint clean → Jest
50 suites / 547 tests on a cold cache. Statuses: B13 Built; LOG-4, LOG-5 Built.

**Earlier today:** B12 workout-notes (LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12;
LOG-13 In progress until the feed), B10 set-types (LOG-14, LOG-15), B09 logger-screen (LOG-2,
NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06 training-math,
B05 auth-and-signup. Details in each plan file.

**B14 edit-delete-workouts** (planning now): edit any past workout's exercises and sets; delete a
workout; PRs and history recomputed from the remaining data, locally and on the server. Standing
inputs for its planner (from B07/B08/B12/B13): the outbox has no delete op yet — B14 adds an `op`
column / tombstone handling; **B14 must rework the keep-best trigger** (`private.keep_best_personal_record`)
which otherwise silently refuses legitimate demotions, add a forced-recompute mode to
`improvedRecords`, and decide ties; a finished workout's edit surface must reuse the store's
setters and `limits.ts`; `source_set_id` cascades, so deleting the set holding a PR removes the
row and the recompute promotes the next best (the step DoD).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order for gates and builders: `expo start --offline` 100–150 s → `tsc` → lint → Jest. Session
helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`,
`trigger`). Executions 4/5 (B05) through 13 (B13); B14 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5 (≈ $115 for nine steps).

**Tristen's hands-on list:** (1) **device run** (`cd frontend && npx expo start`): sign up under
18 → refused; sign up 18+; kill and reopen still signed in; start a workout, add exercises (one
bodyweight), log sets incl. a warm-up, an RPE, a superset link, a drop set, a timed entry and
notes, one-tap Repeat, force-kill mid-workout and relaunch → Resume shows everything; finish in
airplane mode → PR badges on the saved workout; open History from an entry card; reconnect, see
the workout and its `personal_records` rows once in Supabase; sign out / sign in. Flips B05–B13
and their features to Done as each holds. (2) Supabase Dashboard → Authentication → Providers →
Email → turn "Confirm email" off (plan of record; the session's toggle was declined by the
permission layer). (3) The six external blockers. (4) Whether to grant `mmdc` to headless runs.
(5) Two product readings to confirm or overrule: no bodyweight rep-record PR book (B10/B13); the
"e1RM" label on screen counts as "worded as an estimate" without an on-screen Epley citation
(B13 — B16's calculator copy will need the citation regardless).

Next pipeline step after B14 merges: **B15 settings-and-units**.
