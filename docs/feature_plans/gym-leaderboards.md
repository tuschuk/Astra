# gym-leaderboards — B52: the Gym leaderboard (table, board screen, two divisions)

**Branch:** `gym-leaderboards` (from `main`)
**Build step:** B52 — covers **GYM-3** (part: the board shape — one best verified row per member
per ranked exercise; real verified rows arrive with B53), **GYM-6** (part: the replace-previous-best
mechanics, proven with fixture writes; the verification pipeline that performs them is B53),
**GYM-8** (whole: two divisions, absolute ranking, no weight or age classes), and **GYM-9** (part:
entries stay with their gym when the member switches; B53 completes it when real entries exist).
**Depends on:** B50 (gyms, `gym_members`, the gym page this screen hangs off) and B13
(`personal_records` and the PR vocabulary — see "What the B13 dependency is and is not" below).

## Step definition of done (from the Build order)

`leaderboard_entries` keyed by gym, member, exercise (squat, bench press, deadlift) and sex
division; board view showing one best verified row per member; entries stay with their gym when
the member switches. Verified rows arrive only through B53, so this step is tested with fixture
rows. **Step DoD: with fixture entries, each board shows two divisions ranked by absolute weight,
one row per member, and a member's rows stay on the old board after a switch.**

## Scope readings settled up front

