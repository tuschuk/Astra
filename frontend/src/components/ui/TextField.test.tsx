/** TextField tests: findable by its label, forwards typing and focus/blur handlers. */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { TextField } from './TextField';

describe('TextField', () => {
  it('shows its label and is reachable by it', async () => {
    const screen = await render(<TextField label="Email" value="" onChangeText={() => {}} />);
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('passes typed text to onChangeText', async () => {
    const onChangeText = jest.fn();
    const screen = await render(<TextField label="Email" value="" onChangeText={onChangeText} />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.co');
    expect(onChangeText).toHaveBeenCalledWith('a@b.co');
  });

  it('still calls the caller’s own onFocus / onBlur', async () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const screen = await render(<TextField label="Email" onFocus={onFocus} onBlur={onBlur} />);
    await fireEvent(screen.getByLabelText('Email'), 'focus');
    await fireEvent(screen.getByLabelText('Email'), 'blur');
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
