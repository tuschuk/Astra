# training-math

**Step B06.** The single shared module for all training math. Covers (each `part`): **TK-1**
(Epley 1RM), **TK-2** (RPE → working weight), **TK-3** (%1RM → working weight), **TK-4** (plate
loader), **LOG-4** (PR classification), **LOG-6** (kg/lb conversion). Depends on B01 (the
`frontend/` scaffold this wires into). Pure TypeScript, no I/O, no dependencies.

## The one decision this step exists to make: where the module lives

**Home: `backend/supabase/functions/_shared/training-math/`.**

The module must be importable from `frontend/` (Metro/Jest/tsc) and from
`backend/supabase/functions/` (Deno, bundled by `supabase functions deploy`). The two sides are
not symmetric:

- **Metro can reach outside `frontend/`** — monorepo support via `watchFolders` plus a tsconfig
  path alias is standard, documented Expo practice.
- **Supabase's deploy bundler cannot reliably reach outside `backend/supabase/`** — the CLI
  bundles an edge function from the `supabase` directory, and its documented location for shared
  code is `functions/_shared/`. A home under `frontend/` would work until B18 deploys the first
  edge function, then force a move or a mirrored copy — the exact bug CLAUDE.md forbids.

So the side with the rigid tooling gets the file, and the flexible side imports across.
`docs/ARCHITECTURE.md` deferred this call to "when FND-2 lands and the first server function
needs it"; FND-2's schema is live and B06's whole scope is fixing this home, so it is decided
now, before B18 builds on it.

**Deno constraints the module obeys by construction** (so B18 can import it unchanged):

- Internal imports carry explicit `.ts` extensions (`import { epleyE1rm } from "./e1rm.ts"`) —
  required by Deno; Metro, Jest and tsc (with `allowImportingTsExtensions`) all resolve them.
- Zero imports from npm, Node built-ins, React Native or Expo. Plain TS + the standard library.
- No I/O, no globals, no `Date.now()` — every function is deterministic input → output.

## Files

```
backend/supabase/functions/_shared/training-math/
  index.ts      — public API: re-exports everything below; the only import target for consumers
  units.ts      — kg/lb conversion, display rounding, round-to-increment
  e1rm.ts       — Epley estimate + its inversion (weight achievable for N reps at a given 1RM)
  rpe.ts        — (reps, RPE) → %1RM chart + working weight
  intensity.ts  — %1RM → working weight
  plates.ts     — per-side plate solver
  prs.ts        — PR classification + records fold
  *.test.ts     — Jest tests beside each file (mirror rule)
```

Frontend wiring (all in `frontend/`, part of this step so importability is *observably* true):

- `metro.config.js` (new): default Expo config + `watchFolders` for the shared dir. Expo's
  tsconfig-paths resolution may not follow an alias outside the project root — if it doesn't,
  the builder falls back to `resolver.extraNodeModules` / a `resolveRequest` alias in the same
  file; either is fine, the alias name is the contract.
- `tsconfig.json`: path alias `@training-math` → the shared `index.ts`; add the shared dir to
  `include`; `allowImportingTsExtensions: true` (legal: `expo/tsconfig.base` confirmed to set
  `noEmit: true` and `moduleResolution: "bundler"`).
- `jest.config.js`: add the shared dir to `roots` **and** a testMatch pattern that reaches it —
  the current `**/src/**` patterns cannot match a path with no `src` segment.
- One frontend smoke test importing `@training-math` through the alias (proves Metro/Jest/tsc
  resolution, not just that the files exist).

## The math, precisely

All stored and computed weights are **kg** (matches `sets.weight_kg`, `user_settings.unit`
affects display only). The plate solver alone is unit-agnostic (one consistent unit in = same
unit out), because plate inventories are real objects in the user's unit, not conversions.

