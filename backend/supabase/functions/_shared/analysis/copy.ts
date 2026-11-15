/**
 * The words of a post-workout analysis (ANA-4): a headline and a short message chosen from the
 * session's numbers, plus the not-medical-advice statement (NFR-9).
 *
 * Every string the analysis can ever show lives in this one file, so a copy review reads them
 * all in one sitting. The rules they hold to:
 *   - **Encouraging in every state, including a light or empty session.** No shaming, no
 *     comparison with past sessions, nothing that reads as "you could have done more".
 *   - **No performance claims.** Nothing like "you got 5% stronger": Astra's rule is that any
 *     numeric performance claim cites a published source, and this copy cites none, so it makes
 *     none. It states what happened and encourages.
 *   - **No weights or units inside the words.** The numbers are printed by the screen in the
 *     lifter's own unit (kg or lb), so a sentence can never show kilograms to a pounds user.
 *     (A count of records is not a weight, so the PR headline may name it.)
 *   - **Deterministic.** The same summary always gives the same words — no random pick — so the
 *     phone's offline copy and the server's stored copy always agree.
 * No AI writes any of this (ANA-11): it is a fixed lookup over four states.
 */
import type { AnalysisSummary } from './summary.ts';

/**
 * The statement shown on every analysis (and, from B55, every nutrition screen — import this
 * constant there, never retype it).
 */
export const NOT_MEDICAL_ADVICE =
  'Astra’s analysis is general fitness information, not medical advice. If you have an injury, ' +
  'pain or a health condition, talk to a doctor or another qualified professional before ' +
  'changing your training.';

/**
 * Which kind of session the numbers describe, in order of precedence:
 *   - `pr` — the session holds at least one personal record;
 *   - `weighted` — work with external load was done (volume above 0);
 *   - `unloaded` — sets were logged but none carried weight (bodyweight, timed, warm-ups);
 *   - `empty` — the workout was finished with no sets at all.
 */
export type CopyState = 'pr' | 'weighted' | 'unloaded' | 'empty';

/** The words for one analysis. */
export interface AnalysisCopy {
  state: CopyState;
  headline: string;
  message: string;
}

/** Picks the session's state from its numbers (see `CopyState` for the precedence). */
export function copyState(summary: Pick<AnalysisSummary, 'new_prs' | 'total_volume_kg' | 'total_sets'>): CopyState {
  if (summary.new_prs.length > 0) return 'pr';
  if (summary.total_volume_kg > 0) return 'weighted';
  if (summary.total_sets > 0) return 'unloaded';
  return 'empty';
}

/**
 * The headline and message for a summary. The only number that ever appears in the words is
 * the count of personal records on a PR day.
 */
export function pickCopy(summary: Pick<AnalysisSummary, 'new_prs' | 'total_volume_kg' | 'total_sets'>): AnalysisCopy {
  const state = copyState(summary);
  switch (state) {
    case 'pr': {
      const count = summary.new_prs.length;
      return count === 1
        ? {
            state,
            headline: 'New personal record!',
            message:
              'You set a PR this session. Records like this are built on every session that came before ' +
              'it — enjoy this one.',
          }
        : {
            state,
            headline: `${count} new personal records!`,
            message:
              'A day to remember. Records like these are built on every session that came before ' +
              'them — enjoy it.',
          };
    }
    case 'weighted':
      return {
        state,
        headline: 'Solid session',
        message:
          'Every set you logged this session is work in the bank. Strength is built one session at a time, and this one counts.',
      };
    case 'unloaded':
      return {
        state,
        headline: 'Work is work',
        message:
          'Bodyweight, timed, conditioning and warm-up work all count toward the habit. Session logged — nice job putting it in.',
      };
    case 'empty':
      return {
        state,
        headline: 'You showed up',
        message: 'Showing up is the habit everything else is built on. Your workout is saved — come back whenever you’re ready.',
      };
  }
}
