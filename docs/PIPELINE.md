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
n8n trigger        (either the manual trigger in the n8n UI, or
                      `curl -X POST http://localhost:5678/webhook/astra-build-pipeline` — the
                      board carries a Webhook trigger so a shell or Claude session can start a
                      run; the board must be Active for the webhook URL to exist)
  → next-step        (automation/scripts/pipeline.mjs next: lints the build list, then picks the
                      first `Not started` Build-order step whose dependencies are all Built/Done,
                      skipping Blocked steps; refuses on lint errors, a step In progress, a dirty
                      working tree, a branch other than main, or a branch that already exists)
  → planner run      (claude -p, model claude-fable-5 — branches, explores, plans, grills,
                      commits docs/feature_plans/<branch>.md on the branch)
  → GATE 1           (n8n Wait node pauses; Tristen reads the plan file, then opens the
                      execution's resume URL to approve — or cancels the execution to reject.
                      The resume URL is http://localhost:5678/webhook-waiting/<execution id> and
                      takes a GET: open it in a browser or `curl.exe <url>`; a POST gets a 404
                      "no waiting webhook with a matching path/method")
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
| n8n | global npm package (`npm i -g n8n`), data in `~/.n8n` | Start with `NODES_EXCLUDE=[]` in the environment (PowerShell: `$env:NODES_EXCLUDE='[]'; n8n start`) — n8n 2.x disables the Execute Command node by default and the board is built on it; without this the board imports but never runs. UI at http://localhost:5678 |
| The board | `automation/n8n/astra-build-pipeline.json` | Import: `n8n import:workflow --input=automation/n8n/astra-build-pipeline.json`. To update an already-imported board while n8n runs: `PUT /api/v1/workflows/<id>` with `{name, nodes, connections, settings}` from the JSON (header `X-N8N-API-KEY` from `.env`), then `POST /api/v1/workflows/<id>/activate`. Live board id on Tristen's machine: `gvu4dg0NPtND4tGG` |
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
- The `claude` on n8n's PATH must be new enough for both models. Claude Code refuses a model it
  predates ("Claude Code 2.1.220 does not support this model; version 2.1.280 or newer is
  required") and exits non-zero within seconds, which the n8n node reports only as "Command
  failed". The first B05 builder died this way; `claude update` fixed it (2.1.325). Check
  `claude --version` after any long gap between runs.
- Headless runs can use only what `.claude/settings.json` allows. The Supabase MCP tools are not
  in the allowlist, so a builder cannot apply its own migration or read the project's auth config;
  it commits the migration file and leaves the live apply + probe to Gate 2 (B05 did exactly
  this). Widening the allowlist to `mcp__supabase` is Tristen's decision, not the agent's.

## Failure handling (v1)

- The builder n8n node retries once (`retryOnFail`). A second failure stops the execution with the
  run's JSON attached; nothing is rolled back — the branch holds whatever state the run reached, and
  Tristen (or an interactive session) takes it from there.
- **Resuming a failed builder without re-running the planner:** fix the cause, then retry the
  execution from its failed node — in the n8n UI (execution → Retry → "with original workflow"),
  or over the API: `POST /api/v1/executions/<id>/retry` with body `{"loadWorkflow":false}` and
  the `X-N8N-API-KEY` header. The call blocks until the retried execution finishes (a client
  timeout is harmless); the new execution carries `retryOf: <id>` and continues through Summary.
  This is the recovery path — re-firing the trigger would not work, because `next` refuses while
  the step's branch exists. The public API's *list* endpoint returns no executions for this key;
  fetch by id (`GET /api/v1/executions/<id>?includeData=true`) instead.
- A planner that ends in error stops the execution before Gate 1; the branch (if created) is simply
  deleted or re-run. While that branch exists, `next` refuses to pick the same step again.
- A step that is `Blocked` in the Build order (waits on a decision only Tristen can make) is
  skipped, as is any step whose dependencies include it; unblocking = Tristen editing the Status
  cell to `Not started` once the decision is made.
- The builder never hands over failing tests (CLAUDE.md Testing rules); if it cannot get green, it
  must say so in its final report rather than committing broken work.
- **Cold-start quirk (n8n 2.x on Windows):** the internal JS task runner that executes Code nodes
  can take longer than the broker's 15-second grant-token window to spawn, after which it loops on
  `Task runner connection attempt failed with status code 403` in the n8n log until n8n's
  heartbeat check restarts it (a few minutes). Until the log shows `Registered runner "JS Task
  Runner"`, every Code node fails with `Task request timed out after 60 seconds`. Wait for that
  line before triggering a run; if an execution died this way, just re-trigger.

## Operator setup (one-time, Tristen)

1. Copy `automation/claude-settings.example.json` to `.claude/settings.json` (grants the n8n MCP
   tools and lets headless runs use git/node/npm without stalling).
2. `$env:NODES_EXCLUDE='[]'; n8n start` (see the n8n row above for why), open http://localhost:5678,
   create the owner account. To keep n8n alive after the terminal closes, start it detached:
   `Start-Process n8n.cmd -ArgumentList start -WindowStyle Hidden` with that env var set.
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
