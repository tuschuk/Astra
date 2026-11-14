/** Tests for the auth error → friendly message mapping. */
import { describe, expect, it } from '@jest/globals';

import { UNREACHABLE_MESSAGE, friendlyAuthError } from './errors';
import { PASSWORD_TOO_SHORT } from './password';

describe('friendlyAuthError', () => {
  it('maps bad credentials', () => {
    expect(friendlyAuthError({ message: 'Invalid login credentials', code: 'invalid_credentials' })).toMatch(
      /don't match/,
    );
  });

  it('maps an existing account', () => {
    expect(friendlyAuthError({ message: 'User already registered', code: 'user_already_exists' })).toMatch(
      /already exists/,
    );
  });

  it('maps a weak password and names the minimum length', () => {
    expect(friendlyAuthError({ message: 'Password should be at least 6', code: 'weak_password' })).toBe(
      PASSWORD_TOO_SHORT,
    );
  });

  it('maps the signup trigger refusal to neutral copy', () => {
    expect(friendlyAuthError({ message: 'Database error saving new user', status: 500 })).toMatch(
      /couldn't create your account/,
    );
  });

  it('does not treat every message mentioning "fetch" as a network failure', () => {
    expect(friendlyAuthError({ message: 'could not fetch user metadata column' })).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('maps an invalid email address', () => {
    expect(friendlyAuthError({ message: 'Email address is invalid', code: 'email_address_invalid' })).toMatch(
      /doesn't look right/,
    );
  });

  it('maps network failures', () => {
    expect(friendlyAuthError({ message: 'Network request failed', name: 'AuthRetryableFetchError' })).toBe(
      UNREACHABLE_MESSAGE,
    );
    expect(friendlyAuthError({ message: 'TypeError: Failed to fetch' })).toBe(UNREACHABLE_MESSAGE);
  });

  it('maps rate limiting', () => {
    expect(friendlyAuthError({ message: 'slow down', status: 429 })).toMatch(/Too many/);
  });

  it('maps unconfirmed email', () => {
    expect(friendlyAuthError({ message: 'Email not confirmed', code: 'email_not_confirmed' })).toMatch(/Confirm/);
  });

  it('falls back to a generic message', () => {
    expect(friendlyAuthError({ message: 'weird' })).toBe('Something went wrong. Please try again.');
  });
});
