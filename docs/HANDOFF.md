# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — autonomous pipeline session)

The repo still has no app code; every build-list item is `Not started`. This session built the
**autonomous build pipeline** (spec: `docs/PIPELINE.md`, plan:
`docs/feature_plans/autonomous-build-pipeline.md`): n8n orchestrates a headless Fable planner run
and an Opus builder run per build-list item, with Tristen approving at Gate 1 (plan) and Gate 2
(branch merge). CLAUDE.md gained an "Autonomous pipeline" section; its Git section now makes Claude
responsible for git work (changed by Tristen this session).

Built and verified:
- `automation/scripts/pipeline.mjs` — item picker / prompt filler; `check` self-tests all pass
- `automation/prompts/planner.md`, `builder.md`; `automation/scripts/run-planner.cmd`, `run-builder.cmd`
- `automation/n8n/astra-build-pipeline.json` — the board (7 nodes, connections validated)
- `.mcp.json` — `n8n-mcp` server; API key still a placeholder
- n8n community edition installed globally via npm (see below for import status)

Blocked on Tristen (the permission classifier correctly refused to let Claude do these):
1. Copy `automation/claude-settings.example.json` → `.claude/settings.json` (grants n8n MCP tools
   and git/node to headless runs).
2. Git: commit the spec baseline on main, create/commit the `autonomous-build-pipeline` branch
   (this session's git commands were denied; full file list is in the session report).
3. One-time n8n setup: `n8n start` → owner account → API key into `.mcp.json` → activate the board.

Next after that: trigger the board once on FND-1 with eyes on it.
