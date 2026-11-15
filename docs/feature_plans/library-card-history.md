# library-card-history (B30)

Covers **LIB-4** (user's PRs and full history on the card — "a card shows that user's complete
logged history and current PRs for the movement"). Depends on **B29** (the exercise detail
screen this lands on) and **B13** (the records table, the history read model, and the one set
of formatting helpers).

Step DoD: **the exercise detail screen shows the lifter's current PRs and full logged history
for that movement, and the numbers match B13's records.**

## What exists (read before planning)

- `frontend/src/app/exercise/[id].tsx` (B29) — the read-only detail screen, keyed by the
  **catalog slug**, signed-in only, no database access today. Its header comment already says
  "history and PRs arrive in B30".
- `frontend/src/app/exercise-history/[exerciseId].tsx` (B13) — the per-exercise history
  screen, keyed by the **server/device uuid**, reached from the logger's last-time panel and
  the edit screen. Loads `exerciseInfo` + `currentPrs` + `exerciseSessions` in one
  `Promise.all`, renders a "Current PRs" card (`formatPrLine`) and one card per session
  (`groupDropSets` + `formatDropSet`, title or `workoutDateLabel`).
- `frontend/src/workout/history.ts` — `exerciseSessions(db, userId, exerciseId, limit = 50)`
  (`EXERCISE_SESSION_LIMIT`), `exerciseInfo`. `frontend/src/workout/prs.ts` — `currentPrs`
  (the one read every PR surface uses). `frontend/src/workout/format.ts` — `formatPrLine`,
  `formatDropSet`, `groupDropSets`, `workoutDateLabel`. All already tested; all read the
  phone's SQLite only.
- `frontend/src/library/uuidv5.ts` — `libraryExerciseId(slug)`: the one mapping from catalog
  slug to the exercise uuid `seedLocal.ts` wrote into the device's `exercises` table (and the
  server's). This is how the slug-keyed detail screen reaches the uuid-keyed history data.
- Recorded B13 deferral: the history screen lists the newest 50 sessions, no paging.

No migration, no sync change, no new dependency, no network: everything reads the phone's
database, so offline-first holds by construction and the ERD is untouched.

## Scope check

The step scope ("exercise detail shows the user's current PRs and full logged history; the
numbers match B13's records") is right as written, with one tension to resolve honestly:
LIB-4 says **complete** history, and B13's `exerciseSessions` read is capped at the newest
50. Silently calling 50 "complete" would narrow the feature; this plan closes the gap with an
incremental reveal (below) rather than widening into real pagination machinery.

## Approach

One principle drives the design, straight from CLAUDE.md's one-home rule: **the detail screen
must render the same numbers through the same functions — and the same component — as B13's
history screen.** A second rendering of "Current PRs" + session list would drift.

### 1. Extract the shared section — `frontend/src/components/workout/ExerciseHistorySection.tsx`

A new component, extracted from the body of `exercise-history/[exerciseId].tsx` (a move, not
a rewrite): given an exercise **uuid**, it owns the whole read-and-render of that exercise's
records and history —

- loads `currentPrs` + `exerciseSessions` via `useAppDatabase` / `useAuth` / `useDisplayUnit`
  (the hooks the history screen already uses), keyed by exercise id so a reused screen never
  shows the previous exercise's rows;
- renders the "Current PRs" card (`formatPrLine`, "No PRs yet" when empty), then one card per
  session (title or `workoutDateLabel`, sets via `groupDropSets` + `formatDropSet` — drop
  sets, warm-up marks and units keep rendering exactly as B13 shipped them);
- keeps the existing loading / failed / "No finished sessions of this exercise yet" states;
- **"Show older sessions"**: when exactly `limit` sessions came back (so older ones may
  exist), a button re-runs the read with `limit + EXERCISE_SESSION_LIMIT`. `exerciseSessions`
  already takes `limit` — no query change, no cursor machinery. This is what makes LIB-4's
  "complete" true instead of silently meaning "newest 50". (Edge: a lifter with exactly 50
  sessions sees one tap that returns the same 50 and the button disappears — harmless.)

### 2. The history screen keeps its route; both screens render the section

- `app/exercise-history/[exerciseId].tsx` becomes a thin shell: Back, the title (via
  `exerciseInfo` — it must keep working for ids with no catalog entry), and the section. Its
  observable behaviour does not change except for gaining "Show older sessions"; its existing
  tests keep passing.
- **Settled (the handoff asked):** `exercise-history/[exerciseId]` stays the logger's deep
  link; it does **not** redirect to the detail route. Reasons: the detail route resolves
  catalog **slugs** only, while the logger links by **uuid** — a redirect needs a reverse
  uuid→slug lookup and still dead-ends on custom exercises (B31), which will have history but
  no catalog card. Two thin routes over one shared component is the arrangement that can't
  drift; collapsing routes is B31's call to revisit when customs get a detail surface.

### 3. The detail screen gains the section

`app/exercise/[id].tsx`: after the Tips card, a "Your history" block — the section, with
`exerciseId = libraryExerciseId(exercise.id)`. Placement: reference content (muscles, steps,
tips) stays first; the lifter's own numbers follow, because the session list is unbounded and
would push the coaching content below the fold. The PR card is the section's first card, so
"current PRs on the card" is one scroll at most; if the device check wants PRs above the
coaching content, that is a placement swap inside this screen, no logic change.

The screen keeps rendering its catalog content even when the database read fails (the
section shows its own failure line) — the B29 screen must never get worse at its B29 job.

### 4. Files

Create:
- `frontend/src/components/workout/ExerciseHistorySection.tsx` (+
  `ExerciseHistorySection.test.tsx` beside it, per the testing rules)

Change:
- `frontend/src/app/exercise-history/[exerciseId].tsx` — becomes shell + section
- `frontend/src/app/exercise/[id].tsx` — adds the section
- `frontend/src/__tests__/exercise-detail.test.tsx` — harness gains auth + database
  providers (today it renders bare with a stubbed router); new assertions below
- `frontend/src/__tests__/exercise-history.test.tsx` — unchanged assertions must stay green;
  add the show-more case
- `docs/diagrams/app-flow.md` (Document step) — the Library branch's detail screen gains the
  PR/history section, the show-more action and the slug→uuid data path; ERD untouched
- `docs/DEFERRED.md` (Document step) — amend the B13 line "History screen has no paging
  (newest 50)": show-more supersedes it; what remains deferred is tap-through to a session's
  workout and true cursor paging if a measured problem ever calls for it

No route changes: both routes already exist in `_layout.tsx`'s signed-in guard, so the
typed-routes staleness trap does not apply this step (no new route file). Jest can still
rewrite `.expo/types/router.d.ts`; the recorded check order (expo start --offline → tsc →
lint → Jest) stays the safe sequence for the builder and Gate 2.

### 5. Tests (Jest, node SQLite driver, fake transport fakes — never real Supabase)

- `ExerciseHistorySection.test.tsx`: seed a user's workouts **through the real
  active-workout store's `finish()`** (so `personal_records` rows are B13's actual output,
  not hand-written fixtures); assert the PR card text equals
  `formatPrLine(await currentPrs(db, user, exercise), unit)` and each session card shows
  `formatDropSet` output; empty states; a failure state (closed db) shows the failure line;
  show-more: seed `limit + 1` sessions with a small limit override, assert the button
  appears, tap, assert the older session appears and the button is gone.
