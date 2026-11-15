/**
 * Tests for the owner's "Delete this team?" question (B38): it names the team, says posts and
 * workouts survive, and only the destructive choice runs the deletion.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Alert, type AlertButton } from 'react-native';

import { confirmDeleteTeam } from './confirmDeleteTeam';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('confirmDeleteTeam', () => {
  it('names the team; Delete team runs onConfirm, Keep the team does not', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onConfirm = jest.fn();
    confirmDeleteTeam('Iron Tribe', onConfirm);
    expect(alert.mock.calls[0][0]).toBe('Delete Iron Tribe?');
    expect(alert.mock.calls[0][1]).toMatch(/Posts and workouts stay with their owners/);
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    expect(buttons.map((b) => b.text)).toEqual(['Keep the team', 'Delete team']);
    expect(buttons[0].onPress).toBeUndefined();
    buttons[1].onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
