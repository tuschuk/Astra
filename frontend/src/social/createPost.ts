/**
 * Making a post: a finished workout (the last step of Finish → analysis → Post, LOG-7, B21) or a
 * photo — a progress pic or a PR moment (the Share a photo screen, SOC-2, B22).
 *
 * A workout post shares one finished workout to the Home feed, wearing one flair ("WOD", "New
 * PR", …). It links the workout through `workout_id`, and through that same id the workout's
 * analysis too (an analysis's id IS its workout's id), so no second link is needed. A photo post
 * links no workout; it names its picture (`image_path`) instead.
 *
 * Why a post is written on the phone first and uploaded later: lifters post from basement gyms
 * with no signal. So the post is saved on the phone together with its outbox line ("upload
 * this"), in one transaction, and the sync engine sends it when there is a connection — a
 * workout post after its workout, which the server needs first; a photo post after its photo
 * (see `pushPostsPhase` in sync/push.ts). Its id is made here, so a retried upload lands on the
 * same server row.
 */
import { notifyLocalWrite, type ImagePostKind, type PostRow, type WorkoutVisibility } from '@/db/dao';
import type { SqlDriver, SqlExecutor } from '@/db/driver';
import { newUuid } from '@/lib/ids';
import { readProgressPicVisibility } from '@/settings/privacySettings';
import { enqueueTx } from '@/sync/outbox';

import { checkPostImage } from './mediaLimits';
import { postImageObjectPath, savePostImageLocally } from './postImages';

/**
 * Why a post was refused — each one a state the posting screens also guard against.
 * `image-refused` (B22): the photo is over the size limit or in a format the server won't take.
 */
export type PostRefusal = 'workout-missing' | 'workout-unfinished' | 'already-posted' | 'unknown-flair' | 'image-refused';

/**
 * Thrown when a post can't be made; `reason` says why. Nothing was saved. For `image-refused`
 * the message is the sentence to show the lifter (from `mediaLimits.ts`).
 */
export class PostRefusedError extends Error {
  constructor(
    readonly reason: PostRefusal,
    message = `The post was refused: ${reason}`,
  ) {
    super(message);
    this.name = 'PostRefusedError';
  }
}

/** Options for `createWorkoutPost` and `createImagePost`; injectable so tests are repeatable. */
export interface CreatePostOptions {
  /** The current time as ISO-8601 text. */
  now?: string;
  /** Makes the post's id (a random v4 UUID by default). */
  newId?: () => string;
}

/** Options for `createImagePost`: the common ones plus the file copy, replaceable in tests. */
export interface CreateImagePostOptions extends CreatePostOptions {
  /** Copies the picked photo into the phone's waiting folder (`savePostImageLocally` by default). */
  saveImage?: (sourceUri: string, imagePath: string) => Promise<string>;
}

/**
 * Saves a post of workout `workoutId` with flair `flairId` for user `userId`, and queues it for
 * upload — both in ONE transaction, so a saved post is never missing from the upload queue (and a
 * killed app keeps both). Then tells the sync engine, which uploads it soon if there is signal.
 *
 * The post's visibility is copied from the workout, so a followers-only workout makes a
 * followers-only post — the two can never disagree.
 *
 * Refuses (throws `PostRefusedError`, saving nothing) when the workout isn't this user's on this
 * phone, isn't finished, already has a post (one post per workout — this is also what stops a
 * double-tap from posting twice), or the flair isn't on the phone's flair list (the server would
 * refuse such a post forever). Returns the saved post.
 */
export async function createWorkoutPost(
  db: SqlDriver,
  userId: string,
  workoutId: string,
  flairId: string,
  options: CreatePostOptions = {},
): Promise<PostRow> {
  const now = options.now ?? new Date().toISOString();
  const id = (options.newId ?? newUuid)();
  const post = await db.withTransactionAsync(async (tx) => {
    const workout = await tx.getFirstAsync<{ ended_at: string | null; visibility: WorkoutVisibility }>(
      'select ended_at, visibility from workouts where id = ? and user_id = ?',
      [workoutId, userId],
    );
    if (!workout) throw new PostRefusedError('workout-missing');
    if (workout.ended_at === null) throw new PostRefusedError('workout-unfinished');
    if (await hasPostForWorkout(tx, workoutId)) throw new PostRefusedError('already-posted');
    if (!(await flairExists(tx, flairId))) throw new PostRefusedError('unknown-flair');

    const row: PostRow = {
      id,
      user_id: userId,
      flair_id: flairId,
      kind: 'workout',
      workout_id: workoutId,
      image_path: null,
      visibility: workout.visibility,
      created_at: now,
      updated_at: now,
    };
    await insertPostTx(tx, row, now);
    return row;
  });
  notifyLocalWrite(db, ['posts']);
  return post;
}

