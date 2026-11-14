/**
 * Tab bar tests — FND-4's definition of done, as far as a unit test can show
 * it: six destinations exist exactly once each, and a tab button renders the
 * right state when idle, focused, and pressed. (The routing itself is
 * expo-router's code; these tests cover our config and our button.)
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { AstraTabButton, TABS } from './AstraTabBar';

describe('TABS config', () => {
  it('defines exactly the six destinations, in order', () => {
    expect(TABS.map((tab) => tab.name)).toEqual([
      'index',
      'marketplace',
      'workout',
      'communities',
      'library',
      'you',
    ]);
  });

  it('gives every destination a unique href', () => {
    const hrefs = TABS.map((tab) => tab.href);
    expect(new Set(hrefs).size).toBe(TABS.length);
  });

  it('keeps Workout in the center slot', () => {
    // The raised red action must sit mid-bar; moving it breaks the layout.
    expect(TABS[2].name).toBe('workout');
  });
});

describe('AstraTabButton', () => {
  const home = TABS[0];

  it('renders its label and reports unselected when idle', async () => {
    const screen = await render(<AstraTabButton tab={home} isFocused={false} />);
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByTestId('tab-index').props.accessibilityState).toEqual({ selected: false });
  });

  it('reports selected when focused', async () => {
    const screen = await render(<AstraTabButton tab={home} isFocused />);
    expect(screen.getByTestId('tab-index').props.accessibilityState).toEqual({ selected: true });
  });

  it('forwards presses to the handler expo-router injects', async () => {
    const onPress = jest.fn();
    const screen = await render(<AstraTabButton tab={home} onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('tab-index'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
