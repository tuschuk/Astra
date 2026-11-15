# tool-kit-timer — B17: The Tool Kit timer (TK-5)

**Branch:** `tool-kit-timer` (from `main`)
**Build step:** B17 — covers TK-5 whole: rest timer and stopwatch, CrossFit-wall-timer style;
count-up, countdown, EMOM, AMRAP, Tabata; runs in background.
**Depends on:** B16 (the Tool Kit sheet and its two entry points; the `initialTool` seam and the
Workout tab's placeholder Timer tile were left for exactly this step).

## Step definition of done (from the Build order)

Count-up, countdown, EMOM, AMRAP and Tabata modes, timestamp-based so they stay accurate while
backgrounded, with a local notification at zero. All five modes keep correct time across
backgrounding on both platforms.

## Scope check

The scope is right as written and this plan stays inside it. Two readings are recorded rather
than silently chosen:

- **"A local notification at zero"** is read literally: one notification when a finite timer
  (countdown, EMOM, AMRAP, Tabata) reaches its end. Interval boundaries inside EMOM and Tabata
  (each minute, each work/rest flip) are shown on screen but do **not** each fire a notification
  — see the grilling decisions for why.
- **"On both platforms"** cannot be observed from Jest. The math and the mode logic are proven
  in tests by jumping a fake clock (backgrounding is, to timestamp math, indistinguishable from
  time passing — that equivalence is the design); the OS layer (JS timers pausing, the
  notification actually firing) is Tristen's device run on both platforms, the same Built → Done
  split every prior step used. Gate 2 flips B17/TK-5 to Built on green tests; Done is the device.

## Approach in one paragraph

A timer is three timestamps, not a counter. The engine stores `startedAt`, `pausedAt` and the
total milliseconds spent paused, and every display frame is *derived* from `Date.now()` — nothing
increments, so a JS runtime that freezes in the background can't lose time. Each finite mode can
compute the wall-clock moment it hits zero, and that moment is handed to the OS as a scheduled
local notification (`expo-notifications`) the instant the timer starts or resumes — so the alert
fires on time even if the app is backgrounded or killed, with no background task, no push
service, nothing paid. The timer lives in a module-level store (the `toolkit/session.ts`
precedent), so closing the sheet to log a set never stops it.

## What this step builds

### 1. The timer engine (`frontend/src/toolkit/timer.ts`)

Pure functions and types, no React, no I/O — the single home for timer math (nothing here
belongs in `@training-math`: that module is *training* math shared with the server — e1RM, PRs,
plates; elapsed-time arithmetic is the Tool Kit's own and is used nowhere else).

- `TimerMode = 'stopwatch' | 'countdown' | 'emom' | 'amrap' | 'tabata'`.
- Per-mode config: stopwatch none; countdown `{ durationMs }`; EMOM `{ intervalMs, rounds }`
  (interval editable — E90S exists — default 60 s × 10); AMRAP `{ durationMs }`; Tabata
  `{ workMs, restMs, rounds }` (defaults 20 s / 10 s × 8, the published Tabata protocol —
  editable, so no performance claim is made by the defaults).
- `TimerState = { mode, config, startedAt: number | null, pausedAt: number | null,
  pausedTotalMs: number }` — not started / running / paused / done are all derivable.
- `elapsedMs(state, now)` = `(pausedAt ?? now) − startedAt − pausedTotalMs`.
- `snapshot(state, now)` → what the screen draws: the big number (count-up floors to whole
  seconds — a stopwatch reads 0:00 through its first second; remaining time ceils — "0:00"
  never shows while time remains), the phase (`work`/`rest` for Tabata), the current round and
  total (EMOM/Tabata), and `done`.
- `endsAtMs(state)` → the wall-clock completion moment for finite modes (`null` for stopwatch)
  = `startedAt + pausedTotalMs + totalDurationMs`. This one value is what gets scheduled.

### 2. The timer store (`frontend/src/toolkit/timerStore.ts`)

One module-level timer (a singleton — a lifter runs one clock at a time), living outside React
so it keeps running when the Modal unmounts its children, with `subscribe`/`getState` for
`useSyncExternalStore`. Actions: `configure(mode, config)` (only while not running),
`start()`, `pause()`, `resume()`, `reset()`.

The store owns the notification contract, through an injected port (tests pass a fake):

- `start`/`resume` of a finite mode → schedule the zero alert at `endsAtMs`.
- `pause`, `reset`, `configure` → cancel it (cancel is safe when nothing is pending).
- Nothing cancels "at done": by the time any JS tick observes `done`, zero has passed and the
  notification has already fired — and in the foreground that banner + default sound *is* the
  at-zero cue (see §3). A `pause` observed when already done is a no-op.
- Stopwatch never schedules (no zero exists).

The store keeps time with `Date.now()` — wall clock, not a monotonic clock — deliberately: the
OS date-trigger notification lives on the same clock (so display and alert can never disagree),
and monotonic time does not reliably advance across process suspension, which is the exact case
this step exists for. The cost is that a system clock change mid-timer shifts the timer with it;
accepted and recorded. Like `session.ts`, the store exports a test-only reset so the singleton
never leaks state between Jest tests.

Deliberately **not persisted**: the scope's guarantee is backgrounding, not app death (NFR-3's
kill-survival is a *workout* guarantee — a rest timer is seconds-scale and a relaunch mid-rest
is rare and self-evident). If the app dies with a timer running, the already-scheduled OS
notification still fires at the right moment — the alert, the part that matters mid-rest,
survives the kill even though the display doesn't. Recorded in the grilling decisions.

### 3. The notification wrapper (`frontend/src/toolkit/timerAlerts.ts`)

A thin module that is the only place `expo-notifications` is imported:

- **Lazy, guarded `require`** inside a try/catch: a missing or broken native module (the Expo
  Go 57 Android crash, expo/expo#52175, was exactly an *import-time* crash; Jest has no native
  module either) degrades to a no-op alerts port — the timer itself never depends on it.
- `scheduleZeroAlert(atMs, title, body)` → ensures the Android notification channel exists
  (created once before first schedule — Android drops notifications without one), requests
  permission on first use (`requestPermissionsAsync`; iOS prompt, Android 13+ runtime
  permission), then schedules a date-trigger notification. **Never blocks the clock:** `start()`
  returns immediately and the schedule lands whenever the permission dialog resolves — and if
  it resolves after the timer's zero (a short countdown, a slow thumb), scheduling a moment
  already past is a defined no-op, never a late or instant notification. Permission denied →
  resolve to "unavailable"; the timer runs regardless and the screen shows a one-line hint that
  alerts are off.
- `cancelZeroAlert()` → cancels the pending one, tolerating none.
- No `setNotificationHandler` override: SDK 58 shows foreground notifications by default, and
  that default *is* the rest-timer behaviour we want — countdown running, sheet closed, lifter
  logging a set, the banner + default sound fire at zero without any sound code of our own.

Fully offline: local scheduling is entirely on-device; this module adds no transport, and the
Tool Kit import-graph check (no Supabase, no fetch) stays part of the review.

### 4. The timer screen (`frontend/src/components/toolkit/TimerScreen.tsx`)

The fifth tool in the sheet. CrossFit-wall-timer style: the time is the screen — oversized
tabular-numeral digits (`mm:ss`, hours shown only when real), phase name and round ("Round 3 of
8 — REST") above it for EMOM/Tabata, on the existing dark theme.

- A five-way mode switcher (`ChoiceChips`, the B16 pattern), **disabled while running or
  paused** — reset first; one timer, no ambiguity about what the chips do mid-run.
- Per-mode config controls, shown only before start: countdown gets preset chips for common
  rests (0:30, 1:00, 1:30, 2:00, 3:00, 5:00) plus custom min/sec boxes (`NumberField`, bounded,
  reusing `toolkit/inputs.ts` readers); EMOM/AMRAP/Tabata get bounded min/sec and round boxes
  with the defaults above. Config values live in the store, so they survive sheet closes like
  the calculators' inputs do (B16's session principle, same lifetime: in-memory only).
- Start / Pause / Resume / Reset buttons (`Button`), done state shows "Time's up" (mode-worded)
  and offers Reset / Go again.
- The display ticks on a ~250 ms `setInterval` **only while the screen is mounted and the timer
  is running** — the interval triggers re-renders; it never keeps time. Backgrounded, it freezes
  with the rest of JS; the first tick after returning derives the correct time from the
  timestamps. Phase flips announce via `AccessibilityInfo.announceForAccessibility` (NFR-10 —
  a screen-reader user shouldn't have to watch a clock).

### 5. Wiring (the seams B16 left)

- `frontend/src/toolkit/session.ts`: `ToolId` gains `'timer'`. Nothing else — the timer's
  memory is the store, not the session record.
- `frontend/src/components/toolkit/ToolKitSheet.tsx`: `TOOL_OPTIONS` gains
  `{ value: 'timer', label: 'Timer', spoken: 'Timer' }`; the render chain gains the case.
- `frontend/src/app/(tabs)/workout.tsx`: the inert placeholder tile block is **deleted** — the
  tiles map over `TOOL_OPTIONS`, so adding the option makes the Timer tile live with no new
  tile code. Comments updated (the tab's header comment still says "Timer tile is still a
  placeholder").
- `frontend/src/app/active-workout.tsx`: unchanged — the floating button already opens the
  sheet, the session remembers the last tool, so a lifter using the timer between sets gets it
  back in one tap.

### 6. Dependency

`npx expo install expo-notifications` (~58.x) — the one new dependency. Free Expo module, local
notifications only: no push service, no paid tier, no server, no config plugin needed for this
use. Verified against the official docs (Nov 15, 2026): local notifications remain available in
Expo Go; only *remote push* was removed from Expo Go on Android (SDK 53+). Known risks at the
edge of that claim are Risk 1 below.

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/toolkit/timer.ts` (+ test) | new — pure timestamp engine, five modes, `snapshot`, `endsAtMs` (§1) |
| `frontend/src/toolkit/timerStore.ts` (+ test) | new — singleton store, actions, notification contract via injected port (§2) |
| `frontend/src/toolkit/timerAlerts.ts` (+ test) | new — guarded expo-notifications wrapper, channel, permission, schedule/cancel (§3) |
| `frontend/src/components/toolkit/TimerScreen.tsx` (+ test) | new — wall-timer display, mode switcher, config, controls (§4) |
| `frontend/src/toolkit/session.ts` | edit — `ToolId` gains `'timer'` (§5) |
| `frontend/src/components/toolkit/ToolKitSheet.tsx` (+ test edit) | edit — fifth option + render case (§5) |
| `frontend/src/app/(tabs)/workout.tsx` | edit — placeholder tile block deleted; comments updated (§5) |
| `frontend/src/__tests__/tool-kit.test.tsx` | edit — the Timer-tile test flips from "opens nothing" to "opens the sheet at the timer" |
| `frontend/package.json` | edit — `expo-notifications` (§6) |
| `docs/diagrams/app-flow.md` | Document step — Timer node in the Tool Kit, the expo-notifications path, placeholder marking removed |
| `docs/diagrams/database-erd.md` | untouched — no schema change |
| `docs/BUILD_LIST.md` | untouched — status flips at Gate 2 |

## Data model impact

**None.** No migration, no synced table, no kv-store entry (the timer is deliberately
in-memory, §2). No new route — the timer is a tool inside the existing Modal sheet, so the
typed-routes file is untouched; the builder still runs the established order
(`npx expo start` → `tsc` → lint → Jest) because Gate 2 does.

## How the definitions of done become observably true

- **Timestamp accuracy across backgrounding (all five modes)** — `timer.test.ts`: for each
  mode, build a state, advance a fake `now` in jumps (including a jump far past zero — the
  backgrounded-for-ten-minutes case), and assert `snapshot` at every point: elapsed/remaining
  exact, EMOM round = `floor(elapsed / interval) + 1`, Tabata phase/round correct at
  boundaries, `done` at and past the end, pause/resume arithmetic exact across jumps. No
  `setInterval` anywhere near these tests — the math *is* the backgrounding guarantee.
- **The notification at zero** — `timerStore.test.ts` with a fake alerts port: start countdown
  at `now = t` for 90 s → `scheduleZeroAlert(t + 90_000)`; pause → cancel; resume after 20 s
  paused → reschedule at `t + 110_000`; reset → cancel; stopwatch start → nothing scheduled;
  EMOM/AMRAP/Tabata schedule at their computed ends. `timerAlerts.test.ts` with a fake
  expo-notifications module: channel created before first schedule, permission denied →
  "unavailable" and no throw, a past `atMs` → nothing scheduled, missing module → no-op port,
  no crash.
- **The five modes on screen** — `TimerScreen.test.tsx` (fake timers): pick each mode,
  configure, start → the big display ticks down/up correctly; countdown preset chip sets the
  boxes; mode chips disabled while running; Tabata shows phase and round; done state appears
  at zero; reset returns to config.
- **Runs while the sheet is closed** — `tool-kit.test.tsx`: open the sheet from the logger,
  start a countdown, close the sheet, advance time, reopen → the timer shows the correct
  remaining time (this is the store's test — the Modal unmounted everything in between).
- **The tile** — the Workout-tab test presses Timer and asserts the sheet opens at the timer
  (replacing B16's "presses it and asserts no panel opens").
- **Both platforms** — Tristen's device run (Built → Done): each mode started, app
  backgrounded ≥ 2 min, reopened → correct time; countdown backgrounded → notification arrives
  at zero on both iOS and Android.

## Out of scope (this branch)

- **Per-interval notifications or sounds** for EMOM/Tabata interval flips (see grilling).
- **Sound packs, custom audio, vibration patterns** — the notification's default sound is the
  only audio; "no sound packs" is a standing input for this step.
- **Persisting a running timer across app death** (§2; the scheduled notification already
  survives it).
- **Background tasks** of any kind beyond the one scheduled notification (standing input).
- **Prefill/linkage to the workout** (e.g. auto-start rest on logging a set) — that is TK-6
  territory (B43) and new scope besides.
- **Multiple simultaneous timers**; laps/splits on the stopwatch.

## Risks a reviewer should weigh

1. **Expo Go on Android importing expo-notifications.** The official docs keep local
   notifications in Expo Go, but expo/expo#52175 shows Expo Go 57 crashing *at import* on
   Android. The lazy guarded require in `timerAlerts.ts` (§3) is the containment: worst case
   the timer runs with no notification rather than crashing the Tool Kit. Tristen's device
   check should hit the timer early; if Expo Go 58 still crashes, the fallback is a
   development build for the timer check only — the code is correct either way.
2. **Android inexact alarms.** On Android 12+ scheduled notifications may be delivered
   best-effort (seconds late on some OEMs). The in-app clock is always exact (timestamps); only
   the backgrounded alert can drift. Accepted for v1 — a rest timer a few seconds late beats
   an exact-alarm permission flow ("Alarms & reminders" settings round-trip) nobody asked for.
   Revisit only on device evidence.
3. **One notification, at the final zero only.** An EMOM lifter who backgrounds the app gets
   no per-minute cue — the wall-timer use case is the phone propped up and visible, and 16
   scheduled notifications per Tabata would be spam with Risk 2's jitter besides. This is the
   plan's one product reading of "a local notification at zero"; Gate 1 can overrule it, and
   per-interval scheduling would slot into the same store port later without rework.
4. **The 250 ms tick vs. test flakiness.** The display interval must stay out of the engine
   tests entirely (it does — pure `now` injection) and `TimerScreen.test.tsx` must use fake
   timers throughout; a builder who lets real timers leak will get a flaky suite. The
   interval's granularity (~4 Hz) is a display choice, not a timekeeping one.

## Grilling decisions (settled before code)

Run via `mattpocock-skills:grilling`; headless pipeline run, so the planner worked the attack
tree itself at full severity (B08–B16 precedent), verifying claims in the repo (the sheet's
render chain and `TOOL_OPTIONS` map, `session.ts`'s shape, no existing expo-notifications
dependency, the injectable-AppState precedent) and against the Expo docs. Gate 1 is where
Tristen overrules.

- **"Timestamp-based — prove the design actually survives backgrounding rather than asserting
  it."** JS `setInterval` freezes when RN backgrounds; any counter would drift by exactly the
  backgrounded time. Here nothing counts: state is three timestamps and every frame recomputes
  from `Date.now()`, so a freeze merely delays *rendering* the correct value. That makes
  "accurate while backgrounded" a pure-function property, testable by jumping `now` — which is
  precisely what `timer.test.ts` does. The notification is scheduled with the OS at start time,
  not fired by JS at zero, so the alert doesn't depend on the app running at all.
- **"Why isn't the timer a sixth calculator's worth of session.ts state?"** Because it has a
  live process, not just remembered inputs. `session.ts` stores dead text between opens; the
  timer must *advance* while the sheet is closed and notify a port on transitions. Same
  module-level lifetime, its own store. Config inputs still get session-style memory — they
  live in the store beside the state they configure.
- **"Why not put timer math in `@training-math`?"** The one-home rule says training math has
  one home, not that all math lives in that home. e1RM/PR/plate math is shared device + server;
  timer arithmetic has exactly one consumer and no server half. Putting it in the shared
  module would ship dead code to Deno. One home still holds: `timer.ts` is the only place
  elapsed/round/phase math exists; the store and screen call it, never re-derive it.
- **"The scope says notification 'at zero' — EMOM and Tabata have sixteen zeros."** They have
  interval boundaries and one end. The plan reads "zero" as the end (risk 3, overridable at
  Gate 1). Per-interval OS notifications were costed and rejected: spammy in the notification
  shade, unreliable to the second on Android 12+ (risk 2) which makes them *worse* than
  nothing for pacing, and the in-gym reality is the screen is visible. In-app, boundaries are
  fully shown (phase, round, accessibility announcement).
- **"AMRAP and countdown are both 'a duration that ends' — why two modes?"** Direction. A
  countdown (rest timer) shows time *remaining*, big. AMRAP shows time *elapsed* counting up
  with the cap and remaining as the secondary line — a lifter pacing rounds thinks in elapsed
  wall-timer time (that is what the gym clock does), and both the PRD and the scope list them
  as distinct modes. Recorded so the builder doesn't collapse them.
- **"What happens when permission is denied, or expo-notifications is broken in Expo Go?"**
  The timer is never hostage to the alert. The alerts port resolves to unavailable/no-op; the
  screen shows a one-line "alerts off" hint; every mode keeps perfect time on screen. The
  import is lazy and caught (expo/expo#52175 was an import-time crash — the guard exists for
  exactly that shape of failure).
- **"Mode switch while running — what do the chips do?"** Disabled, with reset as the way out.
  The alternatives (auto-reset on switch, or chips that retarget a running timer) both destroy
  a running clock on a mis-tap; a CrossFit timer mid-WOD must be hard to kill. Reset is one
  deliberate tap away.
- **"Should a running timer survive app death?"** No (out of scope list). The scope's word is
  "backgrounded"; kill-survival is NFR-3's workout guarantee, not the timer's. The decisive
  fact: the scheduled notification *already* survives death at the OS level, so the lifter
  resting with a dead app still gets the alert at zero — the one thing mid-rest that matters.
  Persisting store state to kv would add a corruption/stale-restore surface for a seconds-scale
  object. Revisit only if device use shows lifters killing the app mid-Tabata and caring.
- **"Foreground at zero — banner, sound, both, custom?"** SDK 58's breaking change made
  foreground notifications show by default; the plan leans on that default instead of a
  `setNotificationHandler` override or any audio code. One behaviour everywhere (banner +
  default sound), zero sound infrastructure, and the "no sound packs" standing input holds.
- **"Tabata defaults 20/10×8 — a performance claim needing a citation?"** No claim is made:
  they are the protocol's conventional numbers offered as an editable starting point, and the
  product copy asserts nothing about outcomes ("every numeric performance claim" governs claims
  like "builds 2× strength"). The screen names the mode "Tabata" as the convention, same as
  "EMOM".
- **"Is deleting the placeholder tile enough wiring for 'CrossFit-wall-timer style'?"** The
  tile was always just the door (B16 built it mapping `TOOL_OPTIONS`); the style requirement
  lands in `TimerScreen` (the display *is* the screen, §4). Verified in `workout.tsx`: the
  placeholder is a literal extra `<View>` block after the map — one deletion, and the map
  grows the live tile.
- **"Cancel the notification when the timer completes in the foreground?"** The draft plan
  said yes; the grilling killed it as a no-op dressed as a design. The notification fires *at*
  zero; any JS observation of `done` happens after zero, so there is nothing left to cancel —
  and the foreground banner + default sound at zero is the wanted cue anyway (it is the only
  "beep" this feature has). Cancellation exists for pause/reset/configure only.
- **"Does requesting permission stall the clock?"** It must not and does not: `start()` is
  synchronous for the timer, the schedule follows the permission resolution, and a resolution
  that arrives after zero schedules nothing (a past date is a defined no-op in the wrapper).
  The worst case of a slow permission dialog is a missed alert on the *first ever* finite
  timer, with the clock itself perfect throughout.
- **"`Date.now()` is wall clock — a clock change breaks the timer."** True, accepted, recorded
  (§2): the notification trigger is a wall-clock date, so wall clock is the only choice where
  the display and the alert agree by construction, and monotonic clocks don't dependably run
  across the process suspension this step is about. A lifter changing their system clock
  mid-rest gets a shifted timer; no test pretends otherwise.
- **"New dependency — is expo-notifications itself speculative?"** It is the named mechanism
  of the scope ("a local notification at zero") and the architecture's push row already names
  Expo's notification path as the platform default. Local-only use: no push token, no service,
  no billing anywhere (the no-spend rule holds). The alternative — no alert when backgrounded —
  fails the feature's core use (rest timer in pocket).
- **Scope verdict:** right as written. Five modes, timestamp math, one notification at zero,
  both platforms via the device run. The two recorded readings (final-zero-only, Built vs Done
  split) are flagged above rather than smuggled.

## Build deviations (recorded by the builder)

The plan was built as written except for these, none of which changes scope:

1. **Tabata's set-up boxes are whole seconds** (Work (s), Rest (s), Rounds — work 1–600, rest
   0–600), not minutes + seconds pairs. Tabata intervals are seconds-scale; five boxes for one
   protocol was clutter. Countdown, EMOM and AMRAP use minutes + seconds as planned
   (`readMinSec`, new in `toolkit/inputs.ts`: 0–99 min, 0–59 s, above 0:00).
2. **Set-up edits don't call `cancel`.** `setMode` is refused while a run exists and
   `updateDraft` never touches a run, so there is never a pending alert to cancel at configure
   time — `reset` already cancelled it. Cancel stays on pause and reset exactly as planned.
3. **The alerts wrapper has a generation guard** the plan didn't spell out: every schedule or
   cancel bumps a counter, so a pause/reset made *while the permission dialog is open* wins — the
   late schedule books nothing (and a booking that lands after a cancel is withdrawn at once).
   Without it, pausing during the first-ever permission prompt would leave a stale alert booked.
4. **Where things live:** the set-up drafts (`TimerDrafts`, defaults) and their reader
   (`readTimerConfig`) sit in `toolkit/timer.ts` beside the engine; the pure transitions
   `startRun` / `pauseRun` / `resumeRun` are there too and the store wraps them with the clock
   and the alerts. `timerStore` is a stable pass-through over a swappable instance so
   `resetTimerStore(fakeAlerts)` works for tests without a mutable export.
5. **Small shared additions:** `ChoiceChips` gained a `disabled` prop (the locked mode chips);
   the theme gained `type.timer` (88 px Space Grotesk bold; the screen adds tabular numerals).
6. **Mode order is Stopwatch | Countdown | EMOM | AMRAP | Tabata**, opening on Countdown (2:00)
   — the rest timer is the common case. The countdown's presets are a separate "Rest" chip row
   above the minutes/seconds boxes, as planned.
7. **Integration test clock:** `tool-kit.test.tsx` moves time with a `Date.now` spy rather than
   Jest fake timers (the real-SQLite logger under it awaits real promises); `TimerScreen.test.tsx`
   uses fake timers throughout, as planned.
8. **EMOM's big number** counts down the current interval ("Time left this round"), with the
   round above it — the wall-timer reading the plan implied but didn't state.
9. **Mode chips stay locked once a timer has finished**, not only while running or paused: the
   done state offers Go again / Reset, and Reset (one tap) unlocks them. Same reason as the
   grilling's "hard to kill" decision — the chips never act on a timer that exists.

### Review fixes (code-review, both axes)

- **Fixed alert name (`TIMER_ALERT_ID`).** The review found that an alert booked before the
  app died couldn't be withdrawn after relaunch (its id was only in memory), so Reset couldn't
  stop it and a new timer's alert would fire next to it. Every booking now uses one fixed
  identifier: a new booking replaces the old one, and cancel reaches it from any process. The
  plan's "the scheduled notification survives app death" still holds; now it can also be
  overridden.
- **Stale booking answers ignored.** A slow "unavailable" from a replaced booking could flip
  the alerts-off line on after a newer booking succeeded; the store now honours only the latest
  booking's answer.
- **Announcements made consistent.** The first round is now announced on Start every time
  (before, it was skipped on a first run but spoken after Go again); pause/resume never repeat
  it, reopening the panel mid-run stays silent, and the end speaks the notification's words.
- **One home for end-of-timer words.** The screen's finished line now shows `zeroAlertText`'s
  title and body (the notification's words) instead of a second copy.
- **Invalid set-up preview** names the chosen mode with "–:––", not the stopwatch's "Elapsed".
- **Checked and not changed:** the Spec reviewer doubted that SDK 58 shows foreground
  notifications without `setNotificationHandler`. The installed expo-notifications 58.1.9 ships a
  default handler that shows a banner and plays a sound (`build/NotificationsHandler.js`;
  CHANGELOG, expo/expo#49072), so the plan's reading stands. The device check still confirms it.
  Kept as judgement calls: the `timerStore` pass-through (the test seam, deviation 4) and the
  per-mode `switch`es (a five-member union; exhaustiveness is checked by tsc).
