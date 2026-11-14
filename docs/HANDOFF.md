# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05 merged, pipeline continuing)

**B05 auth-and-signup is merged to `main`** (Gate 2 done by the session at Tristen's "keep
building" instruction) and the pipeline is moving on to **B06 training-math**. The build list
shows B05 Built, FND-2 Built, NFR-8 Built; all three still need Tristen's device run to become Done.

**Gate 2 record for B05:**

- Migration `20261114130000_signup_birthdate_gate.sql` applied to the live project via the
  Supabase MCP (six migrations now).
- Live probe: under-18, missing and malformed birthdates refused through the real `signUp` API
  with no `auth.users` row left behind. Supabase's email validation rejects undeliverable test
  domains, so the 18+ path was exercised by inserting a synthetic row into `auth.users`: profile,
  settings and body-data rows were created with the birthdate stamped; the check constraint then
  refused an under-18 edit; the probe user was deleted and all four tables confirmed clean.
- `frontend/.env` created (gitignored) with the project URL and publishable key.
- Auth config read via the Management API: password minimum 6 (matches
  `frontend/src/auth/password.ts`). **Email confirmation is still ON** — the approved plan says
  off for launch, but the session's toggle was declined by the permission classifier.
  **Tristen:** Dashboard → Authentication → Providers → Email → turn "Confirm email" off, or
  decide it stays on (the code handles both; the device check then includes the email hop).
- Independent re-run after the builder: Jest 15 suites / 126 tests, lint, `tsc --noEmit` all clean.
- Not done: the device check (sign up under 18 → refused; sign up 18+; kill app; reopen still
  signed in; sign out; sign in) — flips B05 / FND-2 / NFR-8 to Done and covers FND-1 / FND-4.

**Pipeline changes this session (all on `main`, see `docs/PIPELINE.md`):** n8n starts with
`NODES_EXCLUDE=[]` (Execute Command is disabled by default in 2.x) and runs detached; the board
(`gvu4dg0NPtND4tGG`) is Active with a POST webhook trigger; the `claude` CLI was updated to 2.1.325
(2.1.220 refused Opus 5.5 and killed the first builder attempt, recovered with the execution
retry); `mcp__supabase` is now in the headless allowlist so builders apply their own migrations;
the n8n-mcp SSRF fix (`WEBHOOK_SECURITY_MODE=moderate`) is committed and takes effect at the next
Claude Code start. Gate 1 approval is a GET on `http://localhost:5678/webhook-waiting/<exec id>`;
the public API lists no executions for this key, fetch by id.

**B06 training-math** — the ONE shared math module (e1RM Epley, PR detection, plate math, strength
grades). The planner must choose a home importable from both `frontend/` and
`backend/supabase/functions/`; a mirrored copy is a bug. Its plan lands at
`docs/feature_plans/training-math.md` and waits at Gate 1 for Tristen's approval (or the next
session's, if Tristen delegates it).

**Still Tristen's:** device runs (above); email-confirmation toggle; the six external blockers;
whether to grant `mmdc` to headless runs (DEFERRED).

Next pipeline step after B06 merges: **B07 local-store-and-sync** (move `uuidv5` out of
`automation/scripts/generate-library-seed.ts`, never copy it).
