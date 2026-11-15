/**
 * Tests for the photo limits (NFR-4, B22): the exact boundary, formats, and the refusal wording.
 */
import { describe, expect, it } from '@jest/globals';

import {
  checkAvatarImage,
  checkPostImage,
  extensionFor,
  MAX_AVATAR_BYTES,
  MAX_POST_IMAGE_BYTES,
  mimeTypeForPath,
} from './mediaLimits';

describe('checkAvatarImage (B25)', () => {
  it('is 5 MiB — the avatars bucket’s file_size_limit (5242880) in the B25 migration', () => {
    expect(MAX_AVATAR_BYTES).toBe(5242880);
  });

  it('accepts exactly the cap and refuses one byte over, with the avatar wording', () => {
    expect(checkAvatarImage({ byteSize: MAX_AVATAR_BYTES, mimeType: 'image/png' })).toEqual({ ok: true, mimeType: 'image/png' });
    expect(checkAvatarImage({ byteSize: MAX_AVATAR_BYTES + 1, mimeType: 'image/jpeg' })).toEqual({
      ok: false,
      message: 'This photo is 5.1 MB — profile photos can be up to 5 MB. Choose a smaller photo.',
    });
  });

  it('refuses HEIC and an unreadable size, like post photos', () => {
    expect(checkAvatarImage({ byteSize: 10, mimeType: 'image/heic' }).ok).toBe(false);
    expect(checkAvatarImage({ byteSize: null, mimeType: 'image/jpeg' }).ok).toBe(false);
  });
});

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
