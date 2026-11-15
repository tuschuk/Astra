/**
 * Tests for changing a post's visibility (B26, YOU-5): the one scoped update it sends, the
 * refusals turned into their sentences, and the phone's own copies (post and — the load-bearing
 * one — workout) brought into line with no upload queued. Server-side enforcement itself is
 * probed live as several users (see the plan's Gate 2 probe), not here.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { onLocalWrite, writeLocal } from '@/db/dao';
import { outboxSize } from '@/sync/outbox';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawImagePost, rawPost } from '@/test-utils/feedFixtures';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { USER_ID, WORKOUT } from '@/test-utils/workoutFixtures';

import { toFeedPost } from './feed';
import { POST_VISIBILITY_REFUSAL_MESSAGES, setPostVisibility, visibilityTargetOf, withPostVisibility } from './postPrivacy';

const me = profile(USER_ID, 'me');
const other = profile('someone-else', 'other');
const mine = { ...rawPost({ id: 'p-mine', author: me, createdAt: '2026-11-15T08:00:00.000Z' }), workout_id: WORKOUT.id };
const theirs = rawPost({ id: 'p-theirs', author: other, createdAt: '2026-11-15T08:00:00.000Z' });
const myPic = rawImagePost({ id: 'p-pic', author: me, createdAt: '2026-11-15T08:00:00.000Z', kind: 'progress-pic' });

/** A phone holding the lifter's workout and their post of it. */
async function phone() {
  const db = await prepareDatabase(createNodeSqliteDriver());
  await writeLocal(db, 'workouts', [WORKOUT]);
  await db.runAsync(
    "insert into posts (id, user_id, flair_id, kind, workout_id, image_path, visibility, created_at, updated_at) values ('p-mine', ?, 'wod', 'workout', ?, null, 'public', 't', 't')",
    [USER_ID, WORKOUT.id],
  );
  return db;
}

describe('setPostVisibility', () => {
  it('updates only the lifter’s own post by id, asks for the changed rows back, and reports done', async () => {
    const { client, tables, requests } = createFakeSocialClient({ posts: [mine, theirs] });
    const result = await setPostVisibility(client, null, USER_ID, { id: 'p-mine', workoutId: WORKOUT.id }, 'private');
    expect(result).toEqual({ ok: true });
    expect(requests[0]).toEqual([
      ['from', 'posts'],
      ['update', { visibility: 'private' }],
      ['eq', 'id', 'p-mine'],
      ['eq', 'user_id', USER_ID],
      ['select', 'id'],
    ]);
    expect((tables.posts as { id: string; visibility: string }[]).map((p) => [p.id, p.visibility])).toEqual([
      ['p-mine', 'private'],
      ['p-theirs', 'public'],
    ]);
  });

  it('a post that isn’t the lifter’s (or is gone) changes nothing and says so', async () => {
    const { client, tables } = createFakeSocialClient({ posts: [theirs] });
    const result = await setPostVisibility(client, null, USER_ID, { id: 'p-theirs', workoutId: null }, 'private');
    expect(result).toEqual({ ok: false, reason: 'not-changed' });
    expect((tables.posts[0] as { visibility: string }).visibility).toBe('public');
    expect(POST_VISIBILITY_REFUSAL_MESSAGES['not-changed']).toBe('This post can’t be changed right now.');
  });

  it('no connection is a calm “failed”, never a throw, and the phone is left alone', async () => {
    const db = await phone();
    const { client, setOffline } = createFakeSocialClient({ posts: [mine] });
    setOffline(true);
    const result = await setPostVisibility(client, db, USER_ID, { id: 'p-mine', workoutId: WORKOUT.id }, 'private');
    expect(result).toEqual({ ok: false, reason: 'failed' });
    expect(await db.getFirstAsync('select visibility from workouts')).toEqual({ visibility: 'public' });
  });

  it('a client that throws is also “failed”', async () => {
    const client = {
      from() {
        throw new Error('boom');
      },
    } as unknown as Parameters<typeof setPostVisibility>[0];
    expect(await setPostVisibility(client, null, USER_ID, { id: 'x', workoutId: null }, 'public')).toEqual({ ok: false, reason: 'failed' });
  });

  it('on success, the phone’s post AND workout copies take the new visibility, with nothing queued to upload', async () => {
    const db = await phone();
    const { client } = createFakeSocialClient({ posts: [mine] });
    const queuedBefore = await outboxSize(db); // the fixture workout's own line, from writeLocal
    await setPostVisibility(client, db, USER_ID, { id: 'p-mine', workoutId: WORKOUT.id }, 'followers');
    expect(await db.getFirstAsync('select visibility from posts')).toEqual({ visibility: 'followers' });
    // The workout copy is what a later offline edit of this workout uploads whole — it must not
    // carry the old 'public' back up.
    expect(await db.getFirstAsync('select visibility from workouts')).toEqual({ visibility: 'followers' });
    expect(await outboxSize(db)).toBe(queuedBefore);
  });

  it('a photo post touches no workout on the phone', async () => {
    const db = await phone();
    const { client } = createFakeSocialClient({ posts: [myPic] });
    expect(await setPostVisibility(client, db, USER_ID, { id: 'p-pic', workoutId: null }, 'public')).toEqual({ ok: true });
    expect(await db.getFirstAsync('select visibility from workouts')).toEqual({ visibility: 'public' });
    expect(await db.getFirstAsync("select visibility from posts where id = 'p-mine'")).toEqual({ visibility: 'public' });
  });

  it('tells phone-reading screens the post and workout changed', async () => {
    const db = await phone();
    const { client } = createFakeSocialClient({ posts: [mine] });
    const heard: string[] = [];
    const unsubscribe = onLocalWrite(db, (tbl) => heard.push(tbl));
    await setPostVisibility(client, db, USER_ID, { id: 'p-mine', workoutId: WORKOUT.id }, 'private');
    expect(heard.sort()).toEqual(['posts', 'workouts']);
    unsubscribe();
  });

  it('a phone copy that can’t be updated still reports the server’s change as done', async () => {
    const db = await phone();
    await db.execAsync('drop table workouts');
    const { client } = createFakeSocialClient({ posts: [mine] });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await setPostVisibility(client, db, USER_ID, { id: 'p-mine', workoutId: WORKOUT.id }, 'private')).toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('visibilityTargetOf and withPostVisibility', () => {
  const workoutCard = toFeedPost(mine);
  const picCard = toFeedPost(myPic);
  if (!workoutCard || !picCard) throw new Error('fixtures should shape');

  it('a workout card targets its workout; a photo card targets none', () => {
    expect(visibilityTargetOf(workoutCard)).toEqual({ id: 'p-mine', workoutId: `workout-p-mine` });
    expect(visibilityTargetOf(picCard)).toEqual({ id: 'p-pic', workoutId: null });
  });

  it('changes only the named post in a list, without touching the original', () => {
    const list = [workoutCard, picCard];
    const changed = withPostVisibility(list, 'p-pic', 'followers');
    expect(changed.map((p) => p.visibility)).toEqual(['public', 'followers']);
    expect(list[1].visibility).toBe('private');
  });
});
