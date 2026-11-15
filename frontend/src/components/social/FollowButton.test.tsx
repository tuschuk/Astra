/**
 * Tests for the shared Follow / Following button (B25, extracted from UserCard): it flips at once,
 * flips back with the message on a refusal, and tells `onSettled` only about changes the server
 * accepted — the profile re-reads its counts on that, so a refused follow never moves a count.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FOLLOW_REFUSED, type FollowResult } from '@/social/follows';

import { FollowButton } from './FollowButton';

describe('FollowButton', () => {
  it('flips at once and reports an accepted change', async () => {
    const onSettled = jest.fn();
    const onSetFollowing = jest.fn(async (_next: boolean): Promise<FollowResult> => ({ ok: true }));
    await render(<FollowButton initialFollowing={false} onSetFollowing={onSetFollowing} onSettled={onSettled} />);
    await fireEvent.press(screen.getByLabelText('Follow'));
    expect(await screen.findByLabelText('Following')).toBeTruthy();
    expect(onSetFollowing).toHaveBeenCalledWith(true);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('flips back with the message on a refusal, and reports nothing', async () => {
    const onSettled = jest.fn();
    await render(
      <FollowButton
        initialFollowing={false}
        onSetFollowing={async () => ({ ok: false, message: FOLLOW_REFUSED })}
        onSettled={onSettled}
      />,
    );
    await fireEvent.press(screen.getByLabelText('Follow'));
    expect(await screen.findByText(FOLLOW_REFUSED)).toBeTruthy();
    expect(screen.getByLabelText('Follow')).toBeTruthy();
    expect(onSettled).not.toHaveBeenCalled();
  });
});