- `exercise-detail.test.tsx`: existing catalog assertions unchanged; new — for a seeded
  bench history, the detail screen at slug `bench_press` shows the same PR line and set text
  as `exercise-history/[exerciseId]` rendered at `libraryExerciseId('bench_press')` over the
  same database (**the step DoD, asserted literally: the two screens' numbers match** — one
  test file, one seeded db, both route components; the expo-router mock serves both param
  shapes, `{id}` and `{exerciseId}`); an unlogged exercise shows "No PRs yet" / no-sessions
  copy; the 151-exercise loop keeps passing under the new harness. Builder note for the loop:
  settle each of the 151 mounts by awaiting the section's own empty-state text ("No PRs
  yet") against one empty seeded database — ad-hoc waits here become an act-warning flood.
- `exercise-history.test.tsx`: the pinned B13 behaviour stays green after the extraction.

### DoD, made observable

- **LIB-4** — the detail card shows current PRs (`formatPrLine` over `currentPrs`) and the
  logged history, with every session reachable via "Show older sessions" (complete, not
  newest-50); pinned by the section and detail tests. Flips LIB-4 → Built at Gate 2.
- **Step DoD "numbers match B13's records"** — by construction (same functions, same
  component) and by the two-screens-same-numbers test above.
- Device verification (Built → Done, Tristen): open a logged exercise's card from the
  Library → PRs and sessions under the tips, legible at phone width; show-more on a long
  history; a never-logged exercise's card reads fine.

## Out of scope

- **Custom exercises on the detail route** — B31 (they have no catalog card yet; their
  history keeps living at `exercise-history/[exerciseId]`).
- **Tap-through from a session card to its saved workout** — recorded B13 deferral,
  unchanged (both screens would get it via the section when it lands).
- **Strength grades on the card** — B45 (blocked on the Strength Level licence).
- **Other lifters' PRs/history on a card** — nothing social here; `personal_records` is
  owner-only RLS (B13) and every read is the signed-in user's own device rows.
- **Real pagination machinery** (cursors, windowing) — the grow-the-limit reveal is enough
  until a measured problem says otherwise.
- Any migration, sync change, or new dependency. None needed.

## Risks

