/**
 * Team coaching (B37 — TEAM-3): every read and write the app makes about what a team's coaches
 * push and assign, in one place.
 *
 * What coaching is: a team's owner and its coaches (the owner always counts as one) can
 *   - **push** to the team: an announcement (text), one of their programs, or one workout of a
 *     program. Every member sees pushes on the team page, newest first;
 *   - **assign** one of their programs to a member. The member sees "Your coach assigned …" on
 *     the team page and taps Start: the phone copies the program into the member's own programs
 *     (`programs/copyProgram.ts`) and starts running it, then this file removes the assignment.
 *
 * Why pushed programs come back as JSON: a coach's program tables are readable by the coach only
 * (and the phone downloads them unfiltered, so widening them would fill every member's phone with
 * the coach's rows). Instead two server functions hand a member the pushed program or workout as
 * one JSON document — `team_program_payload` / `team_workout_payload` — and answer null unless
 * the member is on the team and the content was pushed (or assigned) there and still exists.
 * This file parses that JSON carefully (`parseProgramPayload`) rather than trusting its shape.
 *
 * Who may do what is NOT decided here: every request runs as the signed-in lifter and the
 * server's row-level security refuses pushes and assignments from non-coaches, pushes of someone
 * else's program, assignments to non-members or across a block. This file asks and turns a
 * refusal into a calm sentence. Coaching is online-only, like the rest of Teams. The Supabase
 * client is passed in, so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertValidTeamAnnouncement, MAX_TEAM_ANNOUNCEMENT_LENGTH } from '@training-math';

import { throwIfError } from '@/lib/throwIfError';

import type { PersonName } from './names';
import { codeOf, RLS_REFUSED, TEAM_FAILED, UNIQUE_VIOLATION, type TeamResult } from './teams';

/** What a push carries: text, a whole program, or one program workout. */
export type TeamPostKind = 'announcement' | 'program' | 'workout';

/** One push as the team page shows it. */
export interface TeamPost {
  id: string;
  teamId: string;
  authorId: string;
  /** The coach who pushed it (null names if their profile can't be read). */
  author: PersonName;
  kind: TeamPostKind;
  /** The announcement's text (announcements only). */
  body: string | null;
  /** The pushed program's id (program pushes only). */
  programId: string | null;
  /** The pushed program workout's id (workout pushes only). */
  programWorkoutId: string | null;
  createdAt: string;
}

/** "This program, for this member" — a standing assignment the member hasn't started yet. */
export interface TeamAssignment {
  teamId: string;
  userId: string;
  programId: string;
  assignedBy: string;
  createdAt: string;
}

/** One exercise slot of a pushed program, as the payload function sends it. */
export interface PayloadSlot {
  /** Null if the coach's slot lost its exercise. */
  exerciseId: string | null;
  /** The exercise's name — travels with the push, so even a coach's own custom exercise names itself. */
  exerciseName: string | null;
  position: number;
  targetSets: number;
  targetReps: number | null;
  targetWeightKg: number | null;
  targetRpe: number | null;
}

/** One workout of a pushed program: its name (null → "Workout N"), place and slots. */
export interface PayloadWorkout {
  name: string | null;
  position: number;
  exercises: PayloadSlot[];
}

/** A whole pushed or assigned program: its name and its live weeks, each with its workouts, in order. */
export interface TeamProgramPayload {
  name: string;
  weeks: { position: number; workouts: PayloadWorkout[] }[];
}

/** One pushed program workout, with the name of the program it comes from. */
export interface TeamWorkoutPayload extends PayloadWorkout {
  programName: string;
}

/** Shown when the server refuses a push, an assignment or a removal — the lifter isn't a coach here. */
export const COACH_NOT_ALLOWED = 'Only this team’s coaches can do that.';

/**
 * Shown when an assignment is refused: the lifter left the team, there's a block, or the program
 * hasn't reached the server yet (it uploads shortly after it's made).
 */
export const ASSIGN_REFUSED =
  'That program couldn’t be assigned to this lifter. If you just made it, wait for it to sync and try again.';

