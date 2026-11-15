/**
 * Reading and saving profiles (YOU-1, YOU-2, YOU-3, SOC-7; B25) — the one place that knows how to
 * ask the server for a profile's header, another lifter's workout history and their PRs, and how
 * to save the lifter's own profile.
 *
 * Why this exists: other people's data is never copied onto the phone, so another lifter's
 * profile is read from the server every time. (The lifter's OWN history and PRs are already on the
 * phone and are read there — `workout/history.ts`, `workout/prs.ts` — so they work offline.)
 *
 * Who may see what is NOT decided here. Every request runs as the signed-in lifter and the server's
 * row-level security filters it: workouts by their visibility (public / followers / private,
 * blocks), PRs by the visibility of the workout their proof set is in. Follower counts come from
 * the server's `follow_counts` function, because the app may only see follow rows it is part of —
 * counting them itself would be silently wrong for anyone else's profile.
 *
 * The Supabase client is passed in, so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PrKind } from '@training-math';

import { throwIfError } from '@/lib/throwIfError';
import type { PastWorkoutCursor } from '@/workout/history';
import { groupPrs, type ExercisePrs, type ProfileRecord } from '@/workout/prList';

import { PROFILE_FIELD_MESSAGES, type ProfileField, type ProfileTextValues } from './profileLimits';

/** Who a profile says the lifter is: their row in `profiles`, in the app's names. */
export interface ProfileIdentity {
  id: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  /** The photo's path in the avatars bucket, or null for none (the letter avatar shows). */
  avatarPath: string | null;
}

/** A profile's header: the five facts (photo, name, bio, two counts) plus the @username. */
export interface ProfileHeader extends ProfileIdentity {
  /** How many lifters follow this one — every follow row, not just the ones the viewer may see. */
  followers: number;
  /** How many lifters this one follows. */
  following: number;
  /** Whether the viewer follows this lifter; null on the viewer's own profile. */
  viewerFollows: boolean | null;
}

/** One `profiles` row as the server sends it. */
interface RawProfile {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
}

/** The `follow_counts` reply: one row of two counts (Postgres bigints may arrive as text). */
interface RawFollowCounts {
  followers: number | string;
  following: number | string;
}

/**
 * Just `profileId`'s row — name, @username, bio, photo — or null when there is no such profile.
 * One request. Edit profile fills its boxes from this (it needs no counts); the header builds on
 * it. Throws when the server can't be reached.
 */
export async function loadProfileRow(client: SupabaseClient, profileId: string): Promise<ProfileIdentity | null> {
  const found = await client
    .from('profiles')
    .select('id,username,display_name,bio,avatar_url')
    .eq('id', profileId)
    .limit(1);
  throwIfError(found.error, 'Loading the profile failed');
  const row = ((found.data ?? []) as RawProfile[])[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username ?? null,
    displayName: row.display_name ?? null,
    bio: row.bio ?? null,
    avatarPath: row.avatar_url ?? null,
  };
}

/**
 * The header of `profileId`'s profile as `me` sees it, or null when there is no such profile (a
 * deleted account, a bad link). Three small requests: the profile row, the two counts, and — on
 * someone else's profile — whether `me` follows them. Throws when the server can't be reached.
 */
export async function loadProfileHeader(
  client: SupabaseClient,
  me: string,
  profileId: string,
): Promise<ProfileHeader | null> {
  const row = await loadProfileRow(client, profileId);
  if (!row) return null;

  const counts = await client.rpc('follow_counts', { profile_id: profileId });
  throwIfError(counts.error, 'Loading the follower counts failed');
  const reply = counts.data as RawFollowCounts[] | RawFollowCounts | null;
  const tally = Array.isArray(reply) ? reply[0] : reply;

  let viewerFollows: boolean | null = null;
  if (profileId !== me) {
    const mine = await client
      .from('follows')
      .select('followee_id')
      .eq('follower_id', me)
      .eq('followee_id', profileId)
      .limit(1);
    throwIfError(mine.error, 'Loading the profile failed');
    viewerFollows = (mine.data ?? []).length > 0;
  }

  return {
    ...row,
    followers: Number(tally?.followers ?? 0),
    following: Number(tally?.following ?? 0),
    viewerFollows,
  };
}

/** What the lifter changes on Edit profile: the checked text, and the photo's bucket path. */
export interface ProfileChanges extends ProfileTextValues {
  avatarPath: string | null;
}

/** How a save went: done, or a message — under a box when it is about one field. */
export type ProfileSaveResult =
  | { ok: true }
  | { ok: false; field: ProfileField | null; message: string };

/** Shown when the save didn't reach the server (or it failed for a reason the lifter can't fix). */
export const PROFILE_SAVE_FAILED = 'Your profile didn’t save. Check your connection and try again.';

