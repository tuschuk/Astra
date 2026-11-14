# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — styling guide session)

New this session: `docs/styling_guide.md` — the full design system extracted from the Max Method
app (colors, three-font typography, background texture recipe, component recipes, a11y rules,
plus RN/Expo translation notes). It is the visual reference for all Astra UI work.

The spec baseline was committed on main (e63b0bd), so the git blocker from the pipeline session
is resolved. Still true from that session:

The repo still has no app code; every build-list item is `Not started`. That session built the
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

Blocked on Tristen:
1. Copy `automation/claude-settings.example.json` → `.claude/settings.json` (grants n8n MCP tools
   and git/node to headless runs).
2. One-time n8n setup: `n8n start` → owner account → API key into `.mcp.json` → activate the board
   (the n8n MCP server timed out this session — likely n8n isn't running).

Next after that: trigger the board once on FND-1 with eyes on it.
