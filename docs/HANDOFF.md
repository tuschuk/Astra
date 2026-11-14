# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — UI foundation session)

**The app now exists, in a monorepo.** The Expo app lives in `frontend/` (run app commands from
there), Supabase will live in `backend/` (README maps the FND-2 structure). The `ui-ux-pro-max`
skill is installed user-level (`~/.claude/skills/ui-ux-pro-max`) and was run against the tabs —
findings and the carry-forward checklist are in `docs/ui_ux_audit.md`; its palette suggestion was
rejected (brand is locked by `docs/styling_guide.md`), its UX fixes were applied (platform-aware
48dp Android touch targets, pressed feedback everywhere, decorative icons hidden from screen
readers, Workout CTAs honestly disabled until LOG-1).

Branch `ui-foundation` (plan: `docs/feature_plans/ui-foundation.md`,
grilled + code-reviewed) holds the Expo SDK 58 / TypeScript scaffold with:

- `src/theme/` — single-home design tokens from `docs/styling_guide.md` (colors, 3-font type
  system, spacing, radii, glows, motion). No color/font literal exists outside this module.
- `src/components/` — `AppBackground` (maroon gradient + red SVG grid), `Screen` wrapper,
  `AstraTabBar` (custom six-tab bar on headless `expo-router/ui`; raised red center Workout
  action), and `ui/` primitives (Heading/SectionLabel/Body, Button ×3 variants, Card, EmptyState).
- `src/app/(tabs)/` — six designed placeholder screens: Home, Marketplace, Workout, Communities,
  Library, You.
- Verified: `tsc` clean, 22/22 Jest tests (jest-expo + RNTL), `expo lint` clean, `expo export`
  builds for both ios and android. **Not verified: a run on a real device/simulator** — FND-1 and
  FND-4 sit at `Built`, and flip to `Done` after Tristen runs it on both platforms (`npx expo start`).

Notable: SDK 58 dropped `@react-navigation/bottom-tabs` from expo-router and doesn't bundle
`@expo/vector-icons`; the tab bar uses the headless `expo-router/ui` kit. Unused template deps
(react-native-web, reanimated, gesture-handler, …) were pruned per the no-speculation rule.

**For Tristen:** review + merge `ui-foundation` (Gate 2 style), run the app on a device. The
"UI/UX max pro" skill wasn't installed on this machine — screens were designed from
`docs/styling_guide.md` + Anthropic's frontend-design guidance; install `ui-ux-pro-max` if you
want future sessions to audit against it. Also still open from the pipeline session: copy
`automation/claude-settings.example.json` → `.claude/settings.json`; n8n API key is live in `.env`.

Next build items: FND-2 (Supabase project + auth) or LOG-1/LOG-2 (logger core) — the tab shells
are ready to receive them.
