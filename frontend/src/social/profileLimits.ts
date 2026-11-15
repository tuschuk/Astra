/**
 * The rules for what a lifter may type on their profile (YOU-1, B25) — the app's one spelling of
 * them.
 *
 * Why it exists: the server's `profiles` table refuses a display name over 50 characters, a bio
 * over 300, and a username that isn't 3–30 letters, digits or underscores (the CHECKs in
 * `backend/supabase/migrations/20261114100000_identity.sql`). Those CHECKs are the law; this file
 * only lets the Edit profile screen say so next to the box, in plain words, before Save. The
 * numbers here and in that migration must change together.
 */

/** The longest display name the server accepts (characters). */
export const MAX_DISPLAY_NAME_LENGTH = 50;

/** The longest bio the server accepts (characters). */
export const MAX_BIO_LENGTH = 300;

/** A username: 3–30 letters, digits or underscores — the server's CHECK, exactly. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;

/** The field-level messages, shared by the screen and its tests. */
export const PROFILE_FIELD_MESSAGES = {
  displayName: `Keep your name to ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`,
  bio: `Keep your bio to ${MAX_BIO_LENGTH} characters or fewer.`,
  username: 'Usernames are 3–30 letters, numbers or underscores.',
  usernameRequired: 'Your username can be changed, but not removed.',
  usernameTaken: 'That username is taken.',
} as const;

/** The three text boxes on the Edit profile screen, as typed. */
export interface ProfileTextInput {
  displayName: string;
  bio: string;
  username: string;
}

/** The text as it will be saved: trimmed, with an empty box saved as "not set" (null). */
export interface ProfileTextValues {
  displayName: string | null;
  bio: string | null;
  username: string | null;
}

/** Which box a message belongs under. */
export type ProfileField = 'displayName' | 'bio' | 'username';

/** The check's answer: the values to save, or a message per box that is wrong. */
export type ProfileTextCheck =
  | { ok: true; values: ProfileTextValues }
  | { ok: false; errors: Partial<Record<ProfileField, string>> };

/**
 * Counts characters the way Postgres's `char_length` does (whole characters, so an emoji is one,
 * not two halves) — so "50 characters" here means the same thing as on the server.
 */
function charLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Checks what the lifter typed before it is sent.
 *
 * Inputs: the three boxes, and whether the account already has a username. Output: the trimmed
 * values (an empty box becomes null), or a message for each box that breaks a rule.
 *
 * A username that is already set can be changed but not cleared — every card in the app prints
 * the @handle, so a claimed handle must not silently vanish. A first-time lifter may leave it
 * empty.
 */
export function checkProfileText(input: ProfileTextInput, hasUsername: boolean): ProfileTextCheck {
  const displayName = input.displayName.trim();
  const bio = input.bio.trim();
  const username = input.username.trim();
  const errors: Partial<Record<ProfileField, string>> = {};
  if (charLength(displayName) > MAX_DISPLAY_NAME_LENGTH) errors.displayName = PROFILE_FIELD_MESSAGES.displayName;
  if (charLength(bio) > MAX_BIO_LENGTH) errors.bio = PROFILE_FIELD_MESSAGES.bio;
  if (username === '') {
    if (hasUsername) errors.username = PROFILE_FIELD_MESSAGES.usernameRequired;
  } else if (!USERNAME_PATTERN.test(username)) {
    errors.username = PROFILE_FIELD_MESSAGES.username;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      displayName: displayName === '' ? null : displayName,
      bio: bio === '' ? null : bio,
      username: username === '' ? null : username,
    },
  };
}
