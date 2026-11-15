/**
 * Tests for the feed's post card (B20): the flair chip shows the flair row's own name (SOC-3,
 * "data, not code"), every set is printed by the logger's one spelling — `formatSet` /
 * `formatDropSet` — in the viewer's unit (LOG-13's feed clause), supersets are grouped, and a
 * long workout is cut short with "+ n more". And (B22) photo posts: the picture fetched as the
 * viewer, the owner told when their post is private, a plain panel when it can't be shown.
 * And (B26) the owner-only "who can see this" chip on every post kind: the chooser, the
 * optimistic change, one change at a time, the revert on refusal.
 * And (B23) the vote footer: no downvote control on an upvote-only flair (read from the row),
 * optimistic score moves, the revert on refusal, and the comments button.
 * And (B27) the ⋯ report button: only on other people's cards, opening the report panel.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { toFeedPost, type FeedPost, type RawFeedPost } from '@/social/feed';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { REPORT_THANKS } from '@/social/moderation';
import { POST_VISIBILITY_REFUSAL_MESSAGES } from '@/social/postPrivacy';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';
import { VOTE_REFUSAL_MESSAGES } from '@/social/votes';
import { feedSet, profile, rawImagePost, rawPost, rawReshare } from '@/test-utils/feedFixtures';
import { RESHARE_MESSAGES } from '@/social/reshare';
import { formatDropSet, formatSet, workoutDetailsLabel } from '@/workout/format';

import { canReshare, CARD_EXERCISE_LIMIT, commentButtonLabel, PostCard, UNNAMED_EXERCISE } from './PostCard';

const NOW = new Date('2026-11-15T18:00:00');
const author = profile('u1', 'wod_queen', 'Wendy');

/** A workout post in the card's shape (the fixture always has a workout, so never dropped). */
function shaped(raw: RawFeedPost): Extract<FeedPost, { kind: 'workout' }> {
  const post = toFeedPost(raw);
  if (post?.kind !== 'workout') throw new Error('expected a workout post');
  return post;
}

/** A photo post in the card's shape. */
function shapedPhoto(raw: RawFeedPost): FeedPost {
  const post = toFeedPost(raw);
  if (!post) throw new Error('expected a post');
  return post;
}

// The viewer's unit, switchable per test (the real hook follows the synced setting).
let mockUnit: 'kg' | 'lb' = 'lb';
jest.mock('@/settings/displayUnit', () => ({ useDisplayUnit: () => mockUnit }));

beforeEach(() => {
  mockUnit = 'lb';
});

describe('PostCard — the author header (B25)', () => {
  it('opens the author’s profile when tapped', async () => {
    const onOpenProfile = jest.fn();
    const post = shaped(rawPost({ id: 'p1', author, createdAt: '2026-11-15T08:00:00.000Z' }));
    await render(<PostCard post={post} now={NOW} onOpenProfile={onOpenProfile} />);
    await fireEvent.press(screen.getByLabelText('Open Wendy’s profile'));
    expect(onOpenProfile).toHaveBeenCalledWith('u1');
  });

  it('is not tappable without a handler', async () => {
    const post = shaped(rawPost({ id: 'p1', author, createdAt: '2026-11-15T08:00:00.000Z' }));
    await render(<PostCard post={post} now={NOW} />);
    expect(screen.getByLabelText('Open Wendy’s profile')).toBeDisabled();
  });
});

