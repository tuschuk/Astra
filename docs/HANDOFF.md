# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05–B12 merged; pipeline on B13)

**Eight pipeline steps are merged to `main`.** The P0 logging path is on screen (sign up / sign in →
Workout tab → full-screen logger → finish → saved workout) over the kill-safe device store and the
outbox sync engine; the logger handles warm-ups, bodyweight, RPE, supersets, drop sets, timed /
scored work, and now a title plus notes at every level. The pipeline is running **B13
exercise-history-and-prs**. Gates are delegated to the session (CLAUDE.md, "Autonomous
sessions"). Tristen's hands-on list is at the end.

**B12 workout-notes (merged, Gate 2 record):** one migration, `sets.notes text` (CHECK ≤ 500),
applied live by the builder, file named to the recorded version (`20261115031049_sets_notes.sql`)
and confirmed at Gate 2; device schema V3. Four text caps now in `@training-math/limits.ts` (title
100, workout notes 2000, entry notes 1000, set notes 500; code-point counting like the server).
Store: `setTitle`, `setNotes`, `setEntryNotes`, `setSetNotes` (reads the set inside the mutation
queue so a note save can never revert a concurrent W flip), `SetInput.notes`; Repeat does not copy
notes. UI: `useAutosaveText` (debounce ~750 ms, unmount flushes, drops a pending save once the
store is no longer active) plus an `AutosaveRegistry` so Finish flushes every open box and stops
with a message if any save was refused; title + notes boxes in the logger header, "Add note" per
exercise, note icon per set; saved workout shows all three levels. Eight build deviations recorded
in the plan file; the review made a refused save visible instead of silent. Gate 2 reran in order:
regenerate typed routes → `tsc` clean → lint clean → Jest 48 suites / 506 tests on a cold cache.
Statuses: B12 Built; LOG-3 Built.

**Earlier today:** B11 supersets-dropsets-timed (LOG-11, LOG-12 Built; LOG-13 In progress until
the feed), B10 set-types (LOG-14, LOG-15 Built), B09 logger-screen (LOG-2, NFR-2 Built), B08
active-workout-store (NFR-3 Built), B07 local-store-and-sync (FND-3 Built), B06 training-math,
B05 auth-and-signup. Details in each plan file.

**B13 exercise-history-and-prs (built on its branch, awaiting Gate 2):**

- **Server:** `personal_records` holds one row per record book (user × exercise × kind [× reps]):
  the current best plus its source set. It has owner-only RLS, `private.owns_set` on writes, a
  unique book index, and a silent **keep-best trigger** that never lets an upload lower a record.
  The migration is applied live, and the file is named to the recorded version
  (`20261115035806_personal_records.sql`). The builder's live probe is recorded in the plan file.
  Device schema V4.
- **Finish:** `finish()` runs `improvedRecords` (`workout/prs.ts`). It folds the full finished
  history plus today's sets through the new `@training-math` `recordBooks` and writes only
  improved books, in the same transaction as the workout. Ids are deterministic uuidv5 per book.
- **Sync:** pull has a third bookmark for the records.
- **UI:** the entry card shows the "last time" panel (last sets + "PRs: …" line + History link),
  there is a new `exercise-history/[exerciseId]` screen, and the saved workout has
  "PR · 5RM"-style badges.
- **B14 must rework the keep-best trigger.**

Eight build deviations are recorded in the plan file. B10's "no bodyweight rep-record book"
reading was kept; Tristen can still overrule it before merge.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order for gates and builders: `expo start --offline` ~100 s → `tsc` → lint → Jest. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions: 4/5 (B05), 6 (B06), 7 (B07), 8 (B08), 9 (B09), 10 (B10), 11 (B11), 12 (B12); B13 is
next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7,
B11 ≈ $14.9, B12 ≈ $13.2.

**Tristen's hands-on list:** (1) **device run** (`cd frontend && npx expo start`): sign up under
18 → refused; sign up 18+; kill and reopen still signed in; start a workout, add exercises (one
bodyweight), log sets incl. a warm-up, an RPE, a superset link, a drop set, a timed entry and notes
at all three levels, one-tap Repeat, force-kill mid-workout (and mid-note) and relaunch → Resume
shows everything; finish in airplane mode, reconnect, see the workout once in Supabase; sign out /
sign in. Flips B05–B12 and their features to Done as each holds; the entry card's header icons,
two action rows and five-control set rows need a phone-width look. (2) Supabase Dashboard →
Authentication → Providers → Email → turn "Confirm email" off (plan of record; the session's
toggle was declined by the permission layer). (3) The six external blockers. (4) Whether to grant
`mmdc` to headless runs. (5) B10's reading — no bodyweight rep-record PR book — before B13 merges.

Next pipeline step after B13 merges: **B14 edit-delete-workouts**.
