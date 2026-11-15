/**
 * Reading the Home feed (SOC-1): the posts of the people the lifter follows (and their own),
 * newest first, a page at a time.
 *
 * Why this exists: the feed is the one screen that shows other people's workouts, and those are
 * never copied onto the phone (the device holds only the lifter's own rows). So the feed is read
 * straight from the server every time, and this file is the one place that knows how to ask.
 *
 * Who may see what is NOT decided here. Every request runs as the signed-in lifter and the
 * server's row-level security filters it — blocks, "followers only", private workouts. This file
 * only chooses *whose* posts to ask for (the people you follow) and in what order.
 *
 * The Supabase client is passed in (never fetched here), so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { SetRow, WorkoutExerciseRow } from '@/db/dao';
import { throwIfError } from '@/lib/throwIfError';

import type { PersonName } from './names';

/** How many posts one page of the feed holds. */
export const FEED_PAGE_SIZE = 20;

/** Where the last page ended: the oldest post's time and id. The next page starts just before it. */
export interface FeedCursor {
  created_at: string;
  id: string;
}

/** One set as a feed card prints it — exactly the parts `formatSet` reads. */
export type FeedSet = Pick<
  SetRow,
  'id' | 'position' | 'reps' | 'weight_kg' | 'rpe' | 'is_warmup' | 'drop_set_position' | 'duration_seconds' | 'score'
>;

/** One exercise of a shared workout, with its sets in logged order. */
export interface FeedEntry extends Pick<WorkoutExerciseRow, 'id' | 'position' | 'superset_group'> {
  /** The exercise's name, or null when the viewer can't see it (someone else's custom exercise) or it was deleted. */
  exerciseName: string | null;
  sets: FeedSet[];
}

/** One post, shaped for the card that shows it. */
export interface FeedPost {
  id: string;
  createdAt: string;
  /** The post's one flair, straight from the `flairs` table — the app never spells flair names itself. */
  flair: { id: string; name: string };
  author: PersonName & { id: string };
  workout: {
    id: string;
    title: string | null;
    notes: string | null;
    started_at: string;
    ended_at: string | null;
    /** In workout order. */
    entries: FeedEntry[];
  };
}

/** One page of the feed, and the bookmark for the next one (null when this was the last). */
export interface FeedPage {
  posts: FeedPost[];
  next: FeedCursor | null;
}

/**
 * The columns asked for, with the author, flair and whole workout nested in (PostgREST
 * "embedding"). `workouts!inner` is deliberate: the workouts table's own security filters the
 * nested workout, and `!inner` drops a post whose workout the viewer may not see (its owner
 * made it private after posting) instead of showing an empty card.
 */
export const FEED_SELECT =
  'id,created_at,' +
  'flair:flairs(id,name),' +
  'author:profiles(id,username,display_name),' +
  'workout:workouts!inner(id,title,notes,started_at,ended_at,' +
  'workout_exercises(id,position,superset_group,exercise:exercises(name),' +
  'sets(id,position,reps,weight_kg,rpe,is_warmup,drop_set_position,duration_seconds,score)))';

/** A post exactly as the server sends it for `FEED_SELECT` (the one place the untyped reply is described). */
export interface RawFeedPost {
  id: string;
  created_at: string;
  flair: { id: string; name: string } | null;
  author: { id: string; username: string | null; display_name: string | null } | null;
  workout: {
    id: string;
    title: string | null;
    notes: string | null;
    started_at: string;
    ended_at: string | null;
    workout_exercises: (Pick<WorkoutExerciseRow, 'id' | 'position' | 'superset_group'> & {
      exercise: { name: string } | null;
      sets: (FeedSet & { weight_kg: number | string | null })[];
    })[];
  };
}

/**
 * The "older than this bookmark" filter: an earlier time, or the same time and a smaller id.
 * The mirror image of the sync's `afterCursorFilter`. Paging by bookmark instead of by count
 * means a new post arriving while the lifter scrolls never shifts a page — no card is shown
 * twice or skipped. Times are double-quoted because they contain `:` and `+`.
 */
