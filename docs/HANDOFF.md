# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — first full pipeline run, B05)

**The n8n pipeline completed its first step end to end.** B05 auth-and-signup was planned by
Fable (7 min, 33 turns, about $5.32), approved at Gate 1, and built by Opus (30 min, 195 turns,
about $6.78). The build is commit `6ddf543 Build B05: auth and signup` on branch
`auth-and-signup`, pushed to origin, **not merged** — it waits at Gate 2. `main` holds only
pipeline tooling and docs since the last merge; no BUILD_LIST status changed.

This branch also carries a merge of `main` (so Gate 2's `git merge --no-ff auth-and-signup` is
conflict-free). The app diff is exactly the builder's commit.

**What the build contains** (deviations are recorded under "Build deviations" in
`docs/feature_plans/auth-and-signup.md`): supabase-js client with an AsyncStorage-persisted
session (`frontend/src/lib/supabase.ts`); `AuthProvider` / `useAuth` with offline-safe restore,
sign in, sign up, local-scope sign out; an 18+ gate (`frontend/src/auth/age.ts`) matching the
Postgres cutoff including Feb 29; `(auth)` sign-in / sign-up screens behind `Stack.Protected`
with a root error boundary so a missing env var can never strand the splash; a Sign out button on
You; migration `backend/supabase/migrations/20261114130000_signup_birthdate_gate.sql` making the
signup trigger refuse missing or under-18 birthdates and stamp `user_body_data.birthdate`; both
living diagrams updated.

**Verified independently after the builder finished** (in `frontend/`): `npx jest` 15 suites /
126 tests pass, `npm run lint` clean, `npx tsc --noEmit` clean. Two-axis code review ran inside
the builder; its fixes are listed in the plan file.

**Not verified:** the migration has never run against Postgres (the builder could not use the
Supabase MCP — not in the headless allowlist); nothing ran on a device; the project's auth
settings (email confirmation, password minimum) are unread; `frontend/.env` does not exist.

**Gate 2 — what Tristen does now:**

1. **Review the branch** (`git diff main..auth-and-signup`, or the GitHub compare link).
2. **Apply the migration live** (Supabase MCP `apply_migration` with the file's contents, or the
   SQL editor), then **probe it**: a raw `signUp` with `options.data.birthdate` under 18 must fail
   and leave no `auth.users` row; an 18+ signup must create `profiles`, `user_settings` and
   `user_body_data` with the birthdate set.
3. **Create `frontend/.env`** from `frontend/.env.example` (project URL + publishable key).
4. **Auth settings:** confirmation off per the plan; if the password minimum isn't 6, change
   `frontend/src/auth/password.ts`.
5. **Device check** (`cd frontend && npx expo start`): sign up under 18 → refused; sign up 18+;
   kill the app; reopen still signed in; sign out; sign in. This also covers FND-1 / FND-4's
   pending device run.
6. **Merge** `auth-and-signup` with `--no-ff`; in `docs/BUILD_LIST.md` flip B05 to Built and
   update FND-2 / NFR-8 as their definitions of done become true.
7. **Start B06 training-math:** `curl.exe -X POST http://localhost:5678/webhook/astra-build-pipeline`
   (confirm first with `node automation/scripts/pipeline.mjs next --dry-run`). Gate 1 approval is a
   GET on `http://localhost:5678/webhook-waiting/<execution id>`.

**Pipeline operations, learned this session** (all in `docs/PIPELINE.md`): n8n must start with
`NODES_EXCLUDE=[]` or its Execute Command nodes are disabled; it is running detached now and must
be restarted the same way after a reboot. The board (`gvu4dg0NPtND4tGG`) is Active with a POST
webhook trigger beside the manual one. The `claude` CLI on PATH must support both models — it was
2.1.220 and refused Opus 5.5, killing the first builder attempt; `claude update` → 2.1.325 fixed
it, and the execution was resumed from the failed node with the API retry (execution 5, retryOf 4).
The public API's list endpoint hides executions for this key; fetch by id. The n8n-mcp SSRF fix
(`WEBHOOK_SECURITY_MODE=moderate`) is committed and takes effect on the next Claude Code start.

**Decisions queued in `docs/DEFERRED.md`:** whether headless builders may use the Supabase MCP and
`mmdc`; B05 follow-ups (B02 RLS probe re-run with birthdate, auth-config read, password reset step,
kv-store session swap at B07); the six external blockers.

Next pipeline step after B05 merges: **B06 training-math**.
