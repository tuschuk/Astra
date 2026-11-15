/**
 * Tests for the timer's end-of-timer notification, over a fake `expo-notifications` (the real one
 * is a phone feature with nothing behind it under Jest): the Android channel comes first,
 * permission is asked once and a "no" is handled quietly, a moment already passed books nothing,
 * a pause during the permission dialog wins, and a missing module never crashes anything.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { createTimerAlerts, TIMER_ALERT_ID, TIMER_CHANNEL_ID } from './timerAlerts';

type NotificationsModule = typeof import('expo-notifications');

/** A stand-in notifications module that records calls; permission answers can be scripted. */
function fakeNotifications(options: { granted?: boolean; canAskAgain?: boolean; askAnswer?: boolean } = {}) {
  const calls: string[] = [];
  let granted = options.granted ?? true;
  let resolveAsk: ((granted: boolean) => void) | null = null;
  const module = {
    AndroidImportance: { HIGH: 4 },
    SchedulableTriggerInputTypes: { DATE: 'date' },
    getPermissionsAsync: jest.fn(async () => {
      calls.push('getPermissions');
      return { granted, canAskAgain: options.canAskAgain ?? true };
    }),
    requestPermissionsAsync: jest.fn(async () => {
      calls.push('requestPermissions');
      if (options.askAnswer === undefined) {
        // Left open until the test answers it — the lifter staring at the dialog.
        granted = await new Promise<boolean>((resolve) => {
          resolveAsk = resolve;
        });
      } else {
        granted = options.askAnswer;
      }
      return { granted, canAskAgain: true };
    }),
    setNotificationChannelAsync: jest.fn(async (_id: string, _channel: object) => {
      calls.push('setChannel');
      return null;
    }),
    scheduleNotificationAsync: jest.fn(async (_request: object) => {
      calls.push('schedule');
      return TIMER_ALERT_ID;
    }),
    cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
      calls.push(`cancel:${id}`);
    }),
  };
  return {
    module: module as unknown as NotificationsModule,
    raw: module,
    calls,
    /** Waits until the permission dialog is up. */
    dialogOpen: async () => {
      while (resolveAsk === null) await new Promise<void>((resolve) => setImmediate(resolve));
    },
    /** Waits until the permission dialog is up, then answers it. */
    answer: async (yes: boolean) => {
      while (resolveAsk === null) await new Promise<void>((resolve) => setImmediate(resolve));
      resolveAsk(yes);
    },
  };
}

const NOW = 1_000_000;

