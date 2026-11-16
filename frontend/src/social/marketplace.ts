/**
 * The Marketplace (B40 — MKT-1, MKT-4): every read the app makes of published programs, in one
 * place. The Marketplace is an online surface like the feed — nothing here is stored on the
 * phone; a lifter who taps Save and Start gets a device copy (`programs/saveAndStart.ts`).
 *
 * What it reads, and why from where:
 *   - **The browse list / search** reads `programs` rows directly. Since B39 the server lets any
 *     signed-in lifter read a program whose visibility is "published". The list ALSO filters on
 *     `visibility = published` and "not deleted" itself: without those two filters the server
 *     would hand back the lifter's own private and deleted programs too (an author always reads
 *     their own), which don't belong on a public shelf. Search uses Postgres full-text search on
 *     the server's generated `search` column (built from the name, B40 migration) — whole words,
 *     any order, typed text needs no escaping. The author's name comes embedded from `profiles`.
 *   - **A program page** reads that one row (for its author and owner), plus the whole program's
 *     contents through `program_payload` — the server function B39 built, which answers only if
 *     the lifter may see the program. The weeks / workouts / exercises tables themselves stay
 *     author-only and are never read here (reading them would return nothing for another author).
 *     (B41) It also reads the program's score and comment count from the `program_scores` view,
 *     and the viewer's own vote from `program_votes`.
 *   - **The Featured section** (B41) reads the `program_scores` view — every program with its
 *     net votes over the last week, month, year and all time — with the same shelf filters as
 *     the browse list, ranked by the chosen window.
 *
 * The payload JSON is checked by `parseProgramPayload` (teamCoaching.ts) — the one parser of that
 * shape, shared with the team pushes. The Supabase client is passed in, so tests hand it a fake.
 * Every reader throws on failure (no signal included); the screens turn that into the standard
 * "needs a connection" message.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProgramVisibility } from '@/db/dao';
import { throwIfError } from '@/lib/throwIfError';

import type { PersonName } from './names';
import { parseProgramPayload, type TeamProgramPayload } from './teamCoaching';
import type { VoteValue } from './votes';

/** How many programs the browse list shows at first, and how many more each "Show more" adds. */
export const MARKETPLACE_PAGE_SIZE = 30;

/** One program as a browse card and the program page's header show it. */
export interface MarketplaceProgram {
  id: string;
  name: string;
  /** The author's user id (the program page's "is this mine?" check, and the profile link). */
  authorId: string;
  /** The author's names (null names if their profile can't be read). */
  author: PersonName;
  visibility: ProgramVisibility;
  createdAt: string;
}

/**
 * A program page: the row's facts and the whole program (a null payload if it just stopped being
 * visible), plus (B41) its net score, its comment count and the viewer's own vote.
 */
export interface MarketplacePage {
  summary: MarketplaceProgram;
  payload: TeamProgramPayload | null;
  /** Net votes, all time (ups minus downs) — the server's tally. */
  score: number;
  commentCount: number;
  /** The viewer's own vote, or null for none (or nobody signed in). */
  myVote: VoteValue | null;
}

/** (B41, MKT-2) The Featured section's four popularity windows. */
export type FeaturedWindow = 'week' | 'month' | 'year' | 'all';

/**
 * Which `program_scores` column ranks each window. The windows are ROLLING — the last 7, 30 and
 * 365 days back from now (a vote counts when it was cast inside the window) — and "all" is every
 * vote ever. The sums themselves are the server view's; this table only picks the column.
 */
export const FEATURED_WINDOW_COLUMNS: Record<FeaturedWindow, 'score_week' | 'score_month' | 'score_year' | 'score'> = {
  week: 'score_week',
  month: 'score_month',
  year: 'score_year',
  all: 'score',
};

/** How many programs the Featured section shows per window — a short list by nature. */
export const FEATURED_LIMIT = 10;

/** One featured program: a browse card's facts plus its net score in the chosen window. */
export interface FeaturedProgram extends MarketplaceProgram {
  score: number;
}

/** The columns a Marketplace read asks for, with the author's names embedded through the foreign key. */
const MARKETPLACE_SELECT =
  'id,name,user_id,visibility,created_at,author:profiles!programs_user_id_fkey(username,display_name)';

/** A programs row exactly as the server sends it for `MARKETPLACE_SELECT`. */
interface RawMarketplaceProgram {
  id: string;
  name: string;
  user_id: string;
  visibility: ProgramVisibility;
  created_at: string;
  author: { username: string | null; display_name: string | null } | null;
}

/** Turns a server row into the app's shape. */
function toMarketplaceProgram(raw: RawMarketplaceProgram): MarketplaceProgram {
  return {
    id: raw.id,
    name: raw.name,
    authorId: raw.user_id,
    author: { username: raw.author?.username ?? null, displayName: raw.author?.display_name ?? null },
    visibility: raw.visibility,
    createdAt: raw.created_at,
  };
}

/**
 * The published programs, newest first, at most `limit` of them (grow the limit for "Show more").
 * With a non-blank `query`, only programs whose name contains every typed word (whole words,
 * any order, case-insensitive; quotes make a phrase). Throws on failure.
 */
export async function loadPublishedPrograms(
  client: SupabaseClient,
  { query = '', limit = MARKETPLACE_PAGE_SIZE }: { query?: string; limit?: number } = {},
): Promise<MarketplaceProgram[]> {
  let request = client
    .from('programs')
    .select(MARKETPLACE_SELECT)
    .eq('visibility', 'published')
    .is('deleted_at', null);
  const words = query.trim();
  if (words !== '') request = request.textSearch('search', words, { type: 'websearch', config: 'simple' });
  const { data, error } = await request
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  throwIfError(error, 'Loading the Marketplace failed');
  return ((data ?? []) as unknown as RawMarketplaceProgram[]).map(toMarketplaceProgram);
}

