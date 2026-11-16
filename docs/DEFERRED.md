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
    (B31: deletion is soft, so names never go missing — returned to the B31 list below.)
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
  - ~~History screen has no paging (newest 50)~~ — B30's "Show older sessions" reaches every
    session (grows the read's limit by 50 per tap). Still deferred: tap-through from a session
    card to its saved workout, and true cursor paging if a measured problem ever calls for it.
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
  - **Live probes:** Gate 2 (Nov 15, 2026) confirmed the deployed function (version 2, ACTIVE,
    `verify_jwt: true`) refuses a call with no token (401, missing authorization header) and a
    call with only the publishable key (401, "Sign in first"), and that `workout_analyses` has
    RLS on with a single owner `select` policy. **Still to run with a real signed-in user**
    (part of Tristen's device check): a seeded finished workout → 200 + one row; again → still
    one row; another user's PUBLIC workout → 404 with the owner's row unchanged.
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
- B19 muscle-map follow-ups (`muscle-map`):
  - **Device check (Tristen):** finish a bench-only session (also in airplane mode) and confirm
    chest, shoulders and triceps are red on the figures and nothing else is; check the two
    figures are legible at phone width (the region shapes in `components/muscleMapPaths.ts` were
    hand-authored blind and are built to be replaced wholesale as data); confirm the lightest
    involvement (0.12 → 34% opacity) is visible on the dark background.
  - **Custom exercises shade nothing** until custom-exercise authoring grows a muscle picker (a
    LIB step); the reader will consume that data through the same path.
  - **Weighting:** shading is the per-muscle maximum (ten chest sets shade like one). Revisit
    only with a product reason, inside `combineMuscleLoads`.
  - **Elsewhere:** the map is only on the analysis screen; saved workout / feed / trends wiring
    belongs to B20 / B21 / B42. `sessionMuscleLoads` does not check `ended_at` — a caller that
    needs finished-only must check it.
  - Judgement calls from review left as-is: the muscle-table type is written out in several
    places (a `MuscleIntensities` alias in `library/exercises.ts` would tidy it);
    `MUSCLE_ORDER` / `MUSCLE_NAMES` could move beside `MuscleKey`.
  - `mmdc` was not permitted for the headless builder; `app-flow.md` was not render-checked.
  - **Flaky test seen:** `src/workout/useAutosaveText.test.ts` (saves once, with the final text,
    after typing settles) failed once in a full run, passed alone twice and in the next full
    run. Timing under load; untouched by B19. Worth making its timers deterministic.
- B20 posts-and-feed follow-ups (`posts-and-feed`):
  - **Device check (Tristen):** Home with no follows shows Find lifters + Log a workout; Find
    lifters search, Follow / Following flip, Back → Home reloads; airplane mode → "The feed needs
    a connection" + Retry. A feed with posts needs rows inserted by SQL until B21 (finish-to-post)
    ships — e.g. as two test accounts: a `posts` row for one account's finished workout, the
    other following it. Check card layout at phone width (header row with flair chip, long
    names).
  - **Live PostgREST not exercised by the builder:** the embed select (`FEED_SELECT`, incl.
    `workouts!inner` and nested `exercise:exercises(name)`), the keyset `or()` filter and the
    quoted / escaped `ilike` search filter are pinned by unit tests against the fake client and
    the RLS was probed in SQL, but no request went through the real REST API with a user token.
    Gate 2 or the device run should confirm a feed load and a search containing `_` / `%`.
  - **Author in-list in the URL:** `.in('user_id', me + followees)` grows with the follow list;
    switch to a server-side view only when a measured follow list makes the URL a problem (G10).
  - **Custom exercises print as "Custom exercise"** on other lifters' cards (their customs are
    hidden by exercises RLS). Widening exercises read to "visible when used in a workout I can
    see" is a later decision.
  - **Not built (later steps per the plan):** post creation / flair picker (B21), votes and
    `upvotes_only` enforcement (B23), image posts (B22), profile counts and avatars (B25), tapping
    a card through to the workout, realtime feed.
  - Review judgement calls left: `beforeCursorFilter` mirrors sync's `afterCursorFilter` by hand
    (different column and direction); kept as two small named functions.
  - `mmdc` was not permitted for the headless builder; neither diagram was render-checked.
- B21 finish-to-post follow-ups (`finish-to-post`):
  - **Device check (Tristen):** finish a workout → analysis shows **Next** → Post step with the
    four flair chips → pick one → Post → Home shows the post (needs signal); a second account
    following you sees it. Repeat in airplane mode: Post still lands on Home (feed offline
    message), and after reconnecting the post appears once. Finish → Next → **Skip** → Workout
    tab, no post. Saved workout → Analysis has no Next. Chip layout at phone width.
  - **Live PostgREST not exercised by the builder:** `posts` upsert on id through the real REST
    API with a user token (insert path, the retry/update path, and the 23505 code arriving on
    `error.code`), and the `flairs` select. Pinned against the recording fake client and the B20
    RLS source only.
  - **A flair removed on the server would wedge a queued post** that uses it (foreign-key refusal
    kept and retried every sync). Today flairs are founder-curated and only ever added (B20: "the
    slug never changes once shipped"); if a flair is ever retired, map that refusal to a settled
    drop or re-flair, the way 23505 is handled.
  - Review judgement calls left as-is: `createPost.ts` and `flairs.ts` spell their own insert
    columns rather than reusing dao's private upsert helper; `pullFlairs` trusts the row shape
    (like the other plain pulls); the `post=1` route param could be a more descriptive name.
  - A failing settings upload holds queued posts back too (the posts phase runs after it);
    accepted, noted in `pushPostsPhase`.
  - `mmdc` was not permitted for the headless builder; neither diagram was render-checked.
- B22 image-posts follow-ups (`image-posts`):
  - **Device check (Tristen):** Home → Share a photo → Progress pic → Choose photo → Post → back on
    Home at once; the card appears (private, "Only you can see this post") once uploaded. Same for
    a PR photo, then from a second account following you: the PR photo shows, the progress pic
    does not. Pick a >10 MB photo (a long-exposure or a screenshot of a huge PNG) → the "This photo
    is N MB — the limit is 10 MB" line and Post disabled. Airplane mode → Post → reconnect → posts
    once. **On iPhone, confirm the picker hands back JPEG (not HEIC) with `quality: 0.9`** (G9).
    Confirm photos render with the Bearer-header `<Image>` on both platforms (risk 2; fallback is
    signed URLs behind `postImageSource`).
  - **Not exercised live by the builder:** a real Storage upload (`/storage/v1/object/post-images/…`
    with `x-upsert`, the user token and `apikey`), the bucket's `file_size_limit` refusing a >10 MiB
    HTTP upload, and the authenticated GET. Bucket config and every storage/posts RLS rule were
    probed in SQL as two users; the HTTP surface was pinned only against fakes.
  - **No sweep of stray waiting photos** in `documents/post-images/` (failed best-effort delete, a
    kill between acknowledge and delete, a dropped post). Add a sweep (delete files with no queued
    post) when storage on the phone matters.
  - **Permanent non-23505 refusals of a photo post** (a CHECK the app never violates today, a 4xx
    from the bucket on a corrupted file) would hold the posts queue, the B07 known limit. Map
    known-permanent codes to a settled drop if one is ever seen.
  - **Deleting photo posts** (and their storage objects) lands with the post-deletion step;
    the bucket's owner-delete policy is already in place for it.
  - **B26** relaxes `posts_progress_pic_private` by migration when the visibility choice ships;
    **B28** should know a PR post is a photo with the New PR flair, with no link to
    `personal_records` (owner-only RLS).
  - Review judgement calls left as-is: the 10 MiB cap and mime list are mirrored by hand in the
    migration and `mediaLimits.ts` (commented to change together, the `limits.ts` precedent); the
    storage policies repeat the own-folder expression; `saveImage`'s returned path is unused.
  - `mmdc` was not permitted for the headless builder; neither diagram was render-checked.
- B23 votes-and-comments follow-ups (`votes-and-comments`):
  - **Device check (Tristen):** on Home, tap up / down / the lit arrow again on a WOD post — score
    moves ±1 / ±2 and survives a pull-to-refresh; a Physique Check post shows no down arrow. Open
    "Comment" → write one → it appears; from a second account following you, see it and reply;
    airplane mode → the comments screen says it needs a connection.
  - **Comment paging** (G9/G12): one load reads 200, oldest first, and says "More comments exist"
    past that. Keyset paging on `(created_at, id)` — the index already matches — when a post gets
    there.
  - **Deleting your own comment** has RLS (`users delete their own comments`) but no UI yet.
  - **Founder removal and block/mute filtering** of comments and votes: B27, as the plan recorded.
    Today a comment by someone who blocked you still shows, and a post's author cannot remove
    other people's comments.
  - **`post_scores` aggregates every vote and comment** before the `post_id in (…)` filter (the
    grouped subqueries may not be pushed down). Fine at launch scale; when the feed is slow,
    rewrite the view as lateral per-post sums or a counter column maintained by trigger. B24's hot
    view should be measured with this in mind.
  - **`votes.user_id` FK has no covering index** (advisor INFO, like `personal_records.exercise_id`).
    Add one if account deletion ever gets slow.
  - **Flipping `flairs.upvotes_only` to true** on a flair whose posts already have downvotes isn't
    guarded (only re-flairing a post is). Flairs change only by migration; a migration that flips
    one must clear or convert those downvotes itself.
  - **Comments screen on a post that became invisible** shows "No comments yet" and a send that fails
    with the connection line; a clearer "this post is no longer available" needs a post read first.
  - Review judgement calls left as-is: the author-shaping in `toPostComment` / `toFeedPost` is
    similar but separate (one line each); the 500-char cap is mirrored by hand (the `mediaLimits`
    precedent); `UPVOTES_ONLY_CODE` is the generic `P0001`, safe while the trigger is the only
    `raise` on `votes` — give it a custom errcode if a second one appears; the fake social client
    branches per table.
  - `mmdc` was not permitted for the headless builder; neither diagram was render-checked.
- B24 feed-sort-and-filter follow-ups (`feed-sort-and-filter`):
  - **Live ranking probe and `explain analyze` on `post_hot_scores`** need several real accounts
    with votes; the live project has one profile and no posts. Gate 2 / Tristen: seed 2–3 test
    accounts, check a 3-vote older post outranks a 0-vote newer one, a private / blocked post is
    absent, and look at the plan for the whole-`votes` aggregation. Recorded rewrite if slow:
    lateral per-post sums (view body only).
  - **Preference roaming** across phones (a `user_settings` column + mirror) — with B26 if ever
    wanted (plan G1).
  - **`ChoiceChips` lives in `components/toolkit/`** but Home now uses it too; move it to
    `components/ui/` in a tidy-up pass (left alone to keep this diff on its feature).
  - **The fake's `fakeHotScore` copies the migration's formula** (test-only, labelled). The Hot
    ordering tests check the fake, not the SQL; a change to the view body must change the fake too.
  - Review judgement calls left as-is: `loadFeedPage` branches on the order at the query-builder
    stage (plan G11 kept one function); `sort` + `flairId` travel as two params rather than one
    type (they map 1:1 to `FeedPrefs`; bundle if a third feed option appears).
  - Pre-existing: three "overlapping act()" console warnings in older `home-feed.test.tsx` tests
    (present on main before B24); the B24 tests add none.
  - `mmdc` not run for this build either; diagrams not render-checked.
- B25 profile follow-ups (`profile`):
  - **Two live probes not run by the builder**: an avatar object fetched from
    `/storage/v1/object/public/avatars/<path>` with no auth header, and an over-limit (> 5 MiB)
    avatar upload refused by `file_size_limit` — both need a real signed-in upload. The bucket row
    (`public = true`, `file_size_limit = 5242880`) was confirmed live. Gate 2 / Tristen's device
    run: change the photo on Edit profile, open the public URL in a browser, try a > 5 MB photo.
  - **Follower / following lists** (tapping a count) — not in B25's scope; another user's lists
    aren't readable under `follows` RLS. A later SOC step decides the RLS (plan, Out of scope).
  - **No "remove photo"** on Edit profile (`avatar_url` can only be replaced); add with B26's
    privacy settings or a tidy-up pass if wanted.
  - **Another lifter's workout rows aren't tappable** — no online workout detail screen yet (B20
    stance).
  - **`follow_counts` ignores blocks**: a blocked lifter can still read the blocker's two counts,
    just as they can read the `profiles` row. Product reading for Tristen; B27 (block / mute) can
    add a `workout_visible`-style check if it should hide them.
  - Review judgement calls left as-is: `ProfileView` branches on the tab in several places and its
    three loaders share a generation-guard shape (a per-tab table would collapse them — refactor if
    a fourth tab arrives); the own / others' History rows are two renderers by design (plan G8);
    `router.push('/profile/[id]')` is spelled in Home and Find lifters (one line each).
  - When both the header and the open tab fail offline, the profile shows two Retry buttons (the
    header's reloads both); merge into one if it reads oddly on device.
  - `mmdc` not permitted for the headless builder; neither diagram was render-checked.
- B26 post-privacy follow-ups (`post-privacy`):
  - **Body-data visibility control** moved out of B26 (plan scope readings / G5): Settings states
    "Only you. Body data never leaves your account." The user-set choice lands with the first step
    that reads body data (B38+ grades, B46 trends). Gate 2 should reword NFR-5's BUILD_LIST note.
  - **Default workout visibility / per-workout visibility control** — not in B26's scope;
    `user_settings.default_workout_visibility` stays unmirrored (new workouts are born public). The
    step that adds a workout-level control must also add the workout→post lockstep trigger (only
    post→workout exists today).
  - **Multi-device stale workout edit** (accepted, plan "Risks" 2): device B holding an old copy
    of a workout and editing it offline before its next download can push the old visibility
    back up, moving the workout (not the post) back. It's the B14 last-write-wins class and fixes
    itself on the next post change. Revisit if a per-workout control lands.
  - **Gate 2 / device check:** toggle a post private on the phone, confirm it disappears for a
    second account (and its photo for a progress pic); set Settings → Privacy → Followers offline,
    reconnect, post a progress pic and confirm a follower sees it.
  - Review judgement calls left as-is: the visibility icons (`PostCard`) and Settings' spoken
    labels are their own small tables beside `VISIBILITY_WORDS` (merge if a fourth visibility ever
    appears); `postPrivacy.ts` holds both the audience wording and the update (split if the wording
    grows); `'private'` as the fallback appears in `DEFAULT_USER_SETTINGS`, `parseVisibility` and two
    screens' initial state.
  - `mmdc` needs approval for the headless builder; neither diagram was render-checked.
- B27 moderation-and-safety follow-ups (`moderation-and-safety`):
  - **Live HTTP probe of `moderate`** (Gate 2 / Tristen): the builder's outbound `curl` was declined
    by the permission layer. Gate 2 (Nov 15, 2026) confirmed over HTTP: no token → 401, anon key
    only → 401 "Sign in first". Still unproven (needs a signed-in token — Tristen): a
    non-moderator → 403, a moderator removing a real photo post (storage object gone),
    a comment, a throwaway account (both storage folders swept), and their own account → 409.
    The database side of every removal was proven in SQL.
  - **Appeal address** for `docs/CONTENT_POLICY.md` — Tristen to pick one; the policy says plainly
    it isn't published yet. Surface the policy in the app (sign-up link, Settings link) in the
    same change.
  - **In-app founder queue / removal screen** — on evidence the dashboard + function stop
    sufficing; the `moderators read the queue` policy already admits it, no migration needed.
  - **Removed post's ghost on the author's phone** (plan G9): the device `posts` mirror keeps the
    row; nothing shows it (own-post reads are server reads). Sweep it in the step that builds
    post-deletion UI.
  - **Block cutting DMs** — B48 (SOC-8's DM clause; Gate 2 notes it on SOC-8).
  - **Report-then-block shortcut**, report notifications, strikes, rate limits, block/mute list
    screens — on evidence.
  - **`remove-post` retry after a failed photo delete** answers 404 (the row is gone) and leaves an
    unreachable object in `post-images`; sweep orphans if it ever happens.
  - Review judgement calls left as-is: `workout_visible` still spells the block check inline (its
    pre-B27 body) rather than calling `blocked_either`; `ReportResult` / `SafetyResult` /
    `FollowResult` are the same shape and `SAFETY_FAILED` = `FOLLOW_FAILED` in words; `json` /
    `check` helpers copied between the two server functions; `'post' | 'comment'` written in three
    types. Merge if a third copy appears.
  - Builder session left a stray `expo start --port 8099` (pid 20408) running — stopping it was
    declined by the permission layer; Gate 2 frees port 8099 anyway.
- B28 share-cards follow-ups (`share-cards`):
  - **Device check (Tristen):** analysis → Share → share sheet → post the PNG to another app
    (Instagram story / Messages) and judge legibility at 1080×1350; Android content-URI handling;
    whether view-shot captures in Expo Go at all (if not, LOG-8 stays Built until a dev build).
    Re-share from a second account and see it in a follower's feed.
  - **Signed-in PostgREST probe of the B28 feed** (Gate 2): a Latest and a Hot read with a real
    re-share on the page, then the `posts?id=in.(…)` originals read — the builder had no user token;
    the SQL-level rules were probed as three users.
  - Un-resharing (delete own re-share) UI — lands with the post-deletion step (policy allows it).
  - A hidden re-share (its original went private / blocked) is invisible to its own owner too; if
    owners should see and delete such ghosts, the read rule needs an owner arm — on evidence.
  - Quote posts (a caption on a re-share), notifying the original author (B47), muscle map / logo
    asset on the share card, exporting photo posts — not built (plan, Out of scope).
  - Review judgement calls left as-is: the share-card `router.push` is written in three places and
    the re-share `useCallback` in two (Home, ProfileView); the footer's three icon+label pressables
    could share a `FooterAction`. Merge if another footer action arrives.
- **B29 library-filters-and-detail:**
  - **Device check (Tristen):** at phone width, the four region chips + two sideways-scrolling
    chip rows + search before the first card (the plan's fallback: collapse the two rows behind a
    "Filters" toggle); detail screen legibility; card tap feel.
  - Info/detail link from the logger's `ExercisePicker` — its rows add on tap, so a detail link
    needs a second tap target (plan, Out of scope).
  - Muscle-filter noise: any involvement counts, ordered hardest first; if it reads as noisy on
    device, the knob is a threshold in `filterExercises` (one line, no UI change).
  - Mermaid render of the updated `app-flow.md` was not run by the builder (`mmdc` was declined
    by the permission layer) — Gate 2 should render it once.
- **B30 library-card-history:**
  - **Device check (Tristen):** open a logged exercise's card from the Library → "Your history"
    (PRs + sessions under the tips) legible at phone width; "Show older sessions" on a long
    history; a never-logged exercise's card reads fine. If PRs belong above the coaching content,
    it is a placement swap inside `app/exercise/[id].tsx`, no logic change.
  - Custom exercises have no catalog card, so their history lives only on
    `exercise-history/[exerciseId]`; whether the two routes collapse is B31's call.
  - A failed "Show older sessions" read keeps the shown list and hides the button for that
    attempt; there is no retry other than reopening the screen. Add one if it is ever seen.
  - Mermaid render of `app-flow.md` was not run by the builder (`mmdc` needed approval the
    headless run doesn't have) — Gate 2 should render it once.
- **B31 custom-exercises:**
  - **Exercise-name snapshot on `workout_exercises`** — returned here from B14/B09's note: B31
    made deletion a *soft* delete (`exercises.deleted_at`), so a deleted custom keeps its name on
    every past session and the snapshot's trigger is gone. Remaining triggers: account deletion
    (the whole account goes) and a founder retiring a library exercise (a content migration).
  - **Creating a custom from inside the logger's picker** — valuable mid-workout; needs the form in
    the logger (plan, Out of scope). Today: Library → New exercise, then back to the logger.
  - **Muscle-map shading for customs** — a single `primary_muscle` is not an intensity table;
    customs contribute nothing to the map. A later LIB step can grow the authoring.
  - **Undelete / permanent purge**; **hiding a deleted custom's PRs** from the profile's PR list
    (they are real lifts and still show) — product calls for later.
  - **Library tab still reads the catalog from the bundle**, not `astra.db` (unchanged gap); only
    the "Your exercises" section reads the device table.
  - **Device check (Tristen):** airplane mode → Library → New exercise (name + chips) → it appears
    under "Your exercises" and in the logger's picker → log it → its card shows the session and PR →
    Edit the name → Delete → gone from Library and picker, past sessions still name it → reconnect →
    the row in Supabase with `deleted_at` set. Also: the section's height at phone width above the
    catalog count; the form's chip rows wrapping at phone width.
  - Mermaid render of the updated diagrams by the builder — see the B31 plan's Deviations; Gate 2
    should render them once if the builder could not.
- **B32 export-and-delete-account:**
  - **Live HTTP probe of both functions** (the plan's Gate 2 probe): the builder deployed
    `export-data` (v1) and `delete-account` (v2), both `verify_jwt` on, and proved the cascade in
    a rolled-back SQL transaction (two throwaway users, a row in every user-owned table → all 0
    after `delete from auth.users`, the other user kept), but outbound `curl` was declined by the
    permission layer. Gate 2: throwaway user by SQL insert (`email_confirmed_at = now()`,
    `encrypted_password = crypt(…, gen_salt('bf'))`), password grant for a JWT, seed rows + one
    object per bucket, call `export-data` (diff counts vs SQL) then `delete-account` (400 without
    confirm, 200 with), then counts + bucket listings → 0.
  - **The shared edge-function HTTP helpers** (`json`, `check`, Bearer strip + `getUser`) now exist
    in four `index.ts` files (analyze-workout, moderate, export-data, delete-account), plus the
    storage sweep in two. Extract to `functions/_shared/http.ts` in a step that redeploys all four.
  - **One shared "ok or message" result type** — `AuthResult`, `ExportResult`, `DeleteResult` are
    the same shape; merge when a fourth appears.
  - **The deleted user's other devices** keep their local mirror and 401 on every sync (plan risk
    5; the B07 account-switch class). Wiping on account switch stays deferred with B07's item.
  - **Exports of photo binaries, CSV, scheduled/emailed exports, a grace period before deletion**
    — out of scope by the plan; product calls.
  - **Device check (Tristen):** Settings → Export your data → share sheet opens with
    `astra-export-<date>.json`; save to Files and open it (workouts with sets nested, PRs present);
    airplane mode → Export shows "needs a connection". Delete account (on a throwaway account!):
    button locked until DELETE typed; airplane mode → "needs a connection", nothing changes;
    online → lands on sign-in; signing in again with the same email fails; reopening the app shows
    a fresh, empty device database.
  - Mermaid render of `app-flow.md` was not run by the builder (`mmdc` needed approval) — Gate 2
    should render it once.
- **B34 program-builder:**
  - **`export-data` does not export programs yet** (plan, Out of scope). B32's function predates the
    four program tables (`OwnedTable` in `functions/export-data/handler.ts`). Add `programs` →
    weeks → workouts → exercises (incl. soft-deleted rows, like customs) in the step that redeploys
    the functions with the `_shared/http.ts` extraction above. Account deletion is already complete
    (`programs.user_id` cascades from `profiles`).
  - **Program description, week labels ("Deload"), copy / duplicate a week, drag-to-reorder,
    undelete** — product calls for later (plan, Out of scope). Moves are one step at a time.
  - **Program workout reorder and week reorder** — only exercise slots move; weeks and workouts
    keep their add order (no PRD line asks for more yet).
  - **B39 must keep program children author-only readable** or change the phone's download shape
    (plan risk 1; warning in the migration header and the ERD).
  - **Device check (Tristen):** airplane mode → Workout → Your programs → New program → Add week ×2
    → Add workout → open it → Add exercise (a library one and a custom) → set sets / reps / weight /
    RPE → Save targets → kill the app → reopen: the program, weeks, workouts and targets are intact;
    reconnect → rows in Supabase (`programs`, `program_weeks`, `program_workouts`,
    `program_exercises`); judge the editor at phone width (four target boxes in a row, the action
    buttons wrapping, the week cards).
  - Mermaid render of both diagrams was not run by the builder (`mmdc` needed approval) — Gate 2
    should render them once.
- **B35 run-program:**
  - **`export-data` exports neither programs nor `program_runs`** — the B34 item above widens to
    include `program_runs` (and `workouts.program_workout_id` already rides the `'*'` select).
    Deletion is complete (`program_runs.user_id` cascades from `profiles`).
  - **Tied positions are ambiguous.** Two weeks (or two workouts in one week) sharing a `position`
    — only possible when two offline phones each appended one — can't be told apart by the run's
    stored positions; the first in `(position, id)` order wins, so the second of a tie can be
    skipped. Fix if it ever shows: renumber ties on read in `programs.ts`, or move the pointer to
    a (position, id) pair.
  - **A completion flourish** ("Program complete" card / analysis line) when a run ends (plan §d).
  - **Seeding the logger's entry boxes with target numbers** — an `EntryCard` prop fed from the
    same slot data (plan §e); today targets live in the entry note only.
  - **Run history UI** — ended `program_runs` rows accumulate; nothing renders them.
  - **"Week 2 · Day 1" in history / feed / analysis** beyond the workout title — the
    `workouts.program_workout_id` column exists for a later reader.
  - **A run whose program another phone deleted stays "active" on the server** (reads ignore it;
    the next start or stop on any phone ends it). Harmless; recorded in the plan.
  - **Shared paged-table union** — `pullStandalone`, `supabaseTransport.page` and
    `fakeTransport.page` each spell the table union; one `PagedTable` alias in `dao.ts` would make
    the next table one edit (review smell, left as-is to keep the diff narrow).
  - **Device check (Tristen):** build a 2-week program on the phone; airplane mode → Workout →
    Start from a program → pick it → Start next session: "Week 1 · Day A" with each exercise's
    "Target: …" note → log a set → Finish → the tab offers Day B; start the next session, kill the
    app mid-session, reopen → Resume shows it intact; reconnect → the run row and the linked
    workouts (`program_workout_id`) in Supabase; Stop program; run a program to its last session
    → finishing it ends the run (tab shows the two start buttons). Judge the run card at phone width.
  - Mermaid render of both diagrams was not run by the builder (`mmdc` needed approval) — Gate 2
    should render them once.
- **B36 teams:**
  - **Blocks and open teams (product call for Tristen).** Joining an open team and reading an open
    team's roster ignore blocks (only inviting checks `blocked_either`), so a lifter you blocked
    can join your open team and see its roster — never your posts, which posts RLS still hides.
    Adding a block arm to the join policy is one line if wanted.
  - **Ownership transfer / team deletion / removing members** — B38's family; today a creator's
    account deletion cascades the team away (members silently lose it).
  - **Member counts** on directory rows and on invite-only teams you aren't in — needs a definer
    view à la `follow_counts`; on evidence.
  - **Big rosters:** the Team feed puts every member id in one `in.(…)` filter (plan risk 3);
    revisit with a view if a team reaches hundreds of members.
  - **Stale chips after a failed re-read:** Home keeps its last "Your teams" row and the team page
    its last state when a background re-read fails (the "keep what's on screen" pattern) — a leave
    that succeeded but whose reload failed can briefly still show the member view.
  - **Small screen-local repetition** across Communities / team page / invite screen (`act()`,
    `back()`, the debounced search effect) — review smell, left as-is.
  - **Device check (Tristen):** two accounts. A: Communities → Create a team → page shows "Open",
    owner switch, no Leave. B: Find teams → Join → Home shows the team chip → its page lists both
    and B's posts in the Team feed; B Leaves. A switches to Invite only; B's page shows the closed
    line, no Join. A → Invite lifters → invite B; B sees "1 team invite" on Home and the invite on
    Communities → Join → in. B's profile shows the Teams section (from A's phone too). Judge the
    chip row and the team page at phone width; airplane mode → the connection message.
  - Mermaid render of both diagrams was not run by the builder (`mmdc` declined by the permission
    layer) — Gate 2 should render them once.
- **B37 team-coaching:**
  - **Coach-custom exercises don't copy** (plan G9): a pushed / assigned program slot naming the
    coach's own custom exercise arrives with no exercise ("Deleted exercise") in the member's copy,
    and is skipped when a pushed workout starts. The Start / Save confirmation states the count;
    starting a pushed workout does not (the logger opens straight away). Copying custom rows is its
    own feature.
  - **Duplicate copies after a kill** (plan risk 3): a kill between copy and run start, or a failed
    assignment delete, leaves a saved program plus the standing assignment; Start again makes a
    second copy. Tolerated by design; dedupe state rejected as speculative.
  - **Coach's corner shows the newest 20 pushes**, no paging (plan G15).
  - **Owner moderation of pushes**, removing members — B38. **Push notifications** — B47.
    **Program visibility / shared reads** — B39 (the payload RPCs are team-scoped stopgaps).
  - **Coach access ignores mutes** (a coach who muted a member still reads their log) — a product
    nuance of "coaching implies log access"; one clause in `private.coach_reads_logs` if unwanted.
  - **`private.program_workout_json` keeps the default EXECUTE grant** (no gate of its own). Safe
    while the `private` schema stays unexposed through the API (the repo's standing assumption for
    every `private.*` helper); revoke it in a later migration if that ever changes.
  - **A revoke or dismiss that deletes nothing reports success** (`removeAssignment` doesn't ask
    for the removed row back) — harmless: the row is gone either way, the page re-reads.
  - **Review smells left as-is:** the target-fields reshaping (camelCase payload slot →
    `target_*`) in three places; the payload cache keyed by string with casts; `useTeamCoaching`
    holding loading, actions and modals together; payload types living in `social/` while
    `programs/copyProgram.ts` and `workout/startPushedWorkout.ts` import them.
  - **Device check (Tristen):** two accounts, A owns a team, B is a member. A: Make coach on B
    (badge flips; Remove coach undoes). A: Announce → text appears in Coach's corner on both
    phones. A: Push a program (one already synced) → B taps the card → weeks / targets → Save to
    my programs → Workout → Your programs lists it. A: Push a workout → B → Start this workout →
    logger prefilled with "Target:" notes. A: Assign a program on B → B sees "Your coach assigned
    …" → View → Start program → Workout tab shows the run with Day 1 next. B logs a **private**
    workout; A opens B's profile → History shows it → tap → full session with sets. B blocks A (or
    leaves) → A's History of B no longer shows it. Push a just-made program in airplane-then-online
    → the "wait for it to sync" line. Judge the team page at phone width.
  - Mermaid render of both diagrams was not run by the builder (`mmdc` declined by the permission
    layer) — Gate 2 should render them once.
- **B38 team-moderation** (built, awaiting Gate 2):
  - **Re-shares of a hidden post** still show in the Team feed — a re-share is its own post; the
    owner hides it separately. Following hides through `shared_post_id` waits for evidence.
  - **Removal is not a ban** (plan G6): a removed member of an open team can rejoin at once; the
    keep-out tool is Invite only. A ban list waits for evidence.
  - **No hide reasons, moderation log, hidden-posts screen or notice to the hidden author** — on
    evidence / B47.
  - **Client-side hide filter can leave a page short or empty** for non-owners when many posts on a
    page are hidden (the next page still loads on scroll); a hides read is unbounded (plan G5).
  - **Device check (Tristen):** two accounts, A owns an open team, B is a member with a post. A:
    Hide from Team feed under B's post → marker with Unhide on A's phone; on B's phone the post is
    gone from the Team feed but still on Home / B's profile. Unhide → back. A: Remove from team on
    B → confirm → B gone from the roster; B's phone: team page shows Join team. A: switch to Invite
    only, B can't rejoin. A: Remove on a coach's push. A: Delete team → confirm → Communities; B's
    Home chip for the team is gone. Judge the marker / Hide button layout at phone width.
- **B39 program-visibility** (built, awaiting Gate 2):
  - **Live HTTP pass with throwaway JWTs** (the step DoD's "through the API") is Gate 2's: the
    builder ran the rolled-back SQL claims probe (every level positive and negative, mirror
    safety, B37 regression — recorded in the ERD) but not the HTTP pass, the no-token 401 on
    `/rest/v1/rpc/program_payload`, or the PostgREST embed case (`programs?select=*,program_weeks(*)`
    as a non-author → empty children).
  - **No reader-facing screen** for someone else's shared program and no client wrapper for
    `program_payload` — B40 (Marketplace) is the first consumer.
  - **Shares stand when the author leaves a team** (plan's product call); the app shows "Still
    shared with N teams you left" with Stop sharing. Automatic cleanup waits for evidence.
  - **`program_team_shares` read lets team members see which program ids are shared with their
    team even while the program is no longer `team`** (dormant shares). Ids only — row and payload
    stay hidden. Narrow the read to `visibility = 'team'` if it ever matters.
  - **`owns_program` ignores `deleted_at`**, so an author can share a soft-deleted program; inert
    (non-authors never see deleted programs).
  - **Block filtering of `published` programs** — a B40 client-side option if wanted.
  - **`export-data`** still exports no program tables (standing item; `visibility` rides `'*'`
    selects when it lands).
  - **Review smells left as-is:** Postgres error-code helpers (`codeOf`, `RLS_REFUSED`,
    `TeamResult`) imported from `social/teams.ts` (the `teamCoaching.ts` precedent); the four levels
    spelled in the SQL enum, the TS type and the order list; the device column has no CHECK (the
    `setProgramVisibility` guard and the server enum are the walls).
  - **Device check (Tristen):** a program page → Who can see this → each chip in airplane mode,
    kill + reopen → still chosen; reconnect → `programs.visibility` in Supabase. Team (online) →
    tick a team → a `program_team_shares` row; a second account in that team calls
    `program_payload` (or, after B40, opens it on device). Leave the team → "Still shared with 1
    team you left" → Stop sharing. Judge the section at phone width.
  - Mermaid render of both diagrams was not run by the builder (`mmdc` declined by the permission
    layer) — Gate 2 should render them once.
- **B40 marketplace-browse** (built, awaiting Gate 2):
  - **Live HTTP pass with a throwaway JWT** is Gate 2's (the builder ran the rolled-back SQL
    claims probe only): `programs?select=…&visibility=eq.published&search=wfts(simple).<word>`
    returns A's published program for B and not A's private one; no token → refused.
  - **`programs.description`** (D1) — not added; lands with the first step that displays one
    (B41 cards), one migration swapping the generated `search` expression to include it.
  - **Search is whole-word only** (no prefix / typeahead: "start" misses "Starting Strength"), no
    `ts_rank` relevance order (newest first), no author-name search (G2) — on device evidence.
  - **Grow-the-limit paging** (30 at a time) — keyset paging when the shelf grows (feed shape).
  - **Browse cards show name + author only** (D2) — counts/size on cards need a definer list
    surface (child tables are author-only); B41 redesigns cards.
  - **Blocked authors' published programs are not filtered** (B39's recorded option, still open).
  - **The program page serves any program RLS shows** (G8): a deep link to a team-shared or
    followers program opens it with Save and Start; nothing links there yet.
  - **No confirm dialog before Save and Start replaces a running program** — the page shows
    "This will replace your current program" instead (G7, parity with the team accept flow).
  - **Device check (Tristen):** account A publishes a program → account B: Marketplace lists it →
    search a word of its name → tap → author / weeks / days + full breakdown → Save and Start →
    Workout tab shows the run → Start next session = A's Day 1 with targets; airplane mode →
    Marketplace shows the connection message; B's copy survives kill + reopen and syncs up.
    Judge the cards, the page and the button block at phone width.
  - `mmdc` render of both diagrams not run by the builder — Gate 2.
