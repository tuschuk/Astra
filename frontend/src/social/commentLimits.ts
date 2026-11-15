/**
 * The rules for a comment's text (SOC-5, B23) — the app's one spelling of them.
 *
 * Why it exists: the server refuses a comment that is empty, only whitespace (spaces, line
 * breaks, tabs), or longer than 500 characters (the CHECK on `comments.body` in
 * `backend/supabase/migrations/…_votes_comments.sql`, tightened by
 * `…_comments_body_not_blank.sql`). That server rule is the law; this module
 * only lets the phone say so *before* the lifter taps Send, instead of sending a doomed request.
 * The number here and in the migration must change together.
 */

/** The longest comment allowed, in characters — the server's CHECK. */
export const COMMENT_MAX_CHARS = 500;

/** How close to the cap the composer starts showing the "n / 500" counter. */
export const COMMENT_COUNTER_FROM = COMMENT_MAX_CHARS - 50;

/** The one sentence shown for a body that is too long. */
export const COMMENT_TOO_LONG = `Comments can be up to ${COMMENT_MAX_CHARS} characters.`;

/** The one sentence shown for a body with nothing in it but whitespace. */
export const COMMENT_EMPTY = 'Write something first.';

/**
 * Judges a comment's text the way the server will.
 * Input: the text as typed. Output: null when it may be sent; otherwise the sentence saying why
 * not — blank (nothing left after trimming whitespace) or over the cap. Like the server, the cap
 * counts the text as typed, spaces included, one per character (an emoji counts once).
 */
export function commentBodyError(body: string): string | null {
  if (body.trim() === '') return COMMENT_EMPTY;
  // Count characters as Postgres does (code points), so an emoji counts once, not twice.
  if ([...body].length > COMMENT_MAX_CHARS) return COMMENT_TOO_LONG;
  return null;
}