/** A photo the lifter picked: where the picker left it, and its size and format as reported. */
export interface PickedImage {
  /** The picker's file address (a cache the phone may empty — hence the copy). */
  uri: string;
  /** Size in bytes, or null if the picker couldn't say. */
  byteSize: number | null;
  /** Format, e.g. "image/jpeg", or null if unknown. */
  mimeType: string | null;
}

/**
 * The flair each photo post kind is born wearing (B22). Flair ids are stable data slugs (the
 * names stay in the server's `flairs` table, SOC-3): a progress pic wears Physique Check, a PR
 * photo wears New PR. Who sees the post is decided separately (`imagePostVisibility`).
 */
export const IMAGE_POST_DEFAULTS: Record<ImagePostKind, { flairId: string }> = {
  'progress-pic': { flairId: 'physique-check' },
  pr: { flairId: 'new-pr' },
};

/**
 * Who a new photo post of kind `kind` is shown to (B26):
 *   - a PR photo — public, as it has been since B22;
 *   - a progress pic — the lifter's own choice in Settings → Privacy, read from the phone so it
 *     works with no signal; 'private' until they choose otherwise (the sensitive-class default,
 *     CLAUDE.md's privacy rule).
 * Either way, the post can be changed afterwards on its card (`social/postPrivacy.ts`), and the
 * server's row-level security is what actually enforces it.
 */
export async function imagePostVisibility(db: SqlExecutor, userId: string, kind: ImagePostKind): Promise<WorkoutVisibility> {
  return kind === 'pr' ? 'public' : readProgressPicVisibility(db, userId);
}

/**
 * Saves a photo post of kind `kind` (a progress pic or a PR photo) for user `userId` and queues
 * it for upload, so it goes up in the background — on the next sync, with signal — while the
 * lifter carries on using the app. Returns the saved post.
 *
 * Steps, in an order chosen so a killed app never leaves a post without its photo:
 *   1. checks the photo against the limits (size, format — `checkPostImage`; the screen checks
 *      first, this is the module's own guarantee) and that the kind's flair is on the phone;
 *   2. copies the photo into the phone's waiting folder (a kill here leaves only a stray file);
 *   3. in ONE transaction saves the post row — no workout, `image_path` in the lifter's own
 *      server folder, the kind's flair, and the visibility from `imagePostVisibility` (for a
 *      progress pic, the lifter's Settings choice) — and its outbox line;
 *   4. tells the sync engine.
 *
 * Refuses (throws `PostRefusedError`, saving nothing): `image-refused` with the lifter-facing
 * sentence for an over-limit or unsupported photo; `unknown-flair` if the flair list hasn't
 * synced. A failed copy throws the file system's error, also saving nothing.
 */
export async function createImagePost(
  db: SqlDriver,
  userId: string,
  kind: ImagePostKind,
  image: PickedImage,
  options: CreateImagePostOptions = {},
): Promise<PostRow> {
  const check = checkPostImage(image);
  if (!check.ok) throw new PostRefusedError('image-refused', check.message);
  const { flairId } = IMAGE_POST_DEFAULTS[kind];
  if (!(await flairExists(db, flairId))) throw new PostRefusedError('unknown-flair');
  const visibility = await imagePostVisibility(db, userId, kind);

  const now = options.now ?? new Date().toISOString();
  const id = (options.newId ?? newUuid)();
  const imagePath = postImageObjectPath(userId, id, check.mimeType);
  await (options.saveImage ?? savePostImageLocally)(image.uri, imagePath);

  const row: PostRow = {
    id,
    user_id: userId,
    flair_id: flairId,
    kind,
    workout_id: null,
    image_path: imagePath,
    visibility,
    created_at: now,
    updated_at: now,
  };
  await db.withTransactionAsync((tx) => insertPostTx(tx, row, now));
  notifyLocalWrite(db, ['posts']);
  return row;
}

/** Inserts one post row and its outbox line, inside an already-open transaction. */
async function insertPostTx(tx: SqlExecutor, row: PostRow, now: string): Promise<void> {
  await tx.runAsync(
    'insert into posts (id, user_id, flair_id, kind, workout_id, image_path, visibility, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      row.id,
      row.user_id,
      row.flair_id,
      row.kind,
      row.workout_id,
      row.image_path,
      row.visibility,
      row.created_at,
      row.updated_at,
    ],
  );
  await enqueueTx(tx, 'posts', row.id, now);
}

/** True if flair `flairId` is on the phone's copy of the flair list. */
async function flairExists(db: SqlExecutor, flairId: string): Promise<boolean> {
  return (await db.getFirstAsync<{ id: string }>('select id from flairs where id = ?', [flairId])) !== null;
}

/**
 * True if this phone holds a post of workout `workoutId` — the Post step's "already posted?"
 * check, so a re-entered flow offers no second post.
 */
export async function hasPostForWorkout(db: SqlExecutor, workoutId: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>('select id from posts where workout_id = ?', [workoutId]);
  return row !== null;
}
