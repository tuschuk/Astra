/**
 * The on-device copy of the lifter's settings row (`user_settings`, schema version 6, B15;
 * widened at version 10, B26, version 16, B47, and version 17, B48).
 *
 * Why its own module: `user_settings` is shaped unlike the five training tables — one row per
 * user, keyed by `user_id` rather than `id`, and the server lets the phone UPDATE it but never
 * insert it (the row is created with the account). So it skips the generic table machinery in
 * `dao.ts` and keeps its few lines of SQL here, where the settings code (`settings/unitStore.ts`,
 * `settings/privacySettings.ts`, `settings/notificationSettings.ts`, `settings/dmSettings.ts`)
 * and the sync code (`sync/push.ts`, `sync/pull.ts`) can share them without either reaching into
 * the other.
 *
 * The settings that live here:
 *   - `unit` (B15) — kg or lb. Weights themselves are always stored in kg; the unit decides only
 *     how they are shown and typed (conversion lives in `@training-math`);
 *   - `progress_pic_visibility` (B26) — who a NEW progress pic is shown to. Existing posts keep
 *     their own visibility; this is only the starting value (`social/createPost.ts` reads it);
 *   - `dm_policy` (B48) — who may start a direct-message conversation with the lifter: anyone,
 *     or only lifters they follow who follow them back. The server enforces its own copy;
 *   - `notify_follows`, `notify_comments`, `notify_votes`, `notify_team_pushes` (B47) and
 *     `notify_messages` (B48) — the five push-notification switches. The server's `notify`
 *     function reads its own copy of these when it decides whether to send; the phone's copy is
 *     what Settings shows and uploads.
 *
 * Several writers, one row: the lifter changes each setting separately, so a change goes through
 * `patchUserSettingsTx`, which reads the stored row and changes only the named fields — a unit
 * toggle can never quietly reset the privacy choice or a notification switch, or the other way
 * round.
 */
import type { WeightUnit } from '@training-math';

import type { WorkoutVisibility } from './dao';
import type { SqlExecutor } from './driver';

/** The five push-notification switches (B47, B48), column names as the device and server name them. */
export const NOTIFY_FIELDS = [
  'notify_follows',
  'notify_comments',
  'notify_votes',
  'notify_team_pushes',
  'notify_messages',
] as const;

/** One of the five push-notification switches. */
export type NotifyField = (typeof NOTIFY_FIELDS)[number];

/** Who may start a direct-message conversation with the lifter (B48). */
export type DmPolicy = 'anyone' | 'mutual_follows';

/** The settings row, column for column as the device and the server both name them. */
export interface UserSettingsRow {
  user_id: string;
  unit: WeightUnit;
  /** Who a new progress pic is shown to (B26). 'private' unless the lifter chose otherwise. */
  progress_pic_visibility: WorkoutVisibility;
  /** Who may start a conversation with the lifter (B48). 'anyone' unless they chose otherwise. */
  dm_policy: DmPolicy;
  /** Push when someone follows the lifter (B47). */
  notify_follows: boolean;
  /** Push when someone comments on the lifter's post (B47). */
  notify_comments: boolean;
  /** Push when someone upvotes the lifter's post (B47). */
  notify_votes: boolean;
  /** Push when a teammate posts to one of the lifter's Teams (B47). */
  notify_team_pushes: boolean;
  /** Push when someone sends the lifter a direct message (B48). */
  notify_messages: boolean;
  /** When the row last changed (the phone's clock locally; the server's after a download). */
  updated_at: string;
}

/** The fields the lifter can change — what a settings upload carries. */
export type UserSettingsFields = Pick<UserSettingsRow, 'unit' | 'progress_pic_visibility' | 'dm_policy' | NotifyField>;

/** What a lifter with no saved row has: the server's column defaults. */
export const DEFAULT_USER_SETTINGS: UserSettingsFields = {
  unit: 'lb',
  progress_pic_visibility: 'private',
  dm_policy: 'anyone',
  notify_follows: true,
  notify_comments: true,
  notify_votes: true,
  notify_team_pushes: true,
  notify_messages: true,
};

/**
 * Reads a stored unit text back as a unit. Anything that isn't exactly "kg" is treated as
 * pounds, the column's default — the server's CHECK only ever lets 'kg' or 'lb' in, so this
 * only guards against a damaged local file.
 */
export function parseUnit(value: unknown): WeightUnit {
  return value === 'kg' ? 'kg' : 'lb';
}

/**
 * Reads a stored visibility text back as a visibility (B26). Anything unrecognized becomes
 * 'private' — deliberately the strictest value, not the "public" an ordinary default might be:
 * this guards who sees progress pics, so a damaged value must fail closed.
 */
export function parseVisibility(value: unknown): WorkoutVisibility {
  return value === 'public' || value === 'followers' ? value : 'private';
}

