/**
 * Tests for the timer screen, on Jest's fake clock throughout (both the redraw interval and
 * `Date.now()` are fake, so nothing here waits on real time): each of the five modes set up,
 * started and watched; the countdown presets; the mode chips locked mid-run; Tabata's phase and
 * round; the finished state; reset back to set-up; and the "alerts off" line.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { ScheduleOutcome, TimerAlertsPort } from '@/toolkit/timerAlerts';
import { resetTimerStore } from '@/toolkit/timerStore';

import { TimerScreen } from './TimerScreen';

const T = 1_700_000_000_000;

function fakeAlerts(outcome: ScheduleOutcome = 'scheduled') {
  return {
    schedule: jest.fn<TimerAlertsPort['schedule']>(async () => outcome),
    cancel: jest.fn<TimerAlertsPort['cancel']>(async () => undefined),
  };
}

let alerts: ReturnType<typeof fakeAlerts>;

beforeEach(() => {
  jest.useFakeTimers({ now: T });
  alerts = fakeAlerts();
  resetTimerStore(alerts);
});

afterEach(() => {
  jest.useRealTimers();
  resetTimerStore();
});

/** Moves the fake clock (and the redraw interval) on by `ms`. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** The big clock's spoken label, e.g. "Time left: 1:30". */
function clock(): string {
  return String(screen.getByLabelText(/^(Time left|Elapsed|Round|Work|Rest)[^:]*: /).props.accessibilityLabel);
}

