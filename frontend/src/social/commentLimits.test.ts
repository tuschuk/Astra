/**
 * Tests for the comment rules (B23, SOC-5): the app's copy of the server's CHECK on
 * `comments.body` — 1 to 500 characters, not only spaces.
 */
import { describe, expect, it } from '@jest/globals';

import { COMMENT_EMPTY, COMMENT_MAX_CHARS, COMMENT_TOO_LONG, commentBodyError } from './commentLimits';

describe('commentBodyError', () => {
  it('mirrors the server’s 500-character cap', () => {
    expect(COMMENT_MAX_CHARS).toBe(500);
  });

  it('accepts ordinary text, up to exactly the cap', () => {
    expect(commentBodyError('Strong lockout!')).toBeNull();
    expect(commentBodyError('x'.repeat(COMMENT_MAX_CHARS))).toBeNull();
  });

  it('refuses empty and spaces-only text with the one sentence', () => {
    expect(commentBodyError('')).toBe(COMMENT_EMPTY);
    expect(commentBodyError('    ')).toBe(COMMENT_EMPTY);
    expect(commentBodyError('\n\t ')).toBe(COMMENT_EMPTY);
  });

  it('refuses one character over the cap, counting spaces as the server does', () => {
    expect(commentBodyError('x'.repeat(COMMENT_MAX_CHARS + 1))).toBe(COMMENT_TOO_LONG);
    expect(commentBodyError(` ${'x'.repeat(COMMENT_MAX_CHARS)}`)).toBe(COMMENT_TOO_LONG);
  });

  it('counts an emoji once, as Postgres does (not as two UTF-16 halves)', () => {
    expect(commentBodyError('💪'.repeat(COMMENT_MAX_CHARS))).toBeNull();
    expect(commentBodyError('💪'.repeat(COMMENT_MAX_CHARS + 1))).toBe(COMMENT_TOO_LONG);
  });
});
