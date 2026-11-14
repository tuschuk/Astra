/**
 * Button tests — the three recipe variants render their label, fire onPress,
 * and respect disabled.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Button } from './Button';

describe('Button', () => {
  it.each(['primary', 'ghost', 'outline'] as const)(
    'renders the %s variant label',
    async (variant) => {
      const screen = await render(
        <Button label="Start workout" onPress={() => {}} variant={variant} />,
      );
      expect(screen.getByText('Start workout')).toBeTruthy();
    },
  );

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    const screen = await render(<Button label="Save changes" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', async () => {
    const onPress = jest.fn();
    const screen = await render(<Button label="Save changes" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
