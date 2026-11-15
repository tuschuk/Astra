/**
 * Tests for the Home feed's remembered order and flair (B24): reading saved settings back
 * (including damaged ones), saving then loading through a fake store, one user's settings never
 * leaking to another, and the in-memory copy surviving a storage failure.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  DEFAULT_FEED_PREFS,
  feedPrefsKey,
  getCachedFeedPrefs,
  loadFeedPrefs,
  parseFeedPrefs,
  resetFeedPrefsCache,
  saveFeedPrefs,
  serializeFeedPrefs,
  type FeedPrefsStorage,
} from './feedPrefs';

/** An in-memory stand-in for the phone's key-value store. */
function fakeStorage(): FeedPrefsStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value);
    },
  };
}

/** Lets a fire-and-forget save land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetFeedPrefsCache();
});

describe('parseFeedPrefs', () => {
  it('reads back what was saved', () => {
    expect(parseFeedPrefs(serializeFeedPrefs({ sort: 'hot', flairId: 'form-check' }))).toEqual({
      sort: 'hot',
      flairId: 'form-check',
    });
  });

  it('nothing saved, broken JSON, a wrong version or a non-object → the defaults', () => {
    for (const json of [null, '{oops', '42', 'null', JSON.stringify({ version: 99, sort: 'hot' })]) {
      expect(parseFeedPrefs(json)).toEqual(DEFAULT_FEED_PREFS);
    }
  });

  it('a damaged part falls back alone: a bad sort keeps the flair, a bad flair keeps the sort', () => {
    expect(parseFeedPrefs(JSON.stringify({ version: 1, sort: 'top', flairId: 'wod' }))).toEqual({
      sort: 'latest',
      flairId: 'wod',
    });
    expect(parseFeedPrefs(JSON.stringify({ version: 1, sort: 'hot', flairId: 7 }))).toEqual({ sort: 'hot', flairId: null });
    expect(parseFeedPrefs(JSON.stringify({ version: 1, sort: 'hot', flairId: '' }))).toEqual({ sort: 'hot', flairId: null });
  });
});

describe('loadFeedPrefs / saveFeedPrefs', () => {
  it('a choice saved today is there after a relaunch (step DoD)', async () => {
    const storage = fakeStorage();
    saveFeedPrefs('u1', { sort: 'hot', flairId: 'wod' }, storage);
    await settle();
    resetFeedPrefsCache(); // the app was closed: memory is gone, the phone's store is not
    expect(await loadFeedPrefs('u1', storage)).toEqual({ sort: 'hot', flairId: 'wod' });
  });

  it('keys by user: two accounts on one phone keep separate feeds', async () => {
    const storage = fakeStorage();
    saveFeedPrefs('u1', { sort: 'hot', flairId: 'wod' }, storage);
    await settle();
    expect([...storage.items.keys()]).toEqual([feedPrefsKey('u1')]);
    expect(feedPrefsKey('u1')).toBe('astra.social.feedPrefs.u1');
    resetFeedPrefsCache();
    expect(await loadFeedPrefs('u2', storage)).toEqual(DEFAULT_FEED_PREFS);
    expect(getCachedFeedPrefs('u1')).toBeNull();
    expect(getCachedFeedPrefs('u2')).toEqual(DEFAULT_FEED_PREFS);
  });

  it('serves the in-memory copy without touching storage again', async () => {
    const storage = fakeStorage();
    const getItem = jest.spyOn(storage, 'getItem');
    await loadFeedPrefs('u1', storage);
    await loadFeedPrefs('u1', storage);
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('an unreadable store gives the defaults, and a failed save still holds for this session', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: FeedPrefsStorage = {
      getItem: () => Promise.reject(new Error('disk')),
      setItem: () => Promise.reject(new Error('disk')),
    };
    expect(await loadFeedPrefs('u1', broken)).toEqual(DEFAULT_FEED_PREFS);
    saveFeedPrefs('u1', { sort: 'hot', flairId: null }, broken);
    await settle();
    expect(await loadFeedPrefs('u1', broken)).toEqual({ sort: 'hot', flairId: null });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('a choice made while storage was still being read wins over what was read', async () => {
    const storage = fakeStorage();
    storage.items.set(feedPrefsKey('u1'), serializeFeedPrefs({ sort: 'latest', flairId: 'wod' }));
    const loading = loadFeedPrefs('u1', storage);
    saveFeedPrefs('u1', { sort: 'hot', flairId: null }, storage);
    expect(await loading).toEqual({ sort: 'hot', flairId: null });
  });
});
