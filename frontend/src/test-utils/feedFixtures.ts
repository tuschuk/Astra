/**
 * Synthetic feed data — TEST USE ONLY. Builds people and posts shaped exactly the way the
 * server's feed request returns them (`RawFeedPost`), so the fake social client can serve them
 * and the screens can render them.
 */
import type { FeedSet, RawFeedPost } from '@/social/feed';

/** A profile row as the server stores it. */
export function profile(id: string, username: string | null, displayName: string | null = null) {
  return { id, username, display_name: displayName };
}

let counter = 0;

/** A set with nothing filled in but what `overrides` gives (and a unique id). */
export function feedSet(overrides: Partial<FeedSet> = {}): FeedSet {
  counter += 1;
  return {
    id: `set-${counter}`,
    position: counter,
    reps: null,
    weight_kg: null,
    rpe: null,
    is_warmup: false,
    drop_set_position: null,
    duration_seconds: null,
    score: null,
    ...overrides,
  };
}

interface PostSpec {
  id: string;
  author: ReturnType<typeof profile>;
  createdAt: string;
  flair?: { id: string; name: string };
  title?: string | null;
  notes?: string | null;
  /** Exercises in order; each with its sets and an optional superset number. */
  entries?: { name: string | null; sets: FeedSet[]; superset_group?: number | null }[];
}

/**
 * A post, with its author, flair and workout nested in, plus the `user_id` column the feed
 * filters on (the server sends it only when asked; the fake needs it to filter).
 */
export function rawPost(
  spec: PostSpec,
): RawFeedPost & { user_id: string; workout: NonNullable<RawFeedPost['workout']> } {
  const entries = spec.entries ?? [{ name: 'Bench Press', sets: [feedSet({ reps: 5, weight_kg: 100 })] }];
  return {
    id: spec.id,
    user_id: spec.author.id,
    created_at: spec.createdAt,
    kind: 'workout',
    image_path: null,
    visibility: 'public',
    flair: spec.flair ?? { id: 'wod', name: 'WOD' },
    author: spec.author,
    workout: {
      id: `workout-${spec.id}`,
      title: spec.title === undefined ? `Workout ${spec.id}` : spec.title,
      notes: spec.notes ?? null,
      started_at: '2026-11-14T10:00:00.000Z',
      ended_at: '2026-11-14T11:00:00.000Z',
      workout_exercises: entries.map((e, i) => ({
        id: `${spec.id}-entry-${i}`,
        position: i,
        superset_group: e.superset_group ?? null,
        exercise: e.name == null ? null : { name: e.name },
        sets: e.sets,
      })),
    },
  };
}

/**
 * A photo post (B22) as the server sends it: no workout, a photo path in the author's folder.
 * A progress pic is private (as the server insists); a PR photo public — unless overridden.
 */
export function rawImagePost(spec: {
  id: string;
  author: ReturnType<typeof profile>;
  createdAt: string;
  kind: 'progress-pic' | 'pr';
  flair?: { id: string; name: string };
}): RawFeedPost & { user_id: string } {
  return {
    id: spec.id,
    user_id: spec.author.id,
    created_at: spec.createdAt,
    kind: spec.kind,
    image_path: `${spec.author.id}/${spec.id}.jpg`,
    visibility: spec.kind === 'progress-pic' ? 'private' : 'public',
    flair:
      spec.flair ??
      (spec.kind === 'progress-pic' ? { id: 'physique-check', name: 'Physique Check' } : { id: 'new-pr', name: 'New PR' }),
    author: spec.author,
    workout: null,
  };
}
