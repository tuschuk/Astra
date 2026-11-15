/**
 * Tests for how another lifter is named on cards (B20): display name first, then username, then
 * "Lifter"; the @handle only with a username; and the avatar letter is a whole character.
 */
import { describe, expect, it } from '@jest/globals';

import { personLabels } from './names';

describe('personLabels', () => {
  it('prefers the display name, falls back to the username, then to "Lifter"', () => {
    expect(personLabels({ username: 'big_sam', displayName: 'Big Sam' })).toEqual({
      name: 'Big Sam',
      handle: '@big_sam',
      initial: 'B',
    });
    expect(personLabels({ username: 'big_sam', displayName: '   ' })).toEqual({
      name: 'big_sam',
      handle: '@big_sam',
      initial: 'B',
    });
    expect(personLabels({ username: null, displayName: null })).toEqual({ name: 'Lifter', handle: null, initial: 'L' });
  });

  it('uses a whole emoji as the avatar letter, never half of one', () => {
    expect(personLabels({ username: null, displayName: '💪 Max' }).initial).toBe('💪');
  });
});
