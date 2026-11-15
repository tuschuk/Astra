/**
 * The phone's copy of the flair list (`flairs`, schema version 8, B21) — the labels a post can
 * wear ("WOD", "Physique Check", "New PR", "Form Check" today).
 *
 * Why the phone keeps a copy at all: the Post step after Finish shows the flairs as chips, and
 * finishing a workout with no signal is a normal, supported path. A copy downloaded on every sync
 * means the chips are there in a basement gym too. The names always come from these rows, never
 * from words in the app's code, so adding a flair on the server needs no app release (SOC-3).
 *
 * The list is tiny and the server table has no `updated_at` to bookmark, so every download
 * simply replaces the whole copy (`replaceFlairsTx`, called by sync/pull.ts).
 */
import { fromSqlRow, TABLE_COLUMNS, type FlairRow } from './dao';
import type { SqlExecutor } from './driver';

/** Every flair stored on the phone, in picker order (lowest `position` first; empty before the first sync). */
export async function readFlairs(db: SqlExecutor): Promise<FlairRow[]> {
  const columns = (TABLE_COLUMNS.flairs as readonly string[]).join(', ');
  const raw = await db.getAllAsync<Record<string, unknown>>(`select ${columns} from flairs order by position, id`);
  return raw.map((r) => fromSqlRow('flairs', r));
}

/**
 * Replaces the phone's flair list with `rows`, the server's whole list, inside an already-open
 * transaction (so a reader sees the old list or the new one, never half of each). Returns how many
 * rows were saved.
 *
 * An EMPTY list is ignored and the old copy kept: the server always has flairs, so an empty answer
 * can only mean something went wrong on the way (for example a read the security rules filtered),
 * and stale chips are better than none — with none, the Post step can't post.
 */
export async function replaceFlairsTx(tx: SqlExecutor, rows: readonly FlairRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  await tx.runAsync('delete from flairs');
  for (const flair of rows) {
    await tx.runAsync('insert into flairs (id, name, position, upvotes_only) values (?, ?, ?, ?)', [
      flair.id,
      flair.name,
      flair.position,
      flair.upvotes_only ? 1 : 0,
    ]);
  }
  return rows.length;
}
