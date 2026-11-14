/**
 * Tests for the Supabase client module's testable logic: config validation
 * and foreground-only token refresh. Never creates a client against the real
 * project (Testing rules).
 */
import { describe, expect, it, jest } from '@jest/globals';

import { createFakeAppState } from '@/test-utils/fakeAuthClient';

import { readSupabaseConfig, refreshWhileForegrounded } from './supabase';

describe('readSupabaseConfig', () => {
  it('returns the trimmed URL and key when both are set', () => {
    expect(
      readSupabaseConfig({
        EXPO_PUBLIC_SUPABASE_URL: ' https://example.supabase.co ',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_x',
      }),
    ).toEqual({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_x' });
  });

  it('names the missing variable', () => {
    expect(() => readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' })).toThrow(
      /EXPO_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });

  it('names both when nothing is set (or values are blank)', () => {
    expect(() => readSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: '  ' })).toThrow(
      /EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });
});

describe('refreshWhileForegrounded', () => {
  function controls() {
    return { startAutoRefresh: jest.fn<() => void>(), stopAutoRefresh: jest.fn<() => void>() };
  }

  it('starts refreshing immediately when the app is already in the foreground', () => {
    const auth = controls();
    refreshWhileForegrounded(auth, createFakeAppState('active'));
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh while launched in the background', () => {
    const auth = controls();
    refreshWhileForegrounded(auth, createFakeAppState('background'));
    expect(auth.startAutoRefresh).not.toHaveBeenCalled();
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('follows foreground/background changes and stops on cleanup', () => {
    const auth = controls();
    const appState = createFakeAppState('active');
    const stop = refreshWhileForegrounded(auth, appState);
    appState.set('inactive');
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    appState.set('active');
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(2);
    stop();
    expect(appState.listenerCount()).toBe(0);
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(2);
  });
});