**`units.ts`** — `KG_PER_LB = 0.45359237` (exact by definition of the international pound).
`kgToLb` / `lbToKg` (exact, no rounding — these feed math, not screens);
`displayWeight(kg, unit)` → number in the user's unit rounded to 1 decimal (display only, never
written back — LOG-6's "without corrupting stored data" is a module-boundary rule: nothing here
mutates or returns a "rounded kg for storage");
`roundToIncrement(value, increment)` — calculators snap suggestions to a practical step (B16
passes 2.5 kg / 5 lb or the smallest inventory plate pair).

**`e1rm.ts`** — `epleyE1rm(weightKg, reps)`:
- reps ≥ 2: `weight × (1 + reps / 30)` — the PRD's formula, verbatim.
- reps = 1: returns `weight`. A performed single *is* the lifter's measured 1RM; raw Epley would
  claim 100 kg × 1 "estimates" 103.3 kg, a weight never lifted, and every true-1RM PR would
  absurdly flag a higher estimated-1RM PR at the same moment. (Grilled decision G1.)
- `weightForReps(oneRmKg, reps)` — the inversion `oneRm / (1 + reps / 30)` (reps = 1 → oneRm);
  shared by `rpe.ts` and `intensity.ts` so there is exactly one Epley expression in the repo.
- Domain: weight > 0, integer reps in [1, 30]; out of domain throws `RangeError`. Callers (B16
  input fields) validate before calling; the throw is the backstop, not the UX.

