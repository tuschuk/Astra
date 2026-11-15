/**
 * Reading the Home feed (SOC-1): the posts of the people the lifter follows (and their own),
 * newest first, a page at a time — shared workouts and (B22) progress-pic and PR photo posts.
 * Since B23 each post also carries its net score, its comment count and the viewer's own vote
 * (SOC-4, SOC-5), and its flair says whether it takes upvotes only — the card's whole footer.
 * Since B24 the feed can also be read ranked by votes ("Hot", from the server's
 * `post_hot_scores` view, SOC-11) instead of newest first, and narrowed to one flair (SOC-9).
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

import type { ImagePostKind, PostKind, SetRow, WorkoutExerciseRow, WorkoutVisibility } from '@/db/dao';
import { throwIfError } from '@/lib/throwIfError';

import type { PersonName } from './names';
import type { VoteValue } from './votes';

/** How many posts one page of the feed holds. */
export const FEED_PAGE_SIZE = 20;

/**
 * The two orders the feed can be read in (B24, SOC-11): newest first ("Latest"), or ranked by
 * the server's hot score ("Hot").
 */
export type FeedSort = 'latest' | 'hot';

/** In "Latest" order, where the last page ended: the oldest post's time and id. */
export interface LatestFeedCursor {
  sort: 'latest';
  created_at: string;
  id: string;
}

/**
 * In "Hot" order (B24), where the last page ended: the lowest-ranked post's hot score — the
 * server's number, echoed back untouched, never computed here — and its id.
 */
export interface HotFeedCursor {
  sort: 'hot';
  hot_score: number;
  id: string;
}

/**
 * The bookmark for the next page. It is tagged with the order it was made in, so a bookmark
 * from one order can never be replayed under the other (`loadFeedPage` refuses it).
 */
export type FeedCursor = LatestFeedCursor | HotFeedCursor;

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

/** The workout a workout post shares, as its card shows it. */
export interface FeedWorkout {
  id: string;
  title: string | null;
  notes: string | null;
  started_at: string;
  ended_at: string | null;
  /** In workout order. */
  entries: FeedEntry[];
}

/** A post's flair as the card needs it. */
export interface FeedFlair {
  id: string;
  name: string;
  /**
   * The flair row's own `upvotes_only` flag (B23): true means the card offers no downvote
   * (Physique Check today) — and the server refuses one anyway. Data, never a flair name in code.
   */
  upvotesOnly: boolean;
}

/** What every post has, whatever its kind. */
interface FeedPostBase {
  id: string;
  createdAt: string;
  /** The post's one flair, straight from the `flairs` table — the app never spells flair names itself. */
  flair: FeedFlair;
  author: PersonName & { id: string };
  /** Who may see it (B22: the card tells the owner when a post is private). */
  visibility: WorkoutVisibility;
  /** The net score — upvotes minus downvotes — from the server's `post_scores` view (B23). */
  score: number;
  /** How many comments the post has, from the same view (B23). */
  commentCount: number;
  /** The viewer's own vote on it, or null when they haven't voted (B23). */
  myVote: VoteValue | null;
}

/**
 * One post, shaped for the card that shows it: a shared workout, or (B22) a photo — a progress
 * pic or a PR moment — named by its path in the `post-images` bucket.
 */
export type FeedPost =
  | (FeedPostBase & { kind: 'workout'; workout: FeedWorkout })
  | (FeedPostBase & { kind: ImagePostKind; imagePath: string });

/** One page of the feed, and the bookmark for the next one (null when this was the last). */
export interface FeedPage {
  posts: FeedPost[];
  next: FeedCursor | null;
}

/**
 * The columns asked for, with the author, flair and whole workout nested in (PostgREST
 * "embedding"). The workout is a plain (left) embed since B22: a photo post has no workout, and
 * the old `workouts!inner` would have hidden every photo post. The workouts table's own security
 * still filters the nested workout — a workout the viewer may not see (its owner made it private
 * after posting) arrives as null — and `toFeedPost` then drops that empty workout card, the job
 * `!inner` used to do on the server. Who may see what is unchanged: it was never the join.
 *
 * B23 adds the flair's `upvotes_only` flag, and `my_vote`: the post's votes embedded under that
 * name, which `loadFeedPage` narrows to the viewer's own row with a filter on the alias
 * (`my_vote.user_id`) — so the reply never carries anyone else's votes.
 *
 * B24: the same select serves both orders — "Latest" reads it from `posts`, "Hot" from the
 * `post_hot_scores` view, which carries the same columns. The author embed names its foreign key
 * (`!posts_user_id_fkey`) because, read through the view, the live server also sees a second
 * path to `profiles` (through `votes`) and refuses the bare name as ambiguous. On `posts` the
 * hint names the same relationship it already used.
 */