- **A board entry is not a `personal_records` row.** The PR table is owner-only RLS (widened for
  nothing public), client-written, and legitimately *demotable* (B14 recompute). A board entry is
  a public, verified snapshot whose proof is a B53 video submission. So `leaderboard_entries`
  carries its own `weight_kg` and no FK to `personal_records` — a deliberate denormalization, not
  a mirrored copy: the two tables answer different questions ("my current best" vs "the best this
  gym ever verified for me"), and GYM-9's stay-on-the-old-board rule *requires* board rows to
  survive events (gym switches, later PR demotions) that rewrite the PR table. The B13 dependency
  supplies the vocabulary (true-1RM, kg storage, `formatWeight`) — it is honored by reuse, not by
  foreign key.
- **The division is stamped on the entry, never joined from `user_body_data`.** Sex lives in
  `user_body_data` under owner-only RLS because it is sensitive (NFR-5); a public board cannot
  read it and must not leak it. GYM-8's split therefore works like GYM-9's gym keying: the
  division is a column written at verification time and frozen. Submitting to a leaderboard is a
  voluntary public act — the submitter's division becomes visible *because they entered a
  sex-divided public competition*, which is B53's consent surface ("every user picks male or
  female" gates *submission*, there). The private `user_body_data` row stays exactly as private
  as it is today. A member who later changes their picked sex keeps old entries in the division
  they entered (snapshot semantics, the same honesty as `joined_at`). **Recorded product call,
  flagged for Gate 1** (Risk 1).
- **No user write path exists in B52 — structurally, like `gyms`.** Verified rows arrive only
  through B53's verification flow; until then nothing may write the board. Enforcement is the
  GYM-7 pattern: a select policy and nothing else, with table-level INSERT / UPDATE / DELETE /
  TRUNCATE revoked from `authenticated` and `anon` (the B50 deviation-1 lesson: revoke the lot,
  TRUNCATE skips RLS). Rows are written by migrations and probes now, by B53's server-side
  writer later. This makes B52's board read-only by construction and GYM-6's "only verified PRs
  appear" vacuously true until B53 — nothing else *can* appear.
- **Boards are public to signed-in users.** B50's plan recorded "B52's leaderboards are public by
  nature" when it made membership public; the select policy is `to authenticated using (true)`,
  the open-roster posture. Anon stays refused.
- **One current-best row per book, not an event log** — the B13 argument verbatim. The board's
  unit of identity is (gym, member, lift): a unique index enforces "one row per member" in the
  schema, and GYM-6's "replaces" is an upsert on that key by B53's writer. An entry *history* is
  speculative until something reads it (GYM-10's pending-submission feed is B53's and reads
  submissions, not board rows).
- **The three lifts are a closed vocabulary, not `exercises` FKs.** The PRD names squat, bench
  press, deadlift as the launch board. A text column checked against three slugs says exactly
  that; pointing at library `exercises` rows would couple the board to seed ids and invite a
  "rank any exercise" generality nobody asked for. Mapping a logged workout's `exercise_id` to a
  board lift is B53's submission concern.
- **Online-only social surface** (B36/B50 precedent): the board needs a connection and degrades
  to the standard message. No device table, no outbox, no schema bump, no `SYNC_ORDER` change.
  Offline-first governs logging and the Tool Kit, which don't change.
- **Ranking is ordering, not training math.** Nothing here estimates, converts or grades — the
  board sorts stored kg values descending and numbers the rows. That is list furniture and lives
  in the social module; the only math-adjacent touch is `formatWeight` (kg → the viewer's unit),
  imported from its one home. No `@training-math` change, no mirrored copy.

## Data model (one migration: `leaderboard_entries`)

```sql
create table public.leaderboard_entries (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  lift        text not null check (lift in ('squat', 'bench', 'deadlift')),
  division    text not null check (division in ('male', 'female')),
  weight_kg   numeric(8, 3) not null check (weight_kg > 0),
  verified_at timestamptz not null,
  created_at  timestamptz not null default now()
);

-- One board row per member per lift per gym: GYM-3's "one row per member" and the key
-- GYM-6's replace upserts on (B53). Leading gym_id also serves the board read's filter.
create unique index leaderboard_entries_book_idx
  on public.leaderboard_entries (gym_id, user_id, lift);
-- Account deletion path (B32): cascade from profiles finds its rows.
create index leaderboard_entries_user_idx on public.leaderboard_entries (user_id);
```

RLS on. Policies: **select to authenticated using (true)** — and nothing else. Then the
belt-and-braces block: `revoke insert, update, delete, truncate, references, trigger on
public.leaderboard_entries from authenticated, anon;` (grant select back). No user, including
the row's own `user_id`, can write the board; B53's writer will be server-side (a definer
function or service-role edge function — its design, not ours).

Column notes:

- `division` mirrors `user_body_data.sex`'s text-check vocabulary (`'male'`/`'female'`) rather
  than introducing an enum, so the two columns can never drift apart in spelling. It is `not
  null` **on the entry** while `user_body_data.sex` is nullable — you can use Astra without
  picking, but you cannot be *on a board* without a division (GYM-8's "every user picks" at the
  schema level; B53's submission UI is where the picking happens).
- `weight_kg numeric(8,3)` — the `personal_records.value_kg` shape; kg is the storage unit
  everywhere.
- `verified_at not null` — the moment the entry earned its place; B53 stamps it at threshold.
  It is also the tie-breaker (below). No `updated_at`/`moddatetime`: the table is not synced to
  devices, and B53's upsert rewrites `verified_at` anyway, which *is* the meaningful time.
- `gym_id … on delete cascade` — a B51 re-seed that deletes fixture gyms drops their (test-only)
  entries, the recorded B50 posture; `user_id … on delete cascade` keeps B32's account deletion
  complete. **Account deletion removes the member's board rows everywhere** — that is NFR-6's
  "full content deletion" and overrides GYM-9's stickiness, which is about *switching*, not
  about ceasing to exist.
- No `submission_id`, no video ref, no columns for B53 — it adds what it needs when its design
  exists ("add nothing speculative").

**No fixture seed in the migration.** Fixture entries need profile rows, which hang off
`auth.users` — fake people do not belong in the live schema. The step DoD's "with fixture
entries" is made true twice: in Jest against the fake client (every board behaviour), and at
Gate 2 with throwaway rows inserted and removed by the standing probe recipe (below).

## The board read

PostgREST orders and filters this directly — no RPC, no view:

```
leaderboard_entries
  ?gym_id=eq.<gym>&lift=eq.<lift>
  &select=id,user_id,division,weight_kg,verified_at,profile:profiles(username,display_name)
  &order=weight_kg.desc,verified_at.asc,id.asc
  &limit=200
```

- One read per lift, issued when the lift chip is selected (and cached per lift in screen
  state) — so the result is never a mixed-lift list a limit could truncate unfairly.
- **Absolute weight, descending** is the whole of GYM-8's ranking rule — no bodyweight, no age,
  no coefficient anywhere.
- **Ties:** equal `weight_kg` → earlier `verified_at` first (the earlier lift held the spot;
  re-verifying the same number does not leapfrog), `id` as the stable last word. Rank numbers
  are positional (1, 2, 3 — no shared ranks; two 405s show as 1 and 2, the earlier verification
  first). Recorded as the launch reading; shared "T-1" ranks are display polish for later.
- The client splits the rows into the two divisions and numbers each independently. `limit=200`
  is a generous top-of-board cap, recorded; keyset paging if a gym ever outgrows it.
- The `profile:profiles(…)` embed is the `GYM_MEMBER_SELECT` shape; profiles are public-read
  (B25), so names render for entrants who have since left the gym — which GYM-9 requires
  (an old-board row whose member left must still say who lifted it).

## App module and screens

### `frontend/src/social/leaderboards.ts` (+ `leaderboards.test.ts`)

Injected-client pattern (`gyms.ts` / `teams.ts`); RLS decides; refusals map to calm messages.

- `LIFTS = ['squat', 'bench', 'deadlift'] as const` with `LIFT_LABELS` ("Squat", "Bench press",
  "Deadlift") and `DIVISIONS = ['male', 'female'] as const` with `DIVISION_LABELS` ("Men",
  "Women") — the closed vocabularies, spelled once.
- `LEADERBOARD_SELECT` — the embed select above.
- `loadBoard(client, gymId, lift)` — the read above; returns rows in server order or the
  standard offline result (reuses `GYMS_OFFLINE` from `gyms.ts` — same Gyms surface, same
  sentence).
- `splitBoard(rows)` — groups into `{ male: RankedEntry[], female: RankedEntry[] }`, each entry
  gaining its 1-based `rank`. Pure, tested: ordering is trusted from the server, ranks are
  positional per division. (Why trust the server's order? Because the order clause *is* the
  ranking rule and the probe pins it; re-sorting client-side would be a second home for the
  rule.)
- Weight display goes through `formatWeight(weight_kg, unit)` from `workout/format.ts` /
  `@training-math` — the one home for unit display.

### Screens

| Piece | What it does |
|---|---|
| `app/gym/[id]/leaderboard.tsx` (new) | The **board**: gym name as title; the three lift chips (`ChoiceChips`, the Home-feed precedent); for the chosen lift, **always both division sections** — "Men" and "Women" as headers (`SectionLabel`, `accessibilityRole="header"`, the B49 posture) — each listing rank · display name (tap → `/profile/[id]`) · weight in the viewer's unit. An empty division says "No verified PRs yet." under its header, so "exactly two divisions" (GYM-8's DoD) is observable even on an empty or one-sided board. Offline → the standard message + Retry. |
| `app/gym/[id]/index.tsx` (edit) | A **Leaderboard** row between the join/leave block and the Members section — one tappable line ("Leaderboard" + chevron) pushing `/gym/[id]/leaderboard`. Members and the Gym feed are untouched. |
| `app/_layout.tsx` (edit) | Register `gym/[id]/leaderboard` in the signed-in guard (the B50 deviation-2 footgun: every route needs it). |

Route tests in `frontend/src/__tests__/` (expo-router rule): `gym-leaderboard.test.tsx` new;
`gym.test.tsx` extended for the entry row. Module tests beside the module. The fake social
client (which gained `gyms` / `gym_members` in B50) gains `leaderboard_entries` with eq-filter
and multi-key order support (`weight_kg desc, verified_at asc, id asc`) — fake-client work the
builder should expect.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_leaderboard_entries.sql` | new — table, checks, unique book index, RLS select-only, revoke block (applied live, renamed to the recorded version) |
| `frontend/src/social/leaderboards.ts` (+ `leaderboards.test.ts`) | new — vocabularies, labels, `loadBoard`, `splitBoard` |
| `frontend/src/app/gym/[id]/leaderboard.tsx` | new — the board screen |
| `frontend/src/app/gym/[id]/index.tsx` | edit — the Leaderboard row |
| `frontend/src/app/_layout.tsx` | edit — route registration |
| `frontend/src/test-utils/*` (fake social client) | edit — `leaderboard_entries` table + ordering |
| `frontend/src/__tests__/gym-leaderboard.test.tsx` (new), `gym.test.tsx` (edit) | route tests |
| `docs/diagrams/database-erd.md` | edit (Document step) — table, checks, index, policies/revokes |
| `docs/diagrams/app-flow.md` | edit (Document step) — gym page → Leaderboard → board read path |

Builder footguns (standing): new route → regenerate typed routes with `npx expo start
--offline` (~150 s) **before** `tsc --noEmit` → lint → Jest; apply the migration via MCP then
rename to the `list_migrations` version; full-suite Jest timeouts → rerun `--maxWorkers=50%`;
`get_advisors` after apply.

## Offline / sync / privacy / rules check

- **Offline-first:** untouched where it applies; the board is an online-only read surface with
  the standard degradation. Logging and the Tool Kit unaffected.
- **One home:** no training math is written; `formatWeight` is imported, not copied; the
  ranking rule exists once (the server order clause, with `splitBoard` only numbering);
  the lift and division vocabularies are spelled once each in `leaderboards.ts` and once in
  the migration's CHECKs (schema vocabulary, the B06-G9 class, commented to change together).
- **RLS, never client-side:** who can read the board and that nobody can write it are policies
  plus revokes; one-row-per-member is a unique index. The app renders; it enforces nothing.
- **Privacy:** `user_body_data` is never read, joined or widened; the division on an entry is
  data the member will have published by submitting (B53's consent surface). Progress pics,
  body data, recovery data untouched. 18+ unaffected.
- **Nothing speculative:** no RPC, no view, no realtime, no paging machinery, no entry history,
  no B53 columns, no coefficients, no per-gym settings. No new dependency.
- **No AI; no numeric performance claims** — the board shows user-achieved numbers, not product
  claims.

## Migration / Gate 2 probe (standing recipe; throwaway users A and B, service-role fixture rows, all removed afterwards)

1. Service-role inserts a fixture board on a fixture gym: two divisions of three entries each
   across the three lifts, with a deliberate tie (equal `weight_kg`, different `verified_at`).
2. A (real JWT) reads the board read above per lift → rows ordered weight desc, the tie ordered
   by earlier `verified_at`; both divisions present.
3. A second insert for the same (gym, user, lift) → 23505 (the unique book index); an upsert on
   the key with a new `weight_kg` + `verified_at` (service role — B53's future writer) → still
   one row, new value: GYM-6's replace mechanics at the schema.
4. A INSERT / UPDATE / DELETE on `leaderboard_entries` with their JWT → refused (42501),
   including a row whose `user_id` is A themself. Anon select → refused.
5. **The switch probe (GYM-9):** A has entries on gym 1 and a `gym_members` row there; A
   switches to gym 2 through the REST upsert (the B50 recipe). Gym 1's board still returns A's
   rows; gym 2's board returns none for A. A leaves entirely → unchanged again.
6. Cleanup (probe rows deleted, throwaway users removed); `get_advisors` (security) after apply.

## How each definition of done becomes observably true

- **Step DoD:** Jest route test renders the board from fixture rows — two division headers, rows
  ranked by descending displayed weight, one row per member (the fake enforces the unique key);
  a membership flip in the fake moves `gym_members` only and the board re-read is identical
  (stay-on-old-board), while the new gym's board shows nothing for that member. Probe steps 2
  and 5 prove the same against the live schema.
- **GYM-3 (this step's part):** the board shows one row per member per lift, labelled from
  verified entries — shape and screen done; *Built for its B52 part* only when B53 supplies real
  verified rows (the feature row stays In progress, like GYM-1 under B50).
- **GYM-6 (this step's part):** probe step 3 — the unique key plus upsert-replace is the entire
  "replaces that member's previous best" mechanism B53 will call.
- **GYM-8 (whole):** the board screen renders exactly two divisions, ranked by absolute weight,
  with no class structure anywhere in schema or UI; the "every user picks" clause is a CHECK-level
  truth on entries now and a submission-gate UI in B53 (recorded reading — see Risk 2).
- **GYM-9 (this step's part):** probe step 5 and the Jest switch test; the schema makes it a
  non-event (entries key on `gym_id`; switching rewrites only `gym_members`).

## Out of scope (and where it lands)

- Submissions, video, thumbs-up verification, thresholds, expiry, the pending feed, the
  "pick your division" moment, mapping logged exercises to board lifts, the server-side writer —
  **B53** (which also completes GYM-3, GYM-6, GYM-9).
- Real gym data — **B51** (Blocked). Real verified entries — B53.
- Entry history / "was on the board" log, shared tie ranks, paging past 200, realtime board
  updates, per-gym lift lists, bodyweight or age coefficients (the PRD forbids classes),
  km/kg-aware division labels — later, on evidence or product call; coefficients never (GYM-8).
- Any write path for users on `leaderboard_entries` — never in B52; B53 decides its writer's
  shape.
- Showing a member's board entries on their profile or the gym page roster — nothing in the PRD
  asks; on evidence.

## Risks a reviewer should weigh

1. **The division column is a privacy posture set in schema** (the B50 Risk-1 class): once B53
   writes real rows, any signed-in user can read an entrant's division — effectively their
   picked sex — forever, including after they leave the gym. The plan's position: that is what
   entering a sex-divided public leaderboard *means*, the stamp is frozen at the submitter's
   choice, and the sensitive `user_body_data` row is never exposed. If Tristen wants boards
   visible to fellow members only, the select policy gains one membership arm now (cheap) —
   but GYM-9 then hides your old board from you after a switch, which argues for public-read.
   Flagged for Gate 1.
2. **GYM-8 is claimed whole with the pick-UI deferred to B53.** Its DoD ("each board renders
   exactly two divisions ranked by absolute weight") is fully observable here with fixtures,
   and `division not null` + CHECK is the schema truth of "every user picks". But a reader of
   the feature line might expect the picking *screen*; if Gate 1 reads it that way, the honest
   fallback is GYM-8 → In progress with a note, costing nothing in code.
3. **B52 ships a permanently-empty surface to real users until B53 lands** (and B53 depends on
   B33, which is Blocked on the video provider). Every real gym's board will say "No verified
   PRs yet." in both divisions for months. The empty copy is written to be true and calm, and
   the alternative — holding the whole step — would idle the pipeline behind B33. Recorded so
   nobody mistakes an empty board on device for a bug; Tristen can overrule the sequencing.
4. **The ranking rule lives in a PostgREST order clause**, not in testable TS — a regression
   (say, someone drops the secondary key) would pass every unit test that trusts server order.
   The probe's deliberate tie and the fake client's faithful multi-key ordering are the nets;
   the builder must implement the fake's ordering exactly (desc weight, asc verified_at, asc
   id) rather than approximating with a single sort key.

## Grilling decisions (settled)

Run via `mattpocock-skills:grilling` in the planner session; Gate 1 is where Tristen overrules.

- **G1 — "Why a table at all in B52? B53 could ship schema+flow together; this step's board is
  empty theater until then."** Because the Build order deliberately splits them: B53 is behind
  B33 (Blocked), and B52 banks the schema, the read surface and the GYM-8/GYM-9 semantics now so
  B53 is purely a writer when unblocked. The cost — an empty surface (Risk 3) — is visible and
  recorded. The alternative (mark B52 Blocked too) contradicts the step's own scope sentence,
  which pre-authorizes fixture-row testing. Kept.
- **G2 — "Shouldn't the board rank from `personal_records` meanwhile, so it isn't empty?"** No —
  that board would be *unverified* (GYM-3/GYM-4 say verified, video-proven), would need the
  owner-only PR select policy widened (a privacy change B25 deliberately scoped), and would be
  torn out at B53. Three rules against; settled.
- **G3 — "Is `division` on the entry a mirrored copy of `user_body_data.sex`?"** It is a
  *snapshot*, not a mirror — the same spelling vocabulary, a different fact ("the division this
  entry competed in" vs "the sex this account picked"), intentionally allowed to diverge when a
  user changes their pick. The CHECKs are commented to change together. Settled.
- **G4 — "Enum vs text CHECK for `lift`/`division`?"** Text CHECKs: `division` must match
  `user_body_data.sex`'s existing text vocabulary, and `lift` follows the same local style; the
  repo's one enum (`pr_kind`) earned its type by mirroring a TS union in `@training-math`, which
  these do not. Settled.
- **G5 — "Why no `verified` boolean or state column?"** Presence *is* verification: a row exists
  only because B53's writer (or a probe) put it there. A state column would be the
  pending-submission model, which is B53's own table (GYM-10 expiry, approvals) — pending things
  are submissions, board rows are results. Settled.
- **G6 — "Client-side `splitBoard` ranking vs a SQL view with `rank()`?"** The order clause
  already is the rule; a view adds a second schema object to keep in step for zero new
  capability (PostgREST can't window-function anyway without the view). Positional numbering in
  TS is five tested lines. If a measured problem (paging with ranks) arrives, the view is the
  recorded upgrade. Settled.
- **G7 — "One read per lift (three on a full visit) vs one board read?"** Per lift: each read's
  order/limit then matches exactly one ranked list, a truncation can never starve one lift, and
  the first paint needs only the default chip's read. Three small reads on a tab-through is
  launch-scale noise. Settled.
- **G8 — "GYM-9 says 'the new board starts empty for that member' — does anything *enforce*
  starting empty?"** Yes, vacuously: entries key on `gym_id` and nothing copies or moves them —
  there is no code path that could populate the new board. The probe asserts both halves anyway
  (old persists, new empty), so a future regression (e.g. a misguided "bring your PRs with you"
  write) would be caught at the schema probe, not just in review. Settled.
- **G9 — "Does showing an ex-member's name on the old board violate anything?"** No — GYM-9
  *requires* the row to persist, profiles are public-read (B25), and the roster is not consulted.
  A deleted *account* cascades its rows away (NFR-6 beats GYM-9). Settled, spelled in the column
  notes.
- **G10 — facts checked in the repo:** `user_body_data.sex` is `text check (sex in
  ('male','female'))`, nullable, owner-only RLS (`20261114100000_identity.sql:82`) — the
  division vocabulary and the privacy posture above are real. `formatWeight(weightKg, unit)`
  exists in `workout/format.ts:32` over `@training-math`'s `displayWeight`. The gym page
  (`app/gym/[id]/index.tsx`) has the header → join block → members → feed structure the
  Leaderboard row slots into, and `ChoiceChips` is already shared beyond the Tool Kit (B24).
  The fake social client gained `gyms`/`gym_members` in B50 and has no `leaderboard_entries`.
  No migration names `leaderboard_entries`. B50's plan recorded both the "B52 boards are public"
  reading and the "switching strands nothing because submissions key on gym_id + user_id" note
  this schema now honors.
- **G11 — "`numeric(8,3)` caps at 99 999.999 kg — enough?"** The world-record deadlift is ~501 kg;
  five digits of headroom is not the constraint to spend thought on. Matches
  `personal_records.value_kg`. Settled.
- **G12 — "Why `limit=200` and not paging?"** A board page shows top lifts; 200 covers any
  plausible launch gym (B50's fixture gyms have single-digit members). Paging machinery with
  rank continuation is real work with no reader. Recorded revisit trigger: a real gym's board
  read hitting the cap. Settled.
- **G13 — "'Men' / 'Women' as division headers, when the PRD says 'male or female'?"** The PRD
  phrase names the *pick* ("every user picks male or female" — the data vocabulary); "Men" /
  "Women" is how boards address people (every strength-sport federation's convention). The data
  stays `male`/`female`; the labels are one `DIVISION_LABELS` entry each, trivially re-worded if
  Tristen prefers the literal PRD words. Recorded display call.
- **G14 — "Does the `profile:profiles(…)` embed need an FK hint?"** Checked: `user_id` is the
  table's only FK to `profiles`, so the plain embed resolves unambiguously (the B48 hint lesson
  applied only because `conversations` had two). The builder should not add a hint that names a
  constraint the migration doesn't.
- **G15 — Gate 2 status flips, spelled so nobody over-flips:** B52 → Built; **GYM-8 → Built**
  (whole, per Risk 2 unless Gate 1 rereads it); **GYM-3, GYM-6, GYM-9 → In progress** (the B50
  GYM-1 precedent for partials — their DoDs complete with B53's real verified rows).
- **Scope verdict:** right as written. The step's own sentence pre-answers the biggest question
  (fixture rows, B53 owns verified writes); nothing was widened or narrowed. The one coverage
  nuance — GYM-8 claimed whole while its pick-UI lives in B53's submission gate — is argued in
  Risk 2 and left for Gate 1 to confirm.
