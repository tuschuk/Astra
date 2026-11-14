# automation/

Local dev tooling for the autonomous build pipeline — **not product code**. The spec and operator
guide live in [docs/PIPELINE.md](../docs/PIPELINE.md); the short rules are in the root
[CLAUDE.md](../CLAUDE.md) under "Autonomous pipeline".

- `n8n/astra-build-pipeline.json` — the n8n board. Import: `n8n import:workflow --input=automation/n8n/astra-build-pipeline.json`
- `prompts/` — planner (Fable) and builder (Opus) prompt templates; `{{ITEM_JSON}}` is filled per item
- `scripts/pipeline.mjs` — picks the next build-list item, fills prompts; `node automation/scripts/pipeline.mjs check` runs its self-tests
- `scripts/run-planner.cmd`, `scripts/run-builder.cmd` — what the n8n Execute Command nodes call
- `state/` — runtime scratch (current item, generated prompts); gitignored
