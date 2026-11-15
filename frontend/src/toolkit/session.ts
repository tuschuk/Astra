/**
 * What the Tool Kit remembers while the app is open: the calculator last used and what was
 * typed into each one.
 *
 * Why this exists: the Tool Kit opens as a sheet (a React Native `Modal`) over the logger, and a
 * `Modal` throws away everything inside it each time it closes. Without this record, a lifter
 * who typed their 1RM, closed the sheet to log a set, and opened it again would find the boxes
 * empty. Every calculator starts from what is stored here and writes back to it as the lifter
 * types, so reopening the sheet — from the logger or from the Workout tab, which share this one
 * record — shows the numbers exactly as they were left.
 *
 * Deliberately kept in memory only: it is gone when the app restarts (a fresh session starts
 * with fresh numbers). The one Tool Kit thing saved on the phone for good is the plate rack —
 * that lives in `plateRack.ts`, because the plates on a rack don't change between sessions.
 *
 * Values are the raw text the lifter typed (or the chip they picked), never converted: the
 * calculators read them in whatever unit is in force when they draw.
 */

/**
 * The five tools the sheet can show, in the order its switcher lists them: four calculators and
 * the timer. (The timer's own memory — its set-up and the running clock — is `timerStore.ts`,
 * not this record, because it has to keep running, not just remember text.)
 */
export type ToolId = 'oneRm' | 'rpe' | 'percent' | 'plates' | 'timer';

/** Everything the Tool Kit remembers between opens. */
export interface ToolKitSession {
  /** The calculator showing when the sheet was last closed. */
  tool: ToolId;
  /** 1RM calculator: the weight lifted and how many reps. */
  oneRm: { weight: string; reps: string };
  /** RPE calculator: the lifter's 1RM, and the chosen target reps and RPE. */
  rpe: { oneRm: string; reps: number; rpe: number };
  /** Intensity calculator: the lifter's 1RM and the percentage of it. */
  percent: { oneRm: string; percent: string };
  /** Plate loader: the total weight to load (the bar and plates live in the plate rack). */
  plates: { target: string };
}

/** A new session: the 1RM calculator showing, every box empty, the RPE chips on 5 @ 8. */
function freshSession(): ToolKitSession {
  return {
    tool: 'oneRm',
    oneRm: { weight: '', reps: '' },
    rpe: { oneRm: '', reps: 5, rpe: 8 },
    percent: { oneRm: '', percent: '' },
    plates: { target: '' },
  };
}

let current: ToolKitSession = freshSession();

/** What the Tool Kit currently remembers. Treat it as read-only; change it with the updaters. */
export function getToolKitSession(): ToolKitSession {
  return current;
}

/** Remembers which calculator is showing. */
export function setToolKitTool(tool: ToolId): void {
  current = { ...current, tool };
}

/**
 * Remembers new values for one calculator, merged over what it already had.
 * Example: `updateToolKitSession('oneRm', { reps: '5' })` keeps the weight and changes the reps.
 */
export function updateToolKitSession<K extends Exclude<keyof ToolKitSession, 'tool'>>(
  calculator: K,
  values: Partial<ToolKitSession[K]>,
): void {
  current = { ...current, [calculator]: { ...current[calculator], ...values } };
}

/** Forgets everything (back to a fresh session). Used by tests; the app never needs it. */
export function resetToolKitSession(): void {
  current = freshSession();
}
