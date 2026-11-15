/**
 * The Tool Kit's one timer, kept alive outside any screen.
 *
 * Why this exists: the Tool Kit is a panel (a React Native `Modal`) that throws away everything in
 * it each time it closes — but a rest timer has to keep going while the lifter closes the panel to
 * log a set. So the timer lives here, in the app's memory, and the timer screen only *shows* it:
 * close the panel, reopen it a minute later, and the timer reads a minute further on. One timer at
 * a time — a lifter runs one clock.
 *
 * What it holds: what is typed in the set-up boxes for each mode (so those survive closing the
 * panel too, like the calculators' boxes), the timer run itself (start/pause timestamps — the
 * arithmetic is all in `timer.ts`), and whether notifications turned out to be off.
 *
 * What it does on top of keeping the run: it keeps the phone's end-of-timer notification in step.
 * Starting or resuming a timer that has an end books the alert for that end; pausing or resetting
 * cancels it. Nothing cancels it "at zero" — by the time any code sees the timer finished, zero has
 * passed and the alert has already gone off, which is the point of it. The stopwatch never books
 * one (it has no zero).
 *
 * Deliberately not saved on the phone: if the app is closed for good mid-timer, the timer is gone
 * on relaunch — but the alert already booked with the phone still goes off on time.
 *
 * It keeps time on the phone's ordinary clock (`Date.now()`), the same clock the notification is
 * booked on, so screen and alert always agree. The trade-off: changing the phone's clock mid-timer
 * shifts the timer with it.
 */
import {
  defaultTimerDrafts,
  endsAtMs,
  isDone,
  pauseRun,
  readTimerConfig,
  resumeRun,
  startRun,
  zeroAlertText,
  type TimerDrafts,
  type TimerMode,
  type TimerRun,
} from './timer';
import { timerAlerts, type TimerAlertsPort } from './timerAlerts';

/** Everything the timer store holds. Treat it as read-only; change it with the store's actions. */
export interface TimerStoreState {
  drafts: TimerDrafts;
  /** The timer in progress (running, paused or finished), or null when none has been started. */
  run: TimerRun | null;
  /** True once the phone has said no to notifications (or has none): the screen says alerts are off. */
  alertsOff: boolean;
}

/** The timer store: read it, watch it, and drive the timer. */
export interface TimerStore {
  getState(): TimerStoreState;
  /** Calls `listener` after every change; returns the function that stops it. */
  subscribe(listener: () => void): () => void;
  /** Chooses a mode. Only before a timer is started — a running clock must be reset first. */
  setMode(mode: TimerMode): void;
  /** Remembers new text for one mode's set-up boxes, merged over what it had. */
  updateDraft<M extends Exclude<TimerMode, 'stopwatch'>>(mode: M, values: Partial<TimerDrafts[M]>): void;
  /** Starts the chosen mode with its set-up. Returns false (and does nothing) if the set-up is unusable. */
  start(): boolean;
  pause(): void;
  resume(): void;
  /** Stops and clears the timer, back to set-up. The set-up boxes keep what was typed. */
  reset(): void;
}

interface TimerStoreOptions {
  alerts: TimerAlertsPort;
  /** The current clock time (ms); injectable for tests. */
  now: () => number;
}

/** Builds a timer store. The app uses the single `timerStore` below; tests build their own. */
export function createTimerStore({ alerts, now }: TimerStoreOptions): TimerStore {
  let state: TimerStoreState = { drafts: defaultTimerDrafts(), run: null, alertsOff: false };
  const listeners = new Set<() => void>();

  const set = (next: Partial<TimerStoreState>): void => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  // Counts booking requests, so only the newest one's answer can change the alerts-off flag.
  let latestBooking = 0;

  /** Books the end-of-timer alert for a run that has just started or resumed (if it has an end). */
  const scheduleZeroAlert = (run: TimerRun): void => {
    const at = endsAtMs(run);
    if (at === null) return;
    const booking = ++latestBooking;
    const { title, body } = zeroAlertText(run.config);
    void alerts.schedule(at, title, body).then((outcome) => {
      if (booking !== latestBooking) return; // a newer booking (or a cancel) has the final say
      if (outcome === 'unavailable' && !state.alertsOff) set({ alertsOff: true });
      if (outcome === 'scheduled' && state.alertsOff) set({ alertsOff: false });
    });
  };

  const cancelZeroAlert = (): void => {
    latestBooking++;
    void alerts.cancel();
  };

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setMode(mode) {
      if (state.run !== null) return;
      set({ drafts: { ...state.drafts, mode } });
    },

    updateDraft(mode, values) {
      set({ drafts: { ...state.drafts, [mode]: { ...state.drafts[mode], ...values } } });
    },

    start() {
      if (state.run !== null) return false;
      const reading = readTimerConfig(state.drafts);
      if (!reading.ok) return false;
      const run = startRun(reading.config, now());
      set({ run });
      scheduleZeroAlert(run);
      return true;
    },

    pause() {
      const run = state.run;
      if (run === null || run.pausedAt !== null || isDone(run, now())) return;
      set({ run: pauseRun(run, now()) });
      cancelZeroAlert();
    },

    resume() {
      const run = state.run;
      if (run === null || run.pausedAt === null) return;
      const resumed = resumeRun(run, now());
      set({ run: resumed });
      scheduleZeroAlert(resumed);
    },

    reset() {
      if (state.run === null) return;
      set({ run: null });
      cancelZeroAlert();
    },
  };
}

let current: TimerStore = createTimerStore({ alerts: timerAlerts, now: () => Date.now() });

/**
 * The app's one timer, over the real notifications and the phone's clock. (Every call is passed
 * through to the current store, so `resetTimerStore` can swap in a fresh one for tests.)
 */
export const timerStore: TimerStore = {
  getState: () => current.getState(),
  subscribe: (listener) => current.subscribe(listener),
  setMode: (mode) => current.setMode(mode),
  updateDraft: (mode, values) => current.updateDraft(mode, values),
  start: () => current.start(),
  pause: () => current.pause(),
  resume: () => current.resume(),
  reset: () => current.reset(),
};

/**
 * Replaces the app's timer with a fresh one (default set-up, no run). Used by tests so one test's
 * timer never leaks into the next; a fake alerts port can be passed in. The app never needs it.
 */
export function resetTimerStore(alerts: TimerAlertsPort = timerAlerts): void {
  current = createTimerStore({ alerts, now: () => Date.now() });
}