/**
 * Shown when a program or workout push is refused. The commonest cause for a coach is a program
 * made moments ago that hasn't uploaded yet; the server can't tell the two apart.
 */
export const PUSH_PROGRAM_REFUSED =
  'That couldn’t be pushed. If you just made this program, wait for it to sync and try again.';

/** How many pushes the team page shows (newest first; no paging yet). */
export const TEAM_POSTS_LIMIT = 20;

/** The push columns, with the author's name embedded through its foreign key. */
export const TEAM_POST_SELECT =
  'id,team_id,author_id,kind,body,program_id,program_workout_id,created_at,author:profiles!team_posts_author_id_fkey(username,display_name)';

/** A push row exactly as the server sends it for `TEAM_POST_SELECT`. */
export interface RawTeamPost {
  id: string;
  team_id: string;
  author_id: string;
  kind: TeamPostKind;
  body: string | null;
  program_id: string | null;
  program_workout_id: string | null;
  created_at: string;
  author: { username: string | null; display_name: string | null } | null;
}

/** An assignment row exactly as the server sends it. */
interface RawAssignment {
  team_id: string;
  user_id: string;
  program_id: string;
  assigned_by: string;
  created_at: string;
}

const ASSIGNMENT_SELECT = 'team_id,user_id,program_id,assigned_by,created_at';

/** Turns a server push row into the app's shape. */
function toTeamPost(raw: RawTeamPost): TeamPost {
  return {
    id: raw.id,
    teamId: raw.team_id,
    authorId: raw.author_id,
    author: { username: raw.author?.username ?? null, displayName: raw.author?.display_name ?? null },
    kind: raw.kind,
    body: raw.body,
    programId: raw.program_id,
    programWorkoutId: raw.program_workout_id,
    createdAt: raw.created_at,
  };
}

/** Turns a server assignment row into the app's shape. */
function toAssignment(raw: RawAssignment): TeamAssignment {
  return {
    teamId: raw.team_id,
    userId: raw.user_id,
    programId: raw.program_id,
    assignedBy: raw.assigned_by,
    createdAt: raw.created_at,
  };
}

/**
 * The newest pushes to a team (at most `TEAM_POSTS_LIMIT`), with their authors' names. The server
 * shows a team's pushes to its members only, so anyone else gets an empty list. Throws on failure.
 */
export async function loadTeamPosts(client: SupabaseClient, teamId: string): Promise<TeamPost[]> {
  const { data, error } = await client
    .from('team_posts')
    .select(TEAM_POST_SELECT)
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(TEAM_POSTS_LIMIT);
  throwIfError(error, 'Loading the team’s pushes failed');
  return ((data ?? []) as unknown as RawTeamPost[]).map(toTeamPost);
}

