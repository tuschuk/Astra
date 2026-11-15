/**
 * The Tool Kit timer's clock math (TK-5): stopwatch, countdown, EMOM, AMRAP and Tabata.
 *
 * Why it is built this way: a timer here is a few timestamps, not a counter. It remembers the
 * moment it started, the moment it was paused (if it is paused) and how long it has spent paused
 * in total — and every number the screen shows is worked out fresh from the current time. Nothing
 * ever "ticks up". That matters because a phone freezes an app's code the moment it goes into the
 * background: a counter would lose exactly the time the app spent in a pocket, while this clock
 * simply reads the right answer the first time it is asked again. To this file, "the app was
 * backgrounded for ten minutes" and "ten minutes passed" are the same thing — which is what lets
 * the tests prove backgrounding works by jumping the clock.
 *
 * Everything here is a plain function of its inputs (no React, no phone features), and it is the
 * only place timer arithmetic lives: the timer store and the timer screen call these functions and
 * never redo the sums themselves. It is not in `@training-math` because that module holds the
 * training math shared with the server; nothing on the server ever needs a rest timer.
 *
 * All times are milliseconds, and the "now" passed in is the phone's ordinary wall clock
 * (`Date.now()`) — the same clock the end-of-timer notification is scheduled on, so the screen and
 * the alert can never disagree.
 */
import { readMinSec, readWholeNumber, type FieldReading } from './inputs';

/** The five ways the timer can run, in the order the screen offers them. */
export type TimerMode = 'stopwatch' | 'countdown' | 'emom' | 'amrap' | 'tabata';

/**
 * What a timer is set to do, by mode:
 *   - stopwatch: counts up forever, nothing to set;
 *   - countdown: counts down from `durationMs` (a rest timer);
 *   - EMOM ("every minute on the minute"): `rounds` back-to-back intervals of `intervalMs` each —
 *     the interval is editable because E90S / E2MOM variants exist;
 *   - AMRAP ("as many rounds as possible"): counts up to a time cap of `durationMs`;
 *   - Tabata: `rounds` of `workMs` work then `restMs` rest.
 */
export type TimerConfig =
  | { mode: 'stopwatch' }
  | { mode: 'countdown'; durationMs: number }
  | { mode: 'emom'; intervalMs: number; rounds: number }
  | { mode: 'amrap'; durationMs: number }
  | { mode: 'tabata'; workMs: number; restMs: number; rounds: number };

/**
 * A timer that has been started. `pausedAt` is set only while it is paused; `pausedTotalMs` is all
 * the time spent paused before that. Running / paused / done are all worked out from these.
 */
export interface TimerRun {
  config: TimerConfig;
  startedAt: number;
  pausedAt: number | null;
  pausedTotalMs: number;
}

/** Where a timer stands right now. "idle" means it hasn't been started. */
export type TimerStatus = 'idle' | 'running' | 'paused' | 'done';

/** Everything the timer screen needs to draw one frame. */
export interface TimerSnapshot {
  status: TimerStatus;
  /** How long the timer has run (paused time excluded), capped at its total for finite modes. */
  elapsedMs: number;
  /** How long until the whole timer ends; null for the stopwatch, which never ends. */
  remainingMs: number | null;
  /** The big number, already formatted ("1:30"). */
  display: string;
  /** What the big number means, in words ("Time left", "Elapsed", "Work"). */
  displayMeaning: string;
  /** Tabata only: whether this is a work or rest interval. Null for the other modes. */
  phase: 'work' | 'rest' | null;
  /** EMOM / Tabata: the round in progress (1-based) and how many there are. Null otherwise. */
  round: number | null;
  rounds: number | null;
}

/**
 * How long the whole timer lasts from start to finish, or null for the stopwatch. Tabata counts the
 * last rest too (8 × (20 s + 10 s) = 4:00), as the protocol's usual four minutes does.
 */
