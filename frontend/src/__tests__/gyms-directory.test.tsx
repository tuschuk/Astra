/**
 * Tests for the gym directory (B50, GYM-1 part): it asks for location only when opened, sends
 * the lifter's own coordinates when allowed and downtown Denver's (with the one-line notice)
 * when refused or unavailable, lists the gyms in the server's distance order with miles, opens
 * a gym's page on tap, and shows the connection message with Retry when offline. The phone's
 * location module is a stand-in (it needs a real phone), the server is the fake social client.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { renderSignedIn } from '@/test-utils/loggerTestKit';

import { GYMS_OFFLINE } from '@/social/gyms';

import GymDirectoryScreen, { DENVER, DENVER_FALLBACK_LINE } from '@/app/gyms/index';

jest.mock('expo-location', () => ({
  __esModule: true,
  Accuracy: { Low: 2 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
const mockPermission = jest.mocked(Location.requestForegroundPermissionsAsync);
const mockPosition = jest.mocked(Location.getCurrentPositionAsync);

const asked: Record<string, unknown>[] = [];
const ROWS = [
  { id: 'near', name: 'Sample Gym · Capitol Hill', address: 'Capitol Hill, Denver, CO', distance_m: 1393 },
  { id: 'far', name: 'Sample Gym · Boulder', address: 'Boulder, CO', distance_m: 38889 },
];
const fakeWithDirectory = () =>
  createFakeSocialClient(
    {},
    {
      rpc: {
        gyms_near: (params) => {
          asked.push(params);
          return ROWS;
        },
      },
    },
  );

let mockSocial = fakeWithDirectory();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

/** A granted permission answer, typed loosely: the screen reads only `status`. */
const permission = (status: 'granted' | 'denied') =>
  ({ status, granted: status === 'granted', canAskAgain: true, expires: 'never' }) as unknown as Location.LocationPermissionResponse;

beforeEach(() => {
  jest.clearAllMocks();
  asked.length = 0;
  mockSocial = fakeWithDirectory();
});

describe('gym directory', () => {
  it('allowed: sorts from my position; rows in server order with miles; tap opens the gym page', async () => {
    mockPermission.mockResolvedValue(permission('granted'));
    mockPosition.mockResolvedValue({ coords: { latitude: 39.75, longitude: -105.0 }, timestamp: 0 } as Location.LocationObject);
    await renderSignedIn(<GymDirectoryScreen />);
    expect(await screen.findByText('Sample Gym · Capitol Hill')).toBeTruthy();
    expect(asked).toEqual([{ lat: 39.75, lng: -105.0 }]);
    expect(screen.queryByText(DENVER_FALLBACK_LINE)).toBeNull();
    const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel as string);
    expect(labels.indexOf('Open gym Sample Gym · Capitol Hill, 0.9 mi')).toBeLessThan(labels.indexOf('Open gym Sample Gym · Boulder, 24 mi'));
    await fireEvent.press(screen.getByLabelText('Open gym Sample Gym · Boulder, 24 mi'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/gym/[id]', params: { id: 'far' } });
  });

  it('refused: sorts from downtown Denver and says so; never asks for a position', async () => {
    mockPermission.mockResolvedValue(permission('denied'));
    await renderSignedIn(<GymDirectoryScreen />);
    expect(await screen.findByText(DENVER_FALLBACK_LINE)).toBeTruthy();
    expect(asked).toEqual([{ lat: DENVER.lat, lng: DENVER.lng }]);
    expect(mockPosition).not.toHaveBeenCalled();
  });

  it('the position fails: falls back to Denver too', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPermission.mockResolvedValue(permission('granted'));
    mockPosition.mockRejectedValue(new Error('Location services off'));
    await renderSignedIn(<GymDirectoryScreen />);
    expect(await screen.findByText(DENVER_FALLBACK_LINE)).toBeTruthy();
    expect(asked).toEqual([{ lat: DENVER.lat, lng: DENVER.lng }]);
    warn.mockRestore();
  });

  it('offline: the connection message; Retry loads without asking for location again', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPermission.mockResolvedValue(permission('denied'));
    mockSocial.setOffline(true);
    await renderSignedIn(<GymDirectoryScreen />);
    expect(await screen.findByText(GYMS_OFFLINE)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText('Sample Gym · Capitol Hill')).toBeTruthy();
    expect(mockPermission).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
