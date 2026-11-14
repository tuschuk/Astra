# Astra autonomous build pipeline

How build-order steps get built with minimal hands-on time: n8n (community edition, running
locally) orchestrates two headless Claude Code runs per step, with Tristen approving at two gates.
A **step** is one row of the Build order table in `docs/BUILD_LIST.md`: one branch covering one or
more PRD features (or part of one), in dependency order. This file
is the spec; the short version lives in the root `CLAUDE.md` under "Autonomous pipeline".

Everything here is **local dev tooling on Tristen's machine** — it is not part of the Astra product
and is not covered by (nor a violation of) the app's "no self-operated infrastructure" rule.

## The flow

```
n8n manual trigger
  → next-step        (automation/scripts/pipeline.mjs next: lints the build list, then picks the
                      first `Not started` Build-order step whose dependencies are all Built/Done,
                      skipping Blocked steps; refuses on lint errors, a step In progress, a dirty
                      working tree, a branch other than main, or a branch that already exists)
  → planner run      (claude -p, model claude-fable-5 — branches, explores, plans, grills,
                      commits docs/feature_plans/<branch>.md on the branch)
  → GATE 1           (n8n Wait node pauses; Tristen reads the plan file, then opens the
                      execution's resume URL to approve — or cancels the execution to reject)
  → builder run      (claude -p, model claude-opus-5-5 — implements the plan file on the branch:
                      Code → Test → Review → Document → commit; retries once on failure)
  → summary          (branch name, builder report, cost of both runs)
  → GATE 2           (outside n8n: Tristen reviews the branch, merges to main, flips the step
                      to Built and each covered feature's Status in docs/BUILD_LIST.md)
```

One step per trigger. Nothing auto-advances to the next step: merging (Gate 2) is what makes the
tree clean again and the step `Built`, and `pipeline.mjs next` enforces both before the next run
can start. Preview the queue any time with `node automation/scripts/pipeline.mjs next --dry-run`
(no git checks, nothing written) and validate the list with `… pipeline.mjs lint`.

## The pieces

| Piece | Where | Notes |
|---|---|---|
| n8n | global npm package (`npm i -g n8n`), data in `~/.n8n` | Start with `n8n start`; UI at http://localhost:5678 |
| The board | `automation/n8n/astra-build-pipeline.json` | Import: `n8n import:workflow --input=automation/n8n/astra-build-pipeline.json` |
| Prompts | `automation/prompts/planner.md`, `builder.md` | `{{ITEM_JSON}}` placeholder is replaced by the wrapper scripts |
| Wrappers | `automation/scripts/run-planner.cmd`, `run-builder.cmd` | cd to the repo, inject the item into the prompt, call `claude -p` |
| Step picker | `automation/scripts/pipeline.mjs` | `next [--dry-run]` prints the step as JSON — `{id, feature, branch, phase, status, dependsOn, covers: [{id, feature, phase, status, dod, partial}], scope}`; `lint` validates the build list; `prompt <role>` fills a template; `check` runs its self-tests |
| n8n MCP server | `.mcp.json` → `automation/scripts/n8n-mcp.mjs` → `npx n8n-mcp`, API key from `.env` | Lets Claude sessions inspect/modify the board; all its tools are allowlisted once Tristen installs the settings file (next row) |
| Permissions | `automation/claude-settings.example.json` → copy to `.claude/settings.json` | Tristen installs this by hand — Claude is intentionally barred from granting itself permissions |

## Headless run contract

Both runs use:

```
claude -p <prompt> --output-format json --permission-mode acceptEdits
```

- `--output-format json` gives n8n a parseable result: `result`, `is_error`, `total_cost_usd`,
  `session_id`. The wrapper scripts pass this through on stdout.
- `--permission-mode acceptEdits`, **not** `--dangerously-skip-permissions`. If a headless run
  stalls on a permission prompt, the fix is a narrower allowlist entry in `.claude/settings.json`,
  never dropping the sandbox.
- The repo is the working directory; prompts instruct the run to follow `CLAUDE.md` (which both
  models load automatically as project instructions).
- A `session_id` from the planner is recorded in the summary so a failed builder can be diagnosed
  by resuming either session interactively (`claude --resume <id>`).

## Failure handling (v1)

- The builder n8n node retries once (`retryOnFail`). A second failure stops the execution with the
  run's JSON attached; nothing is rolled back — the branch holds whatever state the run reached, and
  Tristen (or an interactive session) takes it from there.
- A planner that ends in error stops the execution before Gate 1; the branch (if created) is simply
  deleted or re-run. While that branch exists, `next` refuses to pick the same step again.
- A step that is `Blocked` in the Build order (waits on a decision only Tristen can make) is
  skipped, as is any step whose dependencies include it; unblocking = Tristen editing the Status
  cell to `Not started` once the decision is made.
- The builder never hands over failing tests (CLAUDE.md Testing rules); if it cannot get green, it
  must say so in its final report rather than committing broken work.

## Operator setup (one-time, Tristen)

1. Copy `automation/claude-settings.example.json` to `.claude/settings.json` (grants the n8n MCP
   tools and lets headless runs use git/node/npm without stalling).
2. `n8n start`, open http://localhost:5678, create the owner account.
3. Settings → n8n API → create an API key; put it in the repo's `.env` as `N8N_API_KEY=<key>`
   (gitignored; `automation/scripts/n8n-mcp.mjs` loads it when Claude starts the MCP server).
   Until then the MCP server runs docs-only (node documentation works; live board management
   doesn't).
4. Import the board if not already imported (command in the table above), open it, and activate it.
5. Run it once on the next step (`pipeline.mjs next --dry-run` shows which) with eyes on it
   before trusting it further.

## Deliberately not in v1

- Cron / fully unattended triggering — earn it after a few clean runs.
- Parallel items or git worktrees — foundation items share too much surface.
- External notifications at gates (Telegram/email) — the n8n UI and resume URL suffice for now.
- Auto-updating `docs/BUILD_LIST.md` status — Tristen flips the step and its covered features at
  merge time (Gate 2).
