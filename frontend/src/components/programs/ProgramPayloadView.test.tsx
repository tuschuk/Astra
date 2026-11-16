/**
 * Tests for ProgramPayloadView (B40): every week, every workout (named, or "Workout N") and every
 * exercise slot with its targets in the lifter's unit; a slot that lost its exercise reads
 * "Deleted exercise"; an empty workout and a program with no weeks say so.
 */
import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import type { TeamProgramPayload } from '@/social/teamCoaching';

import { ProgramPayloadView } from './ProgramPayloadView';

const slot = { exerciseId: 'x', exerciseName: 'Back Squat', position: 0, targetSets: 3, targetReps: 5, targetWeightKg: 100, targetRpe: 8 };
const program: TeamProgramPayload = {
  name: 'Block',
  weeks: [
    {
      position: 0,
      workouts: [
        { name: 'Day A', position: 0, exercises: [slot, { ...slot, position: 1, exerciseName: null, targetRpe: null }] },
        { name: null, position: 1, exercises: [] },
      ],
    },
    { position: 1, workouts: [{ name: 'Day C', position: 0, exercises: [{ ...slot, exerciseName: 'Deadlift', targetReps: null, targetWeightKg: null, targetRpe: null }] }] },
  ],
};

describe('ProgramPayloadView', () => {
  it('draws every week, workout and slot with targets in the lifter’s unit', async () => {
    await render(<ProgramPayloadView payload={program} unit="kg" />);
    expect(screen.getByText('Week 1')).toBeTruthy();
    expect(screen.getByText('Week 2')).toBeTruthy();
    expect(screen.getByText('Day A')).toBeTruthy();
    expect(screen.getByText('Workout 2')).toBeTruthy();
    expect(screen.getByText('Day C')).toBeTruthy();
    expect(screen.getByText('Back Squat')).toBeTruthy();
    expect(screen.getByText('3 × 5 @ 100 kg · RPE 8')).toBeTruthy();
    expect(screen.getByText('Deleted exercise')).toBeTruthy();
    expect(screen.getByText('3 × 5 @ 100 kg')).toBeTruthy();
    expect(screen.getByText('Deadlift')).toBeTruthy();
    expect(screen.getByText('3 sets')).toBeTruthy();
    expect(screen.getByText('No exercises yet.')).toBeTruthy();
  });

  it('shows target weights in pounds for a lifter on lb', async () => {
    await render(<ProgramPayloadView payload={program} unit="lb" />);
    expect(screen.getByText('3 × 5 @ 220.5 lb · RPE 8')).toBeTruthy();
  });

  it('a program with no weeks says so', async () => {
    await render(<ProgramPayloadView payload={{ name: 'Empty', weeks: [] }} unit="kg" />);
    expect(screen.getByText('This program has no weeks yet.')).toBeTruthy();
  });
});
