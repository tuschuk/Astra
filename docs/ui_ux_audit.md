# UI/UX Pro Max audit — foundation screens

Run Nov 14, 2026 with the `ui-ux-pro-max` skill (installed this session at
`~/.claude/skills/ui-ux-pro-max`) against the six foundation tabs. Queries: `--design-system`
("strength training social fitness dark"), `--domain ux` (navigation, empty states, touch
targets), `--domain product` (fitness), `--stack react-native` (touch feedback, lists), plus the
skill's `pro-rules.md` pre-delivery checklist.

## Standing rule

`docs/styling_guide.md` is the visual source of truth. The skill's generated palette
(orange `#F97316` / Barlow) is a recommendation and was **rejected** — the brand (red `#cc0404`,
Permanent Marker / Space Grotesk / Manrope, near-black + maroon) is locked. The skill's own terms
agree: results are recommendations and never override repository rules. Its *product database*
independently validates the direction: Fitness/Gym apps → "Vibrant & Block-based + Dark Mode
(OLED)", motion-driven, gamification encouraged.

## Findings applied (this session)

| Finding (skill source) | Fix |
|---|---|
| Android touch floor is 48dp, not iOS's 44pt (ux: Touch Target Size) | `layout.minTouchTarget` is now platform-aware: 48 Android / 44 iOS |
| Every tap needs visual feedback within 80–150ms (react-native stack + pro-rules) | Tab buttons: `android_ripple` + pressed opacity; Library category chips: pressed opacity. (Buttons already had pressed recipes.) |
| Decorative icons must be hidden from the accessibility tree (pro-rules: Contextual Semantics) | EmptyState icon, Library search icon, You avatar glyph now set `accessibilityElementsHidden` / `importantForAccessibility="no"` |
| Controls that look tappable but do nothing (pro-rules: Disabled state clarity) | Workout's two start CTAs are disabled with an honest "being built" hint until LOG-1 wires them |
| Empty states need message + action (ux: Empty States) | Already satisfied — kept |

## Accepted deviations

- **Six bottom-nav destinations** (guideline: ≤5): mandated by the PRD (FND-4). Mitigations: the
  center Workout action carries no label chrome, labels are short (Market, Groups), and the
  custom bar avoids the iOS "More" overflow entirely.
- **Outline icons idle / filled icons active** in the tab bar: a deliberate state signal, not a
  mixed-style violation (one family — Ionicons — throughout).

## Carry-forward checklist (apply as features land)

- `inputmode`/`keyboardType="numeric"` on all weight/reps inputs (logger, TK calculators).
- `FlatList` + memoized rows for the feed, library grid and marketplace once they hold real data
  (50+ items) — the current static placeholders are fine in a ScrollView.
- Reduced-motion: respect `useReducedMotion` when real animations arrive (none yet beyond press
  states); one orchestrated moment, not scattered effects.
- Dynamic Type / largest text size + 375px-width + landscape passes on device (needs the device
  run that also flips FND-1/FND-4 to Done).
- Form errors inline next to fields; error summary focus for multi-error forms (auth, program
  builder).
- Gamification surface (per the fitness product profile): PR celebration moment post-workout —
  design it with ANA-2, keep it reduced-motion-safe.
