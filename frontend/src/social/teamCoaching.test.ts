/**
 * Tests for team coaching (B37): pushes (announcement text checked first; program / workout
 * pushes; refusals mapped to calm sentences; author-only removal), assignments (made, repeated
 * harmlessly, refused, read per lifter and per team, removed), and the payload functions —
 * called with the right arguments, parsed defensively (malformed parts dropped, a refusal's null
 * kept as null, numeric text accepted). The client is the in-memory fake social client; who may
 * push, assign or read a payload was probed live (rolled back) at B37.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';

import {
  ASSIGN_REFUSED,
  assignProgram,
  COACH_NOT_ALLOWED,
  deleteTeamPost,
  fetchProgramPayload,
  fetchWorkoutPayload,
  loadTeamPosts,
  myAssignments,
  parseProgramPayload,
  parseWorkoutPayload,
  payloadWorkoutLabel,
  PUSH_PROGRAM_REFUSED,
  pushAnnouncement,
  pushProgram,
  pushWorkout,
  removeAssignment,
  TEAM_POSTS_LIMIT,
  teamAssignments,
} from './teamCoaching';
import { TEAM_FAILED } from './teams';

/** A client whose next request is refused with `code`. */
function refusingClient(code: string) {
  const refusal = { data: null, error: { code, message: 'refused' } };
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'delete']) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(refusal).then(resolve);
  return { from: () => builder, rpc: () => Promise.resolve(refusal) } as never;
}

const slot = (position: number, extra: Record<string, unknown> = {}) => ({
  exercise_id: `ex-${position}`,
  exercise_name: `Lift ${position}`,
  position,
  target_sets: 3,
  target_reps: 5,
  target_weight_kg: 100,
  target_rpe: null,
  ...extra,
});

describe('pushes', () => {
  it('pushes a trimmed announcement and reads it back newest first with its author', async () => {
    const fake = createFakeSocialClient({ profiles: [profile('coach', 'coachy', 'Coach')] });
    expect(await pushAnnouncement(fake.client, 'coach', 't1', '  Deload week  ')).toEqual({ ok: true });
    expect(await pushProgram(fake.client, 'coach', 't1', 'prog-1')).toEqual({ ok: true });
    expect(await pushWorkout(fake.client, 'coach', 't1', 'pw-1')).toEqual({ ok: true });
    const posts = await loadTeamPosts(fake.client, 't1');
    expect(posts.map((p) => p.kind)).toEqual(['workout', 'program', 'announcement']);
    expect(posts[2]).toMatchObject({ body: 'Deload week', authorId: 'coach', author: { username: 'coachy', displayName: 'Coach' } });
    expect(posts[1].programId).toBe('prog-1');
    expect(posts[0].programWorkoutId).toBe('pw-1');
  });

  it('reads only the asked team, at most the limit', async () => {
    const fake = createFakeSocialClient();
    for (let i = 0; i < TEAM_POSTS_LIMIT + 2; i++) await pushAnnouncement(fake.client, 'c', 't1', `n${i}`);
    await pushAnnouncement(fake.client, 'c', 't2', 'other team');
    const posts = await loadTeamPosts(fake.client, 't1');
    expect(posts).toHaveLength(TEAM_POSTS_LIMIT);
    expect(posts.every((p) => p.teamId === 't1')).toBe(true);
  });

  it('refuses an empty or too-long announcement without asking the server', async () => {
    const fake = createFakeSocialClient();
    expect((await pushAnnouncement(fake.client, 'c', 't1', '   ')).ok).toBe(false);
    expect((await pushAnnouncement(fake.client, 'c', 't1', 'x'.repeat(2001))).ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });

  it('maps a security refusal: announcements to "coaches only", program pushes to the sync hint', async () => {
    expect(await pushAnnouncement(refusingClient('42501'), 'm', 't1', 'hi')).toEqual({ ok: false, message: COACH_NOT_ALLOWED });
    expect(await pushProgram(refusingClient('42501'), 'm', 't1', 'p')).toEqual({ ok: false, message: PUSH_PROGRAM_REFUSED });
    expect(await pushWorkout(refusingClient('42501'), 'm', 't1', 'w')).toEqual({ ok: false, message: PUSH_PROGRAM_REFUSED });
  });

  it('reports a dropped connection calmly', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    expect(await pushAnnouncement(fake.client, 'c', 't1', 'hi')).toEqual({ ok: false, message: TEAM_FAILED });
    await expect(loadTeamPosts(fake.client, 't1')).rejects.toThrow();
  });

  it('removes a push, and says "not allowed" when nothing was removed', async () => {
    const fake = createFakeSocialClient();
    await pushAnnouncement(fake.client, 'c', 't1', 'hi');
    expect(await deleteTeamPost(fake.client, 'push-1')).toEqual({ ok: true });
    expect(fake.tables.team_posts).toHaveLength(0);
    expect(await deleteTeamPost(fake.client, 'push-1')).toEqual({ ok: false, message: COACH_NOT_ALLOWED });
  });
});

