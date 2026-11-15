# Deferred

_Things postponed during sessions, so they aren't lost. Remove items when they're done or decided._

- UI foundation leftovers: app icon + splash artwork are still the Expo template placeholders
  (splash/adaptive backgrounds set to `#0d0d0d`); device/simulator verification of FND-1/FND-4
  pending (flips them from Built to Done); re-audit screens with the `ui-ux-pro-max` skill if
  Tristen installs it.
- FND-2 leftovers (branch `supabase-schema`; migrations applied + RLS-verified Nov 14, 2026):
  storage buckets (land
  with avatar / progress-pic features); exercise library seed data (LIB items); replace the single
  `user_body_data.bodyweight_kg` value with a bodyweight history log when trends/REC items need it;
  add an exercise-name snapshot on `workout_exercises` when the logger (LOG items) lands, so
  history entries whose exercise was deleted (`exercise_id` null) can still say what they were.
- Library DB seed follow-ups (`library-db-seed`): ~~move `uuidv5` into the frontend~~ — done in
  B07 (`frontend/src/library/uuidv5.ts`, pure-TS SHA-1; the generator imports it; a regenerated
  seed matched the committed migration's git blob byte for byte). Renaming/retiring a library exercise is a deliberate content migration (new slug = new id;
  history references ids) — never just rerun the generator; orphan-slug detection happens in
  post-re-seed verification.
- B05 auth follow-ups (`auth-and-signup`):
  - ~~Apply the migration live and probe it~~ — done Nov 14, 2026 (applied via MCP; under-18,
    missing and malformed birthdates refused through the real `signUp` API with no `auth.users`
    row left; 18+ path exercised by a direct `auth.users` insert because Supabase's email
    validation rejects undeliverable test domains — all three rows created, birthdate stamped,
    probe row deleted).
  - Re-run the B02 RLS probe with `birthdate` in `user_metadata`, since the trigger now refuses
    users without one.
  - **Email confirmation is ON** in the live project (`mailer_autoconfirm: false`, read via the
    Management API Nov 14, 2026). The approved plan says off for launch; the session's attempt to
    flip it was declined by Claude Code's permission classifier, so **Tristen toggles it**
    (Dashboard → Authentication → Providers → Email → "Confirm email" off) or decides it stays on,
    in which case the device check includes the email hop. Password minimum is 6, matching
    `frontend/src/auth/password.ts`.
  - Password reset / "forgot password" flow deserves its own small step. Email change and the
    account-deletion UI land with the You/settings features (NFR-6).
  - ~~Swap the session store to `expo-sqlite/kv-store`~~: done in B07, and AsyncStorage is
    removed. A device run must still confirm the stored session survives a kill (it moved storage
    engines, so an existing dev install signs in once again).
- Autonomous pipeline v2 features, deliberately left out of v1 (see `docs/PIPELINE.md`): cron /
  unattended triggering, parallel items via git worktrees, external gate notifications
  (Telegram/email), auto-updating build-list status at merge (now cheap: at Gate 2 the step row's
  Status and each covered feature's Status could be flipped by `pipeline.mjs` from the merge
  commit). Earn each with a few clean v1 runs.
- Pipeline permissions: `mcp__supabase` is now in the headless allowlist (Tristen's decision,
  Nov 14, 2026 — both settings files). Still open: whether to grant `Bash(mmdc:*)` so a builder
  can render the living diagrams to check them (the B05 builder could not).
