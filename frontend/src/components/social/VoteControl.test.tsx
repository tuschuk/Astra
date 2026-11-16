/**
 * Tests for VoteControl (B41 — the vote arrows lifted out of the post card so a program votes
 * exactly as a post does): the lit arrow follows the viewer's vote; a tap moves the score at once
 * and sends the change (tap again to take it back, the other arrow to switch); a refusal steps the
 * score back and shows the reason; a fresh load's numbers replace the shown ones; no downvote
 * arrow when downvotes aren't taken; and with no sender the arrows only show.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { VOTE_REFUSAL_MESSAGES, type VoteResult, type VoteValue } from '@/social/votes';

import { VoteControl } from './VoteControl';

/** The score on screen. */
function shownScore(): string {
  return String(screen.getByTestId('vote-score').props.accessibilityLabel);
}

describe('VoteControl', () => {
  it('lights the viewer’s vote; a tap moves the score at once and sends the change', async () => {
    const onVote = jest.fn<(next: VoteValue | null) => Promise<VoteResult>>(async () => ({ ok: true }));
    await render(<VoteControl score={4} myVote={null} showDownvote onVote={onVote} />);
    expect(shownScore()).toBe('Score 4');
    expect(screen.getByLabelText('Upvote').props.accessibilityState.selected).toBe(false);

    await fireEvent.press(screen.getByLabelText('Upvote'));
    expect(onVote).toHaveBeenLastCalledWith(1);
    expect(shownScore()).toBe('Score 5');
    expect(screen.getByLabelText('Upvote').props.accessibilityState.selected).toBe(true);

    // Switch: up → down moves by 2.
    await fireEvent.press(screen.getByLabelText('Downvote'));
    expect(onVote).toHaveBeenLastCalledWith(-1);
    expect(shownScore()).toBe('Score 3');

    // Tap the lit one again: the vote comes off.
    await fireEvent.press(screen.getByLabelText('Downvote'));
    expect(onVote).toHaveBeenLastCalledWith(null);
    expect(shownScore()).toBe('Score 4');
  });

  it('a refusal steps the score back and says why', async () => {
    const onVote = jest.fn<(next: VoteValue | null) => Promise<VoteResult>>(async () => ({ ok: false, reason: 'failed' }));
    await render(<VoteControl score={2} myVote={1} showDownvote onVote={onVote} />);
    await fireEvent.press(screen.getByLabelText('Downvote'));
    expect(shownScore()).toBe('Score 2');
    expect(screen.getByLabelText('Upvote').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(VOTE_REFUSAL_MESSAGES.failed)).toBeTruthy();
  });

  it('a sender that throws counts as refused, and the arrows still work afterwards', async () => {
    const onVote = jest
      .fn<(next: VoteValue | null) => Promise<VoteResult>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: true });
    await render(<VoteControl score={0} myVote={null} showDownvote onVote={onVote} />);
    await fireEvent.press(screen.getByLabelText('Upvote'));
    expect(shownScore()).toBe('Score 0');
    expect(screen.getByText(VOTE_REFUSAL_MESSAGES.failed)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Upvote'));
    expect(onVote).toHaveBeenCalledTimes(2);
    expect(shownScore()).toBe('Score 1');
  });

  it('a fresh load’s numbers replace the shown ones', async () => {
    const onVote = jest.fn<(next: VoteValue | null) => Promise<VoteResult>>(async () => ({ ok: true }));
    const view = await render(<VoteControl score={2} myVote={null} showDownvote onVote={onVote} />);
    await fireEvent.press(screen.getByLabelText('Upvote'));
    expect(shownScore()).toBe('Score 3');
    await view.rerender(<VoteControl score={7} myVote={-1} showDownvote onVote={onVote} />);
    expect(shownScore()).toBe('Score 7');
    expect(screen.getByLabelText('Downvote').props.accessibilityState.selected).toBe(true);
  });

  it('no downvote arrow when downvotes aren’t taken; no sender means display only', async () => {
    await render(<VoteControl score={1} myVote={null} showDownvote={false} />);
    expect(screen.queryByLabelText('Downvote')).toBeNull();
    expect(screen.getByLabelText('Upvote').props.accessibilityState.disabled).toBe(true);
  });
});
