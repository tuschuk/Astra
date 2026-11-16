/**
 * Tests for program shares (B39): reading which Teams a program is shared with, sharing (twice is
 * fine; a security-rule refusal becomes the calm "only teams you're in / wait for sync" sentence;
 * offline becomes the connection sentence) and unsharing. The client is the in-memory fake social
 * client; who may share — the author, with a Team they're in — was probed live at B39.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';

import { listProgramShares, PROGRAM_SHARE_REFUSED, shareProgramWithTeam, unshareProgramFromTeam } from './programShares';
import { TEAM_FAILED } from './teams';

describe('listProgramShares', () => {
  it('answers the Team ids of this program only', async () => {
    const fake = createFakeSocialClient({
      program_team_shares: [
        { program_id: 'p', team_id: 't1' },
        { program_id: 'p', team_id: 't2' },
        { program_id: 'other', team_id: 't3' },
      ],
    });
    expect(await listProgramShares(fake.client, 'p')).toEqual(new Set(['t1', 't2']));
  });

  it('throws when offline (the section shows the offline line)', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    await expect(listProgramShares(fake.client, 'p')).rejects.toThrow();
  });
});

describe('shareProgramWithTeam', () => {
  it('adds the share; sharing again is still fine', async () => {
    const fake = createFakeSocialClient();
    expect(await shareProgramWithTeam(fake.client, 'p', 't')).toEqual({ ok: true });
    expect(await shareProgramWithTeam(fake.client, 'p', 't')).toEqual({ ok: true });
    expect(fake.tables.program_team_shares).toEqual([{ program_id: 'p', team_id: 't' }]);
  });

  it('a security-rule refusal (42501) becomes the calm sentence', async () => {
    const fake = createFakeSocialClient({}, { refuse: { program_team_shares: { code: '42501', message: 'rls' } } });
    expect(await shareProgramWithTeam(fake.client, 'p', 't')).toEqual({ ok: false, message: PROGRAM_SHARE_REFUSED });
  });

  it('offline → the connection sentence', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    expect(await shareProgramWithTeam(fake.client, 'p', 't')).toEqual({ ok: false, message: TEAM_FAILED });
  });
});

describe('unshareProgramFromTeam', () => {
  it('removes only that share; unsharing what isn’t shared is fine', async () => {
    const fake = createFakeSocialClient({
      program_team_shares: [
        { program_id: 'p', team_id: 't1' },
        { program_id: 'p', team_id: 't2' },
      ],
    });
    expect(await unshareProgramFromTeam(fake.client, 'p', 't1')).toEqual({ ok: true });
    expect(await unshareProgramFromTeam(fake.client, 'p', 't1')).toEqual({ ok: true });
    expect(fake.tables.program_team_shares).toEqual([{ program_id: 'p', team_id: 't2' }]);
  });

  it('offline → the connection sentence', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    expect(await unshareProgramFromTeam(fake.client, 'p', 't1')).toEqual({ ok: false, message: TEAM_FAILED });
  });
});
