/**
 * Tests for the user card (B20, SOC-7's action): Follow flips to Following at once and asks to
 * follow; Following asks to unfollow; a refusal flips the button back and explains.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FOLLOW_REFUSED, type FollowResult, type LifterResult } from '@/social/follows';

import { UserCard } from './UserCard';

const lifter: LifterResult = { id: 'u2', username: 'big_sam', displayName: 'Big Sam', following: false };

describe('UserCard', () => {
  it('shows the name and handle, and follows then unfollows', async () => {
    const onSetFollowing = jest.fn(async (_next: boolean): Promise<FollowResult> => ({ ok: true }));
    await render(<UserCard lifter={lifter} onSetFollowing={onSetFollowing} />);
    expect(screen.getByText('Big Sam')).toBeTruthy();
    expect(screen.getByText('@big_sam')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Follow'));
    expect(onSetFollowing).toHaveBeenLastCalledWith(true);
    expect(await screen.findByLabelText('Following')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Following'));
    expect(onSetFollowing).toHaveBeenLastCalledWith(false);
    expect(await screen.findByLabelText('Follow')).toBeTruthy();
  });

  it('starts as Following for someone already followed', async () => {
    await render(<UserCard lifter={{ ...lifter, following: true }} onSetFollowing={async () => ({ ok: true })} />);
    expect(screen.getByLabelText('Following')).toBeTruthy();
  });

  it('flips back and explains when the follow is refused', async () => {
    await render(
      <UserCard lifter={lifter} onSetFollowing={async () => ({ ok: false, message: FOLLOW_REFUSED })} />,
    );
    await fireEvent.press(screen.getByLabelText('Follow'));
    expect(await screen.findByText(FOLLOW_REFUSED)).toBeTruthy();
    expect(screen.getByLabelText('Follow')).toBeTruthy();
  });
});
