/**
 * Tests for the timer store: driving the timer, the set-up rules (no mode change mid-run, nothing
 * starts from an unusable set-up), and the notification contract over a fake alerts port —
 * start/resume book the alert at the timer's exact end, pause/reset cancel it, the stopwatch never
 * books one, and a "no" from the phone turns the alerts-off flag on.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { createTimerStore } from './timerStore';
import type { ScheduleOutcome, TimerAlertsPort } from './timerAlerts';

const T = 1_700_000_000_000;

/** A store on a hand-moved clock with a recording alerts port. */
function setup(outcome: ScheduleOutcome = 'scheduled') {
  let clock = T;
  const alerts = {
    schedule: jest.fn<TimerAlertsPort['schedule']>(async () => outcome),
    cancel: jest.fn<TimerAlertsPort['cancel']>(async () => undefined),
  };
  const store = createTimerStore({ alerts, now: () => clock });
  return {
    store,
    alerts,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** Lets the store's "after the booking" step run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('timer store', () => {
  it('starts on a 2:00 countdown set-up with nothing running', () => {
    const { store } = setup();
    expect(store.getState()).toMatchObject({ run: null, alertsOff: false, drafts: { mode: 'countdown' } });
  });

  it('countdown: books the alert at the end, cancels on pause, rebooks on resume shifted by the pause', () => {
    const { store, alerts, advance } = setup();
    store.updateDraft('countdown', { minutes: '1', seconds: '30' });
    expect(store.start()).toBe(true);
    expect(alerts.schedule).toHaveBeenLastCalledWith(T + 90_000, 'Time’s up', expect.any(String));

    advance(10_000);
    store.pause();
    expect(alerts.cancel).toHaveBeenCalledTimes(1);

    advance(20_000);
    store.resume();
    expect(alerts.schedule).toHaveBeenCalledTimes(2);
    expect(alerts.schedule).toHaveBeenLastCalledWith(T + 110_000, 'Time’s up', expect.any(String));

    store.reset();
    expect(alerts.cancel).toHaveBeenCalledTimes(2);
    expect(store.getState().run).toBeNull();
  });

  it('EMOM, AMRAP and Tabata book at their computed ends', () => {
    const cases = [
      { mode: 'emom' as const, end: T + 600_000 },
      { mode: 'amrap' as const, end: T + 720_000 },
      { mode: 'tabata' as const, end: T + 240_000 },
    ];
    for (const { mode, end } of cases) {
      const { store, alerts } = setup();
      store.setMode(mode);
      store.start();
      expect(alerts.schedule).toHaveBeenCalledWith(end, expect.any(String), expect.any(String));
    }
  });

  it('the stopwatch never books an alert', () => {
    const { store, alerts, advance } = setup();
    store.setMode('stopwatch');
    store.start();
    advance(5000);
    store.pause();
    store.resume();
    expect(alerts.schedule).not.toHaveBeenCalled();
  });

  it('won’t change mode or start again while a timer is in progress', () => {
    const { store } = setup();
    store.start();
    store.setMode('tabata');
    expect(store.getState().drafts.mode).toBe('countdown');
    expect(store.start()).toBe(false);
    store.reset();
    store.setMode('tabata');
    expect(store.getState().drafts.mode).toBe('tabata');
  });

  it('won’t start from an unusable set-up', () => {
    const { store, alerts } = setup();
    store.updateDraft('countdown', { minutes: '0', seconds: '0' });
    expect(store.start()).toBe(false);
    expect(store.getState().run).toBeNull();
    expect(alerts.schedule).not.toHaveBeenCalled();
  });

  it('pausing a finished timer does nothing (its alert has already gone off)', () => {
    const { store, alerts, advance } = setup();
    store.start();
    advance(200_000);
    store.pause();
    expect(store.getState().run?.pausedAt).toBeNull();
    expect(alerts.cancel).not.toHaveBeenCalled();
  });

  it('resetting with nothing running is a no-op', () => {
    const { store, alerts } = setup();
    store.reset();
    expect(alerts.cancel).not.toHaveBeenCalled();
  });

  it('keeps set-up text and tells subscribers about every change', () => {
    const { store } = setup();
    const listener = jest.fn();
    const stop = store.subscribe(listener);
    store.updateDraft('emom', { rounds: '12' });
    expect(store.getState().drafts.emom).toEqual({ minutes: '1', seconds: '0', rounds: '12' });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.updateDraft('emom', { rounds: '13' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('turns alerts-off on when the phone refuses, and off again once a booking works', async () => {
    const refused = setup('unavailable');
    refused.store.start();
    await settle();
    expect(refused.store.getState().alertsOff).toBe(true);

    refused.alerts.schedule.mockResolvedValue('scheduled');
    refused.store.pause();
    refused.store.resume();
    await settle();
    expect(refused.store.getState().alertsOff).toBe(false);
  });

  it('a late answer from an old booking can’t overrule a newer one', async () => {
    const { store, alerts } = setup();
    let answerFirst: (outcome: ScheduleOutcome) => void = () => undefined;
    alerts.schedule.mockImplementationOnce(
      () =>
        new Promise<ScheduleOutcome>((resolve) => {
          answerFirst = resolve;
        }),
    );
    store.start(); // first booking: its answer is slow
    store.pause();
    store.resume(); // second booking: answers 'scheduled' straight away
    await settle();
    answerFirst('unavailable'); // the stale answer finally arrives
    await settle();
    expect(store.getState().alertsOff).toBe(false);
  });

  it('a skipped booking leaves the alerts-off flag alone', async () => {
    const { store } = setup('skipped');
    store.start();
    await settle();
    expect(store.getState().alertsOff).toBe(false);
  });
});
