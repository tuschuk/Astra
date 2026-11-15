/**
 * Where a photo post's picture lives — on the phone while it waits to upload, and on the server
 * once it has (B22). Every touch of the phone's file system for post photos goes through here,
 * so the rest of the app (and its tests) deal with one small module, not the native file APIs.
 *
 * The picture's journey:
 *   1. The lifter picks a photo. The picker hands back a file in a cache folder the phone may
 *      empty whenever it likes — too fragile for an upload that might wait days for signal. So
 *      `savePostImageLocally` copies it into the app's own documents folder, under
 *      `post-images/<post_id>.<ext>`, where it stays until uploaded.
 *   2. The sync engine uploads it to the server's private `post-images` bucket at
 *      `<user_id>/<post_id>.<ext>` (the "object path" — the owner's folder first, so the
 *      server's storage rules can tell whose it is). Uploading the same path twice replaces the
 *      file, so a retry can never make a duplicate. See `pushPostsPhase` in sync/push.ts.
 *   3. Once the server has it, the phone's copy is deleted (`localPostImageFiles.remove`).
 *   4. The feed shows it from the server with `postImageSource`: an address that only answers
 *      when the request carries the viewer's sign-in token, so the server's rules decide, photo
 *      by photo, who may see it. There are no public links to leak.
 *
 * Built on `expo-file-system/legacy` — the namespace of this Expo SDK that still has
 * `documentDirectory`, `copyAsync` and `uploadAsync`.
 */
import * as FileSystem from 'expo-file-system/legacy';

import type { SupabaseConfig } from '@/lib/supabase';

import { extensionFor, type PostImageMimeType } from './mediaLimits';

/** The server's storage bucket for post photos (`…_post_images.sql`). */
export const POST_IMAGES_BUCKET = 'post-images';

/** The folder inside the app's documents where photos wait for upload. */
function localFolder(): string {
  return `${FileSystem.documentDirectory ?? ''}post-images/`;
}

/**
 * The photo's path in the server bucket: `<user_id>/<post_id>.<ext>`. The owner's id comes
 * first because the server's rules read the first folder as "whose photo this is"; the post id
 * makes it unique and stable, so a retried upload lands on the same file.
 */
export function postImageObjectPath(userId: string, postId: string, mimeType: PostImageMimeType): string {
  return `${userId}/${postId}.${extensionFor(mimeType)}`;
}

/**
 * Where on the phone the photo for object path `imagePath` waits to upload: the app's documents
 * folder, `post-images/<post_id>.<ext>`. Worked out from the path, not stored, so the phone's
 * `posts` table stays the exact shape of the server's.
 */
export function localPostImageUri(imagePath: string): string {
  const fileName = imagePath.slice(imagePath.lastIndexOf('/') + 1);
  return `${localFolder()}${fileName}`;
}

/**
 * Copies the picked photo at `sourceUri` into the phone's waiting folder for `imagePath`
 * (making the folder if needed) and returns where it now is. Throws if the copy fails — the
 * caller then saves no post, so there is never a post without its photo.
 */
export async function savePostImageLocally(sourceUri: string, imagePath: string): Promise<string> {
  const target = localPostImageUri(imagePath);
  await FileSystem.makeDirectoryAsync(localFolder(), { intermediates: true });
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

/**
 * The size in bytes of the file at `uri`, or null if it can't be read — the fallback for the
 * size check when the photo picker didn't report one.
 */
export async function fileSizeOf(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * The two file questions the upload asks — does the waiting copy still exist, and remove it
 * once uploaded. An interface so the sync tests can hand in an in-memory version.
 */
export interface LocalPostImageFiles {
  /** True if a file is at `uri`. */
  exists(uri: string): Promise<boolean>;
  /** Deletes the file at `uri`; a missing file is no error. */
  remove(uri: string): Promise<void>;
}

/** The real phone's files. */
export const localPostImageFiles: LocalPostImageFiles = {
  async exists(uri) {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  },
  async remove(uri) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  },
};

/** The address a photo is uploaded to: Storage's object endpoint for the bucket and path. */
export function postImageUploadUrl(supabaseUrl: string, imagePath: string): string {
  return `${supabaseUrl}/storage/v1/object/${POST_IMAGES_BUCKET}/${imagePath}`;
}

/**
 * The address a photo is shown from: Storage's *authenticated* endpoint, which runs the
 * bucket's read rules as whoever's token comes with the request. (Not a public link: the bucket
 * is private, so this address alone shows nothing.)
 */
export function postImageUrl(supabaseUrl: string, imagePath: string): string {
  return `${supabaseUrl}/storage/v1/object/authenticated/${POST_IMAGES_BUCKET}/${imagePath}`;
}

/** How an `<Image>` fetches a post's photo as the viewer: its address and the sign-in headers. */
export type PostImageSource = { uri: string; headers: Record<string, string> };

/**
 * What an `<Image>` needs to show a post's photo as the signed-in viewer: the authenticated
 * address plus the viewer's token and the project key as request headers. The server checks the
 * token against the photo's post on every fetch. If photos ever fail to show on a real phone,
 * this is the one function to change (to signed links) — see the B22 plan, risk 2.
 */
export function postImageSource(config: SupabaseConfig, imagePath: string, accessToken: string): PostImageSource {
  return {
    uri: postImageUrl(config.url, imagePath),
    headers: { Authorization: `Bearer ${accessToken}`, apikey: config.anonKey },
  };
}

/** What came back from a file upload: the HTTP status and the reply's text. */
export interface UploadReply {
  status: number;
  body: string;
}

/**
 * Sends the file at `fileUri` as the raw body of a POST to `url` with `headers`, streamed by the
 * phone's own networking — the photo is never read into the app's memory, so a 10 MB picture
 * costs nothing on the JavaScript side and the app stays responsive while it goes up. Resolves
 * with the status and body whatever the status (the caller decides what counts as success);
 * throws only when no answer came at all (no signal).
 */
export async function uploadFile(url: string, fileUri: string, headers: Record<string, string>): Promise<UploadReply> {
  const result = await FileSystem.uploadAsync(url, fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers,
  });
  return { status: result.status, body: result.body };
}
