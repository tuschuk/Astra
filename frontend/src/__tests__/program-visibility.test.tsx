/**
 * Tests for "Who can see this" on the program page (PRG-4, B39), route level: a new program shows
 * Only you; tapping a chip saves the choice on the phone with no connection (it is still there
 * after the page is unmounted and reopened, and it is queued for upload); choosing Team shows the
 * lifter's Teams online and the offline line without a connection. Real SQLite through a mocked
 * `openAppDatabase`; the server is the in-memory fake social client; the router is a stub.
 * Server-side enforcement of each level was probed live at B39.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { createProgram, getProgram } from '@/programs/programs';
import { TEAMS_OFFLINE } from '@/social/teams';
import { pendingRows } from '@/sync/outbox';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import ProgramScreen from '@/app/program/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { id?: string } = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
  mockSocial = createFakeSocialClient({
    teams: [{ id: 't1', name: 'Iron Tribe', join_mode: 'open', created_by: 'owner', created_at: '2026-11-15T10:00:00.000Z' }],
    team_members: [{ team_id: 't1', user_id: SIGNED_IN_USER_ID, role: 'member', joined_at: '2026-11-15T11:00:00.000Z' }],
  });
});

describe('program page — who can see this', () => {
  it('a new program is Only you; a chip change saves offline and survives a reopen', async () => {
    mockSocial.setOffline(true);
    const program = await createProgram(db, SIGNED_IN_USER_ID, 'Strength Block');
    mockParams = { id: program.id };
    const page = await renderSignedIn(<ProgramScreen />);
    expect((await screen.findByLabelText(/^Only you:/)).props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByLabelText(/^Followers:/));
    await waitFor(() =>
      expect(screen.getByLabelText(/^Followers:/).props.accessibilityState).toMatchObject({ selected: true }),
    );
    expect((await getProgram(db, SIGNED_IN_USER_ID, program.id))?.visibility).toBe('followers');
    expect((await pendingRows(db, 'programs')).map((p) => p.rowId)).toContain(program.id);
    await page.unmount();

    await renderSignedIn(<ProgramScreen />);
    expect((await screen.findByLabelText(/^Followers:/)).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('Team shows the lifter’s Teams online, and the offline line without a connection', async () => {
    const program = await createProgram(db, SIGNED_IN_USER_ID, 'Team Block');
    mockParams = { id: program.id };
    const page = await renderSignedIn(<ProgramScreen />);
    await fireEvent.press(await screen.findByLabelText(/^Team:/));
    expect(await screen.findByLabelText('Share with Iron Tribe')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Share with Iron Tribe'));
    await waitFor(() => expect(mockSocial.tables.program_team_shares).toEqual([{ program_id: program.id, team_id: 't1' }]));
    await page.unmount();

    mockSocial.setOffline(true);
    await renderSignedIn(<ProgramScreen />);
    expect(await screen.findByText(TEAMS_OFFLINE)).toBeTruthy();
    expect((await getProgram(db, SIGNED_IN_USER_ID, program.id))?.visibility).toBe('team');
  });
});