export const FEED_SELECT =
  'id,created_at,kind,image_path,visibility,' +
  'flair:flairs(id,name,upvotes_only),' +
  'author:profiles!posts_user_id_fkey(id,username,display_name),' +
  'workout:workouts(id,title,notes,started_at,ended_at,' +
  'workout_exercises(id,position,superset_group,exercise:exercises(name),' +
  'sets(id,position,reps,weight_kg,rpe,is_warmup,drop_set_position,duration_seconds,score))),' +
  'my_vote:votes(value)';

/**
 * The columns read from the `post_scores` view, in a second request by post id (B23). The plan's
 * first choice — embedding the view inside the posts request — is refused by the live server
 * (PostgREST finds no relationship between the posts table and a view over it), so this is the
 * plan's recorded fallback.
 */
export const SCORES_SELECT = 'post_id,score,comment_count';

/** One row of the `post_scores` view as the server sends it. */
export interface RawPostScore {
  post_id: string;
  score: number;
  comment_count: number;
}

/** A post exactly as the server sends it for `FEED_SELECT` (the one place the untyped reply is described). */
export interface RawFeedPost {
  id: string;
  created_at: string;
  kind: PostKind;
  image_path: string | null;
  visibility: WorkoutVisibility;
  /** `upvotes_only` is optional only so a reply missing it shapes to "takes downvotes", never a crash. */
  flair: { id: string; name: string; upvotes_only?: boolean } | null;
  author: { id: string; username: string | null; display_name: string | null } | null;
  /** Null for a photo post, or a workout post whose workout the viewer may not see. */
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
  } | null;
  /** The viewer's own vote, as a list of at most one row (the alias filter keeps only theirs). */
  my_vote?: { value: number }[] | null;
  /** Only on a "Hot" read (B24): the post's rank from the view, used solely as the next bookmark. */
  hot_score?: number | string;
}

/** The view the "Hot" order reads from (B24) — the hot score's one home. */
export const HOT_SOURCE = 'post_hot_scores';

/**
 * The "older than this bookmark" filter: an earlier time, or the same time and a smaller id.
 * The mirror image of the sync's `afterCursorFilter`. Paging by bookmark instead of by count
 * means a new post arriving while the lifter scrolls never shifts a page — no card is shown
 * twice or skipped. Times are double-quoted because they contain `:` and `+`.
 */
export function beforeCursorFilter(cursor: Pick<LatestFeedCursor, 'created_at' | 'id'>): string {
  const ts = `"${cursor.created_at}"`;
  return `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${cursor.id})`;
}

/**
 * The "ranked below this bookmark" filter for the Hot order (B24): a lower hot score, or the
 * same score and a smaller id. The score is the server's own number sent straight back; a hot
 * score is a plain five-digit decimal (seconds since Reddit's epoch ÷ 45000), so it always
 * prints without an exponent or any character the filter syntax reserves.
 *
 * Unlike "Latest", this order can move while the lifter scrolls (a vote raises a post), so a
 * page can occasionally repeat a post (dropped by `appendPage`) or miss one (back on the next
 * refresh) — accepted ranked-feed behaviour (plan, risk 2).
 */
