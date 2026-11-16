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
 *
 * The one deliberate comparison (B42, ANA-5) is `trendCopy` at the bottom: neutral lines setting
 * this session beside the lifter's own recent average ("About 12% more than your recent
 * average"). They state arithmetic on the lifter's own logged numbers — no praise, no blame, no
 * claim about strength — every one worded as an estimate ("about", "around"). They are built at
 * render time from the stored numbers rather than stored, and the headline and message above
 * still never compare.
 */
import { roundToIncrement } from '../training-math/index.ts';
import type { AnalysisSummary } from './summary.ts';
import type { AnalysisTrend } from './trend.ts';

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

/**
 * Within this many percent of the average (after rounding to a whole percent), a volume or
 * load-per-rep line says "right around" instead of naming a tiny difference.
 */
export const TREND_AROUND_PERCENT = 2;

/** Within this much (after rounding to 0.1) of the average RPE, the RPE line says "right around". */
export const TREND_AROUND_RPE = 0.2;

/** Which number a trend line compares. */
export type TrendMeasure = 'volume' | 'rpe' | 'loadPerRep';

/**
 * One trend line: what it compares, its label, the two numbers it compares (this session and
 * the recent average — kg for volume and load per rep, which the screen prints in the lifter's
 * unit; RPE points, already rounded to the 0.1 shown, for RPE), and the sentence describing the
 * difference between exactly those two numbers.
 */
export interface TrendLine {
  measure: TrendMeasure;
  label: string;
  value: number;
  average: number;
  sentence: string;
}

/** The words of the trend section: what it is compared with, and its lines (volume first). */
export interface TrendCopy {
  basis: string;
  lines: TrendLine[];
}

/** The stored numbers the trend words are built from. */
export type TrendCopyInput = Pick<AnalysisSummary, 'total_volume_kg'> & AnalysisTrend;

/**
 * "About 12% more / less than your recent average" for two kg amounts, using `more` / `less`
 * as the direction words; "right around" when the rounded difference is within
 * `TREND_AROUND_PERCENT`. Needs a positive average (no dividing by zero).
 */
function percentSentence(value: number, average: number, more: string, less: string): string {
  // Rounded by size, then given its direction (Math.round alone pulls −x.5 toward zero).
  const size = Math.round((Math.abs(value - average) / average) * 100);
  if (size <= TREND_AROUND_PERCENT) return 'Right around your recent average';
  return `About ${size}% ${value > average ? more : less} than your recent average`;
}

/** An RPE as shown: rounded to one decimal (the screen prints exactly this number). */
function shownRpe(rpe: number): number {
  return roundToIncrement(rpe, 0.1);
}

/**
 * "About 0.5 above / below your recent sessions", or "right around" within `TREND_AROUND_RPE`.
 * Takes the two RPEs as SHOWN (one decimal), so the sentence always matches the printed pair.
 */
function rpeSentence(value: number, average: number): string {
  const size = roundToIncrement(Math.abs(value - average), 0.1);
  if (size <= TREND_AROUND_RPE) return 'Right around your recent sessions';
  return `About ${size.toFixed(1)} ${value > average ? 'above' : 'below'} your recent sessions`;
}

/**
 * The trend section's words for an analysis, or null when there is nothing to show (no trend
 * stored — below the threshold — or no line computable). Rules:
 *   - **Volume** — only when the recent average is above 0 (an all-bodyweight history has no
 *     percentage to give);
 *   - **Intensity** (at most one line, the LOG-10 rule) — average RPE when both this session and
 *     the history have it; otherwise load per rep when both have it; otherwise none, and the
 *     volume line still stands.
 * No weights or units appear in the words — the screen prints the numbers in the lifter's unit.
 * RPE differences are in RPE points, not percent: a percentage of a 10-point scale reads as
 * nonsense.
 */
export function trendCopy(t: TrendCopyInput): TrendCopy | null {
  if (t.trend_sessions == null) return null;
  const lines: TrendLine[] = [];
  if (t.trend_volume_avg_kg != null && t.trend_volume_avg_kg > 0) {
    lines.push({
      measure: 'volume',
      label: 'Volume',
      value: t.total_volume_kg,
      average: t.trend_volume_avg_kg,
      sentence: percentSentence(t.total_volume_kg, t.trend_volume_avg_kg, 'more', 'less'),
    });
  }
  if (t.session_rpe_avg != null && t.trend_rpe_avg != null) {
    const value = shownRpe(t.session_rpe_avg);
    const average = shownRpe(t.trend_rpe_avg);
    lines.push({ measure: 'rpe', label: 'Average RPE', value, average, sentence: rpeSentence(value, average) });
  } else if (t.session_load_per_rep_kg != null && t.trend_load_per_rep_avg_kg != null && t.trend_load_per_rep_avg_kg > 0) {
    lines.push({
      measure: 'loadPerRep',
      label: 'Load per rep',
      value: t.session_load_per_rep_kg,
      average: t.trend_load_per_rep_avg_kg,
      sentence: percentSentence(t.session_load_per_rep_kg, t.trend_load_per_rep_avg_kg, 'heavier', 'lighter'),
    });
  }
  if (lines.length === 0) return null;
  return { basis: `Compared with your last ${t.trend_sessions} sessions`, lines };
}
