# CLAUDE.md

Instructions for every Claude Code session in this repo. Follow them on every task, no exceptions.

## What Astra is

Astra is a social strength-training app — Strava for the barbell. A workout logger whose completed
sessions feed a feed, post-workout analysis, an exercise library, a program Marketplace, Teams, and
Gyms with video-verified PR leaderboards. The source of truth is `Astra-PRD.pdf`; the working specs are:

- `docs/PROJECT_OVERVIEW.md` — product, phases, decisions, open questions
- `docs/ARCHITECTURE.md` — the stack and how the pieces fit
- `docs/BUILD_LIST.md` — every feature, its status, and its definition of done. Update the Status
  column as features land; a feature is Done only when its definition of done is observably true.

## Rules

- **Stack is fixed:** React Native with Expo, TypeScript everywhere (no `any` by default). SQLite on
  device, synced to Supabase (Postgres + PostGIS, auth, storage, realtime, server functions). No other
  backend, no microservices, no self-operated infrastructure. Mobile only — no web app.
- **Monorepo layout:** the Expo app lives in `frontend/`, everything Supabase in `backend/`.
  Run app commands (`npm test`, `npx expo …`) from `frontend/`.
- **Offline-first:** logging and the Tool Kit must work with no signal and sync on reconnect. An
  in-progress workout survives the app dying.
- **No AI in the product:** post-workout analysis is deterministic scripted rules in server functions.
- **Training math has one home.** e1RM (Epley), PR detection, plate math, strength grades live in one
  shared module imported everywhere. A mirrored copy is a bug.
- **Privacy:** progress pics, body data and recovery data are sensitive — user-set visibility enforced
  with row-level security, never client-side only. Physique Check posts take upvotes only. 18+ only.
- **Add nothing speculative:** no Redis, no search service, no data pipeline until a measured problem
  calls for it (see `docs/ARCHITECTURE.md`).
- **Every numeric performance claim** in product copy cites a published source and is worded as an
  estimate.

## Workflow

Every task — every feature and every fix, no matter how small — follows this sequence:

1. **Explore** — read the relevant code, docs, and data model before touching anything. Understand
   what exists before adding.
2. **Plan** — outline the approach and confirm it fits `docs/ARCHITECTURE.md` and the Rules above. For
   non-trivial changes, share the plan with Tristen before writing code. Propose a short kebab-case
   name, save the plan as `docs/feature_plans/<name>.md`, and create the branch with that name.
   Update the plan file if the approach changes during implementation.
3. **Grill** — as soon as the plan file exists, invoke the `mattpocock-skills:grilling` skill on it.
   Attack the plan before any code is written: unexamined assumptions, hard rules it would violate,
   scope that should be a separate branch, cheaper alternatives. Revise the plan file in place (the
   grilled version is the plan of record) and note the decisions the grilling settled. Do not start
   coding until the plan has been through this.
4. **Code** — implement the change, following the Rules here and the folder's own `CLAUDE.md` where
   one exists.
5. **Test** — write unit tests for every function or feature where applicable (see Testing rules).
   All relevant tests and lint must pass before moving on.
6. **Review** — with tests green, invoke the `mattpocock-skills:code-review` skill on the changes,
   passing the plan file as the originating spec so the Spec axis has something to check against. Fix
   what the review finds, then re-run the affected tests. If a fix deliberately deviates from the plan,
   say so in the plan file rather than silently diverging. Report the review's findings to Tristen even
   when nothing needed fixing.
7. **Document** — add plain-language comments to every function and feature written (see
   Documentation rules) and bring both living diagrams up to date with the change (see Living
   diagrams). This runs last so comments and diagrams describe the code as it actually shipped,
   review fixes included.

Finish by committing the work with a clear, self-contained message and listing the files changed.

## Autonomous pipeline

