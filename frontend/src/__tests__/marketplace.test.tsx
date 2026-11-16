/**
 * Tests for the Marketplace tab (B40 — MKT-1, "any published program is findable by search and
 * browse"), with the in-memory fake client: every published program shows as a card (name and
 * author), newest first, and never a private or deleted one; typing a word narrows to the
 * matching programs and clearing brings the full list back; a search with no match says so;
 * "Show more" appears past the first page and reads more; no connection shows the standard
 * message and Retry recovers; an empty shelf says so; a card opens the program page.
 * (B41 — MKT-2) The Featured section ranks the week by default with each card's score, the chips
 * switch windows (all time reorders by old votes), coming back to the tab re-reads so a changed
 * vote moves the ranking, it hides while searching, and an empty shelf has none.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { MARKETPLACE_PAGE_SIZE } from '@/social/marketplace';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import MarketplaceScreen, { MARKETPLACE_EMPTY, MARKETPLACE_OFFLINE } from '@/app/(tabs)/marketplace';

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
// (B41) Focus callbacks are kept so a test can "come back to the tab" with `refocus()`.
const mockFocusCallbacks: (() => void)[] = [];
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({}),
    useFocusEffect: (effect: () => void) =>
      useEffect(() => {
        mockFocusCallbacks.push(effect);
        effect();
      }, [effect]),
  };
});

/** The lifter comes back to the tab (from a program page, say). */
async function refocus(): Promise<void> {
  await act(async () => mockFocusCallbacks[mockFocusCallbacks.length - 1]?.());
}

/** The Featured card names on screen, in order. */
function featuredNames(): string[] {
  return screen
    .getAllByLabelText(/^Open featured program /)
    .map((el) => String(el.props.accessibilityLabel).replace('Open featured program ', '').replace(/, score .*$/, ''));
}

/** A vote cast `daysAgo` days back (the Featured windows are rolling, counted from now). */
function voteAt(programId: string, userId: string, value: 1 | -1, daysAgo: number) {
  return { program_id: programId, user_id: userId, value, created_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString() };
}

const program = (id: string, name: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: 'alex',
  name,
  visibility: 'published',
  deleted_at: null,
  created_at: createdAt,
  ...extra,
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockOpenDatabase.mockResolvedValue(await createPreparedDb());
  mockSocial = createFakeSocialClient({
    profiles: [profile('alex', 'alex_lifts', 'Alex'), profile(SIGNED_IN_USER_ID, 'me_lifts', 'Me')],
    programs: [
      program('p1', 'Starting Strength', '2026-11-15T09:00:00.000Z'),
      program('p2', 'PHUL', '2026-11-15T11:00:00.000Z'),
      program('p3', 'Strength Block', '2026-11-15T10:00:00.000Z'),
      program('private', 'Secret Strength', '2026-11-15T12:00:00.000Z', { user_id: SIGNED_IN_USER_ID, visibility: 'private' }),
      program('deleted', 'Old Strength', '2026-11-15T12:00:00.000Z', { deleted_at: '2026-11-15T13:00:00.000Z' }),
    ],
  });
});

/** The program names on screen, in order. */
function cardNames(): string[] {
  return screen.getAllByLabelText(/^Open program /).map((el) => String(el.props.accessibilityLabel).replace('Open program ', ''));
}

