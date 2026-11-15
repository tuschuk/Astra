// Tests for copy.ts — the four tone states (ANA-4) and the not-medical-advice statement (NFR-9).
// The banned-word list is a tripwire against regressions, not the copy review itself (plan G10).
import { describe, expect, it } from '@jest/globals';

import { copyState, NOT_MEDICAL_ADVICE, pickCopy } from './copy.ts';
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

describe('NOT_MEDICAL_ADVICE', () => {
  it('says the analysis is not medical advice', () => {
    expect(NOT_MEDICAL_ADVICE).toMatch(/not medical advice/);
  });
});
