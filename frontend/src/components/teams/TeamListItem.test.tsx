/**
 * Tests for TeamListItem (B36): the name and the mode / role line, tapping the row, and the
 * row's own buttons acting without opening the team.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TeamListItem } from './TeamListItem';

const team = { id: 't', name: 'Iron Tribe', joinMode: 'invite' as const };

describe('TeamListItem', () => {
  it('shows the name, the mode and the role, and opens on tap', async () => {
    const onPress = jest.fn();
    await render(<TeamListItem team={team} role="owner" onPress={onPress} />);
    expect(screen.getByText('Iron Tribe')).toBeTruthy();
    expect(screen.getByText('Invite only · Owner')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open team Iron Tribe'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('without a role shows only the mode; its buttons act on their own', async () => {
    const onPress = jest.fn();
    const onJoin = jest.fn();
    await render(<TeamListItem team={{ ...team, joinMode: 'open' }} onPress={onPress} actions={[{ label: 'Join', onPress: onJoin }]} />);
    expect(screen.getByText('Open')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Join Iron Tribe'));
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });
});
