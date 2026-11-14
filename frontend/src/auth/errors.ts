/**
 * Turns Supabase auth errors into plain-language messages for the screens.
 *
 * Why: Supabase's raw messages ("Invalid login credentials", "Database error
 * saving new user") are written for developers. The sign-in and sign-up
 * forms show these friendlier versions instead. Nothing here reveals more
 * than the raw error did.
 */
import { PASSWORD_TOO_SHORT } from './password';

/** The fields of a Supabase AuthError this mapping looks at. */
export interface AuthErrorLike {
  message: string;
  code?: string;
  status?: number;
  name?: string;
}

/** Shown whenever the server can't be reached (no signal, server down). */
export const UNREACHABLE_MESSAGE = "Can't reach Astra right now. Check your connection and try again.";

/**
 * Input: an error returned by supabase-js auth calls.
 * Output: a short sentence fit to show the user.
 */
export function friendlyAuthError(error: AuthErrorLike): string {
  const code = error.code ?? '';
  const message = error.message.toLowerCase();

  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return "That email and password don't match an account.";
  }
  if (code === 'email_not_confirmed') {
    return 'Confirm your email first — check your inbox for the link, then sign in.';
  }
  if (code === 'user_already_exists' || code === 'email_exists' || message.includes('already registered')) {
    return 'An account with that email already exists. Try signing in instead.';
  }
  if (code === 'weak_password') {
    return PASSWORD_TOO_SHORT;
  }
  if (code === 'email_address_invalid') {
    return "That email address doesn't look right.";
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || error.status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  // The signup trigger refused the account. The app's age gate already
  // catches under-18 birthdates before sending, so this is most likely some
  // other server-side failure — keep the copy neutral rather than guess.
  if (message.includes('database error saving new user')) {
    return "We couldn't create your account. Check your details and try again.";
  }
  if (
    error.name === 'AuthRetryableFetchError' ||
    message.includes('network request failed') ||
    message.includes('failed to fetch')
  ) {
    return UNREACHABLE_MESSAGE;
  }
  return 'Something went wrong. Please try again.';
}
