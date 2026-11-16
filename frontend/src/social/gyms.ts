/**
 * Gyms (B50 — GYM-1 part, GYM-2, GYM-7): every read and write the app makes about gyms, in one place.
 *
 * What a gym is: a real place lifters train, listed in a directory sorted by distance. Anyone
 * can join any gym — no proof of membership — and a lifter belongs to exactly **one** gym at a
 * time. Joining a different gym switches to it (the old membership is replaced, not kept).
 * Each gym has a page with its members and a Gym feed: the members' posts, read the same way
 * as a Team feed.
 *
 * What a gym is NOT: a group anyone runs. There is no owner, admin, claim or edit — gym rows
 * come only from the database's migrations (GYM-7). That's why this file has no function that
 * writes to `gyms`; the server refuses such writes anyway.
 *
 * Why this file exists: the directory, the gym page, Communities, Home's gym chip and the
 * profile's Gym line all need the same few questions answered; writing each request once here
 * keeps the shapes and refusal sentences in one place (the `teams.ts` pattern).
 *
 * Who may do what is decided by the server's row-level security, not here: every signed-in
 * lifter can read every gym and every membership; each lifter can only join, switch or leave
 * as themselves. The "one gym" rule is the membership table's primary key. Gyms live only on
 * the server (never stored on the phone), so every call needs a connection. The Supabase client
 * is passed in, so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { throwIfError } from '@/lib/throwIfError';

import type { PersonName } from './names';

/** One gym as the app shows it. */
export interface Gym {
  id: string;
  name: string;
  address: string;
}

/** A directory row: a gym and how far it is from where the directory was sorted, in metres. */
export interface NearbyGym extends Gym {
  distanceM: number;
}

/** One person on a gym's roster. */
export interface GymMember extends PersonName {
  userId: string;
  /** Their photo's path in the avatars bucket, or null. */
  avatarPath: string | null;
}

/** How a gym action went: done, or a sentence for the lifter. */
export type GymResult = { ok: true } | { ok: false; message: string };

/** The line any Gyms screen shows when it can't reach the server. */
export const GYMS_OFFLINE = 'Gyms need a connection. Logging workouts and the Tool Kit still work offline.';

/** The line a gym screen shows when the gym doesn't exist (a bad link, or a gym the directory no longer lists). */
export const GYM_MISSING = 'This gym isn’t available.';

/** Shown when a join, switch or leave didn't go through. */
export const GYM_FAILED = 'That didn’t go through. Check your connection and try again.';

/** The gym columns every read asks for. */
export const GYM_SELECT = 'id,name,address';

/** The roster read: the member's profile named through its foreign key (unambiguous on the server). */
export const GYM_MEMBER_SELECT =
  'user_id,joined_at,profile:profiles!gym_members_user_id_fkey(username,display_name,avatar_url)';

/** A `gyms_near` row exactly as the server sends it. */
interface RawNearbyGym {
  id: string;
  name: string;
  address: string;
  distance_m: number;
}

/** A roster row with the member's profile embedded. */
interface RawGymMember {
  user_id: string;
  profile: { username: string | null; display_name: string | null; avatar_url?: string | null } | null;
}

/** Keeps just the app's three gym fields from a server row (which may carry more, e.g. a distance). */
function toGym(row: Gym): Gym {
  return { id: row.id, name: row.name, address: row.address };
}

/**
 * The directory: every gym, nearest to (`lat`, `lng`) first, with its distance in metres. The
 * server does the sorting (PostGIS, `gyms_near`); the coordinates are sent only as the
 * question's arguments and never stored. Throws on failure.
 */
export async function nearbyGyms(client: SupabaseClient, lat: number, lng: number): Promise<NearbyGym[]> {
  const { data, error } = await client.rpc('gyms_near', { lat, lng });
  throwIfError(error, 'Loading the gym directory failed');
  return ((data ?? []) as RawNearbyGym[]).map((g) => ({ ...toGym(g), distanceM: Number(g.distance_m) }));
}

/**
 * The gym `userId` belongs to, or null when they haven't joined one. Memberships are public to
 * signed-in lifters, so this works for your own id (Home's chip, Communities) and anyone else's
 * (their profile). Throws on failure.
 */
export async function gymOf(client: SupabaseClient, userId: string): Promise<Gym | null> {
  const { data, error } = await client.from('gym_members').select(`gym:gyms(${GYM_SELECT})`).eq('user_id', userId).limit(1);
  throwIfError(error, 'Loading the gym failed');
  const row = ((data ?? []) as unknown as { gym: Gym | null }[])[0];
  return row?.gym ? toGym(row.gym) : null;
}

/** One gym by id, or null when there is no such gym (a bad link). Throws on failure. */
export async function loadGym(client: SupabaseClient, gymId: string): Promise<Gym | null> {
  const { data, error } = await client.from('gyms').select(GYM_SELECT).eq('id', gymId).limit(1);
  throwIfError(error, 'Loading the gym failed');
  const row = ((data ?? []) as unknown as Gym[])[0];
  return row ? toGym(row) : null;
}

/**
 * A gym's members, newest first, with names. Also where the Gym feed gets its list of authors.
 * Throws on failure.
 */
export async function loadGymMembers(client: SupabaseClient, gymId: string): Promise<GymMember[]> {
  const { data, error } = await client
    .from('gym_members')
    .select(GYM_MEMBER_SELECT)
    .eq('gym_id', gymId)
    .order('joined_at', { ascending: false });
  throwIfError(error, 'Loading the gym’s members failed');
  return ((data ?? []) as unknown as RawGymMember[]).map((r) => ({
    userId: r.user_id,
    username: r.profile?.username ?? null,
    displayName: r.profile?.display_name ?? null,
    avatarPath: r.profile?.avatar_url ?? null,
  }));
}

/**
 * `me` joins `gymId`. Joining and switching are the same request: the lifter's single
 * membership row is created, or — when they already belong to a gym — pointed at this one
 * (one active gym per lifter; the server's primary key makes a second row impossible). Joining
 * the gym you're already in changes nothing. Only `user_id` and `gym_id` are sent; the server
 * stamps the join time itself.
 */
export async function joinGym(client: SupabaseClient, me: string, gymId: string): Promise<GymResult> {
  try {
    const { error } = await client.from('gym_members').upsert({ user_id: me, gym_id: gymId }, { onConflict: 'user_id' });
    return error ? { ok: false, message: GYM_FAILED } : { ok: true };
  } catch {
    return { ok: false, message: GYM_FAILED };
  }
}

/** `me` leaves their gym (deletes their one membership row). Not being in a gym counts as success. */
export async function leaveGym(client: SupabaseClient, me: string): Promise<GymResult> {
  try {
    const { error } = await client.from('gym_members').delete().eq('user_id', me);
    return error ? { ok: false, message: GYM_FAILED } : { ok: true };
  } catch {
    return { ok: false, message: GYM_FAILED };
  }
}

/** Metres in one statute mile (exact by definition). */
export const METRES_PER_MILE = 1609.344;

/**
 * A directory distance for display, in miles: one decimal under 10 miles ("0.8 mi", "9.6 mi"),
 * whole miles from 10 up ("12 mi"). Miles only at launch — the directory is Denver-area.
 */
export function formatDistance(distanceM: number): string {
  const miles = Math.max(0, distanceM) / METRES_PER_MILE;
  if (miles < 9.95) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