describe('createTimerAlerts', () => {
  it('on Android, sets up the channel before the first booking, once', async () => {
    const fake = fakeNotifications();
    const alerts = createTimerAlerts({ load: () => fake.module, platform: 'android', now: () => NOW });
    expect(await alerts.schedule(NOW + 90_000, 'Time’s up', 'Rest is over')).toBe('scheduled');
    expect(fake.calls.indexOf('setChannel')).toBeLessThan(fake.calls.indexOf('schedule'));
    expect(fake.raw.setNotificationChannelAsync).toHaveBeenCalledWith(TIMER_CHANNEL_ID, expect.objectContaining({ importance: 4 }));
    expect(fake.raw.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: TIMER_ALERT_ID,
      content: { title: 'Time’s up', body: 'Rest is over', sound: true },
      trigger: { type: 'date', date: NOW + 90_000, channelId: TIMER_CHANNEL_ID },
    });
    await alerts.schedule(NOW + 1000, 'a', 'b');
    expect(fake.raw.setNotificationChannelAsync).toHaveBeenCalledTimes(1);
  });

  it('needs no channel on iOS', async () => {
    const fake = fakeNotifications();
    const alerts = createTimerAlerts({ load: () => fake.module, platform: 'ios', now: () => NOW });
    await alerts.schedule(NOW + 1000, 'a', 'b');
    expect(fake.raw.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('books every alert under one fixed name, so cancel reaches it even after a relaunch', async () => {
    const fake = fakeNotifications();
    const alerts = createTimerAlerts({ load: () => fake.module, platform: 'ios', now: () => NOW });
    await alerts.schedule(NOW + 1000, 'a', 'b');
    await alerts.schedule(NOW + 2000, 'a', 'b');
    const names = fake.raw.scheduleNotificationAsync.mock.calls.map(([request]) => (request as { identifier: string }).identifier);
    expect(names).toEqual([TIMER_ALERT_ID, TIMER_ALERT_ID]);

    // A fresh port (the app relaunched, remembering nothing) still cancels the booked alert.
    const relaunched = createTimerAlerts({ load: () => fake.module, platform: 'ios', now: () => NOW });
    await relaunched.cancel();
    expect(fake.calls[fake.calls.length - 1]).toBe(`cancel:${TIMER_ALERT_ID}`);
  });

  it('a cancel that tolerates nothing booked never throws', async () => {
    const fake = fakeNotifications();
    fake.raw.cancelScheduledNotificationAsync.mockRejectedValueOnce(new Error('no such notification'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const alerts = createTimerAlerts({ load: () => fake.module, platform: 'ios', now: () => NOW });
    await expect(alerts.cancel()).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('asks permission when it hasn’t been given, and reports "unavailable" on a no — without throwing', async () => {
    const fake = fakeNotifications({ granted: false, askAnswer: false });
    const alerts = createTimerAlerts({ load: () => fake.module, platform: 'ios', now: () => NOW });
    expect(await alerts.schedule(NOW + 1000, 'a', 'b')).toBe('unavailable');
    expect(fake.raw.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(fake.raw.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('doesn’t ask again once the phone says it can’t', async () => {
    const fake = fakeNotifications({ granted: false, canAskAgain: false });
    const alerts = createTimerAlerts({ load: () => fake.module, platform: 'ios', now: () => NOW });
    expect(await alerts.schedule(NOW + 1000, 'a', 'b')).toBe('unavailable');
    expect(fake.raw.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('books nothing for a moment already passed (a slow answer to the permission dialog)', async () => {
    const fake = fakeNotifications({ granted: false });
    let clock = NOW;
    const alerts = createTimerAlerts({ load: () => fake.module, platform: 'ios', now: () => clock });
    const pending = alerts.schedule(NOW + 5000, 'a', 'b');
    clock = NOW + 10_000; // the lifter answered after the countdown had already ended
    await fake.answer(true);
    expect(await pending).toBe('skipped');
    expect(fake.raw.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('a cancel while permission is being asked wins: nothing is booked', async () => {
    const fake = fakeNotifications({ granted: false });
    const alerts = createTimerAlerts({ load: () => fake.module, platform: 'ios', now: () => NOW });
    const pending = alerts.schedule(NOW + 60_000, 'a', 'b');
    await fake.dialogOpen();
    await alerts.cancel(); // paused while the dialog was up
    await fake.answer(true);
    expect(await pending).toBe('skipped');
    expect(fake.raw.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('with no notifications module, every call is a quiet no-op', async () => {
    const alerts = createTimerAlerts({ load: () => null, platform: 'android', now: () => NOW });
    expect(await alerts.schedule(NOW + 1000, 'a', 'b')).toBe('unavailable');
    await expect(alerts.cancel()).resolves.toBeUndefined();
  });

  it('a module that throws is reported as unavailable, not a crash', async () => {
    const fake = fakeNotifications();
    fake.raw.getPermissionsAsync.mockRejectedValueOnce(new Error('native module missing'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const alerts = createTimerAlerts({ load: () => fake.module, platform: 'ios', now: () => NOW });
    expect(await alerts.schedule(NOW + 1000, 'a', 'b')).toBe('unavailable');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('loads the module only once, and only when first needed', async () => {
    const fake = fakeNotifications();
    const load = jest.fn(() => fake.module);
    const alerts = createTimerAlerts({ load, platform: 'ios', now: () => NOW });
    expect(load).not.toHaveBeenCalled();
    await alerts.schedule(NOW + 1000, 'a', 'b');
    await alerts.cancel();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
