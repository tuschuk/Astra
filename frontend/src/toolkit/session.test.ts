/**
 * Tests for the Tool Kit's in-memory session: it starts fresh, remembers each calculator's
 * inputs and the last tool, merges partial updates, and resets.
 */
import { afterEach, describe, expect, it } from '@jest/globals';

import { getToolKitSession, resetToolKitSession, setToolKitTool, updateToolKitSession } from './session';

afterEach(() => resetToolKitSession());

describe('Tool Kit session', () => {
  it('starts on the 1RM calculator with empty boxes and the RPE chips on 5 @ 8', () => {
    expect(getToolKitSession()).toEqual({
      tool: 'oneRm',
      oneRm: { weight: '', reps: '' },
      rpe: { oneRm: '', reps: 5, rpe: 8 },
      percent: { oneRm: '', percent: '' },
      plates: { target: '' },
    });
  });

  it('merges an update into one calculator and leaves the others alone', () => {
    updateToolKitSession('oneRm', { weight: '100' });
    updateToolKitSession('oneRm', { reps: '5' });
    updateToolKitSession('rpe', { rpe: 9.5 });
    const session = getToolKitSession();
    expect(session.oneRm).toEqual({ weight: '100', reps: '5' });
    expect(session.rpe).toEqual({ oneRm: '', reps: 5, rpe: 9.5 });
    expect(session.percent).toEqual({ oneRm: '', percent: '' });
  });

  it('remembers the tool last shown', () => {
    setToolKitTool('plates');
    expect(getToolKitSession().tool).toBe('plates');
  });

  it('hands out a new object on change, never mutating the one already read', () => {
    const before = getToolKitSession();
    updateToolKitSession('percent', { percent: '85' });
    expect(before.percent.percent).toBe('');
    expect(getToolKitSession().percent.percent).toBe('85');
  });

  it('reset forgets everything', () => {
    setToolKitTool('rpe');
    updateToolKitSession('plates', { target: '225' });
    resetToolKitSession();
    expect(getToolKitSession().tool).toBe('oneRm');
    expect(getToolKitSession().plates.target).toBe('');
  });
});
