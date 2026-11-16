/**
 * Tests for ProgramVisibilitySection (B39): the four chips show the current choice and report a
 * tap; the meaning sentence follows the choice; nothing asks the server until Team is chosen;
 * with Team chosen the lifter's Teams appear ticked per their shares and a tap shares / unshares;
 * the no-teams and pick-a-team hints; a share with a Team the lifter left is shown and can be
 * ended; offline shows the Teams offline line; a refused share shows
 * the calm sentence. The client is the in-memory fake social client.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { ProgramVisibility } from '@/db/dao';
import { PROGRAM_VISIBILITY_WORDS } from '@/programs/programs';
import { PROGRAM_SHARE_REFUSED } from '@/social/programShares';
import { TEAMS_OFFLINE } from '@/social/teams';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';

import { leftSharesLine, NO_TEAMS_TO_SHARE, PICK_A_TEAM, ProgramVisibilitySection } from './ProgramVisibilitySection';

const ME = 'me';
const team = (id: string, name: string) => ({ id, name, join_mode: 'open', created_by: 'owner', created_at: '2026-11-15T10:00:00.000Z' });
const member = (teamId: string) => ({ team_id: teamId, user_id: ME, role: 'member', joined_at: '2026-11-15T11:00:00.000Z' });

let fake = createFakeSocialClient();

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  fake = createFakeSocialClient({
    teams: [team('t1', 'Iron Tribe'), team('t2', 'Barbell Club')],
    team_members: [member('t1'), member('t2')],
    program_team_shares: [{ program_id: 'p', team_id: 't1' }],
  });
});

async function renderSection(visibility: ProgramVisibility, onSelect = jest.fn<(v: ProgramVisibility) => void>()) {
  await render(
    <ProgramVisibilitySection programId="p" visibility={visibility} onSelect={onSelect} userId={ME} client={fake.client} />,
  );
  return onSelect;
}

describe('ProgramVisibilitySection', () => {
  it('lights the current choice, explains it, reports a tap and asks the server nothing', async () => {
    const onSelect = await renderSection('followers');
    expect(screen.getByLabelText(/^Followers:/).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText(/^Only you:/).props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByText(PROGRAM_VISIBILITY_WORDS.followers.meaning)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Published:/));
    expect(onSelect).toHaveBeenCalledWith('published');
    expect(fake.requests).toHaveLength(0);
    expect(screen.queryByLabelText('Share with Iron Tribe')).toBeNull();
  });

  it('Team lists the lifter’s Teams ticked by their shares, and a tap shares or unshares', async () => {
    await renderSection('team');
    const tribe = await screen.findByLabelText('Share with Iron Tribe');
    expect(tribe.props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Share with Barbell Club').props.accessibilityState).toMatchObject({ checked: false });

    await fireEvent.press(screen.getByLabelText('Share with Barbell Club'));
    await waitFor(() =>
      expect(screen.getByLabelText('Share with Barbell Club').props.accessibilityState).toMatchObject({ checked: true }),
    );
    await fireEvent.press(screen.getByLabelText('Share with Iron Tribe'));
    await waitFor(() =>
      expect(screen.getByLabelText('Share with Iron Tribe').props.accessibilityState).toMatchObject({ checked: false }),
    );
    expect(fake.tables.program_team_shares).toEqual([{ program_id: 'p', team_id: 't2' }]);
  });

  it('hints when Team is chosen but nothing is ticked', async () => {
    fake.tables.program_team_shares = [];
    await renderSection('team');
    expect(await screen.findByText(PICK_A_TEAM)).toBeTruthy();
  });

  it('hints when the lifter is in no Team', async () => {
    fake.tables.team_members = [];
    await renderSection('team');
    expect(await screen.findByText(NO_TEAMS_TO_SHARE)).toBeTruthy();
    expect(screen.queryByText(PICK_A_TEAM)).toBeNull();
  });

  it('a share with a Team the lifter has left is shown and can be ended', async () => {
    fake.tables.team_members = [member('t2')]; // left Iron Tribe, still shared with it
    await renderSection('team');
    expect(await screen.findByText(leftSharesLine(1))).toBeTruthy();
    expect(screen.queryByText(PICK_A_TEAM)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Stop sharing with teams you left'));
    await waitFor(() => expect(screen.queryByText(leftSharesLine(1))).toBeNull());
    expect(fake.tables.program_team_shares).toEqual([]);
    expect(screen.getByText(PICK_A_TEAM)).toBeTruthy();
  });

  it('offline: the Team list says it needs a connection, the chips still work', async () => {
    fake.setOffline(true);
    const onSelect = await renderSection('team');
    expect(await screen.findByText(TEAMS_OFFLINE)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Only you:/));
    expect(onSelect).toHaveBeenCalledWith('private');
  });

  it('a refused share shows the calm sentence and leaves the tick off', async () => {
    fake = createFakeSocialClient(
      { teams: [team('t1', 'Iron Tribe')], team_members: [member('t1')] },
      { refuse: { program_team_shares: { code: '42501', message: 'rls' } } },
    );
    await renderSection('team');
    await fireEvent.press(await screen.findByLabelText('Share with Iron Tribe'));
    expect(await screen.findByText(PROGRAM_SHARE_REFUSED)).toBeTruthy();
    expect(screen.getByLabelText('Share with Iron Tribe').props.accessibilityState).toMatchObject({ checked: false });
  });
});
