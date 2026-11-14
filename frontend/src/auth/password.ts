/**
 * Password policy shown and checked on the sign-up screen.
 *
 * PASSWORD_MIN_LENGTH mirrors the Supabase project's minimum. 6 is Supabase's
 * default; the B05 build couldn't read the live project setting (see the
 * plan's Deviations), so if the project minimum is raised in the dashboard,
 * raise this to match — the server stays the real enforcement point either way.
 */
export const PASSWORD_MIN_LENGTH = 6;

/** Shown when a password is too short or the server calls it too weak. */
export const PASSWORD_TOO_SHORT = `Your password needs at least ${PASSWORD_MIN_LENGTH} characters.`;