export function beforeCursorFilter(cursor: FeedCursor): string {
  const ts = `"${cursor.created_at}"`;
  return `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${cursor.id})`;
}

/**
 * Whose posts the feed shows: everyone `me` follows, plus `me` (so a lifter's own posts appear
 * on their own Home, and a new lifter with no follows still sees the feed work). One request.
 */
export async function feedAuthorIds(client: SupabaseClient, me: string): Promise<string[]> {
  const { data, error } = await client.from('follows').select('followee_id').eq('follower_id', me);
  throwIfError(error, 'Loading who you follow failed');
  const followees = ((data ?? []) as { followee_id: string }[]).map((r) => r.followee_id);
  return [me, ...followees.filter((id) => id !== me)];
}

/**
 * Stand-in for a post's flair if the server ever sent none. It can't happen today — every post
 * has a required flair and every signed-in user may read `flairs` — so this only keeps a card
 * from crashing on a broken reply. It is a fallback label, not a flair: no flair row has it.
 */
export const MISSING_FLAIR = { id: '', name: 'Post' } as const;

/**
 * Turns one server post into the card's shape: exercises sorted into workout order, each
 * exercise's sets into logged order, the weight made sure to be a number (Postgres `numeric`
 * can arrive as text), and a missing flair or author filled in so the card never crashes.
 */
export function toFeedPost(raw: RawFeedPost): FeedPost {
  const entries = [...raw.workout.workout_exercises]
    .sort((a, b) => a.position - b.position)
    .map((entry) => ({
      id: entry.id,
      position: entry.position,
      superset_group: entry.superset_group,
      exerciseName: entry.exercise?.name ?? null,
      sets: [...entry.sets]
        .sort((a, b) => a.position - b.position)
        .map((set) => ({ ...set, weight_kg: set.weight_kg == null ? null : Number(set.weight_kg) })),
    }));
  return {
    id: raw.id,
    createdAt: raw.created_at,
    flair: raw.flair ?? { ...MISSING_FLAIR },
    author: {
      id: raw.author?.id ?? '',
      username: raw.author?.username ?? null,
      displayName: raw.author?.display_name ?? null,
    },
    workout: {
      id: raw.workout.id,
      title: raw.workout.title,
      notes: raw.workout.notes,
      started_at: raw.workout.started_at,
      ended_at: raw.workout.ended_at,
      entries,
    },
  };
}

/**
 * Adds a later page to the posts already shown, skipping any post already on screen. Paging by
 * bookmark already prevents repeats; this is the belt to that braces (e.g. a refresh and a
 * page landing close together).
 */
export function appendPage(shown: readonly FeedPost[], page: readonly FeedPost[]): FeedPost[] {
  const seen = new Set(shown.map((p) => p.id));
  return [...shown, ...page.filter((p) => !seen.has(p.id))];
}

/**
 * One page of the feed: the posts of `authorIds`, newest first, starting just before `after`
 * (or at the newest post when `after` is null). The server's security decides which of those
 * posts the lifter may actually see. A full page means there may be more, so it returns a
 * bookmark; a short page is the end.
 */
export async function loadFeedPage(
  client: SupabaseClient,
  authorIds: readonly string[],
  after: FeedCursor | null,
): Promise<FeedPage> {
  if (authorIds.length === 0) return { posts: [], next: null };
  let query = client.from('posts').select(FEED_SELECT).in('user_id', [...authorIds]);
  if (after) query = query.or(beforeCursorFilter(after));
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(FEED_PAGE_SIZE);
  throwIfError(error, 'Loading the feed failed');
  // The one cast from the untyped reply, at the seam; everything past here is typed.
  const raw = (data ?? []) as unknown as RawFeedPost[];
  const last = raw[raw.length - 1];
  return {
    posts: raw.map(toFeedPost),
    next: raw.length === FEED_PAGE_SIZE && last ? { created_at: last.created_at, id: last.id } : null,
  };
}
