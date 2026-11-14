# ui-foundation

Covers **FND-1** (Expo/React Native scaffold, TypeScript) and **FND-4** (six-tab navigation),
plus the shared theme module and a designed placeholder screen per tab. This is the visual and
structural foundation every build-list feature lands on.

**Visual spec:** `docs/styling_guide.md` (extracted from Max Method). The brief pins the direction:
near-black + maroon bands + red-grid texture, `#cc0404` accent with glows, green strictly for
completion, Permanent Marker / Space Grotesk / Manrope. Where the guide speaks, it wins.

## Approach

1. **Scaffold** with `create-expo-app` (default TypeScript + expo-router template) into the repo
   root. Strip the example screens. No `any`; strict TS stays on.
2. **Theme module — one home: `src/theme/`.** `tokens.ts` carries every color, font role, type
   style, spacing step, radius, motion duration and z value from the styling guide as typed
   constants. Nothing hardcodes a color outside this module. (Same single-home rule the training
   math will follow.)
3. **Fonts** via `@expo-google-fonts/permanent-marker`, `/space-grotesk`, `/manrope`, loaded in the
   root layout with a splash hold until ready.
4. **Signature background** as one `AppBackground` component: `expo-linear-gradient` for the
   black→maroon→black bands + a static `react-native-svg` `<Pattern>` for the faint red 60px grid.
   Rendered once per screen via a shared `Screen` wrapper, not per-card.
5. **Navigation (FND-4):** expo-router `Tabs` in `app/(tabs)/` with a **custom tab bar**
   (`AstraTabBar`) — six destinations: Home (`index`), Marketplace, **Workout (center, elevated
   red circular action)**, Communities, Library, You. A JS tab bar never produces the iOS "More"
   overflow, which is exactly why FND-4 asks for a custom bar. Icons from `@expo/vector-icons`
   (ships with Expo — no new dependency).
6. **Shared primitives** in `src/components/ui/`: `Heading` (Permanent Marker), `SectionLabel`
   (Space Grotesk uppercase tracked), `Body`, `Button` (primary / ghost / outline recipes from the
   guide), `Card`, `EmptyState`. Screens compose only these.
7. **Six placeholder screens**, each a *designed empty state with real copy* pointing at the
   feature that will fill it (per `docs/BUILD_LIST.md`):
   - **Home** — feed empty state: "Your feed is empty — follow lifters to fill it" + ghost CTA.
   - **Marketplace** — featured-programs skeleton: section label, three placeholder program cards.
   - **Workout** — the one bold screen: big red "Start workout" CTA, secondary "Empty workout /
     From program" split, Tool Kit teaser row (1RM · RPE · %1RM · Plates · Timer).
   - **Communities** — Teams / Gyms split with join/create empty states.
   - **Library** — search field + muscle-group category chips (the four category colors) over an
     empty exercise-card grid.
   - **You** — profile skeleton: avatar ring, name, follower/following counts, PRs section label.
   Placeholder data is local constants typed against future shapes — no fake persistence.
8. **Routes vs. code:** everything in `app/` is a route file only; components, theme and tests live
   in `src/` (expo-router would otherwise register `*.test.tsx` as routes).

## Testing

- `jest-expo` + React Native Testing Library.
- RNTL tests: tab bar renders all six destinations and navigates (FND-4's DoD, as far as a test
  can show it); each screen renders its title and primary action; Button variants render per
  recipe. Token file gets a small invariants test (completion green ≠ accent, contrast-critical
  alphas present) rather than value-echo tests.
- Verification ceiling on this machine: `tsc --noEmit`, lint, Jest, and `npx expo export`
  (bundle builds). No iOS/Android device run here ⇒ FND-1/FND-4 end this branch **Built**, not
  Done; Tristen's device run flips them.

## Out of scope (separate branches)

Auth, Supabase, SQLite/sync (FND-2/FND-3), any real data or persistence, the actual logger,
animations beyond the guide's hover/press equivalents, app icon/splash artwork (default
placeholders keep the dark bg color).

## Implementation notes (what changed during the build)

- **SDK 58 reality check:** `create-expo-app` now ships Expo SDK 58, whose router no longer
  wraps `@react-navigation/bottom-tabs` and whose template uses `NativeTabs` (the native iOS bar —
  the exact thing that overflows at six tabs). The custom bar is therefore built on the headless
  `expo-router/ui` kit (`Tabs`/`TabSlot`/`TabList`/`TabTrigger asChild`), which injects press
  handlers and `isFocused` into our own button component. `@expo/vector-icons` is no longer
  bundled and was installed explicitly.
- **Code-review findings fixed** (built-in `code-review` skill, this plan as spec): font-load
  errors no longer strand the splash screen; the center Workout button sits fully inside the bar's
  bounds (a negative-margin raise is untouchable on Android) and, per the grilling decision, has
  no text label; the shared `Screen` scroll view passes taps through with the keyboard open;
  unused template deps (react-native-web, react-dom, reanimated, gesture-handler, etc.) pruned;
  the `reactCompiler` experiment removed; jest types imported per test file instead of globally;
  hardcoded font sizes replaced with a new `type.cardTitle` token; chip radius corrected to 6px.
- **Verified:** `tsc --noEmit` clean, 22/22 Jest tests, `expo lint` clean, `expo export` succeeds
  for both android and ios; no color/rgba literal exists outside `src/theme`.

## Grilling decisions (settled before code)

- **"UI/UX max pro" skill is not installed on this machine** — substituted Anthropic's
  `frontend-design` guidance + this plan's design pass. If Tristen installs `ui-ux-pro-max`,
  a later branch can re-audit the screens against it.
- **Workout as a tab, not a modal FAB:** FND-4 names it as one of the six destinations; PRD wins.
  It still reads as the elevated center action in the custom bar.
- **Grid texture on mobile — keep or cut?** Kept: it's the signature texture, and a static SVG
  pattern is one draw, no rerenders. If profiling ever shows cost, the `AppBackground` seam makes
  it a one-line removal.
- **Permanent Marker legibility:** display sizes only (screen titles, brand, big numbers). All
  sub-14px text is Space Grotesk/Manrope — matches the source system, avoids unreadable marker
  text at small sizes.
- **Six labeled tabs on narrow phones:** 10px uppercase labels at 0.08em tracking fit at 360pt
  width with the center action taking no label chrome. Icon-only fallback rejected — labels are
  the system's own convention and aid first-run comprehension.
- **No extra icon/dependency shopping:** `@expo/vector-icons` only ("add nothing speculative").
  `expo-linear-gradient` and `react-native-svg` are Expo-SDK-blessed and required by the brief's
  background; both justified.
- **Scaffold-into-nonempty-root problem:** `create-expo-app` into a temp dir, then copy into the
  repo root (keeping our README/docs), rather than hand-writing package.json with guessed
  versions.
- **Scope challenge — "all initial tabs/pages" could balloon into building features:** held to
  designed empty states + primitives. Any screen logic beyond navigation and static placeholder
  content was cut from this branch.
- **CLAUDE.md's grilling/code-review skills (`mattpocock-skills:*`) are unavailable in this
  session** — this section is the grill of record; the built-in `code-review` skill substitutes
  at the Review step, with this file passed as the spec.