1. **The extraction touches B13's shipped screen.** The history screen's tests pin its
   behaviour; the move must keep them green with only the show-more addition. The reviewer
   should diff the section against the old screen body for dropped states — the keyed-by-id
   reload guard and the `dbError` branch from `useAppDatabase` are the two easiest to lose.
2. **The detail test harness changes.** Today those tests render with no providers; adding a
   database-reading section means auth + db providers and async settling for every render —
   including the 151-exercise loop (now 151 mounts × 2 quick queries on an empty seeded db,
   each needing its load to settle to avoid act warnings). Suite time and flakiness are the
   risk; the mitigation is the same renderWithAuth-style harness `exercise-history.test.tsx`
   already uses, and `findBy*` queries that wait once per mount.
3. **"Show older sessions" re-reads with a growing limit** (O(n²) across taps in the worst
   case). Local, indexed SQLite at human workout counts (a 3×/week lifter logs ~150 sessions
   a year); accepted deliberately over cursor machinery. The knob, if ever needed, is a
   keyset cursor in `exerciseSessions` — `listPastWorkouts` already shows the pattern.

## Grilling record (settled decisions)

Conducted by the planner session itself (autonomous pipeline — no interactive user; CLAUDE.md
"Autonomous sessions" delegates the gate judgment to the session). Questions put
adversarially; the draft was revised in place where an answer changed it.

- **"Is a shared component scope creep over just adding queries to the detail screen?"** The
  opposite: two renderings of the same records are the mirrored-copy bug CLAUDE.md names, one
  screen-refactor away from disagreeing with the step DoD. The extraction is the minimal
  arrangement in which the numbers *cannot* diverge. It is also the step's whole diff — three
  files plus tests.
- **"Does `exercise-history` redirect to the detail route?"** No — settled in the approach
  (slug vs uuid keys; custom exercises in B31 have history but no catalog card). Recorded so
  B31 revisits deliberately instead of rediscovering it.
- **"Is newest-50 'complete'?"** It is not, and the step scope says *full*. First draft
  deferred to B13's no-paging precedent; grilling overturned that: LIB-4's own DoD wording is
  the requirement, and the cheap honest fix (re-query with a grown limit through the
  *existing* `limit` parameter) exists. Cursor pagination stays out — that would be
  speculative machinery; the grow-the-limit button is one state variable.
- **"Does show-more belong to B30 or is it widening?"** The step scope's own words ("full
  logged history") demand it; without it the plan would have to declare the scope wrong.
  Recorded as deliberate inclusion, the B29 reordering precedent.
- **"Why not put PRs above the coaching content?"** The unbounded list argument (above). The
  PR card is one scroll away at most; placement is a device-check call, swap is free. Not
  worth splitting the section into two mount points for a guess.
- **"The detail screen now needs db + auth — does it break for a signed-out viewer?"** The
  route already sits under the signed-in guard (B29), so the section always has a user. The
  section still degrades (failure line, catalog content intact) if the database read fails.
- **"Are the fixtures honest?"** The section test writes history through the real
  `finish()` path, so the asserted PR rows are what B13 actually persists — the step DoD
  ("match B13's records") tested against B13's real writer, not a re-implementation.
- **"Anything for the ERD?"** No schema change of any kind; ERD untouched, flowchart only.
- **"Does anything recorded go stale?"** Yes — B13's "no paging (newest 50)" deferral line;
  the Document step amends it (added to Files). The grilling also added two builder notes so
  known traps aren't rediscovered: the dual param shapes in the router mock, and settling the
  151-mount loop on the section's empty-state text.
- **Scope verdict:** right as written, with the "complete vs 50" reading resolved inside the
  step rather than silently narrowed. Nothing else widened; customs, grades, tap-through and
  social surfaces all have named owners elsewhere.

## Build deviations (builder, B30)

- **The name heading moved into the section, behind a `showName` prop.** The plan had the
  history screen shell read `exerciseInfo` for its title. Loading it in the section's one read
  keeps B13's observable behaviour exact (name, PRs and sessions appear together; the loading
  and failure states still show only Back) without a second read in the shell. The Library card
  passes no `showName`, and then `exerciseInfo` is skipped.
- **`pageSize` is a section prop** (default `EXERCISE_SESSION_LIMIT`): the plan's "small limit
  override" for tests, as a prop. No production caller sets it.
- **A failed "Show older sessions" read keeps the list already shown** (and hides the button for
  that attempt) instead of replacing the PRs and sessions with the failure line. Found by the
  review; the plan did not cover the case. A failed *first* read still shows the failure line.
- **History screen with a missing `exerciseId` param** now shows the failure line instead of
  "Loading history…" forever. The app's own links can't reach this case.
- **The `lb` set helper moved into `test-utils/loggerTestKit.tsx`**, shared by the three test
  files (review: duplicated code). The screen-level show-more test seeds 51 sessions through
  the real store.