**`rpe.ts`** — the "RPE-to-percentage chart" is *computed from Epley, not copied from a
published table*: RIR = 10 − RPE; effective reps = reps + RIR; %1RM =
`1 / (1 + effectiveReps / 30)` (effective reps = 1 → 100%). One source of truth: a set of
5 @ RPE 8 at the suggested weight produces exactly the e1RM it was derived from. Published RPE
charts (e.g. RTS) differ by ≤ ~2% in this domain, are themselves derived estimates, and would
add a second, licensed authority that can disagree with our own e1RM math. (Grilled decision
G2.) Exposed as `percentOfOneRm(reps, rpe)` and
`workingWeightFromRpe(oneRmKg, reps, rpe)` = `oneRm × percent`, raw kg (rounding is the
caller's choice via `roundToIncrement`). Domain: reps [1, 12], RPE [6, 10] in 0.5 steps —
below RPE 6 the estimate is noise; throws `RangeError` outside.

**`intensity.ts`** — `workingWeightFromPercent(oneRmKg, percent)` = `oneRm × percent / 100`.
Domain: percent in (0, 150] (bands/overloads above 100 are legitimate); throws outside. TK-3's
"any percentage input" is read as any sane percentage, not literally negative numbers.

**`plates.ts`** — `loadBar(target, bar, inventory)` with
`inventory: { plate: number; perSide: number }[]` (counts are *per side* — the UI asks "how
many 25s per side do you have", no silent halving). Returns
`{ perSide: { plate, count }[], loaded, remainder }` where `loaded` = bar + 2 × Σ(side) is the
**heaviest achievable weight ≤ target**, and `remainder` = target − loaded (0 when exact).
Solver: exact subset-sum DP over integer centi-units (plate weights × 100), not greedy — greedy
fails on real custom inventories (target 6 over plates [4, 3, 3] → greedy 4, optimal 6), and
TK-4's DoD says *any* inventory. Per-side search space ≤ ~50 000 states; microseconds.
Tie-break: fewest plates, then heaviest-first (what a lifter actually racks). target < bar
returns `{ perSide: [], loaded: bar, remainder: target − bar }` (negative remainder = "bar is
already too heavy" — a UI state, not an exception).

**`prs.ts`** — mirrors the schema: a candidate set is
`{ reps, weightKg: number | null, isWarmup }`. Current bests are
`PrRecords { true1RmKg?: number; e1RmKg?: number; repMaxesKg: Record<number, number> }`.
- `classifyPrs(set, records)` → `PrEvent[]`, each
  `{ kind: 'true1rm' | 'repMax' | 'e1rm'; reps?: number; valueKg; previousKg? }`:
  - **Excluded outright:** `isWarmup` true (schema comment says exactly this), `weightKg` null
    or ≤ 0 (bodyweight/timed work — B10's rep-based PRs are not in this step's scope), reps < 1.
  - **true1rm:** reps = 1 and weight beats `true1RmKg` (or no record exists — first ever counts).
  - **repMax:** reps ≥ 2 and weight beats the best at *exactly* that rep count (5×100 is a 5RM
    candidate only; it never competes with the 3RM). A single is not also a repMax(1): true1rm
    *is* the 1-rep record book, and emitting both kinds would hand B13 a forever-duplicate row
    (grilled decision G8).
  - **e1rm:** `epleyE1rm(set)` beats `e1RmKg`.
  - "Beats" = `candidate > current + ε` (ε = 1e-6) so float artifacts and exact ties never flag.
  - One set can flag several kinds at once (a 110 kg single can be true1rm + repMax(1) + e1rm) —
    that is correct, they are distinct record books.
  - **Volume is structurally excluded:** total sets/reps/tonnage are never inputs, so a
    volume-only improvement *cannot* flag — LOG-4's negative DoD holds by construction and is
    still asserted by test.
- `recordsFromSets(sets)` — fold a set history into `PrRecords` (same exclusion rules). B13
  seeds records from history and B14 recomputes after edit/delete with this; without it both
  steps would re-implement the classifier's rules backwards.

## How each DoD becomes observably true

| DoD | Observable proof (all Jest, worked fixtures) |
|---|---|
| Step: every formula covered, fixtures | Each file has a mirror test with hand-computed cases, e.g. 100 kg × 5 → 116.67; 225 lb bench plate-out; RPE 8 × 5 at 150 kg 1RM |
| Step: no other implementation in repo | Explore confirmed none exists today (grep: only `library/exercises.ts` text matches); review re-greps for `1rm\|epley\|plate\|0.45359\|2.2046` outside the module |
| TK-1 (part) | `epleyE1rm` fixtures incl. reps = 1; "in the user's units" is `displayWeight` over the kg result — unit tests prove the pair; the *screen* is B16 |
| TK-2 (part) | `workingWeightFromRpe` fixtures across the reps/RPE grid incl. 1 @ 10 → 100% |
| TK-3 (part) | `workingWeightFromPercent` fixtures incl. 100%, >100%, throw cases |
| TK-4 (part) | Solver fixtures: standard kg and lb racks, microplates, the greedy-killer inventory, unreachable target (remainder > 0), target < bar |
| LOG-4 (part) | Fixtures: qualifying single → true1rm; 5-rep weight jump → repMax(5) + e1rm; warm-up never flags; **same weight × reps repeated for more sets (volume-only) → `[]`**; first-ever set flags |
| LOG-6 (part) | Round-trip fixtures: kg → lb → kg identity within ε; `displayWeight` never feeds storage (API returns display numbers only; no function accepts a display unit and returns "kg to store" except exact `lbToKg` at entry) |

Entry conversion (user types 225 in lb, we store `lbToKg(225)` exact, unrounded) is the one
storage-direction function; its test pins exactness so B15's "switching units never changes a
stored kg value" has a foundation.

## Data model and diagrams

No migrations; ERD untouched. `docs/diagrams/app-flow.md` gains the module as a shared node
marked **scaffolding — not yet consumed** (B10, B13, B15, B16, B18 wire it), per the living-
diagrams rule that scaffolding is drawn as such.

## Out of scope (and where it lands)

- **Strength grades** — CLAUDE.md names them part of this module, but they are blocked on the
  Strength Level licence (external blocker, `docs/BUILD_LIST.md`). They land *in this module*
  when unblocked; no placeholder code now ("add nothing speculative"). The build-list scope for
  B06 already omits them — this plan matches the step scope, not the HANDOFF shorthand.
- Every screen: calculators (B16), settings/unit toggle (B15), logger badges (B13).
- PR *persistence* (`personal_records` table, sync) — B13. This step is classification only.
- Warm-up toggle UI (B10), bodyweight rep-record PRs (B10+B13 decide if they exist at all).
- Timer math (TK-5/B17), analysis rules (B18).
- **Session volume computation** — not needed by anything until B10 (warm-up exclusion
  assertion, per LOG-14's DoD) and B18 (summary totals). When it arrives it is added *to this
  module* (`volume.ts`), never beside it — B10's DoD already says "excluded from … session
  volume **by the math module**". Deferred, not relocated.
- Any Deno *runtime* verification — no edge function exists to deploy; B18 is the first real
  Deno consumer. The module is Deno-clean by construction (constraints above) and that is a
  review checklist item here, a deploy-time fact at B18.

## Grilling decisions (settled)

Grill conducted via `mattpocock-skills:grilling` in the planner run (non-interactive: the
planner worked the question tree, verified every checkable fact in the repo — Expo tsconfig
base flags, Jest testMatch reach, B10/LOG-14's volume wording, absence of any existing math
implementation — and answered the decision questions itself; Gate 1 is where Tristen overrules
any of them). G1 and G2 interpret the PRD and deserve his eyes most.

- **G1 — Epley at reps = 1 returns the weight itself**, deviating from the raw formula (which
  the PRD states without addressing the single-rep case). Rationale in `e1rm.ts` section; the
  alternative (103.3% "estimates" from performed singles) poisons e1RM PR detection. Flagged
  here for Tristen's Gate 1 eyes since it interprets the PRD.
- **G2 — RPE chart derived from Epley inversion, not a published table.** Self-consistent with
  our own e1RM, no licence, ≤ ~2% from RTS-style charts in the supported domain. If Tristen
  wants chart-faithful numbers later it is one table swap behind the same function signature.
- **G3 — exact DP solver over greedy for plates.** Greedy is wrong on custom inventories
  (counter-example above) and the DoD says any inventory; the DP is ~30 lines and microseconds.
- **G4 — home in `backend/supabase/functions/_shared/`** despite no edge function existing yet:
  the Supabase bundler is the inflexible side (argument at top). Cost: three small frontend
  config touches (metro/tsconfig/jest), each standard monorepo practice.
- **G5 — colocated tests inside `_shared/training-math/`** per the mirror rule. CLAUDE.md's
  `backend/supabase/functions/tests/` convention is for *server-function* tests (none exist);
  this is a shared library, and its tests run under frontend Jest, which the config change
  makes explicit. Deploy bundling only follows imports, so test files never ship.
- **G6 — per-side plate counts in the inventory type**, not total counts silently halved: the
  B16 UI question is "what's on your rack per side"; total-count ambiguity (odd plates) dies at
  the type.
- **G7 — throw `RangeError` on out-of-domain input** rather than clamp or return null:
  calculators are the only callers, they own input validation; silent clamping would make a
  wrong number look authoritative. The TK DoDs' "any input" is read as any input in the stated
  domain (reps 1–30 for Epley, reps 1–12 / RPE 6–10 for RPE, percent 0–150); a plan that
  promised sane answers for −3 reps would be lying.
- **G8 — a single feeds true1rm only, never repMax(1).** LOG-4's "rep max at any rep count" is
  satisfied at rep count 1 by the true-1RM record itself; two kinds for one number means
  duplicate rows in B13 and a profile that lists "1RM" twice.
- **G9 — the `PrKind` union exported here is the canonical vocabulary.** B13's
  `personal_records` migration will declare a matching SQL enum — a different artifact in a
  different language, required by the schema, not a forbidden mirrored copy of *math*. Saying
  so now spares the B13 builder the agonizing.
- **Scope verdict:** the step scope is right as written; nothing moved in or out beyond the
  strength-grades clarification above and the volume-computation deferral note (both are
  clarifications of where future work lands, not scope changes).
