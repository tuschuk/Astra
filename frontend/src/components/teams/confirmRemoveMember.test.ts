/**
 * Tests for the owner's "Remove this member?" question (B38): it names the member and the team,
 * and only the destructive choice runs the removal.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Alert, type AlertButton } from 'react-native';

import { confirmRemoveMember } from './confirmRemoveMember';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('confirmRemoveMember', () => {
  it('names member and team; Remove runs onConfirm, Cancel does not', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onConfirm = jest.fn();
    confirmRemoveMember('Pat', 'Iron Tribe', onConfirm);
    expect(alert.mock.calls[0][0]).toBe('Remove Pat from Iron Tribe?');
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Remove']);
    expect(buttons[0].onPress).toBeUndefined();
    buttons[1].onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