/**
 * Reads a stored direct-message policy back (B48). Anything that isn't exactly
 * 'mutual_follows' is 'anyone', the server column's default. Unlike the progress-pic choice this
 * need not fail closed: the phone's copy decides nothing — the server enforces its own — and the
 * server's CHECK only ever lets the two values in.
 */
export function parseDmPolicy(value: unknown): DmPolicy {
  return value === 'mutual_follows' ? 'mutual_follows' : 'anyone';
}

/**
 * Reads a stored notification switch back as on/off (B47). Only an explicit "off" — false from
 * the server, 0 from the phone's SQLite — counts as off; anything else (including a damaged or
 * missing value) is on, the column's default. Why on: the switch exists to stop a notification
 * the lifter asked to stop, so only a value that clearly says "stop" may silence one.
 */
export function parseNotifySwitch(value: unknown): boolean {
  return !(value === false || value === 0 || value === '0');
}

/** The five switches out of a stored or downloaded row, each read with `parseNotifySwitch`. */
export function parseNotifySwitches(row: Partial<Record<NotifyField, unknown>>): Pick<UserSettingsRow, NotifyField> {
  return Object.fromEntries(NOTIFY_FIELDS.map((field) => [field, parseNotifySwitch(row[field])])) as Pick<
    UserSettingsRow,
    NotifyField
  >;
}

/**
 * Exactly the fields a settings upload sends, picked out of a whole row (or a fields object): the
 * one list of settable columns `sync/push.ts` and the Supabase transport both use, so adding a
 * setting can't leave one of them behind and nothing extra (like `user_id`) is ever sent.
 */
export function settableFields(row: UserSettingsFields): UserSettingsFields {
  return {
    unit: row.unit,
    progress_pic_visibility: row.progress_pic_visibility,
    dm_policy: row.dm_policy,
    notify_follows: row.notify_follows,
    notify_comments: row.notify_comments,
    notify_votes: row.notify_votes,
    notify_team_pushes: row.notify_team_pushes,
    notify_messages: row.notify_messages,
  };
}

/** A settings row as SQLite hands it back: texts as stored, the five switches as 0/1 numbers. */
type StoredRow = {
  user_id: string;
  unit: string;
  progress_pic_visibility: string;
  dm_policy: string;
  updated_at: string;
} & Record<NotifyField, number>;

/** Reads user `userId`'s settings row from the phone, or null if none is stored yet. */
export async function readUserSettingsRow(db: SqlExecutor, userId: string): Promise<UserSettingsRow | null> {
  const row = await db.getFirstAsync<StoredRow>(
    `select user_id, unit, progress_pic_visibility, dm_policy, ${NOTIFY_FIELDS.join(', ')}, updated_at ` +
      'from user_settings where user_id = ?',
    [userId],
  );
  return row
    ? {
        user_id: row.user_id,
        unit: parseUnit(row.unit),
        progress_pic_visibility: parseVisibility(row.progress_pic_visibility),
        dm_policy: parseDmPolicy(row.dm_policy),
        ...parseNotifySwitches(row),
        updated_at: row.updated_at,
      }
    : null;
}

/**
 * Saves a whole settings row (insert, or replace every value of the row with the same
 * `user_id`), inside an already-open transaction. Used as-is for a row downloaded from the
 * server (which always arrives whole); a change the lifter makes goes through
 * `patchUserSettingsTx` instead. Does not queue anything for upload.
 */
export async function writeUserSettingsRowTx(tx: SqlExecutor, row: UserSettingsRow): Promise<void> {
  const columns = ['unit', 'progress_pic_visibility', 'dm_policy', ...NOTIFY_FIELDS] as const;
  await tx.runAsync(
    `insert into user_settings (user_id, ${columns.join(', ')}, updated_at) ` +
      `values (?, ${columns.map(() => '?').join(', ')}, ?) ` +
      `on conflict (user_id) do update set ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}, ` +
      'updated_at = excluded.updated_at',
    [
      row.user_id,
      row.unit,
      row.progress_pic_visibility,
      row.dm_policy,
      ...NOTIFY_FIELDS.map((field) => (row[field] ? 1 : 0)),
      row.updated_at,
    ],
  );
}

/**
 * Changes some of user `userId`'s settings, inside an already-open transaction: reads the stored
 * row (the defaults if there is none yet), applies `patch` on top, stamps `now`, and saves the
 * result. Returns the saved row. Fields not named in `patch` keep their stored values — this is
 * what lets the unit toggle, the privacy choices and the notification switches share one row
 * without undoing each other. Does not queue the upload; the caller adds the outbox line in the
 * same transaction.
 */
export async function patchUserSettingsTx(
  tx: SqlExecutor,
  userId: string,
  patch: Partial<UserSettingsFields>,
  now: string,
): Promise<UserSettingsRow> {
  const current = await readUserSettingsRow(tx, userId);
  const row: UserSettingsRow = {
    ...DEFAULT_USER_SETTINGS,
    ...(current ?? {}),
    ...patch,
    user_id: userId,
    updated_at: now,
  };
  await writeUserSettingsRowTx(tx, row);
  return row;
}
