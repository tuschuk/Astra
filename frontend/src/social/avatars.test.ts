/**
 * Tests for the avatar module (B25): object paths in the owner's folder with a fresh name each
 * time, the public address, and the upload / best-effort delete requests (with fake senders —
 * nothing touches the real Storage).
 */
import { describe, expect, it, jest } from '@jest/globals';

import {
  avatarObjectPath,
  avatarObjectUrl,
  avatarPublicUrl,
  deleteAvatar,
  uploadAvatar,
  type FetchFn,
} from './avatars';
import type { UploadReply } from './postImages';

const CONFIG = { url: 'https://proj.supabase.co', anonKey: 'anon-key' };

describe('paths and addresses', () => {
  it('puts the photo in the owner’s folder under a fresh name per upload', () => {
    expect(avatarObjectPath('user-1', 'image/jpeg', 'abc')).toBe('user-1/abc.jpg');
    const a = avatarObjectPath('user-1', 'image/webp');
    const b = avatarObjectPath('user-1', 'image/webp');
    expect(a).toMatch(/^user-1\/[0-9a-f-]{36}\.webp$/);
    expect(a).not.toBe(b);
  });

  it('shows from the public endpoint and writes to the object endpoint', () => {
    expect(avatarPublicUrl(CONFIG.url, 'u/x.png')).toBe('https://proj.supabase.co/storage/v1/object/public/avatars/u/x.png');
    expect(avatarObjectUrl(CONFIG.url, 'u/x.png')).toBe('https://proj.supabase.co/storage/v1/object/avatars/u/x.png');
  });
});

describe('uploadAvatar', () => {
  it('streams the file to the object endpoint as the lifter, with its format', async () => {
    const upload = jest.fn(
      async (_url: string, _file: string, _headers: Record<string, string>): Promise<UploadReply> => ({ status: 200, body: '{}' }),
    );
    await uploadAvatar(CONFIG, 'token', 'file:///pick.jpg', 'u/x.jpg', 'image/jpeg', upload);
    expect(upload).toHaveBeenCalledWith('https://proj.supabase.co/storage/v1/object/avatars/u/x.jpg', 'file:///pick.jpg', {
      Authorization: 'Bearer token',
      apikey: 'anon-key',
      'Content-Type': 'image/jpeg',
    });
  });

  it('throws with the server’s answer when refused (too big, someone else’s folder)', async () => {
    const upload = async (): Promise<UploadReply> => ({ status: 413, body: 'Payload too large' });
    await expect(uploadAvatar(CONFIG, 't', 'file:///a', 'u/x.jpg', 'image/jpeg', upload)).rejects.toThrow(
      'Upload of profile photo failed: 413 Payload too large',
    );
  });
});

describe('deleteAvatar', () => {
  it('sends a DELETE as the lifter and reports success', async () => {
    const send = jest.fn<FetchFn>(async () => ({ ok: true, status: 200 }));
    expect(await deleteAvatar(CONFIG, 'tok', 'u/old.jpg', send)).toBe(true);
    expect(send).toHaveBeenCalledWith('https://proj.supabase.co/storage/v1/object/avatars/u/old.jpg', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok', apikey: 'anon-key' },
    });
  });

  it('never throws — a refusal or a dropped connection is just false', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await deleteAvatar(CONFIG, 't', 'u/x', async () => ({ ok: false, status: 403 }))).toBe(false);
    expect(
      await deleteAvatar(CONFIG, 't', 'u/x', async () => {
        throw new Error('offline');
      }),
    ).toBe(false);
    warn.mockRestore();
  });
});
