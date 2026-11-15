/**
 * Tests for one row of the Workout tab's history: what it says, and that a tap opens it.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { WORKOUT } from '@/test-utils/workoutFixtures';
import { workoutDateLabel } from '@/workout/format';

import { WorkoutListItem } from './WorkoutListItem';

describe('WorkoutListItem', () => {
  it('shows the date (no title yet), duration and counts, and opens on tap', async () => {
    const onPress = jest.fn();
    const untitled = { ...WORKOUT, title: null };
    await render(<WorkoutListItem summary={{ workout: untitled, exerciseCount: 2, setCount: 5 }} onPress={onPress} />);
    const date = workoutDateLabel(WORKOUT.started_at);
    expect(screen.getByText(date)).toBeTruthy();
    expect(screen.getByText('1 h · 2 exercises · 5 sets')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(`Open workout from ${date}`));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('uses the title when there is one, and singular counts', async () => {
    await render(
      <WorkoutListItem summary={{ workout: WORKOUT, exerciseCount: 1, setCount: 1 }} onPress={() => undefined} />,
    );
    expect(screen.getByText('Push day')).toBeTruthy();
    expect(screen.getByText('1 h · 1 exercise · 1 set')).toBeTruthy();
  });
});
