# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — build-order audit session)

**The build list is now the pipeline's queue.** Branch `build-order-for-pipeline` (plan:
`docs/feature_plans/build-order-for-pipeline.md`, grilled autonomously, two-axis reviewed) audits
`docs/BUILD_LIST.md` against `main` and adds a **Build order** table of 56 steps (B01–B56) that
`automation/scripts/pipeline.mjs next` consumes directly. **Not merged** — Tristen merges (Gate 2);
the pipeline only reads `main`, so nothing changes for it until then.

**Audit result (all merged on `main`):** FND-1 and FND-4 Built (device run pending → Done);
FND-2 In progress (schema + RLS live on Supabase — five migrations confirmed applied via MCP;
auth screens missing); LIB-7 Built (151 exercises in the TS catalog and the live `exercises`
table; videos pending); LIB-1 In progress (cards, search, region chips; muscle/equipment filters
pending). Everything else Not started. Several feature rows now note which columns already exist
(`sets.rpe`, `is_warmup`, `drop_set_position`, `duration_seconds`, `superset_group`,
`user_settings.unit`, `follows`, `blocks`) so planners don't re-migrate them.

**Build order shape:** B01–B04 are the four shipped branches (Built). Phase 1 queue: B05
auth-and-signup → B06 training-math (the one shared math module) → B07 local-store-and-sync →
B08 active-workout-store → B09 logger-screen → set types / notes / history+PRs / edit-delete →
settings → Tool Kit → analysis engine + muscle map → posts/feed → finish-to-post → image posts →
votes/comments → sort/filter → profile → privacy → moderation → share cards → library detail /
history / customs → export+delete → B33 video-service (Blocked). Phase 2: programs → teams →
visibility → marketplace → trend analysis → prefill → B44 deload rules (Blocked) → B45 grades
(Blocked) → trends → push → DMs → accessibility. Phase 3: gyms core → B51 Denver import (Blocked)
→ leaderboards → PR verification (waits on video) → hydration/sleep → B55 nutrition (Blocked) →
B56 recovery-aware analysis (Blocked). Six Blocked steps map 1:1 to the External blockers table.

**Picker changes (`pipeline.mjs`):** parses only the Build order section; `lint` validates the
list (every Covers ID exists, every unfinished feature is covered or listed under "Not steps",
deps point at earlier steps, unique kebab branches); `next` lints first, picks the first `Not
started` step with all deps Built/Done, skips Blocked and unmet-dep steps (stderr notes), refuses
on an `In progress` step or an already-existing branch, and emits
`{id, feature, branch, phase, status, dependsOn, covers[{id, feature, phase, status, dod,
partial}], scope}` (the keys the n8n board reads are unchanged); `next --dry-run` previews
without git or state writes. 22/22 self-tests (`check`), real list lints clean, dry run picks
**B05 auth-and-signup**. Prompts speak in steps and tell the builder to update the living
diagrams; the board JSON's gate texts name the step and its covered features.

**For Tristen:** (1) review and merge `build-order-for-pipeline`; (2) re-import the board
(`n8n import:workflow --input=automation/n8n/astra-build-pipeline.json`) — the n8n MCP server
refuses `localhost` in its strict SSRF mode, so this session could not update the live board;
(3) run the app on a device to flip FND-1/FND-4 to Done; (4) skim the Build order for the two
P1 pull-forwards (LOG-10 in B10, SOC-9 in B24) and the step sizing; (5) the six blockers are
yours — editing a Blocked step's Status to `Not started` is how a step enters the queue.

Next pipeline step after merge: **B05 auth-and-signup** (`node automation/scripts/pipeline.mjs
next --dry-run` to confirm).
