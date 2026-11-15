/**
 * Tests for the own-profile warm cache (B25): survives a relaunch, kept per account, damaged
 * copies read as nothing, and a failing store never throws.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  getCachedOwnProfile,
  loadOwnProfile,
  ownProfileKey,
  parseOwnProfile,
  resetOwnProfileCache,
  saveOwnProfile,
  type OwnProfileStorage,
} from './ownProfileCache';

/** An in-memory store, standing in for the phone's key-value store. */
function memoryStorage(): OwnProfileStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value);
    },
  };
}

const SAM = { username: 'sam', displayName: 'Sam', bio: 'Squats.', avatarPath: 'u1/a.jpg' };

beforeEach(() => resetOwnProfileCache());

describe('ownProfileCache', () => {
  it('comes back after a relaunch, and only for the same account', async () => {
    const storage = memoryStorage();
    saveOwnProfile('u1', SAM, storage);
    await Promise.resolve();
    resetOwnProfileCache();
    expect(getCachedOwnProfile('u1')).toBeNull();
    expect(await loadOwnProfile('u1', storage)).toEqual(SAM);
    expect(await loadOwnProfile('u2', storage)).toBeNull();
    expect([...storage.items.keys()]).toEqual([ownProfileKey('u1')]);
  });

  it('reads a missing, damaged or old-version copy as nothing', () => {
    expect(parseOwnProfile(null)).toBeNull();
    expect(parseOwnProfile('{not json')).toBeNull();
    expect(parseOwnProfile(JSON.stringify({ version: 99, username: 'x' }))).toBeNull();
    expect(parseOwnProfile(JSON.stringify({ version: 1, username: 7, displayName: 'Ok' }))).toEqual({
      username: null,
      displayName: 'Ok',
      bio: null,
      avatarPath: null,
    });
  });

  it('shrugs off a store that fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: OwnProfileStorage = {
      getItem: async () => {
        throw new Error('disk');
      },
      setItem: async () => {
        throw new Error('disk');
      },
    };
    expect(await loadOwnProfile('u1', broken)).toBeNull();
    saveOwnProfile('u1', SAM, broken);
    expect(getCachedOwnProfile('u1')).toEqual(SAM);
    await Promise.resolve();
    warn.mockRestore();
  });
});
