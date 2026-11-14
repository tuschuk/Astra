# automation/

Local dev tooling for the autonomous build pipeline — **not product code**. The spec and operator
guide live in [docs/PIPELINE.md](../docs/PIPELINE.md); the short rules are in the root
[CLAUDE.md](../CLAUDE.md) under "Autonomous pipeline".

- `n8n/astra-build-pipeline.json` — the n8n board. Import: `n8n import:workflow --input=automation/n8n/astra-build-pipeline.json`. Two entry points: the manual trigger (n8n UI) and a POST webhook at `/webhook/astra-build-pipeline` (board must be Active). n8n 2.x must be started with `NODES_EXCLUDE=[]` or its Execute Command nodes are disabled
- `prompts/` — planner (Fable) and builder (Opus) prompt templates; `{{ITEM_JSON}}` is filled per step
- `scripts/pipeline.mjs` — picks the next Build-order step from `docs/BUILD_LIST.md` (`next`, `next --dry-run`), validates the list (`lint`), fills prompts; `node automation/scripts/pipeline.mjs check` runs its self-tests
- `scripts/run-planner.cmd`, `scripts/run-builder.cmd` — what the n8n Execute Command nodes call
- `state/` — runtime scratch (current item, generated prompts); gitignored