describe('PostCard', () => {
  it('shows the author, the date, the flair row’s name, the title and the summary line', async () => {
    const post = shaped(
      rawPost({
        id: 'p1',
        author,
        createdAt: new Date('2026-11-15T07:00:00').toISOString(),
        // A flair name no app code mentions: the chip can only have got it from the data.
        flair: { id: 'grip-day', name: 'Grip Day Zz' },
        title: 'Friday grind',
        notes: 'Felt strong.',
      }),
    );
    await render(<PostCard post={post} now={NOW} />);
    expect(screen.getByText('Wendy')).toBeTruthy();
    expect(screen.getByText('@wod_queen · Today')).toBeTruthy();
    expect(screen.getByText('Grip Day Zz')).toBeTruthy();
    expect(screen.getByLabelText('Flair: Grip Day Zz')).toBeTruthy();
    expect(screen.getByText('Friday grind')).toBeTruthy();
    expect(screen.getByText(workoutDetailsLabel(post.workout, 1, 1))).toBeTruthy();
    expect(screen.getByText('Felt strong.')).toBeTruthy();
  });

  it('prints WOD-style, drop and superset work exactly as the logger’s formatter does, in the viewer’s unit', async () => {
    const timedScored = feedSet({ duration_seconds: 1200, score: '7 rounds + 12 reps' });
    const top = feedSet({ reps: 8, weight_kg: 100 });
    const drop1 = feedSet({ reps: 8, weight_kg: 80, drop_set_position: 1 });
    const drop2 = feedSet({ reps: 10, weight_kg: 60, drop_set_position: 2, rpe: 9.5 });
    const warm = feedSet({ reps: 10, weight_kg: 40, is_warmup: true });
    const pullups = feedSet({ reps: 12 });
    const post = shaped(
      rawPost({
        id: 'p2',
        author,
        createdAt: '2026-11-10T10:00:00.000Z',
        entries: [
          { name: 'Cindy', sets: [timedScored] },
          { name: 'Bench Press', sets: [warm, top, drop1, drop2], superset_group: 1 },
          { name: 'Pull-up', sets: [pullups], superset_group: 1 },
        ],
      }),
    );
    for (const unit of ['lb', 'kg'] as const) {
      mockUnit = unit;
      const view = await render(<PostCard post={post} now={NOW} />);
      expect(screen.getByText(formatSet(timedScored, unit))).toBeTruthy();
      expect(screen.getByText(formatSet(warm, unit))).toBeTruthy();
      expect(screen.getByText(formatDropSet([top, drop1, drop2], unit))).toBeTruthy();
      expect(screen.getByText(formatSet(pullups, unit))).toBeTruthy();
      expect(screen.getByText('Superset')).toBeTruthy();
      await view.unmount();
    }
  });

  it('names an exercise the viewer can’t see as a custom exercise, and cuts a long workout short', async () => {
    const entries = Array.from({ length: CARD_EXERCISE_LIMIT + 2 }, (_, i) => ({
      name: i === 0 ? null : `Exercise ${i}`,
      sets: [feedSet({ reps: i + 1 })],
    }));
    await render(<PostCard post={shaped(rawPost({ id: 'p3', author, createdAt: '2026-11-14T10:00:00Z', entries }))} now={NOW} />);
    expect(screen.getByText(UNNAMED_EXERCISE)).toBeTruthy();
    expect(screen.getByText(`Exercise ${CARD_EXERCISE_LIMIT - 1}`)).toBeTruthy();
    expect(screen.queryByText(`Exercise ${CARD_EXERCISE_LIMIT}`)).toBeNull();
    expect(screen.getByText('+ 2 more exercises')).toBeTruthy();
  });

  it('falls back to the workout date when untitled, and to the username when no display name is set', async () => {
    const post = shaped(
      rawPost({ id: 'p4', author: profile('u2', 'plain', null), createdAt: '2026-11-01T10:00:00Z', title: null }),
    );
    await render(<PostCard post={post} now={NOW} />);
    expect(screen.getByText('plain')).toBeTruthy();
    expect(screen.getByText(/^@plain · /)).toBeTruthy();
  });
});