describe('Marketplace tab', () => {
  it('browse: every published program as a card, newest first, with its author — never private or deleted', async () => {
    await renderSignedIn(<MarketplaceScreen />);
    expect(await screen.findByLabelText('Open program PHUL')).toBeTruthy();
    expect(cardNames()).toEqual(['PHUL', 'Strength Block', 'Starting Strength']);
    expect(screen.getAllByText('by Alex')).toHaveLength(3);
    expect(screen.queryByText('Secret Strength')).toBeNull();
    expect(screen.queryByText('Old Strength')).toBeNull();
    expect(screen.queryByText('Featured this week')).toBeNull();
  });

  it('search: a word narrows to its matches; clearing restores the browse list; no match says so', async () => {
    await renderSignedIn(<MarketplaceScreen />);
    await screen.findByLabelText('Open program PHUL');
    await fireEvent.changeText(screen.getByLabelText('Search programs'), 'strength');
    expect(await screen.findByText('Searching…')).toBeTruthy();
    await screen.findByText('Strength Block');
    expect(screen.queryByText('PHUL')).toBeNull();
    expect(cardNames()).toEqual(['Strength Block', 'Starting Strength']);
    const searched = mockSocial.requests.find((r) => r.some(([m]) => m === 'textSearch'));
    expect(searched).toContainEqual(['textSearch', 'search', 'strength', { type: 'websearch', config: 'simple' }]);

    await fireEvent.changeText(screen.getByLabelText('Search programs'), 'zumba');
    expect(await screen.findByText('No programs match “zumba”.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Search programs'), '');
    expect(await screen.findByLabelText('Open program PHUL')).toBeTruthy();
    expect(cardNames()).toHaveLength(3);
  });

  it('Show more: appears when the first page is full and reads the next page', async () => {
    for (let i = 0; i < MARKETPLACE_PAGE_SIZE + 2; i += 1) {
      mockSocial.tables.programs.push(program(`bulk-${i}`, `Bulk ${i}`, `2026-11-14T${String(i % 24).padStart(2, '0')}:00:00.000Z`));
    }
    await renderSignedIn(<MarketplaceScreen />);
    await screen.findByLabelText('Open program PHUL');
    expect(cardNames()).toHaveLength(MARKETPLACE_PAGE_SIZE);
    await fireEvent.press(screen.getByLabelText('Show more'));
    await screen.findByText('Bulk 0');
    expect(cardNames()).toHaveLength(MARKETPLACE_PAGE_SIZE + 5);
    expect(screen.queryByLabelText('Show more')).toBeNull();
  });

  it('offline: the connection message; Retry reads again', async () => {
    mockSocial.setOffline(true);
    await renderSignedIn(<MarketplaceScreen />);
    expect(await screen.findByText(MARKETPLACE_OFFLINE)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByLabelText('Open program PHUL')).toBeTruthy();
  });

  it('an empty shelf says nothing is published yet', async () => {
    mockSocial.tables.programs.length = 0;
    await renderSignedIn(<MarketplaceScreen />);
    expect(await screen.findByText(MARKETPLACE_EMPTY)).toBeTruthy();
  });

  it('tapping a card opens the program page', async () => {
    await renderSignedIn(<MarketplaceScreen />);
    await fireEvent.press(await screen.findByLabelText('Open program PHUL'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/marketplace-program/[id]', params: { id: 'p2' } });
  });
});

describe('Marketplace tab — Featured (B41, MKT-2)', () => {
  beforeEach(() => {
    mockFocusCallbacks.length = 0;
    mockSocial.tables.program_votes.push(
      // Starting Strength: two votes this week.
      voteAt('p1', 'a', 1, 1),
      voteAt('p1', 'b', 1, 2),
      // Strength Block: one this week, three a year and more back (all time only).
      voteAt('p3', 'a', 1, 0),
      voteAt('p3', 'b', 1, 400),
      voteAt('p3', 'c', 1, 400),
      voteAt('p3', 'd', 1, 400),
      // The private and deleted programs are popular — and never featured.
      voteAt('private', 'a', 1, 0),
      voteAt('deleted', 'a', 1, 0),
    );
  });

  it('ranks the week by default, with each card’s score; the chips switch windows', async () => {
    await renderSignedIn(<MarketplaceScreen />);
    expect(await screen.findByLabelText('Open featured program Starting Strength, score 2')).toBeTruthy();
    expect(screen.getByText('Featured')).toBeTruthy();
    expect(screen.getByLabelText('Most popular this week').props.accessibilityState.selected).toBe(true);
    // PHUL has no votes: 0, below the voted ones.
    expect(featuredNames()).toEqual(['Starting Strength', 'Strength Block', 'PHUL']);
    expect(screen.getByText('by Alex · ▲ 2')).toBeTruthy();
    expect(screen.queryByText('Secret Strength')).toBeNull();
    expect(screen.queryByText('Old Strength')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Most popular of all time'));
    expect(await screen.findByLabelText('Open featured program Strength Block, score 4')).toBeTruthy();
    expect(featuredNames()).toEqual(['Strength Block', 'Starting Strength', 'PHUL']);
    const read = mockSocial.requests.filter((r) => r[0][1] === 'program_scores').pop();
    expect(read).toContainEqual(['order', 'score', { ascending: false }]);
    // The browse list below is unchanged: newest first.
    expect(cardNames()).toEqual(['PHUL', 'Strength Block', 'Starting Strength']);
  });

  it('updates as votes change: coming back to the tab reads the ranking again', async () => {
    await renderSignedIn(<MarketplaceScreen />);
    await screen.findByLabelText('Open featured program Starting Strength, score 2');
    // Meanwhile (on a program page), PHUL picks up three votes this week.
    mockSocial.tables.program_votes.push(voteAt('p2', 'a', 1, 0), voteAt('p2', 'b', 1, 0), voteAt('p2', 'c', 1, 0));
    await refocus();
    expect(await screen.findByLabelText('Open featured program PHUL, score 3')).toBeTruthy();
    expect(featuredNames()).toEqual(['PHUL', 'Starting Strength', 'Strength Block']);
  });

  it('hides while searching; a featured card opens the program page', async () => {
    await renderSignedIn(<MarketplaceScreen />);
    await screen.findByLabelText('Open featured program Starting Strength, score 2');
    await fireEvent.changeText(screen.getByLabelText('Search programs'), 'strength');
    await screen.findByText('Searching…');
    expect(screen.queryByText('Featured')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search programs'), '');
    await fireEvent.press(await screen.findByLabelText('Open featured program Starting Strength, score 2'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/marketplace-program/[id]', params: { id: 'p1' } });
  });

  it('an empty shelf shows no Featured section, only the empty message', async () => {
    mockSocial.tables.programs.length = 0;
    await renderSignedIn(<MarketplaceScreen />);
    expect(await screen.findByText(MARKETPLACE_EMPTY)).toBeTruthy();
    expect(screen.queryByText('Featured')).toBeNull();
  });
});