export function totalDurationMs(config: TimerConfig): number | null {
  switch (config.mode) {
    case 'stopwatch':
      return null;
    case 'countdown':
    case 'amrap':
      return config.durationMs;
    case 'emom':
      return config.intervalMs * config.rounds;
    case 'tabata':
      return (config.workMs + config.restMs) * config.rounds;
  }
}

/** Starts a timer at `now`. */
export function startRun(config: TimerConfig, now: number): TimerRun {
  return { config, startedAt: now, pausedAt: null, pausedTotalMs: 0 };
}

/** Pauses a running timer at `now`. A timer that is already paused or finished is left as it is. */
export function pauseRun(run: TimerRun, now: number): TimerRun {
  if (run.pausedAt !== null || isDone(run, now)) return run;
  return { ...run, pausedAt: now };
}

/** Restarts a paused timer at `now`, adding the pause to the paused total. A running one is unchanged. */
export function resumeRun(run: TimerRun, now: number): TimerRun {
  if (run.pausedAt === null) return run;
  return { ...run, pausedAt: null, pausedTotalMs: run.pausedTotalMs + Math.max(0, now - run.pausedAt) };
}

/**
 * How long the timer has actually run at `now`: the time since it started, minus the time spent
 * paused (frozen at the pause moment while paused). Never below 0, and never past the end of a
 * finite timer — a countdown that ended ten minutes ago has still only run its own length.
 */
export function elapsedMs(run: TimerRun, now: number): number {
  const raw = Math.max(0, (run.pausedAt ?? now) - run.startedAt - run.pausedTotalMs);
  const total = totalDurationMs(run.config);
  return total === null ? raw : Math.min(raw, total);
}

/** True once a finite timer has reached its end (the stopwatch never does). */
export function isDone(run: TimerRun, now: number): boolean {
  const total = totalDurationMs(run.config);
  if (total === null) return false;
  const raw = (run.pausedAt ?? now) - run.startedAt - run.pausedTotalMs;
  return raw >= total;
}

/**
 * The wall-clock moment a running finite timer will hit zero — the value handed to the phone so
 * the end-of-timer notification fires on time even with the app in the background. Null for the
 * stopwatch (no zero) and for a paused timer (its end moves for as long as the pause lasts; it is
 * worked out again on resume).
 */
export function endsAtMs(run: TimerRun): number | null {
  const total = totalDurationMs(run.config);
  if (total === null || run.pausedAt !== null) return null;
  return run.startedAt + run.pausedTotalMs + total;
}

/**
 * Formats a number of whole seconds the way a gym wall clock does: "0:05", "12:30", and "1:02:03"
 * once there is an hour.
 */
