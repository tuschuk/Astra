/**
 * Gym leaderboards (B52 — GYM-3 part, GYM-6 part, GYM-8, GYM-9 part): reading a gym's board.
 *
 * What a board is: for one gym and one of three lifts (squat, bench press, deadlift), every
 * member's best VERIFIED weight, heaviest first, in two divisions — men and women — ranked by
 * the absolute weight on the bar. No bodyweight, age or weight classes (GYM-8).
 *
 * Where the rows come from: the server's `leaderboard_entries` table, which holds exactly one
 * row per member per lift per gym (a unique key in the database). Nobody can write it from the
 * app — rows arrive only through the video-verification flow (B53, not built yet), which
 * replaces a member's row when they verify a heavier lift (GYM-6). Until then every real board
 * is empty, and tests use fixture rows.
 *
 * Why entries stay put when a member switches gyms (GYM-9): each row names its gym. Switching
 * only changes the lifter's membership, so their old gym's board keeps their rows and the new
 * gym's board has none for them until they verify there.
 *
 * Who decides the ranking: the server's sort (heaviest first; on a tie, whoever verified
 * earlier; then a stable id). This file never re-sorts — it only splits the server's list into
 * the two divisions and numbers each one. Keeping the rule in one place means a screen can't
 * disagree with it. Boards live only on the server (never on the phone), so reading one needs
 * a connection. The Supabase client is passed in, so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { throwIfError } from '@/lib/throwIfError';

import type { PersonName } from './names';

/**
 * The three ranked lifts, as the database spells them. Change together with the `lift` CHECK
 * in the `leaderboard_entries` migration.
 */
export const LIFTS = ['squat', 'bench', 'deadlift'] as const;
export type Lift = (typeof LIFTS)[number];

/** How each lift is named on screen. */
export const LIFT_LABELS: Record<Lift, string> = {
  squat: 'Squat',
  bench: 'Bench press',
  deadlift: 'Deadlift',
};

/**
 * The two divisions, spelled like the sex a lifter picks in their body data (`male` / `female`).
 * Change together with the `division` CHECK in the `leaderboard_entries` migration.
 */
export const DIVISIONS = ['male', 'female'] as const;
export type Division = (typeof DIVISIONS)[number];

/** How each division is headed on a board. */
export const DIVISION_LABELS: Record<Division, string> = {
  male: 'Men',
  female: 'Women',
};

/**
 * The board read's columns: the entry, plus the lifter's names from their (public) profile. The
 * table's only link to `profiles` is `user_id`, so the plain embed is unambiguous.
 */
export const LEADERBOARD_SELECT = 'id,user_id,division,weight_kg,verified_at,profile:profiles(username,display_name)';

/** What an empty division says under its header — true and calm, since boards stay empty until B53. */
export const BOARD_EMPTY = 'No verified PRs yet.';

/** The most rows one board read asks for — a generous top of the board (paging comes on evidence). */
export const BOARD_LIMIT = 200;

/** One entry on a board, as the app uses it. */
export interface BoardEntry extends PersonName {
  id: string;
  userId: string;
  division: Division;
  /** The verified weight, in kilograms (the storage unit; shown in the viewer's unit). */
  weightKg: number;
  verifiedAt: string;
}

/** A board entry with its place in its division: 1 for the heaviest. */
export interface RankedEntry extends BoardEntry {
  rank: number;
}

/** A board split into its two divisions, each ranked from 1. */
export type DividedBoard = Record<Division, RankedEntry[]>;

/** A board row exactly as the server sends it (Postgres `numeric` may arrive as text). */
interface RawBoardEntry {
  id: string;
  user_id: string;
  division: Division;
  weight_kg: number | string;
  verified_at: string;
  profile: { username: string | null; display_name: string | null } | null;
}

/**
 * One gym's board for one lift, in the server's ranking order: heaviest first, an earlier
 * verification first on equal weight, then by id so the order never wobbles. Both divisions
 * come back together; `splitBoard` separates them. Throws on failure (no connection), like the
 * other Gyms reads.
 */
export async function loadBoard(client: SupabaseClient, gymId: string, lift: Lift): Promise<BoardEntry[]> {
  const { data, error } = await client
    .from('leaderboard_entries')
    .select(LEADERBOARD_SELECT)
    .eq('gym_id', gymId)
    .eq('lift', lift)
    .order('weight_kg', { ascending: false })
    .order('verified_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(BOARD_LIMIT);
  throwIfError(error, 'Loading the leaderboard failed');
  return ((data ?? []) as unknown as RawBoardEntry[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    division: r.division,
    weightKg: Number(r.weight_kg),
    verifiedAt: r.verified_at,
    username: r.profile?.username ?? null,
    displayName: r.profile?.display_name ?? null,
  }));
}

/**
 * Splits a board (already in ranking order) into its two divisions and numbers each from 1.
 * Ranks are positions: two equal lifts get 1 and 2, the earlier verification first — the
 * server already put them in that order. Both divisions are always present, even when empty,
 * so a screen can always show exactly two. A row with an unknown division is left out.
 */
export function splitBoard(entries: readonly BoardEntry[]): DividedBoard {
  const board: DividedBoard = { male: [], female: [] };
  for (const entry of entries) {
    if (!(DIVISIONS as readonly string[]).includes(entry.division)) continue;
    const division = board[entry.division];
    division.push({ ...entry, rank: division.length + 1 });
  }
  return board;
}
