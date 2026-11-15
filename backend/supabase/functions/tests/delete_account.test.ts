/**
 * Tests for the `delete-account` server function's decisions (B32, NFR-6 — "deletion removes
 * account and content"; step DoD "after deletion nothing of the user remains"). Storage and the
 * login are an in-memory fake that logs every write in order, so each test pins exactly what was
 * removed, in what order — and that a refused or failed request removed nothing that matters.
 * (That the database's cascades then remove every row is checked live; see the B32 plan.)
 * Nothing touches the real project.
 */
import { describe, expect, it } from '@jest/globals';

import { handleDeleteAccountRequest, isConfirmed, type DeleteAccountDeps } from '../delete-account/handler.ts';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FOUNDER = '33333333-3333-4333-8333-333333333333';
const CONFIRM = { confirm: 'DELETE' };

/** A fake world: who moderates, which logins and files exist, a write log, and failure switches. */
function fakeWorld() {
  const moderators = new Set([FOUNDER]);
  const accounts = new Set([ME, OTHER, FOUNDER]);
  const files: Record<string, string[]> = {
    'post-images': [`${ME}/a.jpg`, `${ME}/b.png`, `${OTHER}/theirs.jpg`],
    avatars: [`${ME}/face.jpg`, `${FOUNDER}/face.jpg`],
  };
  const log: string[] = [];
  const failRemoveIn = new Set<string>();
  let failDelete = false;

  const deps: DeleteAccountDeps = {
    isModerator: async (id) => moderators.has(id),
    listFolder: async (bucket, folder) => (files[bucket] ?? []).filter((p) => p.startsWith(`${folder}/`)),
    removeObjects: async (bucket, paths) => {
      if (failRemoveIn.has(bucket)) throw new Error(`Removing files from ${bucket} failed: boom`);
      log.push(`remove ${bucket} ${paths.join(',')}`);
      files[bucket] = files[bucket].filter((p) => !paths.includes(p));
    },
    deleteAccount: async (id) => {
      if (failDelete) throw new Error('Deleting the account failed: boom');
      log.push(`delete account ${id}`);
      accounts.delete(id);
    },
  };
  return {
    deps,
    accounts,
    files,
    log,
    failRemoveIn,
    setFailDelete: (v: boolean) => {
      failDelete = v;
    },
  };
}

describe('isConfirmed', () => {
  it('accepts exactly { confirm: "DELETE" }', () => {
    expect(isConfirmed(CONFIRM)).toBe(true);
    expect(isConfirmed({ confirm: 'DELETE', extra: 1 })).toBe(true);
  });

  it('refuses anything else', () => {
    for (const body of [null, undefined, 'DELETE', {}, { confirm: 'delete' }, { confirm: ' DELETE' }, { confirm: true }]) {
      expect(isConfirmed(body)).toBe(false);
    }
  });
});

describe('handleDeleteAccountRequest', () => {
  it('sweeps the caller’s files in both buckets, then deletes their login — in that order', async () => {
    const w = fakeWorld();
    const result = await handleDeleteAccountRequest(CONFIRM, ME, w.deps);
    expect(result).toEqual({ status: 200, body: { deleted: { userId: ME, filesRemoved: 3 } } });
    expect(w.log).toEqual([`remove post-images ${ME}/a.jpg,${ME}/b.png`, `remove avatars ${ME}/face.jpg`, `delete account ${ME}`]);
    expect(w.accounts.has(ME)).toBe(false);
  });

  it('leaves everyone else alone', async () => {
    const w = fakeWorld();
    await handleDeleteAccountRequest(CONFIRM, ME, w.deps);
    expect(w.accounts).toEqual(new Set([OTHER, FOUNDER]));
    expect(w.files['post-images']).toEqual([`${OTHER}/theirs.jpg`]);
    expect(w.files.avatars).toEqual([`${FOUNDER}/face.jpg`]);
  });

  it('counts only the caller’s files, and with none goes straight to the login delete', async () => {
    const w = fakeWorld();
    const result = await handleDeleteAccountRequest(CONFIRM, OTHER, w.deps);
    expect(result).toEqual({ status: 200, body: { deleted: { userId: OTHER, filesRemoved: 1 } } });
    w.files['post-images'] = [];
    w.accounts.add(OTHER);
    w.log.length = 0;
    await handleDeleteAccountRequest(CONFIRM, OTHER, w.deps);
    expect(w.log).toEqual([`delete account ${OTHER}`]);
  });

  it('refuses without the confirmation word, removing nothing', async () => {
    const w = fakeWorld();
    for (const body of [{}, { confirm: 'yes' }, null]) {
      const result = await handleDeleteAccountRequest(body, ME, w.deps);
      expect(result.status).toBe(400);
    }
    expect(w.log).toEqual([]);
    expect(w.accounts.has(ME)).toBe(true);
  });

  it('refuses a moderator with 409, removing nothing', async () => {
    const w = fakeWorld();
    const result = await handleDeleteAccountRequest(CONFIRM, FOUNDER, w.deps);
    expect(result.status).toBe(409);
    expect(w.log).toEqual([]);
    expect(w.accounts.has(FOUNDER)).toBe(true);
    expect(w.files.avatars).toContain(`${FOUNDER}/face.jpg`);
  });

  it('keeps the login when the sweep fails, and a retry finishes the job', async () => {
    const w = fakeWorld();
    w.failRemoveIn.add('avatars');
    await expect(handleDeleteAccountRequest(CONFIRM, ME, w.deps)).rejects.toThrow('Removing files from avatars failed');
    // Half-swept: the post photos went, the avatar didn't, and the login is untouched.
    expect(w.accounts.has(ME)).toBe(true);
    expect(w.log).toEqual([`remove post-images ${ME}/a.jpg,${ME}/b.png`]);

    w.failRemoveIn.clear();
    const retry = await handleDeleteAccountRequest(CONFIRM, ME, w.deps);
    expect(retry).toEqual({ status: 200, body: { deleted: { userId: ME, filesRemoved: 1 } } });
    expect(w.accounts.has(ME)).toBe(false);
    expect([...w.files['post-images'], ...w.files.avatars].some((p) => p.startsWith(ME))).toBe(false);
  });

  it('throws when the login delete fails, so the app sees a retryable error', async () => {
    const w = fakeWorld();
    w.setFailDelete(true);
    await expect(handleDeleteAccountRequest(CONFIRM, ME, w.deps)).rejects.toThrow('Deleting the account failed');
    expect(w.accounts.has(ME)).toBe(true);
    w.setFailDelete(false);
    expect((await handleDeleteAccountRequest(CONFIRM, ME, w.deps)).status).toBe(200);
  });
});