describe('assignments', () => {
  it('assigns, treats a repeat as done, and reads per lifter and per team', async () => {
    const fake = createFakeSocialClient();
    expect(await assignProgram(fake.client, 'coach', 't1', 'm1', 'p1')).toEqual({ ok: true });
    expect(await assignProgram(fake.client, 'coach', 't1', 'm1', 'p1')).toEqual({ ok: true });
    await assignProgram(fake.client, 'coach', 't1', 'm2', 'p1');
    await assignProgram(fake.client, 'coach', 't2', 'm1', 'p2');
    expect(fake.tables.team_assignments).toHaveLength(3);
    const mine = await myAssignments(fake.client, 'm1', 't1');
    expect(mine).toEqual([expect.objectContaining({ teamId: 't1', userId: 'm1', programId: 'p1', assignedBy: 'coach' })]);
    expect((await teamAssignments(fake.client, 't1')).map((a) => a.userId).sort()).toEqual(['m1', 'm2']);
  });

  it('maps a refusal to ASSIGN_REFUSED', async () => {
    expect(await assignProgram(refusingClient('42501'), 'c', 't1', 'x', 'p')).toEqual({ ok: false, message: ASSIGN_REFUSED });
    expect(await assignProgram(refusingClient('XX000'), 'c', 't1', 'x', 'p')).toEqual({ ok: false, message: TEAM_FAILED });
  });

  it('removes exactly the one assignment (accept, dismiss and revoke are the same delete)', async () => {
    const fake = createFakeSocialClient();
    await assignProgram(fake.client, 'coach', 't1', 'm1', 'p1');
    await assignProgram(fake.client, 'coach', 't1', 'm1', 'p2');
    expect(await removeAssignment(fake.client, 't1', 'm1', 'p1')).toEqual({ ok: true });
    expect(fake.tables.team_assignments.map((a) => a.program_id)).toEqual(['p2']);
    expect(await removeAssignment(fake.client, 't1', 'm1', 'p1')).toEqual({ ok: true });
  });
});

describe('payloads', () => {
  const program = {
    name: 'Block',
    weeks: [
      { position: 0, workouts: [{ name: 'Day A', position: 0, exercises: [slot(0), slot(1, { target_rpe: '8.5' })] }] },
      { position: 3, workouts: [{ name: null, position: 1, exercises: [] }] },
    ],
  };

  it('calls the program function with the team and program, and parses its tree', async () => {
    const seen: Record<string, unknown>[] = [];
    const fake = createFakeSocialClient({}, { rpc: { team_program_payload: (p) => (seen.push(p), program) } });
    const result = await fetchProgramPayload(fake.client, 't1', 'p1');
    expect(seen).toEqual([{ p_team: 't1', p_program: 'p1' }]);
    expect(result.ok && result.payload).toEqual({
      name: 'Block',
      weeks: [
        {
          position: 0,
          workouts: [
            {
              name: 'Day A',
              position: 0,
              exercises: [
                { exerciseId: 'ex-0', exerciseName: 'Lift 0', position: 0, targetSets: 3, targetReps: 5, targetWeightKg: 100, targetRpe: null },
                { exerciseId: 'ex-1', exerciseName: 'Lift 1', position: 1, targetSets: 3, targetReps: 5, targetWeightKg: 100, targetRpe: 8.5 },
              ],
            },
          ],
        },
        { position: 3, workouts: [{ name: null, position: 1, exercises: [] }] },
      ],
    });
  });

  it('keeps the server’s "no" as a null payload, and a failed call as a message', async () => {
    const fake = createFakeSocialClient({}, { rpc: { team_program_payload: () => null } });
    expect(await fetchProgramPayload(fake.client, 't1', 'p1')).toEqual({ ok: true, payload: null });
    const offline = createFakeSocialClient({}, { offline: true });
    expect(await fetchProgramPayload(offline.client, 't1', 'p1')).toEqual({ ok: false, message: TEAM_FAILED });
  });

  it('calls the workout function and parses one workout with its program name', async () => {
    const seen: Record<string, unknown>[] = [];
    const fake = createFakeSocialClient(
      {},
      { rpc: { team_workout_payload: (p) => (seen.push(p), { name: 'Day A', position: 0, exercises: [slot(0)], program_name: 'Block' }) } },
    );
    const result = await fetchWorkoutPayload(fake.client, 't1', 'pw1');
    expect(seen).toEqual([{ p_team: 't1', p_program_workout: 'pw1' }]);
    expect(result.ok && result.payload).toMatchObject({ name: 'Day A', programName: 'Block', exercises: [{ exerciseId: 'ex-0' }] });
  });

  it('drops malformed parts and refuses a payload that is not a program', () => {
    expect(parseProgramPayload(null)).toBeNull();
    expect(parseProgramPayload({ name: 3, weeks: [] })).toBeNull();
    expect(parseProgramPayload({ name: 'x', weeks: 'no' })).toBeNull();
    const parsed = parseProgramPayload({
      name: 'x',
      weeks: [
        'junk',
        { position: 1.5, workouts: [] },
        { position: 0, workouts: [{ position: 0, exercises: [slot(0, { target_sets: null }), slot(1), 'junk'] }, { exercises: [] }] },
      ],
    });
    expect(parsed?.weeks).toHaveLength(1);
    expect(parsed?.weeks[0].workouts).toHaveLength(1);
    expect(parsed?.weeks[0].workouts[0].exercises.map((s) => s.position)).toEqual([1]);
    expect(parseWorkoutPayload({ name: 'A', position: 0, exercises: [] })).toBeNull();
  });

  it('labels an unnamed workout by its place', () => {
    expect(payloadWorkoutLabel({ name: null }, 2)).toBe('Workout 2');
    expect(payloadWorkoutLabel({ name: 'Day A' }, 2)).toBe('Day A');
  });
});
