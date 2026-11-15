/**
 * Tests for making a workout post on the phone (B21), on real SQLite: one row and one outbox line
 * in one transaction, the workout's visibility copied, and every refusal saving nothing.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { onLocalWrite, writeLocal, type FlairRow } from '@/db/dao';
import { replaceFlairsTx } from '@/db/flairs';
import { outboxSize, pendingRows } from '@/sync/outbox';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { OTHER_USER_ID, USER_ID, WORKOUT } from '@/test-utils/workoutFixtures';

import { createWorkoutPost, hasPostForWorkout, PostRefusedError } from './createPost';

const FLAIRS: FlairRow[] = [
  { id: 'wod', name: 'WOD', position: 1, upvotes_only: false },
  { id: 'new-pr', name: 'New PR', position: 2, upvotes_only: false },
];
const POST_ID = 'd0000000-0000-4000-8000-000000000001';
const NOW = '2026-11-15T10:00:00.000Z';

/** A phone with the fixture workout finished and saved, and the flair list synced. */
async function phoneWithFinishedWorkout(visibility = WORKOUT.visibility) {
  const db = await prepareDatabase(createNodeSqliteDriver());
  await writeLocal(db, 'workouts', [{ ...WORKOUT, visibility }]);
  await db.withTransactionAsync((tx) => replaceFlairsTx(tx, FLAIRS));
  await db.runAsync('delete from outbox'); // as if the workout had already uploaded
  return db;
}

/** Expects `promise` to be refused for `reason`. */
async function expectRefused(promise: Promise<unknown>, reason: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(PostRefusedError);
  await expect(promise).rejects.toMatchObject({ reason });
}

describe('createWorkoutPost', () => {
  it('saves one post linking the workout, with the chosen flair, and queues exactly one upload line', async () => {
    const db = await phoneWithFinishedWorkout();
    const post = await createWorkoutPost(db, USER_ID, WORKOUT.id, 'new-pr', { now: NOW, newId: () => POST_ID });
    expect(post).toEqual({
      id: POST_ID,
      user_id: USER_ID,
      flair_id: 'new-pr',
      workout_id: WORKOUT.id,
      visibility: 'public',
      created_at: NOW,
      updated_at: NOW,
    });
    expect(await db.getAllAsync('select * from posts')).toEqual([post]);
    expect(await pendingRows(db, 'posts')).toEqual([{ rowId: POST_ID, mark: expect.any(Number) }]);
    expect(await outboxSize(db)).toBe(1);
    expect(await hasPostForWorkout(db, WORKOUT.id)).toBe(true);
  });

  it('copies the workout’s visibility: a followers-only workout makes a followers-only post', async () => {
    const db = await phoneWithFinishedWorkout('followers');
    const post = await createWorkoutPost(db, USER_ID, WORKOUT.id, 'wod');
    expect(post.visibility).toBe('followers');
  });

  it('makes a fresh random id by default', async () => {
    const db = await phoneWithFinishedWorkout();
    const post = await createWorkoutPost(db, USER_ID, WORKOUT.id, 'wod');
    expect(post.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('tells the sync engine once the post is saved', async () => {
    const db = await phoneWithFinishedWorkout();
    const heard = jest.fn();
    const stop = onLocalWrite(db, heard);
    await createWorkoutPost(db, USER_ID, WORKOUT.id, 'wod');
    stop();
    expect(heard).toHaveBeenCalledWith('posts');
  });

  it('refuses a second post of the same workout (one post per workout — a double-tap posts once)', async () => {
    const db = await phoneWithFinishedWorkout();
    await createWorkoutPost(db, USER_ID, WORKOUT.id, 'wod');
    await expectRefused(createWorkoutPost(db, USER_ID, WORKOUT.id, 'new-pr'), 'already-posted');
    expect(await db.getFirstAsync('select count(*) as n from posts')).toEqual({ n: 1 });
    expect(await outboxSize(db)).toBe(1);
  });

  it('refuses another user’s workout, a missing one, an unfinished one and an unknown flair — saving nothing', async () => {
    const db = await phoneWithFinishedWorkout();
    await writeLocal(db, 'workouts', [
      { ...WORKOUT, id: 'a0000000-0000-4000-8000-000000000002', user_id: OTHER_USER_ID },
      { ...WORKOUT, id: 'a0000000-0000-4000-8000-000000000003', ended_at: null },
    ]);
    await db.runAsync('delete from outbox');

    await expectRefused(createWorkoutPost(db, USER_ID, 'a0000000-0000-4000-8000-000000000002', 'wod'), 'workout-missing');
    await expectRefused(createWorkoutPost(db, USER_ID, 'nope', 'wod'), 'workout-missing');
    await expectRefused(
      createWorkoutPost(db, USER_ID, 'a0000000-0000-4000-8000-000000000003', 'wod'),
      'workout-unfinished',
    );
    await expectRefused(createWorkoutPost(db, USER_ID, WORKOUT.id, 'not-a-flair'), 'unknown-flair');
    expect(await db.getFirstAsync('select count(*) as n from posts')).toEqual({ n: 0 });
    expect(await outboxSize(db)).toBe(0);
  });

  it('the device table itself refuses a second post of one workout (the last backstop)', async () => {
    const db = await phoneWithFinishedWorkout();
    await createWorkoutPost(db, USER_ID, WORKOUT.id, 'wod');
    await expect(
      db.runAsync(
        "insert into posts (id, user_id, flair_id, workout_id, visibility, created_at, updated_at) values ('x', ?, 'wod', ?, 'public', 't', 't')",
        [USER_ID, WORKOUT.id],
      ),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe('hasPostForWorkout', () => {
  it('is false before posting', async () => {
    const db = await phoneWithFinishedWorkout();
    expect(await hasPostForWorkout(db, WORKOUT.id)).toBe(false);
  });
});