- n8n MCP server (`automation/scripts/n8n-mcp.mjs` → `npx n8n-mcp`) rejects `http://localhost:5678`
  with "SSRF protection: Localhost access is blocked in strict mode". Fix confirmed in n8n-mcp's
  source (`dist/utils/ssrf-protection.js`): it reads `WEBHOOK_SECURITY_MODE`; `moderate` allows
  loopback while still blocking cloud-metadata and LAN ranges (`127.0.0.1` is blocked too, so
  changing the URL alone does not help). **Applied Nov 14, 2026 at Tristen's explicit request**
  (`WEBHOOK_SECURITY_MODE: 'moderate'` in the launcher's env block). It takes effect the next time
  Claude Code starts, since MCP servers only launch at session start — confirm with the n8n
  health-check tool in a fresh session, then delete this item. If it still fails, live-board work
  goes through n8n's REST API with the `.env` key (see `docs/PIPELINE.md`, "The board" row).
- Max Method data deliberately NOT imported with the launch library (`launch-library-seed`),
  re-import when a consumer exists:
  - Cardio-machine selector metadata (`MaxMethodBackendStructure/.../src/utils/cardioMachineMetadata.js`:
    skill floors, impact, HIIT/steady-state/warmup suitability, injury exclusions, main-lift fatigue
    map) — useful when programs or cardio selection land.
  - `VIDEO_NAME_ALIASES` (Mux video-name mapping in Max Method's `config/exercises.js`) — revisit
    when the video service is chosen (LIB-2).
- B06 training-math follow-ups (`training-math`):
  - ~~Lint target for `_shared/`~~ — done in B18: `npm run lint` now also runs `lint:functions`
    over `backend/supabase/functions`.
  - ~~Deno-side verification~~ — done in B18 by a real deploy of `analyze-workout` (the bundle
    type-checks the module graph). `deno check` itself was not permitted to the builder; install
    Deno on Tristen's machine if a local check is wanted.
  - Session volume (`volume.ts`) and strength grades land *in this module* when B10/B18 and the
    Strength Level licence call for them — never beside it.
  - `.expo/types/router.d.ts` (gitignored, generated by `expo start`) can go stale and make
    `tsc --noEmit` fail on the auth routes' `router.push` calls; it did at the start of B06.
    Running `npx expo start` once regenerates it.
- B07 local-store-and-sync follow-ups (`local-store-and-sync`):
  - **Poison rows block uploads.** Push stops at the first failed batch, so a row the server
    refuses every time blocks everything queued behind it in that table and in its child tables.
    The device repeats none of the server's CHECKs (RPE 1–10, reps ≥ 0, title ≤ 100…). The
    answer belongs with B08/B09: validate in the logger before `writeLocal` (through the shared
    training-math `validate` module, never a copy). If evidence shows wedges anyway, add per-row
    quarantine of a batch the server refuses with a 4xx.
  - **Account switch on one phone.** The outbox and the local rows are not filtered by user, so a
    previous account's unsent lines would be refused by RLS and wedge the push (see above), and
    its rows stay in `astra.db`. Wipe the local database on *account switch* (not on sign-out)
    in the step that builds account switching. Until then, every UI query must filter by the
    signed-in `user_id`.
  - Device check for FND-3 / NFR-1: log a workout in airplane mode, reconnect, and confirm it
    appears once in Supabase. That needs B08/B09's logger to create a workout on a phone. Until
    then it is proven in Jest only. The expo driver, `expo-network` listener and kv-store
    session have not been exercised on a device or simulator.
  - The `.expo/types/router.d.ts` staleness hit again at B07. Running `npx expo start` once
    regenerated it, and tsc then passed.
- B08 active-workout-store follow-ups (`active-workout-store`):
  - **B09 must wire it:** call `loadActiveWorkout` on launch (or on opening the Workout tab).
    When `startActiveWorkout` refuses, offer resume-or-discard. Offer discard instead of finishing
    an empty workout. Bind `repeatLastSet` to one tap (NFR-2). Every call passes the signed-in
    `user_id`.
  - **Leftover unfinished workouts.** If more than one unfinished workout ever exists, resume
    picks the newest and leaves the others untouched. No UI surfaces them yet.
  - ~~**Title/notes setters** (LOG-3, B12) add their length limits to `@training-math`
    `limits.ts`~~ — done in B12.
  - **`limits.ts` mirrors the migration by hand.** Any future migration that changes a `sets`
    CHECK or column type must update `limits.ts` in the same commit. No test spans the SQL and
    the TS.
  - **Device check for NFR-3:** force-kill the real app mid-workout and relaunch. This needs
    B09's screen. Until then the guarantee is proven in Jest on a file-backed database.
  - A failed snapshot re-read after a committed write reports an error although the write
    landed. Nothing is lost (the next read re-syncs). Revisit if it is ever seen in practice.
  - `mmdc` was not available to the headless builder, so the updated `app-flow.md` Mermaid was not
    render-checked.
- B09 logger-screen follow-ups (`logger-screen`):
  - **Typed-routes root cause found:** running Jest rewrites the gitignored
    `.expo/types/router.d.ts` with a route list that lacks the auth routes and any new ones;
    `expo lint` doesn't touch it. Order for gates and builders: `npx expo start` (~100 s, not
    30 — 40 s was not enough this run) → `tsc --noEmit` → lint → Jest. **Folded into the builder
    prompt at B09's Gate 2** (Nov 14, 2026); Gate 2 follows the same order. Still open: making
    tsc not depend on the generated file at all (e.g. a committed route-type stub or a
    `typecheck` script that regenerates first).
  - **Device check (Tristen):** the whole P0 logging path is now on screen — airplane-mode log
    of a multi-exercise workout, force-kill mid-workout and relaunch (Workout tab offers
    Resume), Finish → saved workout, reconnect → appears once in Supabase. None of the screens
    has run on a device or simulator; layout (keyboard over the entry row, Modal safe areas) is
    unverified.
  - **Unit is pinned to lb** (`settings/displayUnit.ts`) until B15 mirrors
    `user_settings.unit`; a kg user sees and types pounds until then.
  - **Exercise-name snapshot on `workout_exercises`** moves to B31 (first step that makes an
    exercise deletable); the saved screen shows "Deleted exercise" for a missing name meanwhile.
  - Leftover multiple drafts are still not surfaced (Resume takes the newest).
  - `leave()` / `back()` ("back, or the Workout tab") is duplicated in two screens; extract when
    a third screen needs it.
  - `mmdc` was not permitted for the headless builder again, so the updated `app-flow.md`
    Mermaid was not render-checked.
- (External blockers from the PRD — Strength Level licence, food database, Denver gym data source,
  video provider, deload rules — are tracked in `docs/BUILD_LIST.md`.)
- B10 set-types follow-ups (`set-types`): device check of the entry card's new second row
  (Warm-up chip + Log set) and the per-set W toggle at phone width; the RPE error copy hard-codes
  "1 to 10" — build it from `limits.ts`'s RPE bounds if they are ever exported or changed.
- B11 supersets-dropsets-timed follow-ups (`supersets-dropsets-timed`):
  - ~~Migration file vs live version~~ — both files renamed at B11's Gate 2 (Nov 14, 2026) to the
    versions Supabase recorded (`20261114224613_signup_birthdate_gate.sql`,
    `20261115024010_sets_score.sql`); references updated. The builder prompt now tells builders
    to rename after `apply_migration` using `list_migrations`, so this should not recur.
  - **Feed display of WOD entries (LOG-13 "and the feed")** waits for B20. The feed must print sets
    through `formatSet` / `formatDropSet` and group with `supersetRuns` / `groupDropSets`.
  - **Device check (Tristen):** the entry card's header now has four icon buttons (link, up, down,
    remove) and the action row has two chips plus Drop + Log set. Check both at phone width, plus
    the Timed row and the keyboard (`numbers-and-punctuation` for the Time box).
  - A score-only set shows as "—" in the "Last time" one-liner (scores are left out by the plan).
    Revisit if lifters find it confusing.
  - Repeat after a drop copies the drop's number, so the copy shows as its own plain-looking set
    (plan Risk 3, unchanged NFR-2 behaviour).
  - `mmdc` was not permitted for the headless builder again; neither diagram was render-checked.
