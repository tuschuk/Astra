# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05 and B06 merged, pipeline on B07)

**Two pipeline steps are merged to `main`; the pipeline is running B07 local-store-and-sync.**
Gates are delegated to the session (CLAUDE.md, "Autonomous sessions"): it spot-checks each plan,
approves Gate 1, reruns the checks and does Gate 2. Tristen's remaining hands-on items are at the
end.

**B06 training-math (merged, Gate 2 record):** the one shared math module at
`backend/supabase/functions/_shared/training-math/` (units, e1rm, rpe, intensity, plates, prs,
validate, index — mirror test each), imported in the app as `@training-math` through
`frontend/metro.config.js`, `tsconfig.json` and `jest.config.js`. No migration. Nothing calls it
yet (B13/B15/B16/B18 will); the app-flow diagram marks it as scaffolding. Gate 2 found one real
defect the builder's warm cache hid: Jest could not resolve `@babel/runtime` helpers for files
outside `frontend/`; fixed with `moduleDirectories` in `jest.config.js` (recorded in the plan
file). Verified after the fix: Jest 23 suites / 193 tests on a cleared cache and twice warm,
`expo lint` clean, `tsc --noEmit` clean. Statuses: B06 Built; TK-1..4, LOG-4, LOG-6 In progress
(math done, screens pending). Two PRD interpretations worth Tristen's glance: Epley at one rep
returns the lifted weight; the RPE chart is derived from Epley, not a licensed table — both are
one-function swaps if he disagrees.

**B05 auth-and-signup (merged earlier today):** migration applied and probed live; details in the
B05 plan file and DEFERRED. B05 / FND-2 / NFR-8 are Built and wait on a device run for Done.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n runs detached with `NODES_EXCLUDE=[]`;
board `gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless
allowlist includes `mcp__supabase`; n8n-mcp SSRF fix committed (takes effect next Claude Code
start). Session helper for the API: `automation/state/pipe.mjs` (gitignored; `latest`, `approve
<id>`, `retry <id>`, `trigger`). Executions so far: 4 (B05, builder failed on old CLI), 5 (retry,
success), 6 (B06, success); B07 is the next one.

**B07 local-store-and-sync** — expo-sqlite device store + sync engine (FND-3). Planner must MOVE
`uuidv5` out of `automation/scripts/generate-library-seed.ts` into the frontend (expo-crypto or
pure-TS SHA-1, RFC 4122 vector test) and make the generator import it — never a second copy.
Consider `expo-sqlite/kv-store` for the auth session store (DEFERRED). Plan file:
`docs/feature_plans/local-store-and-sync.md`.

**Tristen's hands-on list:** (1) device runs — sign up under 18 → refused, sign up 18+, kill app,
reopen still signed in, sign out, sign in — flips B05 / FND-2 / NFR-8 and FND-1 / FND-4 to Done;
(2) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of
record; the session's toggle was declined by the permission layer); (3) the six external blockers;
(4) whether to grant `mmdc` to headless runs.

Next pipeline step after B07 merges: **B08 active-workout-store**.
