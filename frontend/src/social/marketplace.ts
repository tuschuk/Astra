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

/** A program page: the row's facts and the whole program, or a null payload if it just stopped being visible. */
export interface MarketplacePage {
  summary: MarketplaceProgram;
  payload: TeamProgramPayload | null;
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
 * One program page: the program's row and its whole contents. Answers null when the lifter can't
 * see the program (not published to them, deleted, or no such id). `payload` is null when the
 * row read but the contents didn't — it stopped being visible between the two reads — and the
 * page says "no longer available". Serves any program the server lets the lifter see (their own,
 * a team share…), though only the Marketplace links here. Throws on failure.
 */
export async function loadProgramPage(client: SupabaseClient, programId: string): Promise<MarketplacePage | null> {
  const [row, rpc] = await Promise.all([
    client.from('programs').select(MARKETPLACE_SELECT).eq('id', programId).is('deleted_at', null).limit(1),
    client.rpc('program_payload', { p_program: programId }),
  ]);
  throwIfError(row.error, 'Loading the program failed');
  throwIfError(rpc.error, 'Loading the program’s workouts failed');
  const [raw] = (row.data ?? []) as unknown as RawMarketplaceProgram[];
  if (!raw) return null;
  return { summary: toMarketplaceProgram(raw), payload: parseProgramPayload(rpc.data) };
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
