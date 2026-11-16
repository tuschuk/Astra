/**
 * Tests for the Marketplace tab (B40 — MKT-1, "any published program is findable by search and
 * browse"), with the in-memory fake client: every published program shows as a card (name and
 * author), newest first, and never a private or deleted one; typing a word narrows to the
 * matching programs and clearing brings the full list back; a search with no match says so;
 * "Show more" appears past the first page and reads more; no connection shows the standard
 * message and Retry recovers; an empty shelf says so; a card opens the program page.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

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
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

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
    expect(await screen.findByText('PHUL')).toBeTruthy();
    expect(cardNames()).toEqual(['PHUL', 'Strength Block', 'Starting Strength']);
    expect(screen.getAllByText('by Alex')).toHaveLength(3);
    expect(screen.queryByText('Secret Strength')).toBeNull();
    expect(screen.queryByText('Old Strength')).toBeNull();
    expect(screen.queryByText('Featured this week')).toBeNull();
  });

  it('search: a word narrows to its matches; clearing restores the browse list; no match says so', async () => {
    await renderSignedIn(<MarketplaceScreen />);
    await screen.findByText('PHUL');
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
    expect(await screen.findByText('PHUL')).toBeTruthy();
    expect(cardNames()).toHaveLength(3);
  });

  it('Show more: appears when the first page is full and reads the next page', async () => {
    for (let i = 0; i < MARKETPLACE_PAGE_SIZE + 2; i += 1) {
      mockSocial.tables.programs.push(program(`bulk-${i}`, `Bulk ${i}`, `2026-11-14T${String(i % 24).padStart(2, '0')}:00:00.000Z`));
    }
    await renderSignedIn(<MarketplaceScreen />);
    await screen.findByText('PHUL');
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
    expect(await screen.findByText('PHUL')).toBeTruthy();
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
