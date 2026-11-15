/**
 * Tests for `boldSegments`: plain cues pass through, `**bold**` pairs become bold pieces, and an
 * unmatched marker is left in the text as written.
 */
import { describe, expect, it } from '@jest/globals';

import { boldSegments } from './cueFormat';
import { PATTERN_STEPS } from './exercises';

describe('boldSegments', () => {
  it('returns plain text as one plain piece', () => {
    expect(boldSegments('Brace and press.')).toEqual([{ text: 'Brace and press.', bold: false }]);
  });

  it('marks one bold span', () => {
    expect(boldSegments('Lie flat. **Eyes under the bar**, feet planted.')).toEqual([
      { text: 'Lie flat. ', bold: false },
      { text: 'Eyes under the bar', bold: true },
      { text: ', feet planted.', bold: false },
    ]);
  });

  it('marks several bold spans, including at the start and end', () => {
    expect(boldSegments('**Grip** hard, then **drive**')).toEqual([
      { text: 'Grip', bold: true },
      { text: ' hard, then ', bold: false },
      { text: 'drive', bold: true },
    ]);
  });

  it('leaves an unmatched marker literal', () => {
    expect(boldSegments('Keep **tight the whole way')).toEqual([{ text: 'Keep **tight the whole way', bold: false }]);
    expect(boldSegments('**One** and ** stray')).toEqual([
      { text: 'One', bold: true },
      { text: ' and ** stray', bold: false },
    ]);
  });

  it('renders every real cue with no marker left over and no character lost', () => {
    for (const steps of Object.values(PATTERN_STEPS)) {
      for (const step of steps) {
        const joined = boldSegments(step.cue).map((s) => s.text).join('');
        // Every founder cue pairs its markers, so removing all of them is the expected text.
        expect(joined).toBe(step.cue.split('**').join(''));
      }
    }
  });
});
