// Tests for copy.ts — the four tone states (ANA-4) and the not-medical-advice statement (NFR-9).
// The banned-word list is a tripwire against regressions, not the copy review itself (plan G10).
import { describe, expect, it } from '@jest/globals';

import {
  copyState,
  NOT_MEDICAL_ADVICE,
  pickCopy,
  TREND_AROUND_PERCENT,
  TREND_AROUND_RPE,
  trendCopy,
  type TrendCopyInput,
} from './copy.ts';
import type { AnalysisPr } from './summary.ts';

const pr: AnalysisPr = { exercise_id: 'x', exercise_name: 'Squat', kind: 'repMax', reps: 5, value_kg: 100 };

/** One summary per reachable state (and the two PR wordings). */
const STATES = {
  pr: { new_prs: [pr], total_volume_kg: 500, total_sets: 3 },
  prs: { new_prs: [pr, { ...pr, kind: 'e1rm' as const, reps: null }], total_volume_kg: 500, total_sets: 3 },
  weighted: { new_prs: [], total_volume_kg: 500, total_sets: 3 },
  unloaded: { new_prs: [], total_volume_kg: 0, total_sets: 3 },
  empty: { new_prs: [], total_volume_kg: 0, total_sets: 0 },
};

/** Words and phrases that minimize, shame or compare — none may appear in any analysis copy. */
const BANNED = [
  /\bonly\b/i,
  /\bjust\b/i,
  /\bfail/i,
  /\bat least\b/i,
  /better than last time/i,
  /\bweak/i,
  /\bbad\b/i,
  /\bpoor\b/i,
  /\bmissed\b/i,
  /\bshould have\b/i,
  /\bdisappoint/i,
  /\bnot enough\b/i,
  /%/,
];

describe('copyState', () => {
  it('picks by precedence: PRs, then weighted work, then any sets, then none', () => {
    expect(copyState(STATES.pr)).toBe('pr');
    expect(copyState({ ...STATES.pr, total_volume_kg: 0 })).toBe('pr');
    expect(copyState(STATES.weighted)).toBe('weighted');
    expect(copyState(STATES.unloaded)).toBe('unloaded');
    expect(copyState(STATES.empty)).toBe('empty');
  });
});

describe('pickCopy', () => {
  it.each(Object.entries(STATES))('%s: a non-empty headline and message free of shaming words', (_name, summary) => {
    const copy = pickCopy(summary);
    expect(copy.headline.length).toBeGreaterThan(0);
    expect(copy.message.length).toBeGreaterThan(0);
    for (const word of BANNED) {
      expect(copy.headline).not.toMatch(word);
      expect(copy.message).not.toMatch(word);
    }
  });

  it('never puts a weight or a unit in the words (the screen prints numbers in the lifter’s unit)', () => {
    for (const summary of Object.values(STATES)) {
      const { headline, message } = pickCopy(summary);
      expect(`${headline} ${message}`).not.toMatch(/\b(kg|lb|lbs|pounds|kilos?)\b/i);
    }
  });

  it('names the count on a multi-PR day, and nothing else numeric anywhere', () => {
    expect(pickCopy(STATES.prs).headline).toBe('2 new personal records!');
    expect(pickCopy(STATES.pr).headline).toBe('New personal record!');
    for (const [name, summary] of Object.entries(STATES)) {
      const { headline, message } = pickCopy(summary);
      expect(message).not.toMatch(/\d/);
      if (name !== 'prs') expect(headline).not.toMatch(/\d/);
    }
  });

  it('is deterministic: the same summary always gives the same words', () => {
    expect(pickCopy(STATES.weighted)).toEqual(pickCopy({ ...STATES.weighted }));
  });
});

