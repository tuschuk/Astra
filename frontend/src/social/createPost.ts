/**
 * Making a workout post — the last step of Finish → analysis → Post (LOG-7, B21).
 *
 * A post shares one finished workout to the Home feed, wearing one flair ("WOD", "New PR", …). It
 * links the workout through `workout_id`, and through that same id the workout's analysis too
 * (an analysis's id IS its workout's id), so no second link is needed.
 *
 * Why the post is written on the phone first and uploaded later: lifters finish in basement gyms
 * with no signal, and the Post step is offered exactly once, at finish. So the post is saved on the
 * phone together with its outbox line ("upload this"), in one transaction, and the sync engine
 * sends it when there is a connection — after its workout, which the server needs first (see
 * `pushPostsPhase` in sync/push.ts). Its id is made here, so a retried upload lands on the same
 * server row.
 */
import { notifyLocalWrite, type PostRow, type WorkoutVisibility } from '@/db/dao';
import type { SqlDriver, SqlExecutor } from '@/db/driver';
import { newUuid } from '@/lib/ids';
import { enqueueTx } from '@/sync/outbox';

/** Why `createWorkoutPost` refused — each one a state the Post step screen also guards against. */
export type PostRefusal = 'workout-missing' | 'workout-unfinished' | 'already-posted' | 'unknown-flair';

/** Thrown by `createWorkoutPost` when the post can't be made; `reason` says why. Nothing was saved. */
export class PostRefusedError extends Error {
  constructor(readonly reason: PostRefusal) {
    super(`The post was refused: ${reason}`);
    this.name = 'PostRefusedError';
  }
}

/** Options for `createWorkoutPost`; injectable so tests are repeatable. */
export interface CreatePostOptions {
  /** The current time as ISO-8601 text. */
  now?: string;
  /** Makes the post's id (a random v4 UUID by default). */
  newId?: () => string;
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
    const flair = await tx.getFirstAsync<{ id: string }>('select id from flairs where id = ?', [flairId]);
    if (!flair) throw new PostRefusedError('unknown-flair');

    const row: PostRow = {
      id,
      user_id: userId,
      flair_id: flairId,
      workout_id: workoutId,
      visibility: workout.visibility,
      created_at: now,
      updated_at: now,
    };
    await tx.runAsync(
      'insert into posts (id, user_id, flair_id, workout_id, visibility, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
      [row.id, row.user_id, row.flair_id, row.workout_id, row.visibility, row.created_at, row.updated_at],
    );
    await enqueueTx(tx, 'posts', row.id, now);
    return row;
  });
  notifyLocalWrite(db, ['posts']);
  return post;
}

/**
 * True if this phone holds a post of workout `workoutId` — the Post step's "already posted?"
 * check, so a re-entered flow offers no second post.
 */
export async function hasPostForWorkout(db: SqlExecutor, workoutId: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>('select id from posts where workout_id = ?', [workoutId]);
  return row !== null;
}