export function beforeHotCursorFilter(cursor: Pick<HotFeedCursor, 'hot_score' | 'id'>): string {
  const h = String(cursor.hot_score);
  return `hot_score.lt.${h},and(hot_score.eq.${h},id.lt.${cursor.id})`;
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
export const MISSING_FLAIR: FeedFlair = { id: '', name: 'Post', upvotesOnly: false };

/**
 * Turns one server post into the card's shape, or null when there is nothing to show.
 *   - A workout post: exercises sorted into workout order, each exercise's sets into logged
 *     order, the weight made sure to be a number (Postgres `numeric` can arrive as text). Null
 *     when its workout didn't come along (the viewer may not see it) — no empty card.
 *   - A photo post (B22): its photo's path; null if the server sent none (can't happen — the
 *     server's shape rule requires one — so it only guards against a broken reply).
 * A missing flair or author is filled in so the card never crashes.
 * B23: `scores` is the post's `post_scores` row; without one (a broken reply) the score and
 * comment count read 0. The viewer's vote comes from the `my_vote` embed; anything but +1 / −1
 * reads as "no vote".
 */
export function toFeedPost(raw: RawFeedPost, scores?: RawPostScore): FeedPost | null {
  const mine = raw.my_vote?.[0]?.value;
  const myVote: VoteValue | null = mine === 1 || mine === -1 ? mine : null;
  const base = {
    id: raw.id,
    createdAt: raw.created_at,
    flair: raw.flair
      ? { id: raw.flair.id, name: raw.flair.name, upvotesOnly: raw.flair.upvotes_only === true }
      : { ...MISSING_FLAIR },
    author: {
      id: raw.author?.id ?? '',
      username: raw.author?.username ?? null,
      displayName: raw.author?.display_name ?? null,
    },
    visibility: raw.visibility,
    score: scores?.score ?? 0,
    commentCount: scores?.comment_count ?? 0,
    myVote,
  };
  if (raw.kind === 'progress-pic' || raw.kind === 'pr') {
    return raw.image_path ? { ...base, kind: raw.kind, imagePath: raw.image_path } : null;
  }
  if (!raw.workout) return null;
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
    ...base,
    kind: 'workout',
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
 * The scores of these posts, keyed by post id: one request to the `post_scores` view (B23). It
 * runs as the viewer, so it can only count votes and comments on posts the viewer may see. No
 * ids, no request.
 */
export async function loadPostScores(
  client: SupabaseClient,
  postIds: readonly string[],
): Promise<Map<string, RawPostScore>> {
  if (postIds.length === 0) return new Map();
  const { data, error } = await client.from('post_scores').select(SCORES_SELECT).in('post_id', [...postIds]);
  throwIfError(error, 'Loading the scores failed');
  const rows = (data ?? []) as unknown as RawPostScore[];
  // Made sure to be numbers, in case a count ever arrives as text.
  return new Map(
    rows.map((r) => [r.post_id, { post_id: r.post_id, score: Number(r.score), comment_count: Number(r.comment_count) }]),
  );
}

/** The bookmark that continues after `last`, in the order `sort` (null if the reply lacked a score). */
function cursorAfter(last: RawFeedPost, sort: FeedSort): FeedCursor | null {
  if (sort === 'latest') return { sort, created_at: last.created_at, id: last.id };
  const score = Number(last.hot_score);
  if (Number.isFinite(score)) return { sort, hot_score: score, id: last.id };
  // Can't happen (the view always computes a score); if it ever does, paging stops, visibly in the log.
  console.warn('Feed: a Hot page came back without its hot score; no further pages');
  return null;
}

/**
 * One page of the feed for the viewer `me`: the posts of `authorIds`, each with its score,
 * comment count and the viewer's own vote (B23). The server's security decides which of those
 * posts the lifter may actually see.
 *
 *   - `sort` (B24, SOC-11): 'latest' reads `posts` newest first; 'hot' reads the
 *     `post_hot_scores` view, highest hot score first (ties: larger id first). Both use the same
 *     select, so the cards look identical either way.
 *   - `flairId` (B24, SOC-9): when set, only posts wearing that flair; null means every flair.
 *   - `after`: the bookmark from the previous page (null for the first page). It must come from
 *     the same order — a bookmark from the other order is a bug in the caller and is refused
 *     rather than silently returning a wrong page.
 *
 * A full page means there may be more, so it returns a bookmark; a short page is the end. Two
 * requests: the posts, then their scores.
 */
export async function loadFeedPage(
  client: SupabaseClient,
  me: string,
  authorIds: readonly string[],
  sort: FeedSort,
  flairId: string | null,
  after: FeedCursor | null,
): Promise<FeedPage> {
  if (after && after.sort !== sort) throw new Error(`A ${after.sort} bookmark can't continue the ${sort} feed`);
  if (authorIds.length === 0) return { posts: [], next: null };
  let query = client
    .from(sort === 'hot' ? HOT_SOURCE : 'posts')
    .select(sort === 'hot' ? `${FEED_SELECT},hot_score` : FEED_SELECT)
    .in('user_id', [...authorIds])
    // Narrows the embedded votes to the viewer's own — the alias, not the table's name.
    .eq('my_vote.user_id', me);
  if (flairId !== null) query = query.eq('flair_id', flairId);
  if (after) query = query.or(after.sort === 'hot' ? beforeHotCursorFilter(after) : beforeCursorFilter(after));
  const ordered =
    sort === 'hot'
      ? query.order('hot_score', { ascending: false })
      : query.order('created_at', { ascending: false });
  const { data, error } = await ordered.order('id', { ascending: false }).limit(FEED_PAGE_SIZE);
  throwIfError(error, 'Loading the feed failed');
  // The one cast from the untyped reply, at the seam; everything past here is typed.
  const raw = (data ?? []) as unknown as RawFeedPost[];
  const last = raw[raw.length - 1];
  const scores = await loadPostScores(client, raw.map((p) => p.id));
  return {
    // Dropped posts still count toward the bookmark below, so paging never re-reads them.
    posts: raw.map((p) => toFeedPost(p, scores.get(p.id))).filter((p): p is FeedPost => p !== null),
    next: raw.length === FEED_PAGE_SIZE && last ? cursorAfter(last, sort) : null,
  };
}