- B12 workout-notes follow-ups (`workout-notes`):
  - **Device check (Tristen):** the title + 2000-char notes box in the logger header (keyboard
    over a multiline input inside a FlatList header), the per-set note icon now making five
    controls on a set row (number, text, note, W, remove) at phone width, and the autosave feel
    (~750 ms) on a real keyboard. Force-kill mid-note and relaunch → the note is there (minus at
    most the last ~¾ s of typing).
  - **Feed display of notes** waits for B20; **editing notes on a finished workout** is B14's
    (its edit surface should reuse `setTitle` / `setNotes` / `setEntryNotes` / `setSetNotes`
    validation through `limits.ts`).
  - A save refused *after* its box closed (unmount flush) only logs a `console.warn`; the inputs'
    `maxLength` makes that near-unreachable. Surface it on the card if it is ever seen.
  - `mmdc` was not permitted for the headless builder; neither diagram was render-checked.
- B13 exercise-history-and-prs follow-ups (`exercise-history-and-prs`):
  - ~~B14 must rework the keep-best trigger~~ — resolved by B14 without touching the trigger:
    demotions are uploaded as delete-then-insert, `recomputeRecords` is the forced recompute,
    and ties stay last-write-wins (see `edit-delete-workouts.md`).
  - **Device check (Tristen):** the last-time panel's PR line and History link at phone width;
    the history screen; the "PR · …" badge on the saved workout after a finish.
  - **e1RM copy:** shown as "e1RM" (an estimate by name) with no on-screen source. Decide whether
    CLAUDE.md's "numeric performance claim cites a source" rule wants an "Epley estimate" note.
  - An exercise's PR line stays empty until its first finish after B13 ships (history seeds then).
  - Small duplication to extract when a third user appears: distinct exercise ids of a workout,
    `back()`, and the set-row JSX shared by the saved-workout and history screens.
  - History screen has no paging (newest 50) and no tap-through to a session's workout.
  - `mmdc` was not permitted for the headless builder; neither diagram was render-checked.