describe('PostCard — votes and comments (B23)', () => {
  /** A workout post with the given flair, server score and my vote. */
  function scored(flair: { id: string; name: string; upvotes_only: boolean }, score: number, myVote: 1 | -1 | null): FeedPost {
    const raw = { ...rawPost({ id: 'v1', author, createdAt: '2026-11-15T07:00:00Z', flair }), my_vote: myVote ? [{ value: myVote }] : [] };
    const post = toFeedPost(raw, { post_id: 'v1', score, comment_count: 2 });
    if (!post) throw new Error('expected a post');
    return post;
  }
  const ordinary = { id: 'wod', name: 'WOD', upvotes_only: false };
  // A flair name no app code mentions: hiding the downvote can only have come from the row's flag.
  const upvoteOnly = { id: 'zz-flair', name: 'Zz Flex Friday', upvotes_only: true };

  it('an ordinary post shows both arrows around the server’s score, and the comment count', async () => {
    await render(<PostCard post={scored(ordinary, 4, null)} now={NOW} />);
    expect(screen.getByLabelText('Upvote')).toBeTruthy();
    expect(screen.getByLabelText('Downvote')).toBeTruthy();
    expect(screen.getByLabelText('Score 4')).toBeTruthy();
    expect(screen.getByLabelText('2 comments')).toBeTruthy();
  });

  it('an upvote-only flair has no downvote control at all (SOC-4 DoD)', async () => {
    await render(<PostCard post={scored(upvoteOnly, 1, null)} now={NOW} />);
    expect(screen.getByLabelText('Upvote')).toBeTruthy();
    expect(screen.queryByLabelText('Downvote')).toBeNull();
  });

  it('the Physique Check fixture (as seeded on the server) has no downvote control either', async () => {
    const post = shapedPhoto(rawImagePost({ id: 'pc', author, createdAt: '2026-11-15T07:00:00Z', kind: 'progress-pic' }));
    await render(<PostCard post={post} now={NOW} photoSource={() => null} />);
    expect(screen.queryByLabelText('Downvote')).toBeNull();
  });

  it('lights my own vote; tapping moves the score at once and sends the new vote', async () => {
    const onVote = jest.fn(async (_postId: string, _vote: 1 | -1 | null) => ({ ok: true as const }));
    await render(<PostCard post={scored(ordinary, 4, 1)} now={NOW} onVote={onVote} />);
    expect(screen.getByLabelText('Upvote').props.accessibilityState).toMatchObject({ selected: true });
    // Up → down: the score moves by 2.
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Downvote'));
    });
    expect(onVote).toHaveBeenLastCalledWith('v1', -1);
    expect(screen.getByLabelText('Score 2')).toBeTruthy();
    expect(screen.getByLabelText('Downvote').props.accessibilityState).toMatchObject({ selected: true });
    // Tapping the lit arrow takes the vote back.
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Downvote'));
    });
    expect(onVote).toHaveBeenLastCalledWith('v1', null);
    expect(screen.getByLabelText('Score 3')).toBeTruthy();
  });

  it('a refused vote puts the score and arrows back and says why', async () => {
    const onVote = jest.fn(async () => ({ ok: false as const, reason: 'upvotes-only' as const }));
    await render(<PostCard post={scored(ordinary, 4, null)} now={NOW} onVote={onVote} />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Downvote'));
    });
    expect(screen.getByLabelText('Score 4')).toBeTruthy();
    expect(screen.getByLabelText('Downvote').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByText(VOTE_REFUSAL_MESSAGES['upvotes-only'])).toBeTruthy();
  });

  it('a second tap while a vote is on its way sends nothing', async () => {
    let finish: (r: { ok: true }) => void = () => {};
    const onVote = jest.fn(() => new Promise<{ ok: true }>((resolve) => (finish = resolve)));
    await render(<PostCard post={scored(ordinary, 0, null)} now={NOW} onVote={onVote} />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Upvote'));
      fireEvent.press(screen.getByLabelText('Downvote'));
    });
    expect(onVote).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
    expect(screen.getByLabelText('Score 1')).toBeTruthy();
  });

  it('the comments button opens the post’s comments; it reads “Comment” when there are none', async () => {
    const onOpenComments = jest.fn();
    await render(<PostCard post={scored(ordinary, 0, null)} now={NOW} onOpenComments={onOpenComments} />);
    await fireEvent.press(screen.getByLabelText('2 comments'));
    expect(onOpenComments).toHaveBeenCalledWith('v1');
    expect(commentButtonLabel(0)).toBe('Comment');
    expect(commentButtonLabel(1)).toBe('1 comment');
  });
});

