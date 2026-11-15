/**
 * Profile photos (YOU-1, B25) — the one home of where an avatar lives and how it gets there.
 *
 * The photo's journey:
 *   1. On Edit profile the lifter picks a picture; `checkAvatarImage` (mediaLimits.ts) checks its
 *      size and format.
 *   2. On Save it is uploaded straight from the phone's file to the server's `avatars` bucket at
 *      `<user_id>/<fresh-uuid>.<ext>` — the owner's folder first, because the bucket's rules only
 *      let you write inside your own folder. Every upload gets a NEW name: the phone caches
 *      pictures by address, so a new address is what makes the new face show everywhere at once
 *      (an overwritten file at the old address would keep showing the old one).
 *   3. The profile row's `avatar_url` is set to that path (the server refuses a path outside the
 *      owner's folder). Then the previous photo is deleted — best effort; a leftover file costs
 *      a little storage, never correctness.
 *   4. Everyone sees it through the bucket's PUBLIC address (`avatarPublicUrl`): an avatar is a
 *      profile's public face, so it needs no sign-in to fetch (unlike post photos, which are
 *      private and fetched as the viewer — see postImages.ts).
 *
 * The network calls take their sender as a parameter so tests hand in a fake.
 */
import type { SupabaseConfig } from '@/lib/supabase';
import { newUuid } from '@/lib/ids';

import { extensionFor, type PostImageMimeType } from './mediaLimits';
import { uploadFile, type UploadReply } from './postImages';

/** The server's storage bucket for profile photos (`…_profile_reads_and_avatars.sql`). */
export const AVATARS_BUCKET = 'avatars';

/**
 * Where a new profile photo goes in the bucket: `<user_id>/<uuid>.<ext>`. `id` is a fresh uuid
 * unless a test passes one, so each upload has its own address (see step 2 above).
 */
export function avatarObjectPath(userId: string, mimeType: PostImageMimeType, id: string = newUuid()): string {
  return `${userId}/${id}.${extensionFor(mimeType)}`;
}

/** The public address a profile photo is shown from (no sign-in needed — the bucket is public). */
export function avatarPublicUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${AVATARS_BUCKET}/${path}`;
}

/** The address a profile photo is uploaded to (and deleted at): Storage's object endpoint. */
export function avatarObjectUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/${AVATARS_BUCKET}/${path}`;
}

/** The sign-in headers Storage needs for a write as the lifter. */
function authHeaders(config: SupabaseConfig, accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, apikey: config.anonKey };
}

/**
 * Uploads the picked photo at `localUri` to `path` as the signed-in lifter, streamed from the file
 * by the phone's own networking (the B22 upload — the picture never sits in the app's memory).
 * Resolves when the server has it; throws with the server's answer otherwise (too big, wrong
 * format, someone else's folder, no signal), so the screen can say it didn't save.
 */
export async function uploadAvatar(
  config: SupabaseConfig,
  accessToken: string,
  localUri: string,
  path: string,
  mimeType: PostImageMimeType,
  upload: (url: string, fileUri: string, headers: Record<string, string>) => Promise<UploadReply> = uploadFile,
): Promise<void> {
  const reply = await upload(avatarObjectUrl(config.url, path), localUri, {
    ...authHeaders(config, accessToken),
    'Content-Type': mimeType,
  });
  if (reply.status < 200 || reply.status >= 300) {
    throw new Error(`Upload of profile photo failed: ${reply.status} ${reply.body}`.trim());
  }
}

/** The slice of `fetch` the delete uses — swappable in tests. */
export type FetchFn = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number }>;

/**
 * Deletes a profile photo the lifter no longer uses. Best effort: never throws; resolves true if
 * the server confirmed. Called for the old photo after a new one is saved, and for a just-uploaded
 * photo whose profile update then failed.
 */
export async function deleteAvatar(
  config: SupabaseConfig,
  accessToken: string,
  path: string,
  send: FetchFn = (url, init) => fetch(url, init),
): Promise<boolean> {
  try {
    const reply = await send(avatarObjectUrl(config.url, path), {
      method: 'DELETE',
      headers: authHeaders(config, accessToken),
    });
    if (!reply.ok) console.warn(`Profile photo cleanup: the server answered ${reply.status}`);
    return reply.ok;
  } catch (error: unknown) {
    console.warn('Profile photo cleanup: the old photo could not be deleted', error);
    return false;
  }
}
