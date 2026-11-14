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
  - Apply `20261114130000_signup_birthdate_gate.sql` live, then run the live probe (under-18 raw
    `signUp` refused with no `auth.users` row left; 18+ signup creates profile, settings and body
    data with birthdate). The builder run couldn't reach the Supabase MCP.
  - Re-run the B02 RLS probe with `birthdate` in `user_metadata`, since the trigger now refuses
    users without one.
  - Read the project's auth config. If the password minimum isn't 6, update
    `frontend/src/auth/password.ts`. If email confirmation is on, decide whether it stays on (the
    code already handles both).
  - Password reset / "forgot password" flow deserves its own small step. Email change and the
    account-deletion UI land with the You/settings features (NFR-6).
  - At B07, consider swapping the session store from AsyncStorage to `expo-sqlite/kv-store` (a
    one-line adapter change) so the app has one storage engine.
- Autonomous pipeline v2 features, deliberately left out of v1 (see `docs/PIPELINE.md`): cron /
  unattended triggering, parallel items via git worktrees, external gate notifications
  (Telegram/email), auto-updating build-list status at merge (now cheap: at Gate 2 the step row's
  Status and each covered feature's Status could be flipped by `pipeline.mjs` from the merge
  commit). Earn each with a few clean v1 runs.
- n8n MCP server (`automation/scripts/n8n-mcp.mjs` → `npx n8n-mcp`) rejects `http://localhost:5678`
  with "SSRF protection: Localhost access is blocked in strict mode". Fix confirmed in n8n-mcp's
  source (`dist/utils/ssrf-protection.js`): it reads `WEBHOOK_SECURITY_MODE`; `moderate` allows
  loopback while still blocking cloud-metadata and LAN ranges (`127.0.0.1` is blocked too, so
  changing the URL alone does not help). **Tristen applies it** — add
  `WEBHOOK_SECURITY_MODE: 'moderate',` under `N8N_API_URL` in the launcher's env block (or
  `WEBHOOK_SECURITY_MODE=moderate` in `.env`) and restart Claude Code. The Nov 14 session's attempt
  to make that edit was declined by Claude Code's permission classifier (loosening a security
  mode), so it stays a human change. Until then, live-board work goes through n8n's REST API with
  the `.env` key (see `docs/PIPELINE.md`, "The board" row), which is what updated the board on
  Nov 14, 2026.
- Max Method data deliberately NOT imported with the launch library (`launch-library-seed`),
  re-import when a consumer exists:
  - Cardio-machine selector metadata (`MaxMethodBackendStructure/.../src/utils/cardioMachineMetadata.js`:
    skill floors, impact, HIIT/steady-state/warmup suitability, injury exclusions, main-lift fatigue
    map) — useful when programs or cardio selection land.
  - `VIDEO_NAME_ALIASES` (Mux video-name mapping in Max Method's `config/exercises.js`) — revisit
    when the video service is chosen (LIB-2).
- (External blockers from the PRD — Strength Level licence, food database, Denver gym data source,
  video provider, deload rules — are tracked in `docs/BUILD_LIST.md`.)
