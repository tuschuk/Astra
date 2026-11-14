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
- Library DB seed follow-ups (`library-db-seed`): when the logger needs to compute library
  exercise ids on-device, MOVE `uuidv5` from `automation/scripts/generate-library-seed.ts` into
  `frontend/src/library/` beside `LIBRARY_EXERCISE_NAMESPACE` (RN has no `node:crypto`, so that
  means expo-crypto digest or a small pure-TS SHA-1, Jest-tested with the RFC 4122 vector) and
  make the generator import it — a second implementation left in place would be a mirrored copy.
  Renaming/retiring a library exercise is a deliberate content migration (new slug = new id;
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
  - At B07, consider swapping the session store from AsyncStorage to `expo-sqlite/kv-store` (a
    one-line adapter change) so the app has one storage engine.
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
- (External blockers from the PRD — Strength Level licence, food database, Denver gym data source,
  video provider, deload rules — are tracked in `docs/BUILD_LIST.md`.)
