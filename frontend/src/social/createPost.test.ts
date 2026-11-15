/**
 * Tests for making a post on the phone, on real SQLite: a workout post (B21) — one row and one
 * outbox line in one transaction, the workout's visibility copied — and a photo post (B22) — the
 * photo checked and copied first, progress pics born private — with every refusal saving nothing.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { onLocalWrite, writeLocal, type FlairRow } from '@/db/dao';
import { replaceFlairsTx } from '@/db/flairs';
import { outboxSize, pendingRows } from '@/sync/outbox';
import { FakePostImageFiles } from '@/test-utils/fakePostImageFiles';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { OTHER_USER_ID, USER_ID, WORKOUT } from '@/test-utils/workoutFixtures';

import { createImagePost, createWorkoutPost, hasPostForWorkout, PostRefusedError } from './createPost';
import { MAX_POST_IMAGE_BYTES } from './mediaLimits';
import { localPostImageUri } from './postImages';

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
      kind: 'workout',
      workout_id: WORKOUT.id,
      image_path: null,
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

describe('createImagePost (B22)', () => {
  const JPEG = { uri: 'file:///cache/picked.jpg', byteSize: 2_000_000, mimeType: 'image/jpeg' };

  /** A phone with the flair list synced (the two photo flairs among them) and nothing queued. */
  async function phone() {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.withTransactionAsync((tx) =>
      replaceFlairsTx(tx, [...FLAIRS, { id: 'physique-check', name: 'Physique Check', position: 3, upvotes_only: true }]),
    );
    return db;
  }

  it('a progress pic is born private, wears Physique Check, names a photo in the lifter’s own folder, and is queued once', async () => {
    const db = await phone();
    const files = new FakePostImageFiles();
    const post = await createImagePost(db, USER_ID, 'progress-pic', JPEG, {
      now: NOW,
      newId: () => POST_ID,
      saveImage: files.save,
    });
    expect(post).toEqual({
      id: POST_ID,
      user_id: USER_ID,
      flair_id: 'physique-check',
      kind: 'progress-pic',
      workout_id: null,
      image_path: `${USER_ID}/${POST_ID}.jpg`,
      visibility: 'private',
      created_at: NOW,
      updated_at: NOW,
    });
    expect(await db.getAllAsync('select * from posts')).toEqual([post]);
    expect(await pendingRows(db, 'posts')).toEqual([{ rowId: POST_ID, mark: expect.any(Number) }]);
    // The picked photo was copied into the waiting folder, under the post's id.
    expect([...files.files.entries()]).toEqual([[localPostImageUri(post.image_path!), JPEG.uri]]);
  });

  it('a PR photo is public and wears New PR; a PNG keeps its format', async () => {
    const db = await phone();
    const files = new FakePostImageFiles();
    const post = await createImagePost(db, USER_ID, 'pr', { ...JPEG, mimeType: 'image/png' }, {
      newId: () => POST_ID,
      saveImage: files.save,
    });
    expect(post).toMatchObject({ kind: 'pr', flair_id: 'new-pr', visibility: 'public', image_path: `${USER_ID}/${POST_ID}.png` });
  });

  it('refuses an over-limit photo with the lifter-facing message, copying and saving nothing', async () => {
    const db = await phone();
    const files = new FakePostImageFiles();
    const attempt = createImagePost(db, USER_ID, 'pr', { ...JPEG, byteSize: MAX_POST_IMAGE_BYTES + 1 }, { saveImage: files.save });
    await expectRefused(attempt, 'image-refused');
    await expect(attempt).rejects.toThrow('This photo is 10.1 MB — the limit is 10 MB. Choose a smaller photo.');
    expect(files.files.size).toBe(0);
    expect(await outboxSize(db)).toBe(0);
  });

  it('refuses when the flair list hasn’t synced (unknown-flair), and saves nothing when the copy fails', async () => {
    const bare = await prepareDatabase(createNodeSqliteDriver());
    const files = new FakePostImageFiles();
    await expectRefused(createImagePost(bare, USER_ID, 'pr', JPEG, { saveImage: files.save }), 'unknown-flair');
    expect(files.files.size).toBe(0);

    const db = await phone();
    files.failSaves = true;
    await expect(createImagePost(db, USER_ID, 'pr', JPEG, { saveImage: files.save })).rejects.toThrow('disk full');
    expect(await db.getFirstAsync('select count(*) as n from posts')).toEqual({ n: 0 });
    expect(await outboxSize(db)).toBe(0);
  });

  it('any number of photo posts fit on the phone (no workout, so the one-per-workout rule doesn’t apply)', async () => {
    const db = await phone();
    const files = new FakePostImageFiles();
    await createImagePost(db, USER_ID, 'pr', JPEG, { saveImage: files.save });
    await createImagePost(db, USER_ID, 'progress-pic', JPEG, { saveImage: files.save });
    expect(await db.getFirstAsync('select count(*) as n from posts')).toEqual({ n: 2 });
  });

  it('tells the sync engine once the post is saved', async () => {
    const db = await phone();
    const heard = jest.fn();
    const stop = onLocalWrite(db, heard);
    await createImagePost(db, USER_ID, 'pr', JPEG, { saveImage: new FakePostImageFiles().save });
    stop();
    expect(heard).toHaveBeenCalledWith('posts');
  });
});

describe('hasPostForWorkout', () => {
  it('is false before posting', async () => {
    const db = await phoneWithFinishedWorkout();
    expect(await hasPostForWorkout(db, WORKOUT.id)).toBe(false);
  });
});
