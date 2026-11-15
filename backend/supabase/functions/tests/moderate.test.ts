/**
 * Tests for the `moderate` server function's decisions (B27, NFR-7 — "content/accounts can be
 * removed"; step DoD "the founder can remove a post"). The database and storage are an in-memory
 * fake that records every write in order, so each test can pin exactly what was removed — and
 * that nothing is removed for a request that should be refused. Nothing touches the real project.
 */
import { describe, expect, it } from '@jest/globals';

import {
  handleModerateRequest,
  parseModerateRequest,
  type ModeratedComment,
  type ModeratedPost,
  type ModerateDeps,
} from '../moderate/handler.ts';

const FOUNDER = '11111111-1111-4111-8111-111111111111';
const LIFTER = '22222222-2222-4222-8222-222222222222';
const OTHER_MOD = '33333333-3333-4333-8333-333333333333';
const PHOTO_POST = 'a0000000-0000-4000-8000-000000000001';
const WORKOUT_POST = 'a0000000-0000-4000-8000-000000000002';
const COMMENT = 'c0000000-0000-4000-8000-000000000001';
const MISSING = 'f0000000-0000-4000-8000-00000000000f';

/** A fake world: who moderates, which posts/comments/accounts/files exist, and a log of writes. */
function fakeWorld() {
  const moderators = new Set([FOUNDER, OTHER_MOD]);
  const posts = new Map<string, ModeratedPost>([
    [PHOTO_POST, { id: PHOTO_POST, image_path: `${LIFTER}/${PHOTO_POST}.jpg` }],
    [WORKOUT_POST, { id: WORKOUT_POST, image_path: null }],
  ]);
  const comments = new Map<string, ModeratedComment>([[COMMENT, { id: COMMENT }]]);
  const accounts = new Set([FOUNDER, LIFTER, OTHER_MOD]);
  const files: Record<string, string[]> = {
    'post-images': [`${LIFTER}/${PHOTO_POST}.jpg`, `${LIFTER}/other.png`, `${FOUNDER}/mine.jpg`],
    avatars: [`${LIFTER}/face.jpg`],
  };
  const openReports: { kind: 'post' | 'comment'; target: string }[] = [
    { kind: 'post', target: PHOTO_POST },
    { kind: 'post', target: PHOTO_POST },
    { kind: 'comment', target: COMMENT },
  ];
  const log: string[] = [];

  const deps: ModerateDeps = {
    isModerator: async (id) => moderators.has(id),
    readPost: async (id) => posts.get(id) ?? null,
    deletePost: async (id) => {
      log.push(`delete post ${id}`);
      posts.delete(id);
    },
    readComment: async (id) => comments.get(id) ?? null,
    deleteComment: async (id) => {
      log.push(`delete comment ${id}`);
      comments.delete(id);
    },
    resolveReports: async (kind, target) => {
      const before = openReports.length;
      for (let i = openReports.length - 1; i >= 0; i -= 1) {
        if (openReports[i].kind === kind && openReports[i].target === target) openReports.splice(i, 1);
      }
      log.push(`resolve ${kind} ${target}`);
      return before - openReports.length;
    },
    accountExists: async (id) => accounts.has(id),
    deleteAccount: async (id) => {
      log.push(`delete account ${id}`);
      accounts.delete(id);
    },
    listFolder: async (bucket, folder) => (files[bucket] ?? []).filter((p) => p.startsWith(`${folder}/`)),
    removeObjects: async (bucket, paths) => {
      log.push(`remove ${bucket} ${paths.join(',')}`);
      files[bucket] = files[bucket].filter((p) => !paths.includes(p));
    },
  };
  return { deps, posts, comments, accounts, files, openReports, log };
}

describe('parseModerateRequest', () => {
  it('accepts the three actions with a uuid', () => {
    expect(parseModerateRequest({ action: 'remove-post', targetId: PHOTO_POST })).toEqual({ action: 'remove-post', targetId: PHOTO_POST });
    expect(parseModerateRequest({ action: 'remove-comment', targetId: COMMENT })?.action).toBe('remove-comment');
    expect(parseModerateRequest({ action: 'remove-account', targetId: LIFTER })?.action).toBe('remove-account');
  });

  it('refuses anything else', () => {
    expect(parseModerateRequest(null)).toBeNull();
    expect(parseModerateRequest('remove-post')).toBeNull();
    expect(parseModerateRequest({ action: 'delete-everything', targetId: PHOTO_POST })).toBeNull();
    expect(parseModerateRequest({ action: 'remove-post', targetId: 'not-a-uuid' })).toBeNull();
    expect(parseModerateRequest({ action: 'remove-post' })).toBeNull();
  });
});

