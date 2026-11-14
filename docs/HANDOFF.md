# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B06 built on its branch, waiting for Gate 2)

**B06 training-math is built and committed on branch `training-math`** (`Build B06: training
math module`), not merged. Next: Gate 2 — rerun tests/lint/tsc, skim the diff and the plan's
"Builder deviations" section, merge `--no-ff`, flip B06 and its covered features (TK-1..4,
LOG-4, LOG-6, all partial) to Built, fire B07.

**What B06 shipped:** the one training-math module at
`backend/supabase/functions/_shared/training-math/` (units, e1rm, rpe, intensity, plates, prs,
validate, index + a mirror test each), imported in the app as `@training-math` via
`frontend/metro.config.js` (new), `tsconfig.json` and `jest.config.js`. No migrations. Nothing
calls it yet — scaffolding for B13/B15/B16/B18, drawn as such in `docs/diagrams/app-flow.md`.

**Builder verification:** Jest 23 suites / 193 tests green; `tsc --noEmit` clean (after
regenerating the stale, gitignored `.expo/types/router.d.ts` with one `expo start`); `expo lint`
clean; the shared dir linted by hand from the repo root, clean (see DEFERRED for why
`expo lint` can't reach it); a temporary screen import bundled through Metro
(`expo export --platform android`) with the module's code in the bundle, then reverted.
Not verified: Mermaid render of the updated diagram (`mmdc` declined for headless runs), any Deno
import (B18 is the first consumer).

**Gate 1 decisions worth Tristen's eyes (from the plan):** G1 Epley at 1 rep returns the weight
itself; G2 the RPE chart is derived from Epley, not a published table.

**Still Tristen's (unchanged from B05):** device runs for B05 / FND-2 / NFR-8 (and FND-1 /
FND-4); the email-confirmation toggle (still ON); the six external blockers; whether to grant
`mmdc` to headless runs.

Next pipeline step after B06 merges: **B07 local-store-and-sync** (move `uuidv5` out of
`automation/scripts/generate-library-seed.ts`, never copy it).
