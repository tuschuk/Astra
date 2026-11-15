/**
 * The Home feed's remembered settings (B24): which order it reads in — newest first ("Latest")
 * or ranked by votes ("Hot", SOC-11) — and which flair, if any, it is filtered to (SOC-9).
 *
 * Why this exists: the lifter's choice must survive closing the app. Tomorrow's Home opens in
 * the order and on the flair they left it on, with that chip visibly lit, so the filter is never
 * a hidden surprise.
 *
 * Where it is saved: on this phone, in expo-sqlite's key-value store (the same store that keeps
 * the sign-in and the plate rack), as versioned JSON under a key that carries the signed-in
 * user's id — so two accounts on one phone keep separate feeds. It is not synced: nothing asks
 * for the choice to follow the lifter to a second phone (decided in
 * docs/feature_plans/feed-sort-and-filter.md, G1).
 *
 * Nothing here can crash the screen: missing or damaged saved settings fall back to the
 * defaults (Latest, every flair), and a failed save is logged and shrugged off (the worst case
 * is reset settings next launch).
 */
import KeyValueStore from 'expo-sqlite/kv-store';

import type { FeedSort } from './feed';

export type { FeedSort };

/** What Home remembers. */
export interface FeedPrefs {
  sort: FeedSort;
  /**
   * The flair the feed is filtered to, or null for every flair. Kept as an opaque id: whether
   * it still names a real flair is the screen's call against the phone's flair list.
   */
  flairId: string | null;
}

/** A first-time lifter's feed: newest first, every flair. */
export const DEFAULT_FEED_PREFS: FeedPrefs = { sort: 'latest', flairId: null };

/** The saved format's version; a future change of shape bumps it. */
const STORAGE_VERSION = 1;

/** The key one user's settings are saved under. */
export function feedPrefsKey(userId: string): string {
  return `astra.social.feedPrefs.${userId}`;
}

/** The slice of the key-value store this file uses — swappable in tests. */
export interface FeedPrefsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Reads saved JSON back into settings. Input: whatever was stored (null for nothing saved).
 * Output: the settings, with any part that is missing or damaged replaced by its default — a
 * damaged flair never costs the lifter their sort. Never throws.
 */
export function parseFeedPrefs(json: string | null): FeedPrefs {
  if (json == null) return DEFAULT_FEED_PREFS;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return DEFAULT_FEED_PREFS;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_FEED_PREFS;
  const saved = raw as { version?: unknown; sort?: unknown; flairId?: unknown };
  if (saved.version !== STORAGE_VERSION) return DEFAULT_FEED_PREFS;
  return {
    sort: saved.sort === 'hot' || saved.sort === 'latest' ? saved.sort : DEFAULT_FEED_PREFS.sort,
    flairId: typeof saved.flairId === 'string' && saved.flairId !== '' ? saved.flairId : null,
  };
}

/** The settings as the JSON string that gets saved. */
export function serializeFeedPrefs(prefs: FeedPrefs): string {
  return JSON.stringify({ version: STORAGE_VERSION, sort: prefs.sort, flairId: prefs.flairId });
}

// The settings as last loaded or saved during this app session, per user id — so coming back to
// Home shows them at once, and switching accounts can never show the previous account's choice.
const cache = new Map<string, FeedPrefs>();

/** The settings already in memory for `userId`, or null if this app session hasn't read them yet. */
export function getCachedFeedPrefs(userId: string): FeedPrefs | null {
  return cache.get(userId) ?? null;
}

/**
 * The settings to use for `userId`: from memory if already read this session, otherwise from
 * the phone's storage (defaults if nothing is saved, it is damaged, or storage can't be read).
 */
export async function loadFeedPrefs(userId: string, storage: FeedPrefsStorage = KeyValueStore): Promise<FeedPrefs> {
  const known = cache.get(userId);
  if (known) return known;
  let json: string | null = null;
  try {
    json = await storage.getItem(feedPrefsKey(userId));
  } catch (error: unknown) {
    console.warn('Feed settings: could not read the saved settings; using the defaults', error);
  }
  // A choice saved while storage was being read wins over what was read.
  const settled = cache.get(userId) ?? parseFeedPrefs(json);
  cache.set(userId, settled);
  return settled;
}

/**
 * Remembers new settings for `userId`: in memory at once, and on the phone in the background.
 * A failed save is logged, not shown — the choice still holds for this session.
 */
export function saveFeedPrefs(userId: string, prefs: FeedPrefs, storage: FeedPrefsStorage = KeyValueStore): void {
  cache.set(userId, prefs);
  storage.setItem(feedPrefsKey(userId), serializeFeedPrefs(prefs)).catch((error: unknown) => {
    console.warn('Feed settings: could not save them on this phone', error);
  });
}

/** Forgets every in-memory copy, so the next load reads storage again. Tests only (a "relaunch"). */
export function resetFeedPrefsCache(): void {
  cache.clear();
}