- B14 edit-delete-workouts follow-ups (`edit-delete-workouts`):
  - **Device check (Tristen):** saved workout → Edit → remove a set / add one / change the title
    → Done shows it; Delete on the saved workout and on the edit screen (confirm dialog, lands on
    the Workout tab); delete the workout holding a PR → the next best set wears the badge; with
    two devices (or the dashboard), the deletion and the demoted `personal_records` row reach
    Supabase and the other device drops the workout. Layout of the Edit / Delete row and the
    edit screen's header at phone width is unverified.
  - **Inline editing of a logged set's numbers** — today a mistyped set is removed and logged
    again (`EntryCard` has no value editor; the store's `updateSet` is ready for one).
  - **Resurrection window** (plan deviation 1): a tombstone written between the engine's
    pre-push tombstone read and its push can still let a pending edit re-insert a deleted
    workout. A server guard (e.g. a `BEFORE INSERT` trigger on `workouts` that quietly drops an
    id already in `sync_tombstones`) would close it; deferred until it is seen.
  - **A pending exercise-slot edit re-creates a slot another device removed** (edits-win,
    as planned) — the slot comes back empty on the server. Revisit if seen.
  - **Multi-device demotion race** (plan, accepted): device B's offline improvement of a book
    can be overwritten by device A's delete+insert demotion; self-heals on B's next finish of
    that exercise.
  - **Tombstone retention:** `sync_tombstones` grows forever (rows are tiny). Add a cleanup job
    only when its size is measured to matter.
  - Small duplication to extract later: the "exercise ids of these slots / sets" lookups in
    `editWorkout.ts` mirror `workoutIdsOf` in `dao.ts`; the 500-id chunk constant exists in both
    `sync/outbox.ts` and `sync/pull.ts`.
  - `mmdc` was not permitted for the headless builder; neither diagram was render-checked.
- B15 settings-and-units follow-ups (`settings-and-units`):
  - **Device check (Tristen):** You → gear → Settings; flip to kg → the logger, a saved workout,
    edit and exercise history all show kg, entry boxes read "Weight in kg"; flip back → the same
    numbers as before; flip in airplane mode, kill the app, reopen → still kg; reconnect →
    `user_settings.unit` is `kg` in Supabase; change it in the dashboard → the next sync shows
    it on the phone; Sign out from Settings. Gear-button placement beside the floating profile
    button at phone width is unverified.
  - **Live probe:** Gate 2 (Nov 14, 2026) confirmed the live `user_settings` policies the
    update-only push relies on (owner `select` + `update`, no insert; `unit` CHECK in
    (`kg`,`lb`), default `lb`). A real signed-in toggle reaching the row is part of the device
    check above.
  - **Pre-hydration flash** (plan risk 2): a kg lifter may see pounds for a frame on a cold
    start until the one-row read lands. If visible, hold the splash on `unitStore.hydrate`.
  - **Settings sync is bundled behind the training push:** the settings phase runs after the
    five table passes, so a training row the server keeps refusing also holds the unit back.
    Move the phase first if that ever bites.
  - Notifications (B47) and Privacy (B26) sections of Settings, `default_workout_visibility`
    mirroring (B26), email change / password reset (NFR-6) — not in this step.
  - `mmdc` was not permitted for the headless builder; neither diagram was render-checked.
- B16 tool-kit-calculators follow-ups (`tool-kit-calculators`):
  - **Device check (Tristen):** in a long workout, scroll to the bottom → the floating Tool Kit
    button doesn't cover the last card's Log set button or the reps box while the keyboard is
    open (plan risk 2; fallback = header button); one tap opens the panel, Close returns to the
    same scroll position with half-typed boxes intact; airplane mode → all four calculators
    work; plate loader rack edits survive killing the app; kg setting → the three weight
    calculators read "(kg)", the plate loader keeps the rack last chosen.
  - **Tool Kit session isn't cleared on sign-out**: typed calculator numbers (not stored, not
    sensitive under the privacy rule) stay in memory if a second account signs in on the same
    phone without restarting the app. One-line `resetToolKitSession()` in the sign-out path if
    it matters.
  - **Plate solver on a slow phone at absurd inputs**: ~20 ms on desktop at every limit at once;
    if a low-end device lags, debounce the target box or lower `MAX_TARGET_WEIGHT`.
  - Prefill from the exercise in progress and stored PRs (TK-6) is B43; Timer (TK-5) is B17.
  - `mmdc` was not permitted for the headless builder; `app-flow.md` was not render-checked.
