# accessibility-pass — B49: labels, roles, focus order, dynamic type and contrast

**Branch:** `accessibility-pass` (from `main`)
**Build step:** B49 — covers **NFR-10** (Accessibility: screen readers, dynamic text, contrast) in
full. Step DoD: a VoiceOver and TalkBack walkthrough and a contrast check pass.
**Depends on:** B28 (the last feed surface; every core-flow screen this step audits is merged).

## Scope reading

The step names four core flows — **log, feed, profile, library** — and five concerns: labels,
roles, focus order, dynamic type, contrast. The plan treats this as **an audit with fixes, not a
redesign** (the handoff's standing input). Three readings settled up front:

1. **Shared primitives are in scope even though every screen uses them.** The core flows are
   built from `components/ui/*` (Text, Button, TextField, ChoiceChips, Card, EmptyState,
   FormError), `AstraTabBar` and `ProfileButton`. Fixing dynamic type or a role there is the
   single-home fix; other screens improving incidentally is a side effect, not scope creep.
   Screens *outside* the four flows (teams, marketplace, messages, settings, programs) are
   **not individually audited** — they inherit the primitive fixes only.
2. **Contrast is fixed in the theme, nowhere else.** `frontend/src/theme/tokens.ts` is the
   single home for color; any failing pair is fixed by a token change or a new token, never by
   a hardcoded color at a call site (the theme file's own rule).
3. **The walkthrough half of the DoD is Tristen's device check.** A headless session cannot run
   VoiceOver or TalkBack. The session-provable half is: the contrast Jest test passes, RNTL
   queries find every control by role and label, and the code patterns that make a walkthrough
   pass (labels, roles, states, growing layouts) are in place and pinned by tests. Built → Done
   stays Tristen's, with a concrete walkthrough script (below) so the check is repeatable.

## What already exists (audit baseline, verified in the repo)

- ~272 `accessibilityRole` / `accessibilityLabel` / `accessibilityState` usages across 72 files.
  `Button` defaults its label and carries disabled state; `Heading` sets `role="header"`;
  the tab bar sets `role="tab"` + `selected`; chips use roles and states; `EntryCard` (24 uses)
  and `PostCard` (17) are substantially labeled already.
- Decorative elements are hidden (`AppBackground`, avatars, `EmptyState` icon, muscle map and
  trend chart internals via `accessibilityElementsHidden` / `importantForAccessibility`), with
  the muscle map and each trend chart speaking one summary sentence.
- `TimerScreen` announces round/phase changes through `AccessibilityInfo.announceForAccessibility`.
- `layout.minTouchTarget` (44pt iOS / 48dp Android) is applied across buttons, chips, icon
  buttons and rows; `tokens.test.ts` pins the ≥ 44 floor.
- Every sheet (`ToolKitSheet`, `ExercisePicker`, `ProgramPickerSheet`, `ReportSheet`,
  `CustomExerciseForm`, `NewProgramForm`, coach sheets) is a native RN `Modal`, which both
  platforms treat as a focus-trapping window natively; confirm dialogs are native `Alert`s.
- **Nothing anywhere handles font scaling**: no `allowFontScaling` / `maxFontSizeMultiplier`,
  and the theme's `type` scale is fixed points. RN's default (`allowFontScaling` true) already
  multiplies `fontSize` *and* `lineHeight` by the OS font scale, so text itself scales today —
  what breaks at large scales is **containers**: fixed heights (`EntryCard`'s 26×26 set badge,
  the 56px tab-bar circle), dense side-by-side rows, and display-class text (the 88px timer,
  40px display headings) growing past the screen.
- No contrast check exists. Computed ahead of the audit: `muted` (72% white on `bg`) ≈ 9.5:1
  (AAA, as its comment claims) and `mutedDecor` ≈ 5.1:1 pass; **brand red `accent` #cc0404 used
  as small text on the dark background ≈ 3.2:1 — fails AA's 4.5:1** (passes the 3:1 large-text
  and non-text minimums); white on `accent` ≈ 5.9:1 passes. The failing class is confirmed at
  real core-flow sites (grep-verified): `EntryCard`'s History link and superset badge, the
  analysis screen's `sectionLabel`, the saved session's `supersetLabel`, the post-workout
  flair label, the library `FilterChip`'s active label, and the tab bar's focused label
  (10px accent on pure black ≈ 3.6:1).

## Approach — five work packages

### 1. Contrast: a pure helper + a Jest test over the palette pairs the app uses

- **`frontend/src/theme/contrast.ts`** (new, ~40 lines, no dependency): `relativeLuminance(hex)`,
  `compositeOver(overlayRgba, baseHex)` (the palette's translucent whites/reds must be
  alpha-composited over `bg` before measuring), and `contrastRatio(fg, bg)` per WCAG 2.1. Pure
  functions with plain-language docstrings. This is UI theme code, not training math — it lives
  in `theme/`, imported only by tests (and by nothing at runtime).
- **`frontend/src/theme/contrast.test.ts`** (new): unit-tests the math against WCAG's published
  reference values (white/black 21:1, etc.), then asserts every **used, information-bearing
  pair** meets its minimum: 4.5:1 for normal text, 3:1 for large text (≥ 18pt / 14pt bold) and
  for non-text UI (borders of interactive controls, icons — WCAG 1.4.11). The pair list is
  written out in the test with a comment naming where each pair occurs (text on `bg`, text on
  `surface*` tiers composited over `bg`, white on `accent`, `chipText` on `accentDim`,
  `error`/`warn`/`info`/`gold`/`green` on `bg`, category colors on their dim fills, tab label
  colors on `navBg`). Explicit exemptions, each with a reason in a comment: `mutedDecor`
  (documented decorative-only), `gridLine`/`navBorder`/`border` (non-interactive hairlines),
  glow shadows.
- **Failures found by the test are fixed in `tokens.ts`**, with the known one handled like this:
  add **`accentText`** — a lighter red (tuned to clear 4.5:1 on `bg`, in the `error` #ff6b6b
  neighborhood) for information-bearing small red text — and move the audit's failing usages in
  the four core flows onto it. `accent` itself (buttons, fills, borders, large display numbers)
  is identity and passes its 3:1 non-text/large-text minimums; it is not rebranded. If the
  audit finds a failing pair whose cheapest honest fix is contentious (e.g. a color that *is*
  the meaning), the builder records it in this file's Deviations and leaves the token change to
  Tristen rather than silently shifting the brand.

### 2. Dynamic type: let text scale, cap only what breaks, make containers grow

Default posture: **text scales uncapped** (RN's default). The work is making layout survive it,
with caps as recorded exceptions:

- **`tokens.ts` gains a small `fontScaleCaps` table** (the single home for every cap, each with
  a why-comment): `display`/`title`/`timer`-class text capped (~1.4×, timer ~1.2× — an 88px
  digit at 2× is wider than a phone), `label`/`labelSmall`/`button` capped (~2×, uppercase
  tracked labels in fixed chrome), body/input/card text **uncapped**. The `ui/Text.tsx`
  primitives (`Heading`, `SectionLabel`, `Body`), `Button` and `TextField` pass the matching
  `maxFontSizeMultiplier`; raw `<Text>` call sites in the four core flows that spread a capped
  `type.*` style get the same prop where the audit shows breakage (tab bar labels, the timer,
  stat values).
- **Container audit across the core flows**: replace text-bearing fixed `height:` with
  `minHeight:` + padding (`EntryCard`'s set badge, anything found by `grep` for `height:` in
  the flows' styles), confirm multi-column rows (`EntryCard`'s set rows and action row,
  `PostCard` header/footer, library chip rows, profile stat tiles) wrap or grow at 2× scale
  rather than clipping or overlapping, and check `numberOfLines` usages still make sense (a
  truncated title is acceptable; truncated *information* is not).
- The tab bar: labels capped; the 56px center circle keeps its size (icon-only, no text) — its
  label is spoken, not drawn.
- Not testable end-to-end in Jest (no real font-scale rendering): unit tests pin that the
  primitives pass `maxFontSizeMultiplier` from `fontScaleCaps`, and the device walkthrough
  (script below) covers the rest at 200% text.

### 3. Labels and roles: close the audit's gaps in the four flows

Screen-by-screen audit (code walkthrough + RNTL `getByRole`/`getByLabelText` queries), fixing
what it finds. Known gap classes to hunt, from the baseline survey:

- **Icon-only pressables** without labels (any missed among `EntryCard`'s header icons, vote
  arrows, `⋯` menus, close buttons, the library search clear).
- **Raw `<Text>` section headings** not using `Heading` (no header role) — screens hand-rolling
  `type.sectionTitle`/`label` spreads where a header role would let a screen-reader user jump
  by section.
- **State not spoken**: toggles/chips missing `accessibilityState({ selected/checked/disabled })`;
  expanded/collapsed where applicable (`EntryCard` note rows, "Show more" buttons).
- **Dynamic values**: controls whose meaning changes (vote score, set numbers, timer) get
  `accessibilityLabel`/`accessibilityValue` that include the current value in words, following
  the existing one-sentence pattern (muscle map, trend charts).
- **Grouping**: a `PostCard`'s header (author · date · flair) and each logged set row read as
  one sensible utterance (`accessible` grouping with a composed label) instead of five fragments,
  where the audit shows fragmentation — applied to list rows in the four flows only.
- Images: `Avatar` stays hidden-decorative (the author's name is adjacent text); post photos get
  a short content-free label ("Photo in the post" / the flair's words — there is no caption
  data; no AI description, per the no-AI rule).

### 4. Focus order and modals

Native `Modal` + native `Alert` already trap focus. The audit checks, per sheet in the core
flows (`ToolKitSheet`, `ExercisePicker`, and the confirm dialogs; `ProgramPickerSheet` only via
its shared patterns since programs are outside the four flows):

- The first meaningful element a screen reader lands on is the sheet's title or purpose, and a
  labeled Close is reachable early (not after 40 calculator cells).
- `onRequestClose` (Android back) is wired on every Modal — spot-verified, it already is.
- Source-order sanity on the screens themselves: visual order == reading order (RN reads in
  tree order; no `position: absolute` element in the four flows should read out of sequence —
  the floating `ProfileButton` and Tool Kit button get checked and, if needed, moved in tree
  order or given labels that stand alone out of context).
- Screen transitions: expo-router/native-stack moves screen-reader focus on push natively; no
  custom focus management is added (nothing speculative).

### 5. Tests that pin it

- `theme/contrast.test.ts` — the contrast half of the step DoD, as above.
- `theme/tokens.test.ts` — extended: every `fontScaleCaps` entry maps to a real `type` style;
  caps are ≥ 1 (a cap below 1 would *shrink* text).
- Primitives: `Text.test.tsx` (new), `Button.test.tsx`, `TextField.test.tsx` extended — role,
  label, state, and the `maxFontSizeMultiplier` wiring.
- Existing screen/component tests extended where the audit changes a surface: queries move to
  `getByRole`/`getByLabelText` for the controls touched (EntryCard, PostCard, VoteControl,
  library tab, ProfileView, exercise detail), which *is* the regression test that labels and
  roles exist. No snapshots (handoff's steer).

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/theme/contrast.ts` (+ `contrast.test.ts`) | new — WCAG math + the palette-pair assertions |
| `frontend/src/theme/tokens.ts` | edit — `accentText` token (and any other audit-driven token fix), `fontScaleCaps` |
| `frontend/src/theme/tokens.test.ts` | edit — cap invariants |
| `frontend/src/theme/index.ts` | edit — export the new pieces |
| `frontend/src/components/ui/Text.tsx` (+ new test), `Button.tsx`, `TextField.tsx`, `ChoiceChips.tsx`, `Card.tsx`, `EmptyState.tsx`, `FormError.tsx` | edit — caps, role/label/state gaps |
| `frontend/src/components/AstraTabBar.tsx`, `ProfileButton.tsx` | edit — label caps, floating-control audit fixes |
| Log flow: `app/(tabs)/workout.tsx`, `app/active-workout.tsx`, `components/workout/EntryCard.tsx`, `ExercisePicker.tsx`, `WorkoutDetailsFields.tsx`, `WorkoutListItem.tsx`, `app/post-workout/[id].tsx`, `app/analysis/[id].tsx`, `app/session/[id].tsx`, `app/workout/[id].tsx`, `components/toolkit/ToolKitSheet.tsx` (+ the four calculators/timer only where the audit finds gaps) | edit — audit fixes |
| Feed flow: `app/(tabs)/index.tsx`, `components/social/PostCard.tsx`, `VoteControl.tsx`, `CommentsPane.tsx`, `UserCard.tsx`, `FollowButton.tsx` | edit — audit fixes |
| Profile flow: `app/(tabs)/you.tsx`, `app/profile/[id].tsx`, `components/profile/ProfileView.tsx`, `TrendChart.tsx`, `app/edit-profile.tsx` | edit — audit fixes |
| Library flow: `app/(tabs)/library.tsx`, `app/exercise/[id].tsx`, `app/exercise-history/*`, `components/library/CustomExerciseForm.tsx` | edit — audit fixes |
| Affected `*.test.tsx` beside each | edit — role/label queries |
| `docs/diagrams/app-flow.md` | edit (Document step) — one note on the accessibility sentence pattern; nothing structural |
| `docs/BUILD_LIST.md` | untouched by the builder (statuses flip at Gate 2) |

The exact per-screen fix list is the audit's output, recorded by the builder as checked boxes in
this file's Deviations section — the plan deliberately does not pretend to know every missing
label in advance.

## Data model impact

None. No migration, no device schema change, no RLS change. The ERD is untouched. `app-flow.md`
gains at most a note (the diagrams draw structure, and none changes).

## How the definitions of done become observably true

- **"a contrast check passes" (step DoD / NFR-10 "meet contrast minimums"):**
  `theme/contrast.test.ts` computes WCAG 2.1 ratios for every used palette pair and fails the
  suite on any regression — green in CI *is* the contrast check passing, and it keeps passing
  for every future token edit.
- **NFR-10 "honor dynamic text sizes":** text scales by default; the caps table and container
  fixes make the four flows survive 200% text. Jest pins the wiring; the on-device half is step
  2 of the walkthrough script below.
- **NFR-10 "screen readers" / step DoD walkthrough:** the audit closes label/role/state/order
  gaps and RNTL role-based queries pin them. **Walkthrough script for Tristen (Built → Done):**
  with VoiceOver (iOS) then TalkBack (Android), and once more with OS text size at maximum:
  (1) log a two-exercise workout — pick exercises, log sets incl. a warm-up toggle and a set
  note, open the Tool Kit mid-workout, finish to the analysis screen; (2) swipe through the Home
  feed — a workout post, a photo post, vote, open comments, open an author profile; (3) open You
  — tabs, stats, trends (each chart speaks its sentence); (4) Library — filter chips, search,
  open an exercise detail, "Your history". Pass = every control is announced with a sensible
  name/role/state, nothing is unreachable or trapped, no text is clipped at max size.

## Out of scope (and where it lands)

- **Non-core flows** (teams, marketplace, messages, programs, settings, auth): primitive-level
  fixes reach them; a dedicated audit is a later step if NFR-10's device check demands one.
- **Chart interactivity** (DEFERRED's B46 note "B49 may raise the bar beyond one spoken sentence
  per chart"): settled — the one-sentence summary **is** this step's bar. Tap-a-point data
  exploration is a feature, not a label; deferred until a lifter asks.
- **Reduced-motion support**: the app's motion is two durations and no auto-playing animation;
  nothing to reduce. Revisit if animated surfaces land.
- **Light mode / user-selectable themes**: not a product feature; contrast is fixed for the one
  dark theme.
- **A11y linting (`eslint-plugin-react-native-a11y`)**: not added — the contrast test and
  role-based queries are the enforcement this step earns; a lint rule is tooling the next audit
  can adopt on evidence. (It is also a new dev dependency; nothing speculative.)
- **Accessibility statement / copy**: no product copy changes, so the numeric-claim rule is
  untouched.

## Risks a reviewer should weigh

1. **The caps table is judgment, not measurement.** Until a phone renders 200% text, the chosen
   multipliers (1.4× display, 1.2× timer, 2× labels) are informed guesses; a cap too low
   quietly under-serves low-vision users (the feature's whole audience), a cap too high breaks
   chrome. Mitigation: caps only on display-class and chrome text, body/input text uncapped,
   every cap carries a why-comment, and the walkthrough script tests max text size explicitly
   so Tristen's device check catches bad values before Done.
2. **The contrast pair list is hand-enumerated.** A pair the test doesn't list isn't checked —
   the same mirror-by-hand trade the repo already accepts for `limits.ts`/`mediaLimits.ts`,
   commented the same way. The audit builds the list from real call sites; a future screen
   using a new pair must add it. (Automated extraction of pairs from styles would be a tool,
   not a test — not earned yet.)
3. **Touching 25+ shipped screens/components invites regressions.** Every change is
   prop/style-level (labels, roles, minHeight, caps, one token), no logic moves — but the diff
   is wide, and wide diffs hide typos. Mitigation: the full Jest suite (1920 tests) already
   covers these surfaces behaviorally; the builder runs it cold at default workers before
   hand-off, and Gate 2 reruns everything plus `expo start` → `tsc` → lint in the recorded order.
4. **`accentText` changes how the brand red reads in small text.** Deliberate and confined: a
   new token used only where small red text carries information; buttons, fills, big numbers
   and borders keep #cc0404. If on device the lighter red reads wrong, it is one token to tune.

## Grilling decisions (settled)

Grilled in the planner session at full severity (the pipeline's planner holds the delegated
decisions); every checkable claim verified in the repo before writing.

- **G1 — "An audit-shaped plan is a blank check: 'fix what we find' could swell into a redesign."**
  Bounded three ways: only the four named flows plus the shared primitives they're built from;
  only the five named concerns; and the fix vocabulary is closed (add label/role/state/value,
  group a row, swap height→minHeight, pass a cap, retoken a color). Anything outside that
  vocabulary — a layout rebuilt, a component rewritten, a new interaction — goes to Deviations
  as a proposal, not into the diff. The builder records the audit's findings as a checklist in
  this file, so Gate 2 can see exactly what "what we found" was.
- **G2 — "Why cap display text at all? WCAG says *don't* interfere with scaling."** WCAG 1.4.4
  requires 200% for *content* text, which stays uncapped (body, inputs, cards, notes). The caps
  are on decoration-scale display text (an 88px timer digit at 2× is 176px — wider than a
  phone column) and fixed chrome (tab labels), where unbounded growth makes the screen *less*
  usable at exactly the moment a low-vision user needs it. iOS's own guidance scales large
  display styles sublinearly. The table keeps every judgment in one commented place.
- **G3 — "The contrast test asserts tokens, not screens — a screen could still hardcode a bad
  pair."** True, and already the repo's standing rule: nothing outside `src/theme` may hardcode
  a color (tokens.ts header). The audit greps the four flows for hex/rgba literals as part of
  closing gaps; the test then guards the single home those screens must use. A runtime
  style-sniffing test would be machinery the repo's own conventions make unnecessary.
- **G4 — "Is `accentText` a second red — a palette fork?"** It is the same pattern as
  `muted`/`mutedDecor`: one hue, roles separated by use, defined beside each other in the one
  palette with comments saying which is for what. The alternative — relaxing to 3:1 by calling
  all red text 'large' — fails the audit honestly: `type.bodySmall`-sized red text exists (PR
  badges, error-adjacent emphasis) and 12px is not large text.
- **G5 — "Grouping set rows / post headers into one utterance can hide their inner buttons."**
  Only rows whose children are *not* individually interactive get merged (`accessible={true}`
  collapses children). Rows with buttons inside (a set row's W toggle and remove) instead get
  labels on each control plus a spoken value on the row's text, so nothing interactive
  disappears. This rule is written into the audit checklist so the builder doesn't rediscover
  it per row — it is the known RN grouping footgun.
- **G6 — "Why no automated a11y lint if the repo loves enforcement?"** Tried against the rules:
  the plugin flags missing props syntactically but can't judge label quality, grouping, or
  contrast — the three things this step actually fixes — and it would instantly flag dozens of
  intentional patterns (hidden decorative views). Cost (a dependency + a noise-triage pass)
  exceeds what it catches beyond the RNTL role queries this step already adds. Revisit on
  evidence: if a later step ships an unlabeled control the queries missed, the plugin earns in.
- **G7 — facts checked in the repo:** (a) every sheet named is a native `Modal`
  (grep-verified, 8 files); (b) `minTouchTarget` is already platform-correct (44/48) and
  pinned by a test; (c) no `allowFontScaling`/`maxFontSizeMultiplier` exists anywhere in
  `src/` (grep: zero hits), so nothing fights the new caps; (d) `muted`'s AAA and
  `mutedDecor`'s AA claims in tokens.ts comments are *approximately* right by computed ratio
  (9.5:1, 5.1:1) — the test replaces approximate with pinned; (e) the accent-as-small-text
  failure (≈ 3.2:1) is real and present in the flows at the seven grep-verified sites listed
  in the baseline section, so the plan's one predictable fix is not hypothetical; (f)
  `TrendChart`/`MuscleMap` already
  follow the hide-internals-speak-a-sentence pattern the DEFERRED note asks this step to
  reconsider — kept (Out of scope); (g) no new dependency is needed for any of this (the
  no-spend and nothing-speculative rules hold: zero installs).
- **Scope verdict (planner):** right as written. The one deliberate widening — shared
  primitives — is argued in Scope reading 1 and is the single-home rule applied to UI. The one
  deliberate narrowing — non-core flows untouched beyond primitives — matches the step text
  ("across the core flows") and NFR-10's own DoD ("core flows pass").

## Audit findings and deviations (builder, B49)

### What the audit found and fixed

**Contrast** (`theme/contrast.ts` + `contrast.test.ts`, 35 assertions, all green):
- [x] Measured ratios (composited over `bg`): `muted` 10.1:1, `mutedDecor` 5.3:1, `accent`
  #cc0404 3.3:1 on `bg` / 3.6:1 on `navBg` (fails small text, passes non-text), white on `accent`
  5.9:1, white on `accentBright` 5.0:1, `error` 7.0, `warn` 6.2, `info` 12.7, `gold` 13.9,
  `green` 7.8; category colors on their dim fills 6.0–8.5.
- [x] New token `accentText` #ff4d4d (5.9:1 on `bg`, ≥ 4.5 on card surfaces and `navBg`). Moved
  onto it: EntryCard History link + Superset badge, analysis section labels, saved workout's PR
  badge + Superset label, session view's Superset label, post-workout Flair label, tab bar focused
  label. The library FilterChip's active label was already white (its accent is the border —
  non-text, passes), so the baseline's listing of it was a false positive.
- [x] `docs/styling_guide.md` notes the split (it still described small accent-red text).

**Dynamic type:**
- [x] `fontScaleCaps` in `tokens.ts` (display/title 1.4, sectionTitle 1.6, timer 1.2,
  statValue 1.6, label/labelSmall/button 2); body, bodyMuted, bodySmall, input, cardTitle
  uncapped and pinned uncapped by `tokens.test.ts`.
- [x] `Heading`, `SectionLabel`, `Button` pass their caps; `Body` takes `scaleAs` for the one
  call site that restyles it as a stat value (profile count tiles). Raw `<Text>` sites: timer
  digits (timer cap), ResultCard value (display cap), tab labels (labelSmall cap).
- [x] Fixed-size text containers → floors: EntryCard W/link badge (26×26 → min 26 + padding);
  "Set n" column `width: 48` → `minWidth: 48` in the logger, saved workout, session view and
  exercise history; analysis stat labels `width: 80` → `minWidth: 80` with a wrapping row.
- [x] Checked, no change needed: Home header actions already wrap; PostCard photo frame is a
  picture (fixed height is fine); 8px dots and the 56px tab circle hold no text.

**Labels, roles, state, grouping:**
- [x] Section headings now announced as headers: Home "Your feed" / "Your teams", Workout tab
  "Tool Kit" / "Past workouts", Library "Your exercises", profile "Teams", analysis "Against your
  trend" / "Muscles trained" / "New PRs", post-workout "Flair", exercise detail "Muscles worked" /
  "How to do it" / "Tips" / "Your history", history "Current PRs"; exercise names in the logger,
  saved workout and session view and each history session title are headers.
- [x] Set rows read as one sentence via the new `spokenSetLabel` / `spokenSetText` in
  `workout/format.ts` ("Set 2: Warm-up, 8 × 225 lb, then 8 × 185 lb"); the logger's grouping
  wraps only the label + text, so its note / W / remove controls stay separate stops (G5); drop
  rows speak "Drop n: …". Analysis stats speak "Volume: 4,850 kg".
- [x] PostCard author button speaks the handle and age ("Open Wendy's profile, @wod_queen, 2h
  ago" — they were swallowed by the button); the flair View is now `accessible` (its label was
  unreachable on iOS); comment rows read as one sentence; exercise tips read without "bullet".
- [x] VoteControl's refusal message is an `alert` live region (it was silent).
- [x] Already sound, no change: every icon-only pressable in the four flows had a label; chips
  and toggles carry selected/checked/disabled; PostCard photos are labeled "Post photo".

**Focus order and modals:**
- [x] ExercisePicker and ToolKitSheet: title first, Cancel/Close second, `onRequestClose` wired.
  Active-workout Tool Kit button ("Open Tool Kit") and ProfileButton ("Your profile") float
  out of tree order with labels that stand alone. No change needed beyond the touch-target note
  below.

### Deviations from the plan

1. **`borderStrong` and `accentBorder` are exempted from the 3:1 non-text check** (the plan
   asked for "borders of interactive controls" at 3:1). They measure 1.7:1 and 1.4:1. WCAG
   1.4.11 needs a 3:1 boundary only where the boundary is what identifies the control, and every
   Astra input, ghost button and chip is identified by its own text or field label (chip
   selection is also spoken). Raising them to 3:1 would restyle every control in the app — a
   brand call, so per the plan's own rule ("leaves the token change to Tristen") the exemption is
   written into `contrast.test.ts` and listed here for Tristen to decide.
2. **`accentText` also applied outside the four flows** at `new-post.tsx` (composer label) and
   `marketplace-program/[id].tsx` (author name): the same failing pair, fixed by the same token.
   Not a screen audit, just a one-line token swap.
3. **Touch targets** (not one of the five named concerns): ProfileButton now sizes to
   `layout.minTouchTarget` (it was a hardcoded 44, under Android's 48dp), and the ⋯ report
   buttons on PostCard and CommentsPane got a min-touch-target box (an 18–20px icon plus hitSlop
   was ~36px).
4. **Tab labels shrink to fit** (`numberOfLines={1}` + `adjustsFontSizeToFit`) on top of the 2×
   cap, so "LIBRARY" at large sizes shrinks within its fifth of the bar instead of wrapping into
   the icon. The tab's spoken name is unaffected.
5. **TextField.test.tsx not extended**: TextField has no new code — its label is a
   `SectionLabel` (cap pinned in `Text.test.tsx`) and its input is deliberately uncapped.
6. **Review (code-review skill) fixes:** the spoken set label was deduplicated into
   `spokenSetLabel`; a round-trip test now pins `spokenSetText` against `formatDropSet`'s real
   output (so a separator change can't silently garble speech); `Text.tsx` rest props renamed
   (`textProps`, `styleName`); VoteControl, CommentsPane and exercise-detail tests now pin the
   alert, the grouped comment row, the section headers and the tips. Left as-is (judgement
   calls): the two identical min-touch-target styles in PostCard / CommentsPane (two lines each,
   different components) and the separate author-line builders.
