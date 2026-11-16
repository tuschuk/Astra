/**
 * Tests for the "Switch to this gym?" question (B50): it names both gyms, and only "Switch gyms"
 * runs the switch.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Alert, type AlertButton } from 'react-native';

import { confirmSwitchGym } from './confirmSwitchGym';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('confirmSwitchGym', () => {
  it('names both gyms; Switch gyms runs onConfirm, Stay does not', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onConfirm = jest.fn();
    confirmSwitchGym('Old Gym', 'New Gym', onConfirm);
    expect(alert.mock.calls[0][0]).toBe('Switch to New Gym?');
    expect(alert.mock.calls[0][1]).toMatch(/takes you out of Old Gym/);
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    expect(buttons.map((b) => b.text)).toEqual(['Stay', 'Switch gyms']);
    expect(buttons[0].onPress).toBeUndefined();
    buttons[1].onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