/**
 * Saves `me`'s own profile. The server is the law (its CHECKs and the owner-only update rule);
 * this turns its refusals into the sentences the screen shows:
 *   - 23505 (unique) on the username constraint — someone else has it → under the username box;
 *   - 23514 (check) — the constraint's name says which box broke a rule;
 *   - anything else, or no answer at all → `PROFILE_SAVE_FAILED`.
 */
export async function updateProfile(client: SupabaseClient, me: string, changes: ProfileChanges): Promise<ProfileSaveResult> {
  try {
    const { error } = await client
      .from('profiles')
      .update({
        username: changes.username,
        display_name: changes.displayName,
        bio: changes.bio,
        avatar_url: changes.avatarPath,
      })
      .eq('id', me);
    if (!error) return { ok: true };
    return saveRefusal(error as { code?: string; message?: string });
  } catch {
    return { ok: false, field: null, message: PROFILE_SAVE_FAILED };
  }
}

/** A server refusal as the message for the right box. */
function saveRefusal(error: { code?: string; message?: string }): ProfileSaveResult {
  const text = error.message ?? '';
  // Only the username is unique on `profiles` today; checking the constraint's name keeps a future
  // unique column from being reported as "username taken".
  if (error.code === '23505' && text.includes('username')) {
    return { ok: false, field: 'username', message: PROFILE_FIELD_MESSAGES.usernameTaken };
  }
  if (error.code === '23514') {
    if (text.includes('username')) return { ok: false, field: 'username', message: PROFILE_FIELD_MESSAGES.username };
    if (text.includes('display_name')) return { ok: false, field: 'displayName', message: PROFILE_FIELD_MESSAGES.displayName };
    if (text.includes('bio')) return { ok: false, field: 'bio', message: PROFILE_FIELD_MESSAGES.bio };
  }
  console.warn('Profile save refused', error);
  return { ok: false, field: null, message: PROFILE_SAVE_FAILED };
}

/** How many workouts one page of another lifter's history holds. */
export const HISTORY_PAGE_SIZE = 20;

/**
 * Where a page of workout history ended: the oldest workout's start time and id — the same
 * bookmark the phone's own history pages with (`PastWorkoutCursor`), so the profile treats both
 * sides alike.
 */
export type HistoryCursor = PastWorkoutCursor;

/** One workout in another lifter's history, as its row shows it. */
export interface ProfileWorkout {
  id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  /** Exercise names in workout order; null for one the viewer can't see (someone's custom exercise). */
  exerciseNames: (string | null)[];
  setCount: number;
}

/** A page of history and the bookmark for the next one (null when this was the last). */
export interface HistoryPage {
  workouts: ProfileWorkout[];
  next: HistoryCursor | null;
}

/** A workout exactly as the server sends it for `HISTORY_SELECT`. */
interface RawHistoryWorkout {
  id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  workout_exercises: { id: string; position: number; exercise: { name: string } | null; sets: { id: string }[] }[];
}

/** The columns a history row needs, with each exercise's name and set ids nested in. */
export const HISTORY_SELECT =
  'id,title,started_at,ended_at,workout_exercises(id,position,exercise:exercises(name),sets(id))';

/**
 * The "started before this bookmark" filter: an earlier start, or the same start and a smaller
 * id — the same keyset paging as the feed (`beforeCursorFilter`), on `started_at`. Times are
 * double-quoted because they contain `:` and `+`.
 */
export function beforeStartedFilter(cursor: HistoryCursor): string {
  const ts = `"${cursor.started_at}"`;
  return `started_at.lt.${ts},and(started_at.eq.${ts},id.lt.${cursor.id})`;
}

/**
 * One page of `profileId`'s FINISHED workouts, newest first. The server's workout rules decide
 * which ones the viewer may see — a private workout, or a followers-only one the viewer doesn't
 * follow for, is simply not in the reply. Walking the bookmarks reaches the very first workout
 * (YOU-2: the complete history).
 */
export async function loadWorkoutHistory(
  client: SupabaseClient,
  profileId: string,
  after: HistoryCursor | null,
): Promise<HistoryPage> {
  let query = client.from('workouts').select(HISTORY_SELECT).eq('user_id', profileId).not('ended_at', 'is', null);
  if (after) query = query.or(beforeStartedFilter(after));
  const { data, error } = await query
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_PAGE_SIZE);
  throwIfError(error, 'Loading the workout history failed');
  const raw = (data ?? []) as unknown as RawHistoryWorkout[];
  const last = raw[raw.length - 1];
  return {
    workouts: raw.map((w) => {
      const entries = [...w.workout_exercises].sort((a, b) => a.position - b.position);
      return {
        id: w.id,
        title: w.title,
        started_at: w.started_at,
        ended_at: w.ended_at,
        exerciseNames: entries.map((e) => e.exercise?.name ?? null),
        setCount: entries.reduce((n, e) => n + e.sets.length, 0),
      };
    }),
    next: raw.length === HISTORY_PAGE_SIZE && last ? { started_at: last.started_at, id: last.id } : null,
  };
}