describe('trendCopy (B42)', () => {
  /** A stored trend: this session 1100 kg, RPE 8.8, 110 kg/rep vs averages 550 / 8.3 / 86 over 6 sessions. */
  const BASE: TrendCopyInput = {
    total_volume_kg: 1100,
    trend_sessions: 6,
    trend_volume_avg_kg: 550,
    trend_rpe_avg: 8.3,
    trend_load_per_rep_avg_kg: 86,
    session_rpe_avg: 8.8,
    session_load_per_rep_kg: 110,
  };

  it('no stored trend (below the threshold) → no section at all', () => {
    expect(trendCopy({ ...BASE, trend_sessions: null, trend_volume_avg_kg: null, trend_rpe_avg: null, trend_load_per_rep_avg_kg: null })).toBeNull();
  });

  it('volume as a percentage and RPE in points when both sides have RPE', () => {
    expect(trendCopy(BASE)).toEqual({
      basis: 'Compared with your last 6 sessions',
      lines: [
        { measure: 'volume', label: 'Volume', value: 1100, average: 550, sentence: 'About 100% more than your recent average' },
        { measure: 'rpe', label: 'Average RPE', value: 8.8, average: 8.3, sentence: 'About 0.5 above your recent sessions' },
      ],
    });
  });

  it('the RPE sentence is worked out from the one-decimal numbers the screen prints', () => {
    // Stored 7.36 vs 7.12 (a 0.24 gap) is shown as 7.4 vs 7.1 — so the sentence says 0.3, not "around".
    const rpe = trendCopy({ ...BASE, session_rpe_avg: 7.36, trend_rpe_avg: 7.12 })?.lines[1];
    expect(rpe).toEqual({
      measure: 'rpe',
      label: 'Average RPE',
      value: 7.4,
      average: 7.1,
      sentence: 'About 0.3 above your recent sessions',
    });
  });

  it('falls back to load per rep when RPE is missing on either side', () => {
    // 110 vs 86: +27.9% → 28%.
    const line = {
      measure: 'loadPerRep',
      label: 'Load per rep',
      value: 110,
      average: 86,
      sentence: 'About 28% heavier than your recent average',
    };
    expect(trendCopy({ ...BASE, session_rpe_avg: null })?.lines[1]).toEqual(line);
    expect(trendCopy({ ...BASE, trend_rpe_avg: null })?.lines[1]).toEqual(line);
  });

  it('volume-only when neither intensity measure is on both sides', () => {
    expect(trendCopy({ ...BASE, session_rpe_avg: null, session_load_per_rep_kg: null })?.lines.map((l) => l.measure)).toEqual(['volume']);
  });

  it('less / lighter / below wording, and "right around" inside the dead bands', () => {
    // 506 vs 550: −8%. RPE 7.5 vs 8.3: −0.8.
    const lower = trendCopy({ ...BASE, total_volume_kg: 506, session_rpe_avg: 7.5 });
    expect(lower?.lines.map((l) => l.sentence)).toEqual([
      'About 8% less than your recent average',
      'About 0.8 below your recent sessions',
    ]);
    // +2% and +0.2 RPE are "around"; +3% is named.
    expect(trendCopy({ ...BASE, total_volume_kg: 561, session_rpe_avg: 8.5 })?.lines.map((l) => l.sentence)).toEqual([
      'Right around your recent average',
      'Right around your recent sessions',
    ]);
    expect(trendCopy({ ...BASE, total_volume_kg: 566.5 })?.lines[0].sentence).toBe('About 3% more than your recent average');
    expect(TREND_AROUND_PERCENT).toBe(2);
    expect(TREND_AROUND_RPE).toBe(0.2);
    expect(trendCopy({ ...BASE, session_rpe_avg: null, session_load_per_rep_kg: 80 })?.lines[1].sentence).toBe(
      'About 7% lighter than your recent average',
    );
  });

  it('no volume line over an all-bodyweight history (no percentage of zero); nothing at all → null', () => {
    const bw = { ...BASE, trend_volume_avg_kg: 0, trend_load_per_rep_avg_kg: null, session_rpe_avg: null };
    expect(trendCopy(bw)).toBeNull();
    expect(trendCopy({ ...bw, session_rpe_avg: 8 })?.lines.map((l) => l.measure)).toEqual(['rpe']);
  });

  it('every sentence is an estimate, free of the banned words (bar "%"), weights and units', () => {
    const variants: TrendCopyInput[] = [
      BASE,
      { ...BASE, total_volume_kg: 100, session_rpe_avg: 6 },
      { ...BASE, total_volume_kg: 552, session_rpe_avg: null },
      { ...BASE, session_rpe_avg: null, session_load_per_rep_kg: 50 },
    ];
    for (const v of variants) {
      const copy = trendCopy(v);
      if (!copy) throw new Error('expected copy');
      for (const line of copy.lines) {
        expect(line.sentence).toMatch(/^(About|Right around) /);
        for (const word of BANNED.filter((w) => w.source !== '%')) expect(line.sentence).not.toMatch(word);
        expect(`${line.label} ${line.sentence}`).not.toMatch(/\b(kg|lb|lbs|pounds|kilos?)\b/i);
      }
    }
  });
});

describe('NOT_MEDICAL_ADVICE', () => {
  it('says the analysis is not medical advice', () => {
    expect(NOT_MEDICAL_ADVICE).toMatch(/not medical advice/);
  });
});