describe('TimerScreen', () => {
  it('countdown: a preset sets the boxes, then it counts down and ends with "Time’s up"', async () => {
    await render(<TimerScreen />);
    expect(clock()).toBe('Time left: 2:00');
    await fireEvent.press(screen.getByLabelText('1:30 rest'));
    expect(screen.getByLabelText('Countdown minutes').props.value).toBe('1');
    expect(screen.getByLabelText('Countdown seconds').props.value).toBe('30');
    expect(clock()).toBe('Time left: 1:30');

    await fireEvent.press(screen.getByLabelText('Start'));
    expect(alerts.schedule).toHaveBeenCalledWith(T + 90_000, expect.any(String), expect.any(String));
    // Set-up is hidden while it runs.
    expect(screen.queryByLabelText('Countdown minutes')).toBeNull();
    await advance(30_000);
    expect(clock()).toBe('Time left: 1:00');
    await advance(60_000);
    expect(clock()).toBe('Time left: 0:00');
    expect(screen.getByText('Time’s up')).toBeTruthy();
    expect(screen.getByText('Rest is over — back to the bar.')).toBeTruthy();
    expect(screen.getByLabelText('Go again')).toBeTruthy();
  });

  it('keeps the right time when the screen hasn’t redrawn for minutes (backgrounded)', async () => {
    await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('Start'));
    // The phone froze the app: the clock moves, but no redraw interval fires.
    jest.setSystemTime(T + 75_000);
    await advance(250);
    expect(clock()).toBe('Time left: 0:45');
  });

  it('stopwatch counts up and pauses/resumes exactly', async () => {
    await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('Stopwatch'));
    expect(clock()).toBe('Elapsed: 0:00');
    await fireEvent.press(screen.getByLabelText('Start'));
    await advance(5_000);
    expect(clock()).toBe('Elapsed: 0:05');
    await fireEvent.press(screen.getByLabelText('Pause'));
    expect(screen.getByText('Paused')).toBeTruthy();
    await advance(60_000);
    expect(clock()).toBe('Elapsed: 0:05');
    await fireEvent.press(screen.getByLabelText('Resume'));
    await advance(3_000);
    expect(clock()).toBe('Elapsed: 0:08');
    expect(alerts.schedule).not.toHaveBeenCalled();
  });

  it('locks the mode chips while a timer is in progress; Reset returns to set-up', async () => {
    await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('Start'));
    expect(screen.getByLabelText('Tabata').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByLabelText('Tabata'));
    expect(screen.getByLabelText('Countdown').props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByLabelText('Reset'));
    expect(alerts.cancel).toHaveBeenCalled();
    expect(screen.getByLabelText('Countdown minutes')).toBeTruthy();
    expect(clock()).toBe('Time left: 2:00');
    expect(screen.getByLabelText('Tabata').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('EMOM shows the round and the time left in it', async () => {
    await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('EMOM, every minute on the minute'));
    await fireEvent.changeText(screen.getByLabelText('Rounds'), '3');
    await fireEvent.press(screen.getByLabelText('Start'));
    await advance(65_000);
    expect(clock()).toBe('Round 2 of 3 · Time left this round: 0:55');
    await advance(115_000);
    expect(screen.getByText('EMOM complete')).toBeTruthy();
    expect(clock()).toBe('Round 3 of 3 · Time left this round: 0:00');
  });

  it('AMRAP counts up with the time left to the cap', async () => {
    await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('AMRAP, as many rounds as possible'));
    await fireEvent.changeText(screen.getByLabelText('Time cap minutes'), '10');
    await fireEvent.press(screen.getByLabelText('Start'));
    await advance(90_000);
    expect(clock()).toBe('Elapsed: 1:30');
    expect(screen.getByText('8:30 left of the cap')).toBeTruthy();
  });

  it('Tabata shows work and rest with the round', async () => {
    await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('Tabata'));
    expect(clock()).toBe('Round 1 of 8 · Work: 0:20');
    await fireEvent.press(screen.getByLabelText('Start'));
    await advance(22_000);
    expect(clock()).toBe('Round 1 of 8 · Rest: 0:08');
    await advance(10_000);
    expect(clock()).toBe('Round 2 of 8 · Work: 0:18');
  });

  it('shows a box’s problem and won’t start until it is fixed', async () => {
    await render(<TimerScreen />);
    await fireEvent.changeText(screen.getByLabelText('Countdown minutes'), '0');
    await fireEvent.changeText(screen.getByLabelText('Countdown seconds'), '0');
    expect(screen.getByText('Enter a time above 0:00.')).toBeTruthy();
    expect(screen.getByLabelText('Start').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('remembers the set-up and the running timer across closing and reopening', async () => {
    const first = await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('Start'));
    await first.unmount();
    jest.setSystemTime(T + 30_000);
    await render(<TimerScreen />);
    expect(clock()).toBe('Time left: 1:30');
  });

  it('Go again restarts the same timer', async () => {
    await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('Start'));
    await advance(120_000);
    await fireEvent.press(screen.getByLabelText('Go again'));
    expect(clock()).toBe('Time left: 2:00');
    expect(screen.getByLabelText('Pause')).toBeTruthy();
    expect(alerts.schedule).toHaveBeenCalledTimes(2);
  });

  it('announces the start, each work/rest switch and the end — the same on every run', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    // React Native's Jest set-up already mocks this; clear what the earlier tests announced.
    announce.mockClear();
    await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('Tabata'));
    await fireEvent.changeText(screen.getByLabelText('Rounds'), '1');
    expect(announce).not.toHaveBeenCalled(); // set-up previews are silent

    for (let run = 0; run < 2; run++) {
      announce.mockClear();
      await fireEvent.press(screen.getByLabelText(run === 0 ? 'Start' : 'Go again'));
      expect(announce).toHaveBeenLastCalledWith('Round 1 of 1 · Work');
      // Pause and resume don't repeat it.
      await fireEvent.press(screen.getByLabelText('Pause'));
      await fireEvent.press(screen.getByLabelText('Resume'));
      expect(announce).toHaveBeenCalledTimes(1);
      await advance(20_000);
      expect(announce).toHaveBeenLastCalledWith('Round 1 of 1 · Rest');
      await advance(10_000);
      expect(announce).toHaveBeenLastCalledWith('Tabata complete. 1 round done.');
      expect(announce).toHaveBeenCalledTimes(3);
    }
    announce.mockRestore();
  });

  it('reopening the panel on a running timer announces nothing', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const first = await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('Tabata'));
    await fireEvent.press(screen.getByLabelText('Start'));
    await first.unmount();
    announce.mockClear();
    await render(<TimerScreen />);
    await advance(250);
    expect(announce).not.toHaveBeenCalled();
    announce.mockRestore();
  });

  it('with a wrong box, the clock still names the chosen mode and shows no time', async () => {
    await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('AMRAP, as many rounds as possible'));
    await fireEvent.changeText(screen.getByLabelText('Time cap minutes'), '');
    await fireEvent.changeText(screen.getByLabelText('Time cap seconds'), '');
    expect(clock()).toBe('Elapsed: –:––');
    await fireEvent.press(screen.getByLabelText('Countdown'));
    await fireEvent.changeText(screen.getByLabelText('Countdown minutes'), '100');
    expect(clock()).toBe('Time left: –:––');
  });

  it('says when alerts are off', async () => {
    resetTimerStore(fakeAlerts('unavailable'));
    await render(<TimerScreen />);
    await fireEvent.press(screen.getByLabelText('Start'));
    await advance(0);
    expect(screen.getByText(/Notifications are off/)).toBeTruthy();
  });
});