describe('PostCard — photo posts (B22)', () => {
  const source = (path: string) => ({ uri: `https://x/storage/v1/object/authenticated/post-images/${path}`, headers: { Authorization: 'Bearer t' } });

  it('a PR photo: the flair chip and the photo fetched as the viewer, no workout lines, no privacy line', async () => {
    const post = shapedPhoto(rawImagePost({ id: 'pr1', author, createdAt: '2026-11-15T07:00:00Z', kind: 'pr' }));
    await render(<PostCard post={post} now={NOW} viewerId="someone-else" photoSource={source} />);
    expect(screen.getByLabelText('Flair: New PR')).toBeTruthy();
    const photo = screen.getByLabelText('Post photo');
    expect(photo.props.source).toEqual(source('u1/pr1.jpg'));
    expect(screen.queryByLabelText(/^Who can see this post/)).toBeNull();
    expect(screen.queryByText(/exercise/)).toBeNull();
  });

  it('the owner’s own progress pic says only they can see it', async () => {
    const post = shapedPhoto(rawImagePost({ id: 'pic', author, createdAt: '2026-11-15T07:00:00Z', kind: 'progress-pic' }));
    await render(<PostCard post={post} now={NOW} viewerId="u1" photoSource={source} />);
    expect(screen.getByLabelText('Flair: Physique Check')).toBeTruthy();
    expect(screen.getByLabelText('Who can see this post: Only you')).toBeTruthy();
    expect(screen.getByText('Only you')).toBeTruthy();
  });

  it('with no way to fetch (no session), or when the photo fails to load, shows a plain panel instead', async () => {
    const post = shapedPhoto(rawImagePost({ id: 'pr2', author, createdAt: '2026-11-15T07:00:00Z', kind: 'pr' }));
    const view = await render(<PostCard post={post} now={NOW} photoSource={() => null} />);
    expect(screen.getByText('Photo unavailable')).toBeTruthy();
    await view.unmount();

    await render(<PostCard post={post} now={NOW} photoSource={source} />);
    await act(async () => {
      screen.getByLabelText('Post photo').props.onError();
    });
    expect(screen.getByText('Photo unavailable')).toBeTruthy();
  });

  it('a workout post renders beside them unchanged', async () => {
    await render(<PostCard post={shaped(rawPost({ id: 'w', author, createdAt: '2026-11-15T07:00:00Z' }))} now={NOW} />);
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.queryByTestId('post-photo')).toBeNull();
  });
});

