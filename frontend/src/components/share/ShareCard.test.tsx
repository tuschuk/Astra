/**
 * Tests for the workout share card (LOG-8, B28): it prints the analysis screen's exact spellings
 * in the sharer's unit (kg and lb), caps PR lines at three with "+ n more", lists exercises with
 * set counts when there are no PRs, and draws in the 4:5 shape at whatever width it is given.
 * Legibility in another app is a device check — Jest can only pin what the card says.
 */
import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import type { AnalysisPr } from '@analysis';

import { DELETED_EXERCISE, formatDuration, formatWeight, setsSummaryLabel, workoutDateLabel } from '@/workout/format';

import { SHARE_CARD_LINE_LIMIT, ShareCard, shareCardLines, type ShareCardExercise } from './ShareCard';

const STARTED = '2026-11-12T12:00:00.000Z';

function pr(name: string | null, reps: number, kg: number): AnalysisPr {
  return { exercise_id: `ex-${name}`, exercise_name: name, kind: 'repMax', reps, value_kg: kg };
}

const exercises: ShareCardExercise[] = [
  { id: 'e1', name: 'Bench Press', setCount: 3 },
  { id: 'e2', name: null, setCount: 1 },
];

/** Renders a card with sensible defaults and the given overrides. */
async function renderCard(overrides: Partial<React.ComponentProps<typeof ShareCard>> = {}) {
  await render(
    <ShareCard
      title="Heavy Squat Day"
      startedAt={STARTED}
      volumeKg={2041.165}
      totalSets={5}
      workingSets={4}
      durationSeconds={3540}
      prs={[pr('Squat', 5, 102.058)]}
      exercises={exercises}
      unit="lb"
      width={360}
      {...overrides}
    />,
  );
}

describe('ShareCard', () => {
  it('shows the wordmark, the date, the title and the three numbers in the analysis screen’s spellings (lb)', async () => {
    await renderCard();
    expect(screen.getByText('Astra')).toBeTruthy();
    expect(screen.getByText(workoutDateLabel(STARTED))).toBeTruthy();
    expect(screen.getByText('Heavy Squat Day')).toBeTruthy();
    expect(screen.getByText(formatWeight(2041.165, 'lb'))).toBeTruthy();
    expect(screen.getByText('5 sets · 1 warm-up')).toBeTruthy();
    expect(screen.getByText(formatDuration(3540))).toBeTruthy();
    expect(screen.getByText('New PR')).toBeTruthy();
    expect(screen.getByText(`Squat · 5RM · ${formatWeight(102.058, 'lb')}`)).toBeTruthy();
    expect(screen.queryByText(/kg/)).toBeNull();
  });

  it('follows the sharer’s unit: kg', async () => {
    await renderCard({ unit: 'kg' });
    expect(screen.getByText(formatWeight(2041.165, 'kg'))).toBeTruthy();
    expect(screen.getByText(`Squat · 5RM · ${formatWeight(102.058, 'kg')}`)).toBeTruthy();
    expect(screen.queryByText(/lb/)).toBeNull();
  });

  it('an untitled workout uses its date as the title', async () => {
    await renderCard({ title: null });
    expect(screen.getAllByText(workoutDateLabel(STARTED))).toHaveLength(2);
  });

  it('with no PRs, lists what was done instead', async () => {
    await renderCard({ prs: [] });
    expect(screen.getByText('Exercises')).toBeTruthy();
    expect(screen.getByText('Bench Press · 3 sets')).toBeTruthy();
    expect(screen.getByText(`${DELETED_EXERCISE} · 1 set`)).toBeTruthy();
    expect(screen.queryByText(/New PR/)).toBeNull();
  });

  it('is 4:5 at the width it is given, with a solid background (no see-through image)', async () => {
    await renderCard({ width: 300 });
    const style = StyleSheet.flatten(screen.getByTestId('share-card').props.style);
    expect(style.width).toBe(300);
    expect(style.height).toBe(375);
    expect(style.backgroundColor).toMatch(/^#/);
  });
});

describe('shareCardLines', () => {
  it('caps PR lines and says how many more', () => {
    const prs = [pr('Squat', 5, 100), pr('Bench', 3, 80), pr('Deadlift', 1, 180), pr('Row', 8, 60), pr('Press', 5, 50)];
    const out = shareCardLines(prs, exercises, 'kg');
    expect(out?.heading).toBe('New PRs');
    expect(out?.lines).toHaveLength(SHARE_CARD_LINE_LIMIT + 1);
    expect(out?.lines[SHARE_CARD_LINE_LIMIT]).toBe('+ 2 more PRs');
  });

  it('caps exercise lines the same way, singular for one more', () => {
    const many = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: String(i), name: n, setCount: 2 }));
    expect(shareCardLines([], many, 'kg')?.lines).toEqual(['A · 2 sets', 'B · 2 sets', 'C · 2 sets', '+ 1 more exercise']);
  });

  it('a deleted exercise’s PR prints the existing "Deleted exercise"', () => {
    expect(shareCardLines([pr(null, 5, 100)], [], 'kg')?.lines[0]).toBe(`${DELETED_EXERCISE} · 5RM · ${formatWeight(100, 'kg')}`);
  });

  it('nothing to list at all → no list', () => {
    expect(shareCardLines([], [], 'kg')).toBeNull();
  });
});

describe('setsSummaryLabel (the analysis screen’s spelling, shared with the card)', () => {
  it('names warm-ups only when there were some', () => {
    expect(setsSummaryLabel(5, 4)).toBe('5 sets · 1 warm-up');
    expect(setsSummaryLabel(1, 1)).toBe('1 set');
  });
});
