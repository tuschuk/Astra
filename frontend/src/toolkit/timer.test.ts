/**
 * Tests for the timer's clock math. No real timers anywhere: every test builds a timer at a fixed
 * clock time and then jumps "now" forward — which, to timestamp math, is exactly what an app sitting
 * in the background for that long looks like. So these tests are the proof that every mode keeps
 * correct time across backgrounding (TK-5).
 */
import { describe, expect, it } from '@jest/globals';

import {
  defaultTimerDrafts,
  elapsedMs,
  endsAtMs,
  formatClock,
  isDone,
  pauseRun,
  readTimerConfig,
  resumeRun,
  snapshot,
  startRun,
  totalDurationMs,
  zeroAlertText,
  type TimerConfig,
  type TimerDrafts,
} from './timer';

const T = 1_700_000_000_000; // an arbitrary start moment on the wall clock
const s = (seconds: number) => seconds * 1000;

describe('formatClock', () => {
  it('reads like a wall clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(90)).toBe('1:30');
    expect(formatClock(750)).toBe('12:30');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('totalDurationMs', () => {
  it('is the full length of each finite mode, and none for the stopwatch', () => {
    expect(totalDurationMs({ mode: 'stopwatch' })).toBeNull();
    expect(totalDurationMs({ mode: 'countdown', durationMs: s(90) })).toBe(s(90));
    expect(totalDurationMs({ mode: 'amrap', durationMs: s(720) })).toBe(s(720));
    expect(totalDurationMs({ mode: 'emom', intervalMs: s(60), rounds: 10 })).toBe(s(600));
    // Tabata 20/10 × 8 is the protocol's four minutes, final rest included.
    expect(totalDurationMs({ mode: 'tabata', workMs: s(20), restMs: s(10), rounds: 8 })).toBe(s(240));
  });
});

describe('stopwatch', () => {
  const run = startRun({ mode: 'stopwatch' }, T);

  it('counts up, rounding down to whole seconds', () => {
    expect(snapshot(run, T).display).toBe('0:00');
    expect(snapshot(run, T + 999).display).toBe('0:00');
    expect(snapshot(run, T + 1000).display).toBe('0:01');
    expect(snapshot(run, T + s(65.4)).display).toBe('1:05');
  });

  it('is exact after a long background jump and never finishes', () => {
    const later = snapshot(run, T + s(3 * 3600 + 7));
    expect(later.display).toBe('3:00:07');
    expect(later.status).toBe('running');
    expect(later.remainingMs).toBeNull();
    expect(endsAtMs(run)).toBeNull();
  });
});

describe('countdown', () => {
  const run = startRun({ mode: 'countdown', durationMs: s(90) }, T);

  it('counts down, rounding up so 0:00 never shows while time is left', () => {
    expect(snapshot(run, T).display).toBe('1:30');
    expect(snapshot(run, T + 1).display).toBe('1:30');
    expect(snapshot(run, T + s(1)).display).toBe('1:29');
    expect(snapshot(run, T + s(89) + 1).display).toBe('0:01');
    expect(snapshot(run, T + s(90) - 1).status).toBe('running');
  });

  it('is done at zero and stays at 0:00 long after (backgrounded for ten minutes)', () => {
    expect(snapshot(run, T + s(90))).toMatchObject({ status: 'done', display: '0:00', remainingMs: 0 });
    const way = snapshot(run, T + s(90 + 600));
    expect(way).toMatchObject({ status: 'done', display: '0:00', elapsedMs: s(90) });
  });

  it('ends at start + duration on the wall clock', () => {
    expect(endsAtMs(run)).toBe(T + s(90));
  });
});

describe('pause and resume', () => {
  const config: TimerConfig = { mode: 'countdown', durationMs: s(90) };

  it('freezes the time while paused, however long the pause', () => {
    const paused = pauseRun(startRun(config, T), T + s(30));
    expect(snapshot(paused, T + s(30)).display).toBe('1:00');
    expect(snapshot(paused, T + s(3600)).display).toBe('1:00');
    expect(snapshot(paused, T + s(3600)).status).toBe('paused');
    // A paused timer's end isn't fixed yet.
    expect(endsAtMs(paused)).toBeNull();
  });

  it('carries on from where it stopped, and the end moves by exactly the pause', () => {
    const resumed = resumeRun(pauseRun(startRun(config, T), T + s(30)), T + s(50));
    expect(resumed.pausedTotalMs).toBe(s(20));
    expect(snapshot(resumed, T + s(50)).display).toBe('1:00');
    expect(snapshot(resumed, T + s(80)).display).toBe('0:30');
    expect(endsAtMs(resumed)).toBe(T + s(110));
    expect(isDone(resumed, T + s(110) - 1)).toBe(false);
    expect(isDone(resumed, T + s(110))).toBe(true);
  });

  it('adds up several pauses', () => {
    let run = startRun({ mode: 'stopwatch' }, T);
    run = pauseRun(run, T + s(10));
    run = resumeRun(run, T + s(15));
    run = pauseRun(run, T + s(20));
    run = resumeRun(run, T + s(40));
    expect(run.pausedTotalMs).toBe(s(25));
    expect(elapsedMs(run, T + s(100))).toBe(s(75));
  });

  it('ignores pausing a paused or finished timer, and resuming a running one', () => {
    const run = startRun(config, T);
    const paused = pauseRun(run, T + s(10));
    expect(pauseRun(paused, T + s(20))).toBe(paused);
    expect(resumeRun(run, T + s(5))).toBe(run);
    expect(pauseRun(run, T + s(100))).toBe(run);
  });
});

describe('EMOM', () => {
  const run = startRun({ mode: 'emom', intervalMs: s(60), rounds: 10 }, T);

  it('counts down each interval with the round = elapsed ÷ interval, rounded down, plus one', () => {
    expect(snapshot(run, T)).toMatchObject({ display: '1:00', round: 1, rounds: 10 });
    expect(snapshot(run, T + s(59) + 1)).toMatchObject({ display: '0:01', round: 1 });
    expect(snapshot(run, T + s(60))).toMatchObject({ display: '1:00', round: 2 });
    expect(snapshot(run, T + s(185))).toMatchObject({ display: '0:55', round: 4 });
  });

  it('lands on the right round after a background jump, and finishes after the last', () => {
    expect(snapshot(run, T + s(9 * 60 + 30))).toMatchObject({ round: 10, display: '0:30', status: 'running' });
    expect(snapshot(run, T + s(600))).toMatchObject({ status: 'done', round: 10, display: '0:00' });
    expect(snapshot(run, T + s(5000))).toMatchObject({ status: 'done', round: 10 });
    expect(endsAtMs(run)).toBe(T + s(600));
  });

  it('works with a non-minute interval (E90S)', () => {
    const e90 = startRun({ mode: 'emom', intervalMs: s(90), rounds: 4 }, T);
    expect(snapshot(e90, T + s(100))).toMatchObject({ round: 2, display: '1:20' });
    expect(endsAtMs(e90)).toBe(T + s(360));
  });
});

describe('AMRAP', () => {
  const run = startRun({ mode: 'amrap', durationMs: s(720) }, T);

  it('counts up with the time left to the cap alongside', () => {
    expect(snapshot(run, T + s(150.5))).toMatchObject({ display: '2:30', remainingMs: s(569.5), status: 'running' });
  });

  it('stops at the cap, however long the app was away', () => {
    expect(snapshot(run, T + s(720))).toMatchObject({ status: 'done', display: '12:00', remainingMs: 0 });
    expect(snapshot(run, T + s(7200))).toMatchObject({ status: 'done', display: '12:00' });
    expect(endsAtMs(run)).toBe(T + s(720));
  });
});

describe('Tabata', () => {
  const run = startRun({ mode: 'tabata', workMs: s(20), restMs: s(10), rounds: 8 }, T);

  it('switches between work and rest at the boundaries', () => {
    expect(snapshot(run, T)).toMatchObject({ phase: 'work', round: 1, display: '0:20', displayMeaning: 'Work' });
    expect(snapshot(run, T + s(20) - 1)).toMatchObject({ phase: 'work', round: 1, display: '0:01' });
    expect(snapshot(run, T + s(20))).toMatchObject({ phase: 'rest', round: 1, display: '0:10', displayMeaning: 'Rest' });
    expect(snapshot(run, T + s(30))).toMatchObject({ phase: 'work', round: 2, display: '0:20' });
  });

  it('is in the right phase and round after a background jump', () => {
    // 3:35 in: round 8 (starts 3:30), 5 s into its work.
    expect(snapshot(run, T + s(215))).toMatchObject({ phase: 'work', round: 8, display: '0:15' });
    expect(snapshot(run, T + s(235))).toMatchObject({ phase: 'rest', round: 8, display: '0:05' });
  });

  it('finishes after the last rest', () => {
    expect(snapshot(run, T + s(240))).toMatchObject({ status: 'done', round: 8, display: '0:00' });
    expect(snapshot(run, T + s(900))).toMatchObject({ status: 'done' });
    expect(endsAtMs(run)).toBe(T + s(240));
  });

  it('handles a pause across a phase boundary', () => {
    const paused = pauseRun(run, T + s(18));
    const resumed = resumeRun(paused, T + s(300));
    expect(snapshot(resumed, T + s(300))).toMatchObject({ phase: 'work', display: '0:02', round: 1 });
    expect(snapshot(resumed, T + s(302))).toMatchObject({ phase: 'rest', round: 1 });
    expect(endsAtMs(resumed)).toBe(T + s(240 + 282));
  });
});

describe('snapshot of a timer not yet started', () => {
  it('shows where each mode will start from', () => {
    expect(snapshot(null, T, { mode: 'countdown', durationMs: s(120) })).toMatchObject({ status: 'idle', display: '2:00' });
    expect(snapshot(null, T, { mode: 'stopwatch' })).toMatchObject({ status: 'idle', display: '0:00' });
    expect(snapshot(null, T, { mode: 'emom', intervalMs: s(60), rounds: 10 })).toMatchObject({ round: 1, display: '1:00' });
    expect(snapshot(null, T, { mode: 'tabata', workMs: s(20), restMs: s(10), rounds: 8 })).toMatchObject({
      phase: 'work',
      display: '0:20',
    });
    expect(snapshot(null, T)).toMatchObject({ status: 'idle', display: '0:00' });
  });
});

describe('zeroAlertText', () => {
  it('words the end of each finite mode', () => {
    expect(zeroAlertText({ mode: 'countdown', durationMs: 1 }).title).toBe('Time’s up');
    expect(zeroAlertText({ mode: 'emom', intervalMs: 1, rounds: 10 }).body).toContain('10 rounds');
    expect(zeroAlertText({ mode: 'amrap', durationMs: 1 }).title).toContain('AMRAP');
    expect(zeroAlertText({ mode: 'tabata', workMs: 1, restMs: 1, rounds: 8 }).title).toContain('Tabata');
  });
});

describe('readTimerConfig', () => {
  const drafts = (patch: Partial<TimerDrafts>): TimerDrafts => ({ ...defaultTimerDrafts(), ...patch });

  it('reads the defaults for every mode', () => {
    expect(readTimerConfig(drafts({ mode: 'stopwatch' }))).toEqual({ ok: true, config: { mode: 'stopwatch' } });
    expect(readTimerConfig(drafts({ mode: 'countdown' }))).toEqual({ ok: true, config: { mode: 'countdown', durationMs: s(120) } });
    expect(readTimerConfig(drafts({ mode: 'emom' }))).toEqual({
      ok: true,
      config: { mode: 'emom', intervalMs: s(60), rounds: 10 },
    });
    expect(readTimerConfig(drafts({ mode: 'amrap' }))).toEqual({ ok: true, config: { mode: 'amrap', durationMs: s(720) } });
    expect(readTimerConfig(drafts({ mode: 'tabata' }))).toEqual({
      ok: true,
      config: { mode: 'tabata', workMs: s(20), restMs: s(10), rounds: 8 },
    });
  });

  it('names the problem with each box', () => {
    const countdown = readTimerConfig(drafts({ mode: 'countdown', countdown: { minutes: '0', seconds: '0' } }));
    expect(countdown).toEqual({ ok: false, errors: { time: 'Enter a time above 0:00.' } });
    const empty = readTimerConfig(drafts({ mode: 'amrap', amrap: { minutes: '', seconds: '' } }));
    expect(empty).toEqual({ ok: false, errors: { time: 'Enter a time.' } });
    const emom = readTimerConfig(drafts({ mode: 'emom', emom: { minutes: '1', seconds: '0', rounds: '0' } }));
    expect(emom.ok).toBe(false);
    expect(!emom.ok && emom.errors.rounds).toBe('Enter rounds from 1 to 99.');
    const tabata = readTimerConfig(drafts({ mode: 'tabata', tabata: { workSeconds: '0', restSeconds: 'x', rounds: '8' } }));
    expect(!tabata.ok && tabata.errors.work).toMatch(/work seconds from 1/);
    expect(!tabata.ok && tabata.errors.rest).toMatch(/whole number/);
  });

  it('allows a Tabata with no rest', () => {
    const reading = readTimerConfig(drafts({ mode: 'tabata', tabata: { workSeconds: '30', restSeconds: '0', rounds: '5' } }));
    expect(reading).toEqual({ ok: true, config: { mode: 'tabata', workMs: s(30), restMs: 0, rounds: 5 } });
  });
});