export function formatClock(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

/**
 * Time counting up is shown in whole seconds rounded down (a stopwatch reads 0:00 through its first
 * second); time counting down is rounded up, so "0:00" never shows while any time is left.
 */
function upClock(ms: number): string {
  return formatClock(Math.floor(ms / 1000));
}
function downClock(ms: number): string {
  return formatClock(Math.ceil(ms / 1000));
}

/**
 * Everything the screen shows for a timer at `now`. Pass `null` for a timer that hasn't been
 * started and its config as `idleConfig`, and the snapshot shows where it will start from.
 *
 * What the big number is, by mode:
 *   - stopwatch: time elapsed;
 *   - countdown: time left;
 *   - EMOM: time left in the current interval, with the round ("Round 3 of 10") — the round is
 *     elapsed ÷ interval, rounded down, plus one;
 *   - AMRAP: time elapsed (lifters pace rounds against the running clock, as on a gym wall timer),
 *     with the time left to the cap available as `remainingMs`;
 *   - Tabata: time left in the current work or rest interval, with the phase and round.
 */
export function snapshot(run: TimerRun | null, now: number, idleConfig?: TimerConfig): TimerSnapshot {
  const config = run?.config ?? idleConfig ?? { mode: 'stopwatch' };
  // An idle timer looks exactly like one started and paused at its very first instant.
  const effective = run ?? { config, startedAt: now, pausedAt: now, pausedTotalMs: 0 };
  const elapsed = elapsedMs(effective, now);
  const total = totalDurationMs(config);
  const done = isDone(effective, now);
  const status: TimerStatus = run === null ? 'idle' : done ? 'done' : run.pausedAt !== null ? 'paused' : 'running';
  const remainingMs = total === null ? null : Math.max(0, total - elapsed);
  const base = { status, elapsedMs: elapsed, remainingMs, phase: null, round: null, rounds: null };

  switch (config.mode) {
    case 'stopwatch':
      return { ...base, display: upClock(elapsed), displayMeaning: 'Elapsed' };
    case 'countdown':
      return { ...base, display: downClock(remainingMs ?? 0), displayMeaning: 'Time left' };
    case 'amrap':
      return { ...base, display: upClock(elapsed), displayMeaning: 'Elapsed' };
    case 'emom': {
      if (done) {
        return {
          ...base,
          display: formatClock(0),
          displayMeaning: 'Time left this round',
          round: config.rounds,
          rounds: config.rounds,
        };
      }
      const index = Math.floor(elapsed / config.intervalMs);
      const intervalLeft = config.intervalMs - (elapsed - index * config.intervalMs);
      return {
        ...base,
        display: downClock(intervalLeft),
        displayMeaning: 'Time left this round',
        round: index + 1,
        rounds: config.rounds,
      };
    }
    case 'tabata': {
      if (done) {
        return {
          ...base,
          display: formatClock(0),
          displayMeaning: 'Rest',
          phase: 'rest',
          round: config.rounds,
          rounds: config.rounds,
        };
      }
      const cycle = config.workMs + config.restMs;
      const index = Math.floor(elapsed / cycle);
      const intoCycle = elapsed - index * cycle;
      const working = intoCycle < config.workMs;
      const phaseLeft = working ? config.workMs - intoCycle : cycle - intoCycle;
      return {
        ...base,
        display: downClock(phaseLeft),
        displayMeaning: working ? 'Work' : 'Rest',
        phase: working ? 'work' : 'rest',
        round: index + 1,
        rounds: config.rounds,
      };
    }
  }
}

/** "1 round" / "8 rounds". */
function roundsWord(rounds: number): string {
  return `${rounds} ${rounds === 1 ? 'round' : 'rounds'}`;
}

/**
 * What the end of a timer says, for each finite mode — the one place these words live: they are
 * the notification's title and text, and the timer screen shows the same two lines when it
 * finishes. (The stopwatch never ends; its entry exists only so every mode has one.)
 */
export function zeroAlertText(config: TimerConfig): { title: string; body: string } {
  switch (config.mode) {
    case 'countdown':
      return { title: 'Time’s up', body: 'Rest is over — back to the bar.' };
    case 'emom':
      return { title: 'EMOM complete', body: `${roundsWord(config.rounds)} done.` };
    case 'amrap':
      return { title: 'AMRAP time cap', body: 'Time’s up — count your rounds.' };
    case 'tabata':
      return { title: 'Tabata complete', body: `${roundsWord(config.rounds)} done.` };
    case 'stopwatch':
      return { title: 'Stopped', body: '' };
  }
}

// ── Setting a timer up ───────────────────────────────────────────────────────────────────────
//
// What the lifter has typed into the set-up boxes for each mode, kept as the raw text (like the
// calculators' boxes), and the reader that turns it into a `TimerConfig` — or says what's wrong.

/** The set-up boxes for every mode, plus the mode chosen. Times are minutes + seconds boxes. */
export interface TimerDrafts {
  mode: TimerMode;
  countdown: { minutes: string; seconds: string };
  emom: { minutes: string; seconds: string; rounds: string };
  amrap: { minutes: string; seconds: string };
  /** Tabata's intervals are short, so its boxes are whole seconds. */
  tabata: { workSeconds: string; restSeconds: string; rounds: string };
}

/**
 * The starting set-up: a 2:00 countdown (a common rest between heavy sets), a 10-round EMOM of
 * 1:00, a 12:00 AMRAP, and Tabata's conventional 20 s work / 10 s rest × 8. These are starting
 * points to edit, not recommendations.
 */
export function defaultTimerDrafts(): TimerDrafts {
  return {
    mode: 'countdown',
    countdown: { minutes: '2', seconds: '0' },
    emom: { minutes: '1', seconds: '0', rounds: '10' },
    amrap: { minutes: '12', seconds: '0' },
    tabata: { workSeconds: '20', restSeconds: '10', rounds: '8' },
  };
}

/** The most rounds an EMOM or Tabata can be set to. */
export const MAX_TIMER_ROUNDS = 99;
/** The longest single Tabata work or rest interval, in seconds (10 minutes). */
export const MAX_TABATA_INTERVAL_SECONDS = 600;

/** Each set-up box's problem, by which box: the time pair, rounds, Tabata's work and rest. */
export type TimerSetupErrors = Partial<Record<'time' | 'rounds' | 'work' | 'rest', string>>;

/** The set-up read for the chosen mode: a usable config, or each box's problem by name. */
export type TimerConfigReading = { ok: true; config: TimerConfig } | { ok: false; errors: TimerSetupErrors };

/** Reads the chosen mode's boxes into a timer config, or the problems that stop it starting. */
export function readTimerConfig(drafts: TimerDrafts): TimerConfigReading {
  const errors: TimerSetupErrors = {};
  const problem = (reading: FieldReading, empty: string): string | null =>
    reading.kind === 'invalid' ? reading.message : reading.kind === 'empty' ? empty : null;

  switch (drafts.mode) {
    case 'stopwatch':
      return { ok: true, config: { mode: 'stopwatch' } };
    case 'countdown':
    case 'amrap': {
      const { minutes, seconds } = drafts[drafts.mode];
      const time = readMinSec(minutes, seconds);
      if (time.kind === 'ok') return { ok: true, config: { mode: drafts.mode, durationMs: time.value } };
      errors.time = problem(time, 'Enter a time.') ?? undefined;
      return { ok: false, errors };
    }
    case 'emom': {
      const time = readMinSec(drafts.emom.minutes, drafts.emom.seconds);
      const rounds = readWholeNumber(drafts.emom.rounds, 1, MAX_TIMER_ROUNDS, 'rounds');
      if (time.kind === 'ok' && rounds.kind === 'ok') {
        return { ok: true, config: { mode: 'emom', intervalMs: time.value, rounds: rounds.value } };
      }
      errors.time = problem(time, 'Enter a time.') ?? undefined;
      errors.rounds = problem(rounds, 'Enter the rounds.') ?? undefined;
      return { ok: false, errors };
    }
    case 'tabata': {
      const work = readWholeNumber(drafts.tabata.workSeconds, 1, MAX_TABATA_INTERVAL_SECONDS, 'work seconds');
      const rest = readWholeNumber(drafts.tabata.restSeconds, 0, MAX_TABATA_INTERVAL_SECONDS, 'rest seconds');
      const rounds = readWholeNumber(drafts.tabata.rounds, 1, MAX_TIMER_ROUNDS, 'rounds');
      if (work.kind === 'ok' && rest.kind === 'ok' && rounds.kind === 'ok') {
        return {
          ok: true,
          config: { mode: 'tabata', workMs: work.value * 1000, restMs: rest.value * 1000, rounds: rounds.value },
        };
      }
      errors.work = problem(work, 'Enter the work seconds.') ?? undefined;
      errors.rest = problem(rest, 'Enter the rest seconds.') ?? undefined;
      errors.rounds = problem(rounds, 'Enter the rounds.') ?? undefined;
      return { ok: false, errors };
    }
  }
}
