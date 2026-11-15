/**
 * Tests for the photo limits (NFR-4, B22): the exact boundary, formats, and the refusal wording.
 */
import { describe, expect, it } from '@jest/globals';

import { checkPostImage, extensionFor, MAX_POST_IMAGE_BYTES, mimeTypeForPath } from './mediaLimits';

describe('checkPostImage', () => {
  it('is 10 MiB — the same number as the bucket’s file_size_limit (10485760)', () => {
    expect(MAX_POST_IMAGE_BYTES).toBe(10485760);
  });

  it('accepts a photo exactly at the limit', () => {
    expect(checkPostImage({ byteSize: MAX_POST_IMAGE_BYTES, mimeType: 'image/jpeg' })).toEqual({
      ok: true,
      mimeType: 'image/jpeg',
    });
  });

  it('refuses a photo one byte over, saying how big it is (rounded UP, so it never looks at the limit) and what the limit is', () => {
    expect(checkPostImage({ byteSize: MAX_POST_IMAGE_BYTES + 1, mimeType: 'image/jpeg' })).toEqual({
      ok: false,
      message: 'This photo is 10.1 MB — the limit is 10 MB. Choose a smaller photo.',
    });
    expect(checkPostImage({ byteSize: 12.34 * 1024 * 1024, mimeType: 'image/png' })).toEqual({
      ok: false,
      message: 'This photo is 12.4 MB — the limit is 10 MB. Choose a smaller photo.',
    });
  });

  it('accepts png and webp, case-insensitively', () => {
    expect(checkPostImage({ byteSize: 1, mimeType: 'image/PNG' })).toEqual({ ok: true, mimeType: 'image/png' });
    expect(checkPostImage({ byteSize: 1, mimeType: 'image/webp' })).toEqual({ ok: true, mimeType: 'image/webp' });
  });

  it('refuses HEIC and unknown formats with a format message', () => {
    for (const mimeType of ['image/heic', 'video/mp4', null]) {
      const result = checkPostImage({ byteSize: 1000, mimeType });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/format/);
    }
  });

  it('refuses a photo whose size is unknown', () => {
    const result = checkPostImage({ byteSize: null, mimeType: 'image/jpeg' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/size/);
  });
});

describe('extensionFor / mimeTypeForPath', () => {
  it('round-trip every allowed format', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp'] as const) {
      expect(mimeTypeForPath(`u/p.${extensionFor(mime)}`)).toBe(mime);
    }
    expect(mimeTypeForPath('u/p.gif')).toBeNull();
  });
});
