/**
 * Tests for where post photos live (B22): the owner-first object path the server's storage rules
 * read, the phone's waiting-file address derived from it, and the authenticated (never public)
 * addresses used to upload and show a photo.
 */
import { describe, expect, it } from '@jest/globals';

import {
  localPostImageUri,
  postImageObjectPath,
  postImageSource,
  postImageUploadUrl,
  postImageUrl,
} from './postImages';

const CONFIG = { url: 'https://proj.supabase.co', anonKey: 'anon' };

describe('postImageObjectPath', () => {
  it('puts the owner’s id first, then the post id with the format’s file ending', () => {
    expect(postImageObjectPath('u1', 'p1', 'image/jpeg')).toBe('u1/p1.jpg');
    expect(postImageObjectPath('u1', 'p1', 'image/webp')).toBe('u1/p1.webp');
  });
});

describe('localPostImageUri', () => {
  it('is the post’s file in the waiting folder — the same for the same path, distinct per post', () => {
    expect(localPostImageUri('u1/p1.jpg')).toMatch(/post-images\/p1\.jpg$/);
    expect(localPostImageUri('u1/p1.jpg')).toBe(localPostImageUri('u1/p1.jpg'));
    expect(localPostImageUri('u1/p2.jpg')).not.toBe(localPostImageUri('u1/p1.jpg'));
  });
});

describe('addresses', () => {
  it('uploads to the bucket’s object endpoint and shows from the authenticated one (no public link)', () => {
    expect(postImageUploadUrl(CONFIG.url, 'u1/p1.jpg')).toBe('https://proj.supabase.co/storage/v1/object/post-images/u1/p1.jpg');
    expect(postImageUrl(CONFIG.url, 'u1/p1.jpg')).toBe(
      'https://proj.supabase.co/storage/v1/object/authenticated/post-images/u1/p1.jpg',
    );
    expect(postImageUrl(CONFIG.url, 'u1/p1.jpg')).not.toContain('/public/');
  });

  it('a photo is fetched with the viewer’s token, so the server’s rules decide', () => {
    expect(postImageSource(CONFIG, 'u1/p1.jpg', 'tok')).toEqual({
      uri: 'https://proj.supabase.co/storage/v1/object/authenticated/post-images/u1/p1.jpg',
      headers: { Authorization: 'Bearer tok', apikey: 'anon' },
    });
  });
});
