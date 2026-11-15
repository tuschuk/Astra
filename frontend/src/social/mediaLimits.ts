/**
 * The limits on photos a lifter can post (NFR-4, B22) — the app's one spelling of them.
 *
 * Why it exists: a photo post is uploaded to the server's `post-images` storage bucket, and the
 * bucket itself refuses anything bigger than 10 MiB or in a format other than JPEG, PNG or WebP
 * (`backend/supabase/migrations/…_post_images.sql`). That server rule is the law; this module
 * only lets the phone say so *before* the lifter taps Post, in plain words, instead of letting
 * an upload fail quietly later. The numbers here and in the migration must change together.
 *
 * Why no HEIC (iPhones' own format): many Android phones can't show it, so a HEIC post would be a
 * broken picture for half the feed. The photo picker is set to re-encode iPhone photos to JPEG
 * (see app/new-post.tsx); if one ever slips through unconverted, it is refused here by format.
 */

/** The biggest photo a post may carry: 10 MiB (10 × 1024 × 1024 bytes) — the bucket's `file_size_limit`. */
export const MAX_POST_IMAGE_BYTES = 10 * 1024 * 1024;

/** The picture formats a post may carry — the bucket's `allowed_mime_types`. */
export const POST_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** One of the allowed picture formats. */
export type PostImageMimeType = (typeof POST_IMAGE_MIME_TYPES)[number];

/** What the size-and-format check needs to know about a picked photo. */
export interface PostImageFacts {
  /** The photo's size in bytes, or null when the phone couldn't tell. */
  byteSize: number | null;
  /** The photo's format as a MIME type ("image/jpeg"), or null when unknown. */
  mimeType: string | null;
}

/** The answer of `checkPostImage`: fine (with its format), or refused with the message to show. */
export type PostImageCheck = { ok: true; mimeType: PostImageMimeType } | { ok: false; message: string };

/**
 * Shows a byte count as megabytes (1 MB = 1024 × 1024 bytes here, the bucket's own unit) with one
 * decimal, ROUNDED UP — so a photo even one byte over the limit reads "10.1 MB", never a
 * contradictory "10.0 MB — the limit is 10 MB".
 */
function megabytes(bytes: number): string {
  return `${(Math.ceil((bytes / (1024 * 1024)) * 10) / 10).toFixed(1)} MB`;
}

/**
 * Decides whether a picked photo may be posted: at most `MAX_POST_IMAGE_BYTES`, and one of the
 * allowed formats. Exactly at the limit is fine; one byte over is refused.
 *
 * Input: the photo's size and format (either may be unknown). Output: `{ ok: true, mimeType }`,
 * or `{ ok: false, message }` with the sentence the screen shows — shared with the tests so the
 * wording lives in one place. An unknown size is refused too: the phone can't promise the server
 * will take it, and a post that can never upload is worse than a clear "try another photo".
 */
export function checkPostImage({ byteSize, mimeType }: PostImageFacts): PostImageCheck {
  const format = POST_IMAGE_MIME_TYPES.find((m) => m === mimeType?.toLowerCase());
  if (!format) {
    return { ok: false, message: 'This photo’s format isn’t supported — choose a JPEG, PNG or WebP photo.' };
  }
  if (byteSize === null || !Number.isFinite(byteSize) || byteSize < 0) {
    return { ok: false, message: 'This photo’s size couldn’t be read — try choosing it again, or pick another.' };
  }
  if (byteSize > MAX_POST_IMAGE_BYTES) {
    return {
      ok: false,
      message: `This photo is ${megabytes(byteSize)} — the limit is ${MAX_POST_IMAGE_BYTES / (1024 * 1024)} MB. Choose a smaller photo.`,
    };
  }
  return { ok: true, mimeType: format };
}

/** The file ending a photo of this format is saved under ("jpg", "png", "webp"). */
export function extensionFor(mimeType: PostImageMimeType): string {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
}

/** The format a saved photo has, read back from its file ending — the inverse of `extensionFor`. */
export function mimeTypeForPath(path: string): PostImageMimeType | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}
