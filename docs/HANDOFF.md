# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — two sessions landed: Supabase schema + launch library)

**New standing rule (committed on `launch-library-seed` after the library work): living diagrams.**
`docs/diagrams/database-erd.md` (full ERD, enums, triggers, RLS table, cascade rules) and
`docs/diagrams/app-flow.md` (every screen, user action and data path, scaffolding marked) must be
updated in the same commit as any migration, screen, module or data-path change — see the
"Living diagrams" section in `CLAUDE.md`. Both are seeded from today's code and render cleanly
with the Mermaid CLI (`mmdc`, installed globally on this machine; GitHub renders the fenced blocks
without it).

Two sessions ran concurrently in this working tree today and both finished. Branch stack (merge
in this order): `ui-foundation` → `supabase-schema` → `launch-library-seed`. The FND-2 session
committed while HEAD was on `launch-library-seed`, so that branch deliberately contains the
schema commits plus the library import on top — each branch reviews cleanly as a diff against
its parent. Avoid concurrent sessions in one working tree (or use git worktrees).

**FND-2 is underway (branch `supabase-schema`, plan `docs/feature_plans/supabase-schema.md`).**
Supabase project `qczhvuzdxpmfztxrifyg.supabase.co` is live; three commented migrations
(identity + RLS, training tables with client-generated UUID PKs for offline sync, FK delete fix)
are applied remotely with CLI-compatible history; a 30/30 RLS probe with throwaway users verified
visibility, blocking, ownership and deletion-cascade behavior (probe users cleaned up). The
Supabase MCP server loads its token from the gitignored root `.env`
(`automation/scripts/supabase-mcp.mjs`); MCP tools appear after a Claude Code restart.

**The founder's exercise library is imported (LIB-7, branch `launch-library-seed`, plan
`docs/feature_plans/launch-library-seed.md`, grilled + code-reviewed).** Max Method's library —
22 movement patterns, **151 unique exercises**, equipment, muscle intensities, the founder's
5-step coaching cues and tips, squat-family aliases — now lives in `frontend/src/library/`:

- `exercises.ts` — seed data, generated mechanically from Max Method's `config/exercises.js`
  (brand colors → theme-independent intensities 0–1, `<strong>` → `**markers**`, legacy duplicate
  keys dropped in favor of the alias map). Single home: the `exercises` table FND-2 created
  should be seeded FROM this module — never hand-copied.
- `catalog.ts` — deduplicated per-exercise catalog (`ExerciseDef`), `canonicalExerciseName`,
  alias-aware `searchExercises`.
- The Library tab renders the catalog: cards, live name search, four body-region chips, result
  count, no-results state. LIB-1 → In progress; LIB-7 → Built (videos wait on LIB-2's service
  choice). Deliberately not imported (see DEFERRED): cardio-selector metadata, Mux video aliases,
  strength-classification tables (LIB-6, licence-blocked), user PRs/history, AI selector tools.

Verified this session: `tsc` clean, 47/47 Jest, `expo lint` clean. Not verified: on-device run.
Test gotcha: RNTL 14 — `await` every `fireEvent` call or state updates silently don't flush.

**Process note (both sessions):** `mattpocock-skills:grilling` / `mattpocock-skills:code-review`
weren't installed when these sessions ran; grilling was done as a self-pass and review via the
built-in `code-review` skill (8 findings on the library work, all fixed). **Now resolved:** the
`mattpocock-skills` plugin (v1.3.1, official marketplace, user scope) was installed at Tristen's
request after the library session — future sessions get both skills and should use them per the
CLAUDE.md workflow.

**For Tristen:** (1) review + merge the three-branch stack in order, run the app on a device
(flips FND-1/FND-4 to Done — and eyeball the new Library tab while there); (2) set
`SUPABASE_ACCESS_TOKEN` in `.env` if not done; (3) still open: copy
`automation/claude-settings.example.json` → `.claude/settings.json`.

Next build items: FND-2 part 2 (auth screens + supabase-js), FND-3 (SQLite + sync, seeding the
exercises table from `frontend/src/library/exercises.ts`), or LOG-1/LOG-2 — the logger can now
pull exercises from the catalog.
