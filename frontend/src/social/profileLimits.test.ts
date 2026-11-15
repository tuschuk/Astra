/**
 * Tests for the profile text rules (B25): the same limits as the server's `profiles` CHECKs,
 * trimming, empty-means-unset, and a set username that can be changed but not cleared.
 */
import { describe, expect, it } from '@jest/globals';

import { checkProfileText, MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH, PROFILE_FIELD_MESSAGES } from './profileLimits';

describe('checkProfileText', () => {
  it('trims, and saves empty boxes as unset', () => {
    expect(checkProfileText({ displayName: '  Sam  ', bio: '   ', username: ' sam_lifts ' }, false)).toEqual({
      ok: true,
      values: { displayName: 'Sam', bio: null, username: 'sam_lifts' },
    });
  });

  it('accepts exactly the limits and refuses one character over, counting an emoji as one', () => {
    const atName = 'a'.repeat(MAX_DISPLAY_NAME_LENGTH - 1) + '💪';
    const atBio = 'b'.repeat(MAX_BIO_LENGTH);
    expect(checkProfileText({ displayName: atName, bio: atBio, username: '' }, false).ok).toBe(true);
    expect(checkProfileText({ displayName: `${atName}x`, bio: `${atBio}x`, username: '' }, false)).toEqual({
      ok: false,
      errors: { displayName: PROFILE_FIELD_MESSAGES.displayName, bio: PROFILE_FIELD_MESSAGES.bio },
    });
  });

  it('holds usernames to the server’s pattern', () => {
    for (const bad of ['ab', 'a'.repeat(31), 'has space', 'dash-y', 'émile']) {
      expect(checkProfileText({ displayName: '', bio: '', username: bad }, false)).toEqual({
        ok: false,
        errors: { username: PROFILE_FIELD_MESSAGES.username },
      });
    }
    expect(checkProfileText({ displayName: '', bio: '', username: 'Big_Lifter_99' }, false).ok).toBe(true);
  });

  it('lets a first-timer leave the username empty, but never clears a set one', () => {
    expect(checkProfileText({ displayName: '', bio: '', username: '' }, false).ok).toBe(true);
    expect(checkProfileText({ displayName: '', bio: '', username: '  ' }, true)).toEqual({
      ok: false,
      errors: { username: PROFILE_FIELD_MESSAGES.usernameRequired },
    });
  });
});
