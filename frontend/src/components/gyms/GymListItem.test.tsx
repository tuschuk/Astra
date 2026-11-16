/**
 * Tests for the gym row (B50): it shows the name, the address and any detail (a distance), a
 * screen reader hears the name and the detail, and a tap opens the gym.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { GymListItem } from './GymListItem';

const gym = { id: 'g1', name: 'Sample Gym · RiNo', address: 'River North, Denver, CO' };

describe('GymListItem', () => {
  it('shows name, address and distance; tapping opens it', async () => {
    const onPress = jest.fn();
    await render(<GymListItem gym={gym} detail="2.3 mi" onPress={onPress} />);
    expect(screen.getByText('Sample Gym · RiNo')).toBeTruthy();
    expect(screen.getByText('River North, Denver, CO · 2.3 mi')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open gym Sample Gym · RiNo, 2.3 mi'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('without a detail: just the address', async () => {
    await render(<GymListItem gym={gym} onPress={() => {}} />);
    expect(screen.getByText('River North, Denver, CO')).toBeTruthy();
    expect(screen.getByLabelText('Open gym Sample Gym · RiNo')).toBeTruthy();
  });
});
