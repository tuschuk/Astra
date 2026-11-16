/**
 * Tests for the trend charts' geometry (B46) — the edge cases hand-drawn charts get wrong, each
 * pinned to hand-worked numbers: nothing to draw, one session, a flat series, two sessions at the
 * same moment, too many sessions for dots, round axis values in kg *and* in lb (chosen after
 * conversion, never 220.5-style), a 0-anchored volume axis vs a fitted e1RM axis, locale-free date
 * labels that switch from days to months with the span, and the spoken sentence.
 */
import { describe, expect, it } from '@jest/globals';
import { lbToKg } from '@training-math';

import type { TrendPoint } from '@/workout/trendSeries';

import {
  buildChartLayout,
  chartSentence,
  MAX_MARKERS,
  valueAxis,
  type ChartOptions,
} from './chartLayout';

/** Noon local time on a date (month 0 = January), so every time zone sees the same day. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
const point = (id: string, ms: number, valueKg: number): TrendPoint => ({ workoutId: id, startedAtMs: ms, valueKg });
const KG_FIT: ChartOptions = { width: 320, height: 180, unit: 'kg', baseline: 'fit' };

describe('valueAxis', () => {
  it('fits an e1RM axis to the data with round steps', () => {
    // 100–120 padded 10% each side → 98–122; a step of 10 covers it as 90…130.
    expect(valueAxis([100, 110, 120], 'fit')).toMatchObject({ min: 90, max: 130, ticks: [90, 100, 110, 120, 130] });
  });

  it('anchors a volume axis at 0', () => {
    expect(valueAxis([2040, 0, 3000], 'zero').ticks).toEqual([0, 1000, 2000, 3000]);
  });

  it('gives a flat series a real range instead of dividing by zero', () => {
    expect(valueAxis([100, 100], 'fit').ticks).toEqual([95, 100, 105]);
    expect(valueAxis([0, 0], 'zero').ticks).toEqual([0, 5, 10]);
  });

  it('never fits an axis below 0', () => {
    expect(valueAxis([1, 2], 'fit').min).toBeGreaterThanOrEqual(0);
  });
});

describe('buildChartLayout', () => {
  it('has nothing to draw with no sessions, or before the width is known', () => {
    expect(buildChartLayout([], KG_FIT)).toBeNull();
    expect(buildChartLayout([point('a', at(2026, 10, 1), 100)], { ...KG_FIT, width: 0 })).toBeNull();
  });

  it('draws a line through every session, oldest at the left edge, newest at the right', () => {
    const layout = buildChartLayout(
      [point('a', at(2026, 0, 15), 100), point('b', at(2026, 4, 15), 110), point('c', at(2026, 9, 15), 120)],
      KG_FIT,
    );
    expect(layout).not.toBeNull();
    if (!layout) return;
    const { plot, markers } = layout;
    expect(markers).toHaveLength(3);
    expect(markers[0].x).toBe(plot.left);
    expect(markers[2].x).toBe(plot.right);
    // Higher values sit higher (smaller y), and the line visits the dots in order.
    expect(markers[0].y).toBeGreaterThan(markers[1].y);
    expect(markers[1].y).toBeGreaterThan(markers[2].y);
    expect(layout.path).toBe(markers.map((m, i) => `${i === 0 ? 'M' : 'L'}${m.x} ${m.y}`).join(' '));
    // The axis runs 90…130: its lowest label on the plot's floor, its highest on the ceiling.
    expect(layout.yTicks.map((t) => t.label)).toEqual(['90', '100', '110', '120', '130']);
    expect(layout.yTicks[0].y).toBe(plot.bottom);
    expect(layout.yTicks[4].y).toBe(plot.top);
    // A long span labels months, from fixed names (never the phone's locale).
    expect(layout.xTicks.map((t) => t.label)).toEqual(['Jan 2026', 'Apr 2026', 'Jul 2026', 'Oct 2026']);
    expect(layout.xTicks[0].x).toBe(plot.left);
    expect(layout.xTicks[3].x).toBe(plot.right);
  });

  it('picks round values in pounds after converting, never converted kg steps', () => {
    const layout = buildChartLayout(
      [point('a', at(2026, 0, 1), 100), point('b', at(2026, 1, 1), 110), point('c', at(2026, 2, 1), 120)],
      { ...KG_FIT, unit: 'lb' },
    );
    // 220.5 / 242.5 / 264.6 lb → a 20 lb step from 200 to 280.
    expect(layout?.yTicks.map((t) => t.label)).toEqual(['200', '220', '240', '260', '280']);
  });

  it('round kg values entered in pounds still read as round pounds', () => {
    const layout = buildChartLayout(
      [point('a', at(2026, 0, 1), lbToKg(225)), point('b', at(2026, 3, 1), lbToKg(315))],
      { ...KG_FIT, unit: 'lb' },
    );
    expect(layout?.yTicks.every((t) => /^\d{3}$/.test(t.label))).toBe(true);
  });

  it('labels a volume axis from 0 with thousands separators', () => {
    const layout = buildChartLayout(
      [point('a', at(2026, 0, 1), 2040), point('b', at(2026, 0, 3), 0), point('c', at(2026, 0, 5), 3000)],
      { ...KG_FIT, baseline: 'zero' },
    );
    expect(layout?.yTicks.map((t) => t.label)).toEqual(['0', '1,000', '2,000', '3,000']);
    // A 0-volume session (bodyweight day) sits on the floor.
    expect(layout?.markers[1].y).toBe(layout?.plot.bottom);
  });

  it('a single session is one dot in the middle, with no line', () => {
    const layout = buildChartLayout([point('a', at(2026, 10, 12), 150)], KG_FIT);
    expect(layout?.path).toBeNull();
    expect(layout?.markers).toHaveLength(1);
    const { left, right } = layout!.plot;
    expect(layout?.markers[0].x).toBeCloseTo(left + (right - left) / 2, 0);
    expect(layout?.xTicks.map((t) => t.label)).toEqual(['Nov 12']);
  });

  it('a flat series draws a level line inside the plot', () => {
    const layout = buildChartLayout(
      [point('a', at(2026, 10, 1), 100), point('b', at(2026, 10, 8), 100)],
      KG_FIT,
    );
    const [m1, m2] = layout!.markers;
    expect(m1.y).toBe(m2.y);
    expect(m1.y).toBeGreaterThan(layout!.plot.top);
    expect(m1.y).toBeLessThan(layout!.plot.bottom);
  });

  it('two sessions at the same moment share one x', () => {
    const layout = buildChartLayout(
      [point('a', at(2026, 10, 1), 100), point('b', at(2026, 10, 1), 120)],
      KG_FIT,
    );
    expect(layout?.markers[0].x).toBe(layout?.markers[1].x);
    expect(layout?.path).not.toBeNull();
    expect(layout?.xTicks).toHaveLength(1);
  });

  it('a short span labels days; same-day labels merge into one', () => {
    const days = buildChartLayout(
      [point('a', at(2026, 10, 10), 100), point('b', at(2026, 10, 13), 110)],
      KG_FIT,
    );
    expect(days?.xTicks.map((t) => t.label)).toEqual(['Nov 10', 'Nov 11', 'Nov 12', 'Nov 13']);
    const oneDay = buildChartLayout(
      [point('a', at(2026, 10, 10, 9), 100), point('b', at(2026, 10, 10, 17), 110)],
      KG_FIT,
    );
    expect(oneDay?.xTicks.map((t) => t.label)).toEqual(['Nov 10']);
  });

  it('drops the dots past MAX_MARKERS but keeps the line', () => {
    const many = Array.from({ length: MAX_MARKERS + 1 }, (_, i) => point(`p${i}`, at(2026, 0, 1) + i * 86_400_000, 100 + i));
    const layout = buildChartLayout(many, KG_FIT);
    expect(layout?.markers).toEqual([]);
    expect(layout?.path?.split('L')).toHaveLength(MAX_MARKERS + 1);
    const exactly = buildChartLayout(many.slice(0, MAX_MARKERS), KG_FIT);
    expect(exactly?.markers).toHaveLength(MAX_MARKERS);
  });
});

describe('chartSentence', () => {
  it('counts the sessions and names their span, latest and highest, in the lifter’s unit', () => {
    const points = [point('a', at(2026, 2, 3), 9210), point('b', at(2026, 10, 12), 8400)];
    expect(chartSentence('Volume per session', points, 'kg')).toBe(
      'Volume per session: 2 sessions from Mar 3, 2026 to Nov 12, 2026, latest 8,400 kg, highest 9,210 kg.',
    );
    expect(chartSentence('Squat estimated 1RM', [point('a', at(2026, 10, 12), 100)], 'lb')).toBe(
      'Squat estimated 1RM: 1 session on Nov 12, 2026, 220.5 lb.',
    );
    expect(chartSentence('Volume per session', [], 'kg')).toBeNull();
  });
});
