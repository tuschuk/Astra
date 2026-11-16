/**
 * Tests for TrendChart (B46): it speaks one sentence with the real numbers before anything is
 * drawn, draws nothing until it has measured its width, and then draws the line and one dot per
 * session (a lone session: just its dot).
 */
import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TrendPoint } from '@/workout/trendSeries';

import { TrendChart } from './TrendChart';

const HIDDEN = { includeHiddenElements: true };
const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();
const points: TrendPoint[] = [
  { workoutId: 'a', startedAtMs: at(2026, 2, 3), valueKg: 9210 },
  { workoutId: 'b', startedAtMs: at(2026, 10, 12), valueKg: 8400 },
];

/** Reports a measured width, as the phone does after the first layout pass. */
async function measure(width: number) {
  await fireEvent(screen.getByTestId('chart'), 'layout', { nativeEvent: { layout: { width, height: 180, x: 0, y: 0 } } });
}

describe('TrendChart', () => {
  it('tells a screen reader the chart’s numbers', async () => {
    await render(<TrendChart title="Volume per session" points={points} unit="kg" baseline="zero" testID="chart" />);
    expect(
      screen.getByLabelText(
        'Volume per session: 2 sessions from Mar 3, 2026 to Nov 12, 2026, latest 8,400 kg, highest 9,210 kg.',
      ),
    ).toBeTruthy();
  });

  it('draws nothing before its width is known, then the line and a dot per session', async () => {
    await render(<TrendChart title="Volume per session" points={points} unit="kg" baseline="zero" testID="chart" />);
    expect(screen.queryByTestId('trend-line', HIDDEN)).toBeNull();
    await measure(320);
    expect(screen.getByTestId('trend-line', HIDDEN)).toBeTruthy();
    expect(screen.getAllByTestId('trend-marker', HIDDEN)).toHaveLength(2);
  });

  it('a single session is a dot without a line', async () => {
    await render(<TrendChart title="Squat estimated 1RM" points={points.slice(1)} unit="kg" baseline="fit" testID="chart" />);
    await measure(320);
    expect(screen.queryByTestId('trend-line', HIDDEN)).toBeNull();
    expect(screen.getAllByTestId('trend-marker', HIDDEN)).toHaveLength(1);
  });
});
