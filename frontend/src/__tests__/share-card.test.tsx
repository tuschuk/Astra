/**
 * Tests for the share-card screen (LOG-8, B28): a finished workout on the phone renders its card
 * (title, numbers in the lifter's unit, PR lines) offline; Share captures the card on screen to a
 * PNG and hands that file to the share sheet; a failed capture says so; a phone without a share
 * sheet disables Share; a workout that isn't the lifter's shows the empty state and no Share; and
 * the analysis screen's Share button opens this screen. Real SQLite through a mocked
 * `openAppDatabase`; the capture and share-sheet modules are the jest.setup.js stand-ins — the
 * real capture is a device check.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { SHARE_IMAGE_SIZE } from '@/components/share/ShareCard';
import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { unitStore } from '@/settings/unitStore';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { startActiveWorkout } from '@/workout/activeWorkout';
import { formatWeight } from '@/workout/format';

import AnalysisScreen from '@/app/analysis/[id]';
import ShareCardScreen, { SHARE_FAILED, SHARE_UNAVAILABLE } from '@/app/share-card/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) };
let mockParams: { id?: string } = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const mockCapture = jest.mocked(captureRef);
const mockShare = jest.mocked(Sharing.shareAsync);
const mockAvailable = jest.mocked(Sharing.isAvailableAsync);

let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  mockCapture.mockResolvedValue('file:///tmp/share-card.png');
  mockShare.mockResolvedValue(undefined);
  mockAvailable.mockResolvedValue(true);
  unitStore.reset();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

/** A finished squat session: warm-up 10×95 lb, 5×225 lb, 3×275 lb. Returns its id. */
async function seedWorkout(userId = SIGNED_IN_USER_ID): Promise<string> {
  const store = await startActiveWorkout(db, userId, steadyOptions('2026-11-12T12:00:00.000Z'));
  const squat = await store.addExercise(libraryExerciseId('squat'));
  await store.logSet(squat.id, { reps: 10, weight: { value: 95, unit: 'lb' }, isWarmup: true });
  await store.logSet(squat.id, { reps: 5, weight: { value: 225, unit: 'lb' } });
  await store.logSet(squat.id, { reps: 3, weight: { value: 275, unit: 'lb' } });
  return (await store.finish()).id;
}

describe('Share card screen', () => {
  it('renders the card from the phone alone: numbers in the lifter’s unit and the PR lines', async () => {
    mockParams = { id: await seedWorkout() };
    await renderSignedIn(<ShareCardScreen />);
    expect(await screen.findByTestId('share-card')).toBeTruthy();
    const volumeKg = (await db.getFirstAsync<{ v: number }>('select sum(reps * weight_kg) as v from sets where is_warmup = 0'))!.v;
    expect(screen.getByText(formatWeight(Math.round(volumeKg * 1000) / 1000, 'lb'))).toBeTruthy();
    expect(screen.getByText('3 sets · 1 warm-up')).toBeTruthy();
    expect(screen.getByText('New PRs')).toBeTruthy();
    expect(screen.getByText('Squat · 5RM · 225 lb')).toBeTruthy();
    expect(screen.getByText('Squat · 3RM · 275 lb')).toBeTruthy();
  });

  it('Share captures the card to a 1080×1350 PNG and hands it to the share sheet', async () => {
    mockParams = { id: await seedWorkout() };
    await renderSignedIn(<ShareCardScreen />);
    await screen.findByTestId('share-card');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share' })).not.toBeDisabled());
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    expect(mockCapture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ format: 'png', result: 'tmpfile', ...SHARE_IMAGE_SIZE }),
    );
    expect(mockShare).toHaveBeenCalledWith('file:///tmp/share-card.png', expect.objectContaining({ mimeType: 'image/png' }));
  });

  it('a failed capture says so and sends nothing', async () => {
    mockCapture.mockRejectedValueOnce(new Error('no view'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockParams = { id: await seedWorkout() };
    await renderSignedIn(<ShareCardScreen />);
    await screen.findByTestId('share-card');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share' })).not.toBeDisabled());
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText(SHARE_FAILED)).toBeTruthy();
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('with no share sheet on the device, Share is disabled and says why', async () => {
    mockAvailable.mockResolvedValue(false);
    mockParams = { id: await seedWorkout() };
    await renderSignedIn(<ShareCardScreen />);
    expect(await screen.findByText(SHARE_UNAVAILABLE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
  });

  it('someone else’s workout (or a missing one) shows the empty state and no Share', async () => {
    mockParams = { id: await seedWorkout('someone-else') };
    await renderSignedIn(<ShareCardScreen />);
    expect(await screen.findByText('This workout isn’t on this phone.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.queryByTestId('share-card')).toBeNull();
  });

  it('the analysis screen’s Share opens this screen for the same workout', async () => {
    const id = await seedWorkout();
    mockParams = { id };
    await renderSignedIn(<AnalysisScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Share' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/share-card/[id]', params: { id } });
  });
});