/** One set of a workout read from the server (B37), with every field the set formatters print. */
export interface WorkoutDetailSet {
  id: string;
  position: number;
  reps: number | null;
  weight_kg: number | null;
  rpe: number | null;
  is_warmup: boolean;
  duration_seconds: number | null;
  score: string | null;
  drop_set_position: number | null;
  notes: string | null;
}

/** One exercise of a workout read from the server, its sets in logged order. */
export interface WorkoutDetailEntry {
  id: string;
  position: number;
  superset_group: number | null;
  notes: string | null;
  /** Null when the viewer can't read the exercise row (someone's own custom exercise). */
  exerciseName: string | null;
  sets: WorkoutDetailSet[];
}

/** One whole workout read from the server: someone else's log, opened from their profile History. */
export interface WorkoutDetail {
  id: string;
  userId: string;
  title: string | null;
  notes: string | null;
  started_at: string;
  ended_at: string | null;
  entries: WorkoutDetailEntry[];
}

/** A workout exactly as the server sends it for `WORKOUT_DETAIL_SELECT`. */
interface RawWorkoutDetail {
  id: string;
  user_id: string;
  title: string | null;
  notes: string | null;
  started_at: string;
  ended_at: string | null;
  workout_exercises: (Omit<WorkoutDetailEntry, 'exerciseName' | 'sets'> & {
    exercise: { name: string } | null;
    sets: WorkoutDetailSet[];
  })[];
}

/** The columns one workout's full log needs: every entry, its exercise's name, every set. */
export const WORKOUT_DETAIL_SELECT =
  'id,user_id,title,notes,started_at,ended_at,' +
  'workout_exercises(id,position,superset_group,notes,exercise:exercises(name),' +
  'sets(id,position,reps,weight_kg,rpe,is_warmup,duration_seconds,score,drop_set_position,notes))';

/**
 * One workout with all its exercises and sets, read from the server (B37 — TEAM-5), or null
 * when the viewer may not see it (or it doesn't exist). The server decides: the workout's own
 * visibility, plus — for a team's coaches — every member's log, private ones included, unless
 * there is a block. Entries and sets come back sorted by their positions. Throws on failure.
 *
 * Why this exists: a coach can't coach from a list of dates; opening a row of a member's profile
 * History shows the whole session. It serves any workout the viewer may see, not only coaches'.
 */
export async function loadWorkoutDetail(client: SupabaseClient, workoutId: string): Promise<WorkoutDetail | null> {
  const { data, error } = await client.from('workouts').select(WORKOUT_DETAIL_SELECT).eq('id', workoutId).limit(1);
  throwIfError(error, 'Loading the workout failed');
  const raw = ((data ?? []) as unknown as RawWorkoutDetail[])[0];
  if (!raw) return null;
  return {
    id: raw.id,
    userId: raw.user_id,
    title: raw.title,
    notes: raw.notes,
    started_at: raw.started_at,
    ended_at: raw.ended_at,
    entries: [...raw.workout_exercises]
      .sort((a, b) => a.position - b.position)
      .map(({ exercise, sets, ...entry }) => ({
        ...entry,
        exerciseName: exercise?.name ?? null,
        sets: [...sets].sort((a, b) => a.position - b.position),
      })),
  };
}

/** A record row exactly as the server sends it for the PR read. */
interface RawProfileRecord {
  id: string;
  exercise_id: string;
  kind: PrKind;
  reps: number | null;
  value_kg: number | string;
  exercise: { name: string } | null;
}

/**
 * `profileId`'s current records, one group per exercise. The server decides which rows come back:
 * a record is visible when its proof set's workout is (B25 migration). Nothing is recomputed — these
 * are B13's rows exactly ("PRs equal B13's records").
 */
export async function loadProfilePrs(client: SupabaseClient, profileId: string): Promise<ExercisePrs[]> {
  const { data, error } = await client
    .from('personal_records')
    .select('id,exercise_id,kind,reps,value_kg,exercise:exercises(name)')
    .eq('user_id', profileId);
  throwIfError(error, 'Loading the PRs failed');
  const rows = (data ?? []) as unknown as RawProfileRecord[];
  return groupPrs(
    rows.map((r) => ({
      exerciseId: r.exercise_id,
      exerciseName: r.exercise?.name ?? null,
      record: { id: r.id, kind: r.kind, reps: r.reps, value_kg: Number(r.value_kg) },
    })),
  );
}

export type { ExercisePrs, ProfileRecord };