describe('handleModerateRequest — refusals', () => {
  it('400 for a malformed request, before anything is read or written', async () => {
    const world = fakeWorld();
    const res = await handleModerateRequest({ action: 'remove-post', targetId: 'x' }, FOUNDER, world.deps);
    expect(res.status).toBe(400);
    expect(world.log).toEqual([]);
  });

  it('403 for a caller who is not a moderator — nothing is removed', async () => {
    const world = fakeWorld();
    for (const action of ['remove-post', 'remove-comment', 'remove-account']) {
      const target = action === 'remove-post' ? PHOTO_POST : action === 'remove-comment' ? COMMENT : FOUNDER;
      const res = await handleModerateRequest({ action, targetId: target }, LIFTER, world.deps);
      expect(res).toEqual({ status: 403, body: { error: 'Moderators only' } });
    }
    expect(world.log).toEqual([]);
    expect(world.posts.size).toBe(2);
  });

  it('404 for a post, comment or account that does not exist', async () => {
    const world = fakeWorld();
    expect((await handleModerateRequest({ action: 'remove-post', targetId: MISSING }, FOUNDER, world.deps)).status).toBe(404);
    expect((await handleModerateRequest({ action: 'remove-comment', targetId: MISSING }, FOUNDER, world.deps)).status).toBe(404);
    expect((await handleModerateRequest({ action: 'remove-account', targetId: MISSING }, FOUNDER, world.deps)).status).toBe(404);
    expect(world.log).toEqual([]);
  });

  it('409 for removing a moderator’s account — including the caller’s own', async () => {
    const world = fakeWorld();
    expect((await handleModerateRequest({ action: 'remove-account', targetId: FOUNDER }, FOUNDER, world.deps)).status).toBe(409);
    expect((await handleModerateRequest({ action: 'remove-account', targetId: OTHER_MOD }, FOUNDER, world.deps)).status).toBe(409);
    expect(world.log).toEqual([]);
    expect(world.accounts.has(FOUNDER)).toBe(true);
  });
});

describe('handleModerateRequest — removals', () => {
  it('remove-post: deletes the row, then its photo, then resolves its open reports', async () => {
    const world = fakeWorld();
    const res = await handleModerateRequest({ action: 'remove-post', targetId: PHOTO_POST }, FOUNDER, world.deps);
    expect(res).toEqual({
      status: 200,
      body: { removed: { kind: 'post', id: PHOTO_POST, photoRemoved: true, reportsResolved: 2 } },
    });
    expect(world.log).toEqual([
      `delete post ${PHOTO_POST}`,
      `remove post-images ${LIFTER}/${PHOTO_POST}.jpg`,
      `resolve post ${PHOTO_POST}`,
    ]);
    // Only that photo — the lifter's other files stay.
    expect(world.files['post-images']).toContain(`${LIFTER}/other.png`);
    // The comment report is untouched.
    expect(world.openReports).toEqual([{ kind: 'comment', target: COMMENT }]);
  });

  it('remove-post on a workout post touches no storage', async () => {
    const world = fakeWorld();
    const res = await handleModerateRequest({ action: 'remove-post', targetId: WORKOUT_POST }, FOUNDER, world.deps);
    expect(res).toEqual({
      status: 200,
      body: { removed: { kind: 'post', id: WORKOUT_POST, photoRemoved: false, reportsResolved: 0 } },
    });
    expect(world.log).toEqual([`delete post ${WORKOUT_POST}`, `resolve post ${WORKOUT_POST}`]);
  });

  it('remove-comment: deletes the comment and resolves its reports', async () => {
    const world = fakeWorld();
    const res = await handleModerateRequest({ action: 'remove-comment', targetId: COMMENT }, FOUNDER, world.deps);
    expect(res).toEqual({ status: 200, body: { removed: { kind: 'comment', id: COMMENT, reportsResolved: 1 } } });
    expect(world.log).toEqual([`delete comment ${COMMENT}`, `resolve comment ${COMMENT}`]);
    expect(world.comments.size).toBe(0);
  });

  it('remove-account: deletes the login, then sweeps both of the lifter’s storage folders', async () => {
    const world = fakeWorld();
    const res = await handleModerateRequest({ action: 'remove-account', targetId: LIFTER }, FOUNDER, world.deps);
    expect(res).toEqual({
      status: 200,
      body: { removed: { kind: 'account', id: LIFTER, accountDeleted: true, filesRemoved: 3 } },
    });
    expect(world.log).toEqual([
      `delete account ${LIFTER}`,
      `remove post-images ${LIFTER}/${PHOTO_POST}.jpg,${LIFTER}/other.png`,
      `remove avatars ${LIFTER}/face.jpg`,
    ]);
    // Someone else's folder is untouched.
    expect(world.files['post-images']).toEqual([`${FOUNDER}/mine.jpg`]);
  });

  it('remove-account asked again after the login is gone still finishes the file sweep', async () => {
    const world = fakeWorld();
    world.accounts.delete(LIFTER); // a first try deleted the login, then storage failed
    const res = await handleModerateRequest({ action: 'remove-account', targetId: LIFTER }, FOUNDER, world.deps);
    expect(res).toEqual({
      status: 200,
      body: { removed: { kind: 'account', id: LIFTER, accountDeleted: false, filesRemoved: 3 } },
    });
    expect(world.log.some((l) => l.startsWith('delete account'))).toBe(false);
  });
});
