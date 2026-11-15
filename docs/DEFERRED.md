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
  - `npm run lint` (`expo lint`) does not reach `backend/supabase/functions/_shared/` (outside
    ESLint's base path). The B06 builder linted it by hand from the repo root —
    `node frontend/node_modules/eslint/bin/eslint.js -c frontend/eslint.config.js --rule
    "import/no-unresolved: off" backend/supabase/functions/_shared/training-math` — clean. The
    rule is off only because the import resolver can't see `frontend/node_modules` from there
    (`@jest/globals` in the tests). Wire a proper lint target for `_shared/` when B18 adds the
    first server function (it will need Deno-side linting anyway).
  - Deno-side verification (`deno check` / a real `supabase functions deploy` importing the
    module) lands with B18, the first server-function consumer.
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
  - **Title/notes setters** (LOG-3, B12) add their length limits to `@training-math`
    `limits.ts` (title ≤ 100, notes ≤ 2000 / entry notes ≤ 1000).
  - **`limits.ts` mirrors the migration by hand.** Any future migration that changes a `sets`
    CHECK or column type must update `limits.ts` in the same commit. No test spans the SQL and
    the TS.
  - **Device check for NFR-3:** force-kill the real app mid-workout and relaunch. This needs
    B09's screen. Until then the guarantee is proven in Jest on a file-backed database.
  - A failed snapshot re-read after a committed write reports an error although the write
    landed. Nothing is lost (the next read re-syncs). Revisit if it is ever seen in practice.
  - `mmdc` was not available to the headless builder, so the updated `app-flow.md` Mermaid was not
    render-checked.
- (External blockers from the PRD — Strength Level licence, food database, Denver gym data source,
  video provider, deload rules — are tracked in `docs/BUILD_LIST.md`.)
