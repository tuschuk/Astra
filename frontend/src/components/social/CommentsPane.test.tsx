/**
 * Tests for CommentsPane (B41 — the comments list and composer lifted out of the post Comments
 * screen so a program's comments work exactly as a post's): the loaded comments in order with
 * names; the "more exist" line; Send off while blank, over the cap or signed out, with the cap's
 * one sentence; a sent comment appears as saved and clears the box; a failed send says so; a
 * failed load shows the offline message and Retry reads again; and the ⋯ report button only on
 * other people's comments, only when the screen wires reporting in.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { COMMENT_MAX_CHARS, COMMENT_TOO_LONG } from '@/social/commentLimits';
import type { CommentsPage, PostComment } from '@/social/comments';

import { COMMENTS_OFFLINE, CommentsPane, MORE_COMMENTS_LINE, SEND_FAILED_LINE } from './CommentsPane';

/** A comment as the pane receives it. */
function comment(id: string, authorId: string, name: string, body: string): PostComment {
  return { id, body, createdAt: '2026-11-14T10:00:00.000Z', author: { id: authorId, username: `${authorId}_lifts`, displayName: name } };
}

const page: CommentsPage = { comments: [comment('c1', 'ann', 'Ann', 'First'), comment('c2', 'me', 'Me', 'Mine')], more: false };

describe('CommentsPane', () => {
  it('shows the loaded comments in order with their authors', async () => {
    await render(<CommentsPane load={async () => page} send={jest.fn<(b: string) => Promise<PostComment>>()} me="me" />);
    expect(await screen.findByText('First')).toBeTruthy();
    expect(screen.getAllByTestId('comment-row')).toHaveLength(2);
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.queryByText(MORE_COMMENTS_LINE)).toBeNull();
  });

  it('says more exist when the load was cut off', async () => {
    await render(<CommentsPane load={async () => ({ ...page, more: true })} send={jest.fn<(b: string) => Promise<PostComment>>()} me="me" />);
    expect(await screen.findByText(MORE_COMMENTS_LINE)).toBeTruthy();
  });

  it('Send is off while blank or over the cap (with the cap’s sentence), and off when signed out', async () => {
    const view = await render(<CommentsPane load={async () => page} send={jest.fn<(b: string) => Promise<PostComment>>()} me="me" />);
    await screen.findByText('First');
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), 'x'.repeat(COMMENT_MAX_CHARS + 1));
    expect(screen.getByText(COMMENT_TOO_LONG)).toBeTruthy();
    expect(screen.getByText(`${COMMENT_MAX_CHARS + 1} / ${COMMENT_MAX_CHARS}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(true);
    await view.unmount();

    await render(<CommentsPane load={async () => page} send={jest.fn<(b: string) => Promise<PostComment>>()} me={null} />);
    await screen.findByText('First');
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), 'hello');
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(true);
  });

  it('a sent comment appears as saved and the box clears; a failed send says so', async () => {
    const send = jest.fn(async (body: string) => comment('new', 'me', 'Me', body));
    await render(<CommentsPane load={async () => page} send={send} me="me" />);
    await screen.findByText('First');
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), 'Great block');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith('Great block');
    expect(screen.getByText('Great block')).toBeTruthy();
    expect(screen.getByLabelText('Write a comment').props.value).toBe('');

    send.mockRejectedValueOnce(new Error('offline'));
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), 'Again');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText(SEND_FAILED_LINE)).toBeTruthy();
  });

  it('a failed load shows the offline message; Retry reads again', async () => {
    const load = jest.fn<() => Promise<CommentsPage>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(page);
    await render(<CommentsPane load={load} send={jest.fn<(b: string) => Promise<PostComment>>()} me="me" />);
    expect(await screen.findByText(COMMENTS_OFFLINE)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('First')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('the ⋯ report button: only with reporting wired in, only on other people’s comments', async () => {
    const onReport = jest.fn();
    const view = await render(<CommentsPane load={async () => page} send={jest.fn<(b: string) => Promise<PostComment>>()} me="me" onReport={onReport} />);
    await screen.findByText('First');
    expect(screen.queryByLabelText('Report Me’s comment')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Report Ann’s comment'));
    expect(onReport).toHaveBeenCalledWith(page.comments[0]);
    await view.unmount();

    await render(<CommentsPane load={async () => page} send={jest.fn<(b: string) => Promise<PostComment>>()} me="me" />);
    await screen.findByText('First');
    expect(screen.queryByLabelText(/^Report /)).toBeNull();
  });
});
