/**
 * The lifter's own profile header, remembered on this phone (B25) — so the You tab shows their
 * name, @username, bio and photo even with no signal.
 *
 * Why this exists: a profile is read from the server (it is the account's public face), but the
 * You tab is the lifter's home and should never open blank on a plane. So each time the own header
 * loads (or is saved on Edit profile), the identity part of it is written here; the next time the
 * You tab opens it shows this copy at once and replaces it with the server's answer when that
 * arrives. Follower counts are NOT kept: a stale number would be a wrong claim, so offline they show
 * a dash instead.
 *
 * Where it is saved: expo-sqlite's key-value store (the same store that keeps the feed settings),
 * under a key carrying the user id — two accounts on one phone never see each other's name. It is
 * a warm cache, not a synced table: the server is always the truth (plan G3).
 *
 * Nothing here can crash a screen: a missing or damaged copy reads as "nothing remembered", and a
 * failed save is logged and shrugged off.
 */
import KeyValueStore from 'expo-sqlite/kv-store';

import type { ProfileIdentity } from './profile';

/** The identity part of a profile — what is remembered (the key already says whose). */
export type OwnProfileIdentity = Omit<ProfileIdentity, 'id'>;

/** The saved format's version; a future change of shape bumps it. */
const STORAGE_VERSION = 1;

/** The key one user's copy is saved under. */
export function ownProfileKey(userId: string): string {
  return `astra.social.ownProfile.${userId}`;
}

/** The slice of the key-value store this file uses — swappable in tests. */
export interface OwnProfileStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** A text field from the saved JSON: a string, or null for anything else. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Reads saved JSON back into an identity, or null if nothing usable was saved. Never throws. */
export function parseOwnProfile(json: string | null): OwnProfileIdentity | null {
  if (json == null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const saved = raw as Record<string, unknown>;
  if (saved.version !== STORAGE_VERSION) return null;
  return {
    username: textOrNull(saved.username),
    displayName: textOrNull(saved.displayName),
    bio: textOrNull(saved.bio),
    avatarPath: textOrNull(saved.avatarPath),
  };
}

// The copy as last read or saved during this app session, per user id.
const cache = new Map<string, OwnProfileIdentity>();

/** The copy already in memory for `userId`, or null if this app session hasn't read one. */
export function getCachedOwnProfile(userId: string): OwnProfileIdentity | null {
  return cache.get(userId) ?? null;
}

/** The remembered identity for `userId`: from memory, else from the phone (null if none). */
export async function loadOwnProfile(
  userId: string,
  storage: OwnProfileStorage = KeyValueStore,
): Promise<OwnProfileIdentity | null> {
  const known = cache.get(userId);
  if (known) return known;
  try {
    const parsed = parseOwnProfile(await storage.getItem(ownProfileKey(userId)));
    // A save that landed while storage was being read wins over what was read.
    const settled = cache.get(userId) ?? parsed;
    if (settled) cache.set(userId, settled);
    return settled;
  } catch (error: unknown) {
    console.warn('Own profile: could not read the remembered copy', error);
    return cache.get(userId) ?? null;
  }
}

/** Remembers `identity` for `userId`: in memory at once, on the phone in the background. */
export function saveOwnProfile(
  userId: string,
  identity: OwnProfileIdentity,
  storage: OwnProfileStorage = KeyValueStore,
): void {
  const copy: OwnProfileIdentity = {
    username: identity.username,
    displayName: identity.displayName,
    bio: identity.bio,
    avatarPath: identity.avatarPath,
  };
  cache.set(userId, copy);
  storage
    .setItem(ownProfileKey(userId), JSON.stringify({ version: STORAGE_VERSION, ...copy }))
    .catch((error: unknown) => console.warn('Own profile: could not remember it on this phone', error));
}

/** Forgets every in-memory copy, so the next load reads storage again. Tests only (a "relaunch"). */
export function resetOwnProfileCache(): void {
  cache.clear();
}