describe('PostCard — who can see it (B26)', () => {
  const workoutPost = () => shaped(rawPost({ id: 'w1', author, createdAt: '2026-11-15T07:00:00Z' }));
  const pic = () => shapedPhoto(rawImagePost({ id: 'pic', author, createdAt: '2026-11-15T07:00:00Z', kind: 'progress-pic' }));
  const prPhoto = () => shapedPhoto(rawImagePost({ id: 'pr', author, createdAt: '2026-11-15T07:00:00Z', kind: 'pr' }));

  it('every kind of own post carries the chip; another lifter’s never does', async () => {
    for (const [post, label] of [
      [workoutPost(), 'Public'],
      [pic(), 'Only you'],
      [prPhoto(), 'Public'],
    ] as const) {
      const onChange = jest.fn(async () => ({ ok: true as const }));
      const ownView = await render(<PostCard post={post} now={NOW} viewerId="u1" onChangeVisibility={onChange} />);
      expect(screen.getByLabelText(`Who can see this post: ${label}`)).toBeTruthy();
      await ownView.unmount();
      const otherView = await render(<PostCard post={post} now={NOW} viewerId="someone-else" onChangeVisibility={onChange} />);
      expect(screen.queryByLabelText(/^Who can see this post/)).toBeNull();
      await otherView.unmount();
    }
  });

  it('without a handler the owner sees the audience but can’t change it', async () => {
    await render(<PostCard post={workoutPost()} now={NOW} viewerId="u1" />);
    expect(screen.getByLabelText('Who can see this post: Public')).toBeDisabled();
  });

  it('choosing “Only you” sends the change for this post, moves the chip at once, and closes the chooser', async () => {
    let finish: (r: { ok: true }) => void = () => {};
    const onChange = jest.fn((_post: FeedPost, _next: string) => new Promise<{ ok: true }>((r) => (finish = r)));
    const post = workoutPost();
    await render(<PostCard post={post} now={NOW} viewerId="u1" onChangeVisibility={onChange} />);
    await fireEvent.press(screen.getByLabelText('Who can see this post: Public'));
    expect(screen.getByText('Anyone on Astra can see this post')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Only you: Only you can see this post'));
    // Optimistic: the chip already says so while the change is on its way, and the options are held.
    expect(screen.getByLabelText('Who can see this post: Only you')).toBeTruthy();
    expect(screen.getByLabelText('Followers: Your followers can see this post')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Followers: Your followers can see this post'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(post, 'private');
    await act(async () => finish({ ok: true }));
    expect(screen.queryByText('Only you can see this post')).toBeNull(); // chooser closed
    expect(screen.getByLabelText('Who can see this post: Only you')).toBeTruthy();
  });

  it('a refusal moves the chip back and says why', async () => {
    const onChange = jest.fn(async () => ({ ok: false as const, reason: 'failed' as const }));
    await render(<PostCard post={pic()} now={NOW} viewerId="u1" onChangeVisibility={onChange} />);
    await fireEvent.press(screen.getByLabelText('Who can see this post: Only you'));
    await fireEvent.press(screen.getByLabelText('Followers: Your followers can see this post'));
    expect(await screen.findByText(POST_VISIBILITY_REFUSAL_MESSAGES.failed)).toBeTruthy();
    expect(screen.getByLabelText('Who can see this post: Only you')).toBeTruthy();
  });

  it('a refreshed feed’s visibility replaces what the chip showed', async () => {
    const post = workoutPost();
    await render(<PostCard post={post} now={NOW} viewerId="u1" />);
    await screen.rerender(<PostCard post={{ ...post, visibility: 'followers' }} now={NOW} viewerId="u1" />);
    expect(screen.getByLabelText('Who can see this post: Followers')).toBeTruthy();
  });
});

describe('PostCard — reporting (B27)', () => {
  const post = () => shaped(rawPost({ id: 'p9', author, createdAt: '2026-11-15T08:00:00.000Z' }));

  it('someone else’s card has a ⋯ that opens the report panel and files through onReport', async () => {
    const onReport = jest.fn(async (_postId: string, _reason: string, _details: string) => ({ ok: true as const }));
    await render(
      <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
        <PostCard post={post()} now={NOW} viewerId="viewer" onReport={onReport} />
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Report post'));
    expect(screen.getByText('Report post')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Spam:/));
    await fireEvent.press(screen.getByLabelText('Send report'));
    expect(onReport).toHaveBeenCalledWith('p9', 'spam', '');
    expect(await screen.findByText(REPORT_THANKS)).toBeTruthy();
  });

  it('my own card has no ⋯, and neither does a card without a handler', async () => {
    const onReport = jest.fn(async () => ({ ok: true as const }));
    await render(<PostCard post={post()} now={NOW} viewerId="u1" onReport={onReport} />);
    expect(screen.queryByLabelText('Report post')).toBeNull();
    await screen.rerender(<PostCard post={post()} now={NOW} viewerId="viewer" />);
    expect(screen.queryByLabelText('Report post')).toBeNull();
  });
});

describe('PostCard — re-shares and sharing (B28)', () => {
  const alice = profile('alice', 'alice', 'Alice');
  const original = rawPost({ id: 'orig', author: alice, createdAt: '2026-11-15T07:00:00.000Z', title: 'Leg day' });
  const reshareRaw = rawReshare({ id: 'rs', author, createdAt: '2026-11-15T09:00:00.000Z', original: { id: 'orig', flair: original.flair! } });

  /** Wendy's (u1) re-share of Alice's workout, in the card's shape. */
  function reshared(): FeedPost {
    const post = toFeedPost(reshareRaw, undefined, new Map([['orig', original]]));
    if (post?.kind !== 'reshare') throw new Error('expected a re-share');
    return post;
  }
  const ok = { ok: true as const, id: 'new' };

  it('a re-share shows the resharer’s header, a “re-shared from” line, and the original’s author and workout', async () => {
    const onOpenProfile = jest.fn();
    await render(<PostCard post={reshared()} now={NOW} onOpenProfile={onOpenProfile} />);
    expect(screen.getByText('Wendy')).toBeTruthy();
    expect(screen.getByText('Re-shared from @alice')).toBeTruthy();
    expect(screen.getByTestId('reshared-original')).toBeTruthy();
    expect(screen.getByText('Leg day')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open Alice’s profile'));
    expect(onOpenProfile).toHaveBeenCalledWith('alice');
  });

  it('Re-share is offered on other people’s posts only, never my own (nor a re-share of my own post)', async () => {
    const onReshare = jest.fn(async () => ok);
    const theirs = shaped(original);
    await render(<PostCard post={theirs} now={NOW} viewerId="viewer" onReshare={onReshare} />);
    expect(screen.getByLabelText('Re-share')).toBeTruthy();
    await screen.rerender(<PostCard post={theirs} now={NOW} viewerId="alice" onReshare={onReshare} />);
    expect(screen.queryByLabelText('Re-share')).toBeNull();
    await screen.rerender(<PostCard post={reshared()} now={NOW} viewerId="alice" onReshare={onReshare} />);
    expect(screen.queryByLabelText('Re-share')).toBeNull();
    await screen.rerender(<PostCard post={theirs} now={NOW} viewerId="viewer" />);
    expect(screen.queryByLabelText('Re-share')).toBeNull();
    expect(canReshare(theirs, null)).toBe(false);
  });

  it('Re-share asks first, then sends the card’s post and says it went', async () => {
    const onReshare = jest.fn(async (_post: FeedPost) => ok);
    const post = reshared();
    await render(<PostCard post={post} now={NOW} viewerId="viewer" onReshare={onReshare} />);
    await fireEvent.press(screen.getByLabelText('Re-share'));
    expect(screen.getByText('Re-share this post to your followers?')).toBeTruthy();
    expect(onReshare).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Re-share now' }));
    expect(onReshare).toHaveBeenCalledWith(post);
    expect(await screen.findByText(RESHARE_MESSAGES.done)).toBeTruthy();
    expect(screen.queryByText('Re-share this post to your followers?')).toBeNull();
  });

  it('a refused re-share says why; Cancel sends nothing', async () => {
    const onReshare = jest.fn(async () => ({ ok: false as const, reason: 'already-reshared' as const }));
    await render(<PostCard post={shaped(original)} now={NOW} viewerId="viewer" onReshare={onReshare} />);
    await fireEvent.press(screen.getByLabelText('Re-share'));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onReshare).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Re-share'));
    await fireEvent.press(screen.getByRole('button', { name: 'Re-share now' }));
    expect(await screen.findByText(RESHARE_MESSAGES['already-reshared'])).toBeTruthy();
  });

  it('Share (as image) is on my own workout posts only, and opens that workout’s card', async () => {
    const onShareWorkout = jest.fn();
    const mine = shaped(rawPost({ id: 'p1', author, createdAt: '2026-11-15T08:00:00.000Z' }));
    await render(<PostCard post={mine} now={NOW} viewerId="u1" onShareWorkout={onShareWorkout} />);
    await fireEvent.press(screen.getByLabelText('Share as image'));
    expect(onShareWorkout).toHaveBeenCalledWith(mine.workout.id);
    await screen.rerender(<PostCard post={mine} now={NOW} viewerId="viewer" onShareWorkout={onShareWorkout} />);
    expect(screen.queryByLabelText('Share as image')).toBeNull();
    const photo = shapedPhoto(rawImagePost({ id: 'pic', author, createdAt: '2026-11-15T08:00:00.000Z', kind: 'pr' }));
    await screen.rerender(<PostCard post={photo} now={NOW} viewerId="u1" onShareWorkout={onShareWorkout} />);
    expect(screen.queryByLabelText('Share as image')).toBeNull();
    await screen.rerender(<PostCard post={reshared()} now={NOW} viewerId="u1" onShareWorkout={onShareWorkout} />);
    expect(screen.queryByLabelText('Share as image')).toBeNull();
  });
});
