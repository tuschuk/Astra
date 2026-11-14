# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — Supabase schema session)

**FND-2 is underway.** Tristen created the Supabase project
(`qczhvuzdxpmfztxrifyg.supabase.co`). Branch `supabase-schema` (based on `ui-foundation`, since
`main` predates the monorepo split; plan: `docs/feature_plans/supabase-schema.md`) holds:

- **Supabase MCP server** added to `.mcp.json` — it reads a personal access token from the
  `SUPABASE_ACCESS_TOKEN` environment variable, so no secret is committed. **Blocked on Tristen:**
  create a token (Supabase dashboard → Account → Access Tokens), set it user-level on Windows
  (`[Environment]::SetEnvironmentVariable('SUPABASE_ACCESS_TOKEN','<token>','User')`), then restart
  Claude Code — MCP servers only load at session start, so this session never had the tools.
- **`backend/supabase/`** stood up via `supabase init` (config.toml), plus the first two
  migrations, heavily commented:
  - `20261114100000_identity.sql` — profiles (public, auto-created by an `auth.users` signup
    trigger), `user_body_data` (sex/birthdate/bodyweight_kg — owner-only RLS, no public access at
    all), `user_settings` (kg/lb unit, default workout visibility), `blocks` (insert trigger
    severs follows both ways), `follows` (one-way; insert blocked when a block exists, via a
    `security definer` helper since plain RLS would hide the other side's block row).
  - `20261114100100_training.sql` — `exercises` (shared library rows have `owner_id null` +
    private customs), `workouts` / `workout_exercises` / `sets` with **client-generated UUID PKs**
    (offline-first: sync is an idempotent upsert, FND-3's schema half). Visibility
    (public/followers/private + block checks) lives in one place — `private.workout_visible` —
    and child tables delegate to it. Weights stored in kg only.
- `docs/BUILD_LIST.md`: FND-2 → In progress.

**Verified:** nothing executed — no Docker/psql on this machine and no access token, so the SQL
has only been desk-checked (a self-review caught and fixed three real bugs: policy referencing a
not-yet-created table, an RLS-blind block check, a signup-breaking display-name overflow).
**First task next session:** with the MCP connected, apply both migrations and probe RLS with two
test users (can A read B's private workout / body data?). Until that passes, treat the schema as
unproven.

**Process note:** `mattpocock-skills:grilling` and `mattpocock-skills:code-review` (CLAUDE.md
workflow steps 3 and 6) are not installed in this environment — both were done as careful
self-passes, flagged in the plan file. Install the skills if you want future sessions to use them.

**Heads-up:** while this session worked, uncommitted LIB-7 files appeared in the shared working
tree (`docs/feature_plans/launch-library-seed.md`, `frontend/src/library/*`, a `library.tsx`
edit) — apparently a concurrent session. They were deliberately left out of this session's commit;
that session should commit them on its own branch. Two sessions sharing one working tree is how
work gets tangled — avoid running them concurrently (or use git worktrees).

**For Tristen:** (1) set `SUPABASE_ACCESS_TOKEN` as above; (2) review + merge `ui-foundation`
first, then `supabase-schema` on top of it; (3) still open from earlier sessions: run the app on a
device (flips FND-1/FND-4 to Done), copy `automation/claude-settings.example.json` →
`.claude/settings.json`.

Next build items after migrations apply: FND-2 part 2 (auth screens + supabase-js in
`frontend/`), then FND-3 (SQLite + sync) or LOG-1/LOG-2 — the schema is shaped for them.