/**
 * (B41, MKT-2) The Featured section: the published programs most popular in `window`, at most
 * `limit` of them, highest net score first; ties go to the newest program (then the larger id, so
 * the order never wobbles). A window nobody voted in still lists programs — all at 0, newest first.
 *
 * It reads THROUGH the server's `program_scores` view, which carries the same columns as a
 * programs row, so the author embed and the two shelf filters work exactly as in the browse
 * list. The filters are load-bearing here too: the view shows the lifter their own private and
 * deleted programs (the author always sees their own), which never belong on a public shelf.
 * Throws on failure.
 */
export async function loadFeaturedPrograms(
  client: SupabaseClient,
  window: FeaturedWindow,
  limit = FEATURED_LIMIT,
): Promise<FeaturedProgram[]> {
  const column = FEATURED_WINDOW_COLUMNS[window];
  const { data, error } = await client
    .from('program_scores')
    .select(`${MARKETPLACE_SELECT},${column}`)
    .eq('visibility', 'published')
    .is('deleted_at', null)
    .order(column, { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  throwIfError(error, 'Loading the featured programs failed');
  const rows = (data ?? []) as unknown as (RawMarketplaceProgram & Partial<Record<typeof column, number>>)[];
  return rows.map((raw) => ({ ...toMarketplaceProgram(raw), score: raw[column] ?? 0 }));
}

/** A `program_scores` row as the program page asks for it (B41). */
interface RawProgramScore {
  score: number | null;
  comment_count: number | null;
}

/**
 * One program page: the program's row and its whole contents, plus (B41) its score, comment count
 * and the viewer's own vote — four reads side by side. Answers null when the lifter can't see the
 * program (not published to them, deleted, or no such id). `payload` is null when the row read
 * but the contents didn't — it stopped being visible between the reads — and the page says "no
 * longer available". Serves any program the server lets the lifter see (their own, a team
 * share…), though only the Marketplace links here.
 *
 * Inputs: the client, the program, and the viewer's id (`me`, null when signed out — then no vote
 * is read). The vote read filters on `me` itself: every viewer of a program may read ALL its
 * votes (the tally is the same for everyone), so the server's rules can't narrow it to "mine".
 * A missing score row reads as zeros (a quiet page, never a crash). Throws on failure.
 */
export async function loadProgramPage(client: SupabaseClient, programId: string, me: string | null): Promise<MarketplacePage | null> {
  const [row, rpc, scores, mine] = await Promise.all([
    client.from('programs').select(MARKETPLACE_SELECT).eq('id', programId).is('deleted_at', null).limit(1),
    client.rpc('program_payload', { p_program: programId }),
    client.from('program_scores').select('score,comment_count').eq('id', programId).limit(1),
    me == null
      ? Promise.resolve({ data: null, error: null })
      : client.from('program_votes').select('value').eq('program_id', programId).eq('user_id', me).maybeSingle(),
  ]);
  throwIfError(row.error, 'Loading the program failed');
  throwIfError(rpc.error, 'Loading the program’s workouts failed');
  throwIfError(scores.error, 'Loading the program’s score failed');
  throwIfError(mine.error, 'Loading your vote failed');
  const [raw] = (row.data ?? []) as unknown as RawMarketplaceProgram[];
  if (!raw) return null;
  const [score] = (scores.data ?? []) as unknown as RawProgramScore[];
  const vote = (mine.data as { value?: number } | null)?.value;
  return {
    summary: toMarketplaceProgram(raw),
    payload: parseProgramPayload(rpc.data),
    score: score?.score ?? 0,
    commentCount: score?.comment_count ?? 0,
    myVote: vote === 1 || vote === -1 ? vote : null,
  };
}

/** What the program page states about a program's size (MKT-4's "length" and "days per week"). */
export interface ProgramFacts {
  /** How many weeks long the program is. */
  weekCount: number;
  /** Workouts per week: "3" when every week has the same number, "2–3" when weeks differ, "0" with no weeks. */
  daysPerWeek: string;
  /** False when no week holds a workout — the program can't be started (B35 refuses it). */
  hasWorkouts: boolean;
}

/**
 * Counts a program's weeks and its workouts per week. Pure. Weeks differ in how many workouts
 * they hold, so a varied program reads as a range ("2–3") rather than an average no week has.
 */
export function programFacts(payload: TeamProgramPayload): ProgramFacts {
  const perWeek = payload.weeks.map((w) => w.workouts.length);
  const hasWorkouts = perWeek.some((n) => n > 0);
  if (perWeek.length === 0) return { weekCount: 0, daysPerWeek: '0', hasWorkouts };
  const min = Math.min(...perWeek);
  const max = Math.max(...perWeek);
  return { weekCount: perWeek.length, daysPerWeek: min === max ? String(min) : `${min}–${max}`, hasWorkouts };
}

/** The page's facts line: "8 weeks · 3 days/week" ("1 week · 1 day/week", "4 weeks · 2–3 days/week"). */
export function programFactsLine(facts: ProgramFacts): string {
  const weeks = `${facts.weekCount} ${facts.weekCount === 1 ? 'week' : 'weeks'}`;
  const days = `${facts.daysPerWeek} ${facts.daysPerWeek === '1' ? 'day' : 'days'}/week`;
  return `${weeks} · ${days}`;
}
