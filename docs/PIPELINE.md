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
- Headless runs can use only what `.claude/settings.json` allows. The allowlist now includes
  `mcp__supabase` (added Nov 14, 2026 at Tristen's request, after the B05 builder could not apply
  its own migration and had to leave the live apply + probe to Gate 2), so a builder can apply
  migrations, probe them and read the project URL/keys. The Management API (auth config such as
  email confirmation) is not an MCP tool; a run that needs it reads it with the
  `SUPABASE_ACCESS_TOKEN` from `.env`. `mmdc` (diagram rendering) is still not allowed.
- Headless runs cannot make outbound HTTP (`curl` is declined), so live HTTP probes of edge
  functions belong to Gate 2. In the Gate 2 session the Bash sandbox also returns `000` for
  outbound `curl.exe`; use the PowerShell tool (`Invoke-WebRequest` / `Invoke-RestMethod`)
  instead — localhost calls to n8n work from either. A probe that needs a real user JWT while
  email confirmation is ON (B32's recipe): insert a throwaway row into `auth.users` by SQL with
  `email_confirmed_at = now()`, `encrypted_password = extensions.crypt(pw, extensions.gen_salt
  ('bf'))`, the token columns set to `''`, and `raw_user_meta_data` carrying `birthdate` (the
  18+ signup trigger refuses otherwise), plus a matching `auth.identities` row; then call
  `/auth/v1/token?grant_type=password` with the publishable key. Delete the user afterwards
  (or, as in B32, let the function under test delete it).
- A headless run can die after doing its work. The B42 builder (Nov 16, 2026) finished Code,
  Test, Review and Document, then exited non-zero about 13 minutes after its last file write,
  before committing; n8n recorded only "Command failed" because an Execute Command node keeps
  no stderr from a failed command. Both launchers now write stdout and stderr to
  `automation/state/{builder,planner}.out.log` / `.err.log` (gitignored), replay stdout for
  n8n and preserve the exit code, so the next failure can be read. (The B49 planner died
  after 256 s with an empty stderr log and no commit, leaving an empty branch; the model
  itself answered a smoke test seconds later, so it was a one-off crash. Recipe: `git branch
  -D` the empty branch from `main`, then `retry` the execution — a planner retry on a clean
  tree is safe.) Recovery recipe: confirm no `claude -p` process is still alive, run the check chain on
  the uncommitted tree, read the plan file's build notes for how far Review and Document got,
  fill whatever is missing (DEFERRED entries, diagrams), commit the work on the step's branch
  as the build commit, and continue Gate 2 as usual. Do not `retry` the execution on a dirty
  tree — the builder prompt assumes a clean branch.

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
- **Other worktrees must not hold `main`.** A second checkout for a stable dev server (e.g.
  `C:\Users\trist\Astra\Astra-main`, used for the phone's Expo Go session) must stay on a
  *detached* HEAD (`git checkout --detach main`); git refuses to check out a branch that another
  worktree has, so a worktree on `main` makes the picker's and Gate 2's `git checkout main` in the
  pipeline repo fail. Update that worktree with `git checkout --detach main`, never `git pull` on
  the branch.
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