Build-list items may be run by the n8n pipeline instead of a hand-driven session — full spec in
`docs/PIPELINE.md`. Two headless runs per item: a **planner** (`claude-fable-5`) does Explore → Plan
→ Grill and commits the plan file on a fresh branch named for the item; after Tristen approves the
plan (Gate 1 — the execution's resume URL), a **builder** (`claude-opus-5-5`) does Code → Test →
Review → Document on that branch and commits. Tristen reviews and merges the branch (Gate 2). The
plan file is the handoff between the two runs; nothing else is. One item runs at a time, and an item
never starts on a dirty working tree. `automation/` holds the pipeline's prompts, scripts and n8n
board — local dev tooling, exempt from the app-stack rules, which govern the product only.

## Every session

1. **Start:** read `docs/HANDOFF.md` and `docs/DEFERRED.md`.
2. **Work:** take the task through the Workflow above.
3. **Report:** tell Tristen what changed, what was verified, and what wasn't.
4. **End:** overwrite `docs/HANDOFF.md` with where things stand now (not an append-only log), and add
   anything postponed to `docs/DEFERRED.md`.

## Handoffs

Handoffs are written in the session that was asked for them — never as a standalone file. When asked
for a handoff, a summary for a new session, or a "take it from here" brief, output it as a paste-ready
text block in the current session. Do not create a `*_handoff.md`, do not write it into
`docs/feature_plans/`, and do not leave a scratch file behind. A handoff is stale the moment it is
committed; anything durable belongs in that feature's plan file. This does not replace "Every session"
step 4. The autonomous pipeline's planner→builder handoff is the plan file itself — not an exception
to this rule, since the plan file was already the artifact of record.

## Testing rules

- Write Jest unit tests whenever a function has testable logic (data transformations, training math,
  PR detection, query building, sync logic, API responses, business rules).
- App tests (Jest + React Native Testing Library) live alongside what they test:
  `frontend/src/components/Thing.tsx` → `frontend/src/components/Thing.test.tsx` (route files in
  `frontend/src/app/` are the exception — their tests live in `frontend/src/__tests__/`, since
  expo-router would register `*.test.tsx` as routes). Supabase server-function tests live in a
  `tests/` folder beside the functions (`backend/supabase/functions/tests/`).
- A test file mirrors the module it tests.
- Tests never touch the real Supabase project, real storage, or the real video service; use fakes and
  synthetic data.
- Do not write tests for trivial one-liners, but err on the side of more coverage rather than less.
- Tests and lint must pass before work is committed. Never commit a failing test.

## Documentation rules

- Every function, class, and server function has a comment or docstring a non-programmer can follow.
- Explain inputs, outputs, and *why* it exists — not just what the code does line by line. This
  matters most for training math, PR detection, and verification code.
- Components: a comment block at the top describing what it shows and what the user can do.
- Keep comments current — if behavior changes, update the comment.
- Handoffs are never written as files — see "Handoffs".

## Living diagrams

Two Mermaid diagrams are the whole-system picture, kept in `docs/diagrams/` and nowhere else:

- `docs/diagrams/database-erd.md` — the database: every table, column, key and relationship, plus
  the enums, triggers and row-level-security rules a reader needs to predict what a query returns.
- `docs/diagrams/app-flow.md` — how the app works: every screen, what the user can do on it, and
  the data path each action takes from device storage through sync to Supabase and back.

Every commit leaves both diagrams matching the code it ships. A migration lands in the ERD; a
screen, user action, module or data path lands in the flowchart; a change that touches neither
leaves both untouched. The diagrams draw what exists in code, never what is planned, and mark
scaffolding (placeholder screens, unwired services) as such. Done means someone who has never
opened this repo can read the two files and answer any "how does the database / app work"
question without reading code. Mermaid fenced blocks render on GitHub and in VS Code preview;
the Mermaid CLI (`mmdc`, installed globally) renders them to SVG or PNG when an image is needed.

## Git

Claude does all the git work: branching, staging, committing, and pushing. Commit at the end of every
completed task with a message that explains what changed and why. Create the feature branch named in
the Plan step before coding starts.

## Keep this file short

This file must stay under 200 lines. Put detail in `docs/` or a folder's `CLAUDE.md` and link to it.
