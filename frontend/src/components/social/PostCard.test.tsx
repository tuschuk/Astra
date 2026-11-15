/**
 * Tests for the feed's post card (B20): the flair chip shows the flair row's own name (SOC-3,
 * "data, not code"), every set is printed by the logger's one spelling — `formatSet` /
 * `formatDropSet` — in the viewer's unit (LOG-13's feed clause), supersets are grouped, and a
 * long workout is cut short with "+ n more". And (B22) photo posts: the picture fetched as the
 * viewer, the owner told when their post is private, a plain panel when it can't be shown.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { toFeedPost, type FeedPost, type RawFeedPost } from '@/social/feed';
import { feedSet, profile, rawImagePost, rawPost } from '@/test-utils/feedFixtures';
import { formatDropSet, formatSet, workoutDetailsLabel } from '@/workout/format';

import { CARD_EXERCISE_LIMIT, ONLY_YOU_LINE, PostCard, UNNAMED_EXERCISE } from './PostCard';

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

describe('PostCard — photo posts (B22)', () => {
  const source = (path: string) => ({ uri: `https://x/storage/v1/object/authenticated/post-images/${path}`, headers: { Authorization: 'Bearer t' } });

  it('a PR photo: the flair chip and the photo fetched as the viewer, no workout lines, no privacy line', async () => {
    const post = shapedPhoto(rawImagePost({ id: 'pr1', author, createdAt: '2026-11-15T07:00:00Z', kind: 'pr' }));
    await render(<PostCard post={post} now={NOW} viewerId="someone-else" photoSource={source} />);
    expect(screen.getByLabelText('Flair: New PR')).toBeTruthy();
    const photo = screen.getByLabelText('Post photo');
    expect(photo.props.source).toEqual(source('u1/pr1.jpg'));
    expect(screen.queryByText(ONLY_YOU_LINE)).toBeNull();
    expect(screen.queryByText(/exercise/)).toBeNull();
  });

  it('the owner’s own progress pic says only they can see it', async () => {
    const post = shapedPhoto(rawImagePost({ id: 'pic', author, createdAt: '2026-11-15T07:00:00Z', kind: 'progress-pic' }));
    await render(<PostCard post={post} now={NOW} viewerId="u1" photoSource={source} />);
    expect(screen.getByLabelText('Flair: Physique Check')).toBeTruthy();
    expect(screen.getByText(ONLY_YOU_LINE)).toBeTruthy();
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