/** Sends one push row; a security refusal reads `refused`. */
async function insertPost(client: SupabaseClient, row: Record<string, unknown>, refused: string): Promise<TeamResult> {
  try {
    const { error } = await client.from('team_posts').insert(row);
    if (!error) return { ok: true };
    if (codeOf(error) === RLS_REFUSED) return { ok: false, message: refused };
    return { ok: false, message: TEAM_FAILED };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/**
 * Coach `me` pushes an announcement to the team. The text is trimmed and must be 1–2000
 * characters (checked first, so a bad one never makes a request).
 */
export async function pushAnnouncement(
  client: SupabaseClient,
  me: string,
  teamId: string,
  body: string,
): Promise<TeamResult> {
  const trimmed = body.trim();
  try {
    assertValidTeamAnnouncement(trimmed);
  } catch {
    return { ok: false, message: `Write an announcement of 1 to ${MAX_TEAM_ANNOUNCEMENT_LENGTH} characters.` };
  }
  return insertPost(client, { team_id: teamId, author_id: me, kind: 'announcement', body: trimmed }, COACH_NOT_ALLOWED);
}

/**
 * Coach `me` pushes one of their own programs to the team. The program must already be on the
 * server (it syncs up from the phone shortly after it's made); otherwise the push is refused
 * with `PUSH_PROGRAM_REFUSED`.
 */
export function pushProgram(client: SupabaseClient, me: string, teamId: string, programId: string): Promise<TeamResult> {
  return insertPost(
    client,
    { team_id: teamId, author_id: me, kind: 'program', program_id: programId },
    PUSH_PROGRAM_REFUSED,
  );
}

/** Coach `me` pushes one workout of one of their own programs to the team (same rules as `pushProgram`). */
export function pushWorkout(
  client: SupabaseClient,
  me: string,
  teamId: string,
  programWorkoutId: string,
): Promise<TeamResult> {
  return insertPost(
    client,
    { team_id: teamId, author_id: me, kind: 'workout', program_workout_id: programWorkoutId },
    PUSH_PROGRAM_REFUSED,
  );
}

/**
 * Removes a push. The server only lets its author or (B38) the team's owner remove it — the
 * owner's way to take down a coach's push; anyone else's attempt changes nothing, which comes
 * back as `COACH_NOT_ALLOWED`.
 */
export async function deleteTeamPost(client: SupabaseClient, postId: string): Promise<TeamResult> {
  try {
    const { data, error } = await client.from('team_posts').delete().eq('id', postId).select('id');
    if (error) return { ok: false, message: TEAM_FAILED };
    return ((data ?? []) as unknown[]).length > 0 ? { ok: true } : { ok: false, message: COACH_NOT_ALLOWED };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/**
 * Coach `me` assigns their program `programId` to team member `userId`. Assigning the same
 * program twice is harmless. Refused (`ASSIGN_REFUSED`) when the lifter isn't on the team, a
 * block stands between them, `me` isn't a coach, or the program isn't on the server yet.
 */
export async function assignProgram(
  client: SupabaseClient,
  me: string,
  teamId: string,
  userId: string,
  programId: string,
): Promise<TeamResult> {
  try {
    const { error } = await client
      .from('team_assignments')
      .insert({ team_id: teamId, user_id: userId, program_id: programId, assigned_by: me });
    if (!error) return { ok: true };
    if (codeOf(error) === UNIQUE_VIOLATION) return { ok: true };
    if (codeOf(error) === RLS_REFUSED) return { ok: false, message: ASSIGN_REFUSED };
    return { ok: false, message: TEAM_FAILED };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/**
 * Removes an assignment — the member after starting it (or dismissing it), or a coach revoking
 * it. All three are the same delete; the server allows the assignee and the team's coaches.
 * An assignment already gone is no error.
 */
export async function removeAssignment(
  client: SupabaseClient,
  teamId: string,
  userId: string,
  programId: string,
): Promise<TeamResult> {
  try {
    const { error } = await client
      .from('team_assignments')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('program_id', programId);
    return error ? { ok: false, message: TEAM_FAILED } : { ok: true };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/** The programs assigned to `me` in a team, oldest first. Throws on failure. */
export async function myAssignments(client: SupabaseClient, me: string, teamId: string): Promise<TeamAssignment[]> {
  const { data, error } = await client
    .from('team_assignments')
    .select(ASSIGNMENT_SELECT)
    .eq('team_id', teamId)
    .eq('user_id', me)
    .order('created_at', { ascending: true });
  throwIfError(error, 'Loading assignments failed');
  return ((data ?? []) as unknown as RawAssignment[]).map(toAssignment);
}

/**
 * Every standing assignment in a team (the coach's view of who has what). The server shows a
 * non-coach only their own. Throws on failure.
 */
export async function teamAssignments(client: SupabaseClient, teamId: string): Promise<TeamAssignment[]> {
  const { data, error } = await client
    .from('team_assignments')
    .select(ASSIGNMENT_SELECT)
    .eq('team_id', teamId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'Loading assignments failed');
  return ((data ?? []) as unknown as RawAssignment[]).map(toAssignment);
}

// ---------------------------------------------------------------------------------------------
// Payloads — parsed, never trusted raw
// ---------------------------------------------------------------------------------------------

/** A plain object (not null, not an array), for shape checks. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A whole number, or null when it isn't one. */
function wholeOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** A finite number (numeric columns may arrive as numbers or numeric text), or null. */
function numberOrNull(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** A string, or null. */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** One slot from the payload, or null when its required fields (place, sets) are missing. */
function parseSlot(raw: unknown): PayloadSlot | null {
  if (!isObject(raw)) return null;
  const position = wholeOrNull(raw.position);
  const targetSets = wholeOrNull(raw.target_sets);
  if (position == null || targetSets == null) return null;
  return {
    exerciseId: stringOrNull(raw.exercise_id),
    exerciseName: stringOrNull(raw.exercise_name),
    position,
    targetSets,
    targetReps: wholeOrNull(raw.target_reps),
    targetWeightKg: numberOrNull(raw.target_weight_kg),
    targetRpe: numberOrNull(raw.target_rpe),
  };
}

/** One workout from the payload, or null when it is malformed. Malformed slots are dropped. */
function parseWorkout(raw: unknown): PayloadWorkout | null {
  if (!isObject(raw) || !Array.isArray(raw.exercises)) return null;
  const position = wholeOrNull(raw.position);
  if (position == null) return null;
  return {
    name: stringOrNull(raw.name),
    position,
    exercises: raw.exercises.map(parseSlot).filter((s): s is PayloadSlot => s !== null),
  };
}

/**
 * Checks and converts `team_program_payload`'s JSON into a `TeamProgramPayload`, or null when
 * there is none (the server said no) or it isn't shaped like a program. Malformed weeks,
 * workouts or slots are dropped rather than failing the whole program.
 */
export function parseProgramPayload(raw: unknown): TeamProgramPayload | null {
  if (!isObject(raw) || typeof raw.name !== 'string' || !Array.isArray(raw.weeks)) return null;
  const weeks = raw.weeks.flatMap((w) => {
    if (!isObject(w) || !Array.isArray(w.workouts)) return [];
    const position = wholeOrNull(w.position);
    if (position == null) return [];
    return [{ position, workouts: w.workouts.map(parseWorkout).filter((x): x is PayloadWorkout => x !== null) }];
  });
  return { name: raw.name, weeks };
}

/** Checks and converts `team_workout_payload`'s JSON, or null (refused, or malformed). */
export function parseWorkoutPayload(raw: unknown): TeamWorkoutPayload | null {
  const workout = parseWorkout(raw);
  if (!workout || !isObject(raw) || typeof raw.program_name !== 'string') return null;
  return { ...workout, programName: raw.program_name };
}

/** What a payload fetch answers: the content, or null when it's gone or not yours to see. */
export type PayloadResult<T> = { ok: true; payload: T | null } | { ok: false; message: string };

/** Calls one payload function and parses its answer. */
async function fetchPayload<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, string>,
  parse: (raw: unknown) => T | null,
): Promise<PayloadResult<T>> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) return { ok: false, message: TEAM_FAILED };
    return { ok: true, payload: parse(data) };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/**
 * The whole program `programId` as pushed to (or assigned within) team `teamId`. `payload` is
 * null when the program has since been deleted, was never pushed here, or the lifter isn't on
 * the team — the sheet then says "no longer available".
 */
export function fetchProgramPayload(
  client: SupabaseClient,
  teamId: string,
  programId: string,
): Promise<PayloadResult<TeamProgramPayload>> {
  return fetchPayload(client, 'team_program_payload', { p_team: teamId, p_program: programId }, parseProgramPayload);
}

/** One pushed program workout of team `teamId`, or a null payload (see `fetchProgramPayload`). */
export function fetchWorkoutPayload(
  client: SupabaseClient,
  teamId: string,
  programWorkoutId: string,
): Promise<PayloadResult<TeamWorkoutPayload>> {
  return fetchPayload(
    client,
    'team_workout_payload',
    { p_team: teamId, p_program_workout: programWorkoutId },
    parseWorkoutPayload,
  );
}

/** A payload workout's label: its name, or "Workout N" from its 1-based place in its week. */
export function payloadWorkoutLabel(workout: Pick<PayloadWorkout, 'name'>, number: number): string {
  return workout.name ?? `Workout ${number}`;
}