- B17 tool-kit-timer follow-ups (`tool-kit-timer`):
  - **Device check (Tristen), iOS and Android:** each of the five modes started, the app
    backgrounded (or the phone locked) ≥ 2 min, then reopened → correct time, round and phase;
    a countdown left running with the app backgrounded → the "Time's up" notification arrives
    at zero; one finishing with the app open and the panel closed → banner and sound (the
    expo-notifications default handler); first use → the permission prompt, and refusing it
    shows the "Notifications are off" line while the timer keeps time. Plan risk 1: if Expo Go
    on Android crashes or no-ops on expo-notifications, the timer must still run (guarded
    require); the alert check then needs a development build.
  - **Android alert timing** (plan risk 2): date triggers use best-effort delivery, so the alert
    may arrive seconds late on some OEMs. Revisit with exact alarms only on device evidence.
  - **Per-interval cues for EMOM / Tabata** (plan risk 3): only the final zero notifies;
    per-round notifications or in-app sounds would slot into the same alerts port.
  - **A running timer doesn't survive the app being killed** (by design). The alert booked
    with the phone still fires, and the next Start replaces it (fixed alert name). Persist the
    run in kv-store only if lifters ask.
  - **Timer isn't reset on sign-out**, like the calculators' session above (nothing sensitive).
  - `mmdc` was not permitted for the headless builder; `app-flow.md` was not render-checked.
- B18 analysis-engine follow-ups (`analysis-engine`):
  - **Gate 2 live probes not run by the builder** (curl not permitted): POST
    `/functions/v1/analyze-workout` with no token → refused (401); as a real signed-in user on a
    seeded finished workout → 200 + one row; again → still one row; on another user's PUBLIC
    workout → 404 with the owner's row unchanged.
  - **Device check (Tristen):** Finish (also in airplane mode) lands on the analysis — headline,
    volume in the chosen unit, sets "· n warm-up", duration, New PRs, statement at the bottom;
    View workout; the saved workout's Analysis button, including on a workout finished before
    B18; reconnect → a `workout_analyses` row appears in Supabase once; edit the workout → the
    analysis updates after the next sync. Layout of the three-button row (Analysis / Edit /
    Delete) at phone width is unverified.
  - **Batch starvation:** the request pass asks for the 10 newest candidates; ten workouts the
    server refuses forever would keep older ones waiting. Only a server bug could cause that
    (unsent workouts are skipped). Rotate or back off failed ids if it is ever seen.
  - **Pre-B18 backfill is gradual:** a long history fills in at 10 analyses per sync.
  - Small duplications kept: `ANALYSIS_COLUMNS` in the Deno entry vs `TABLE_COLUMNS` in `dao.ts`
    (Deno can't import app code); `is_warmup === 1` by hand in `readAnalysisInput`.
  - `mmdc` was not permitted for the headless builder; neither diagram was render-checked.
