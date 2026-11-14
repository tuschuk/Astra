/**
 * A fake Supabase auth client — TEST USE ONLY (nothing in the app imports it).
 *
 * Why: the Testing rules forbid touching the real Supabase project. This fake
 * behaves like `supabase.auth` closely enough to drive AuthProvider and the
 * auth screens: it can start with a saved session (simulating "kill the app
 * and reopen"), record every call, and fire auth-change events the way the
 * real client does after sign-in and sign-out.
 */
import { jest } from '@jest/globals';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { AppStateStatus } from 'react-native';

import type { AuthClient } from '@/auth/AuthProvider';
import type { AuthErrorLike } from '@/auth/errors';

/** Builds a minimal but correctly shaped session for a given email. */
export function fakeSession(email = 'lifter@example.com'): Session {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-11-14T00:00:00Z',
    },
  };
}

interface FakeOptions {
  /** The session "saved on the device" when the app opens. */
  storedSession?: Session | null;
  /** Make the launch restore throw (corrupt storage, etc.). */
  restoreThrows?: boolean;
  /** Error returned by signInWithPassword. */
  signInError?: AuthErrorLike;
  /** Error returned by signUp. */
  signUpError?: AuthErrorLike;
  /** When true, signUp returns no session (email confirmation required). */
  requireEmailConfirmation?: boolean;
}

export type FakeAuthClient = AuthClient & {
  /** Fires an auth-change event, as the real client does. */
  emit(event: AuthChangeEvent, session: Session | null): void;
  /** How many auth-change listeners are currently attached. */
  listenerCount(): number;
};

/** Creates a fake auth client. Every method is a Jest mock, so calls can be asserted. */
export function createFakeAuthClient(options: FakeOptions = {}): FakeAuthClient {
  const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const emit = (event: AuthChangeEvent, session: Session | null) => {
    listeners.forEach((listener) => listener(event, session));
  };

  const client: FakeAuthClient = {
    emit,
    listenerCount: () => listeners.size,
    getSession: jest.fn(async () => {
      if (options.restoreThrows) throw new Error('storage unavailable');
      return { data: { session: options.storedSession ?? null }, error: null };
    }),
    onAuthStateChange: jest.fn((callback: (event: AuthChangeEvent, session: Session | null) => void) => {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    }),
    signInWithPassword: jest.fn(async ({ email }: { email: string; password: string }) => {
      if (options.signInError) return { data: { session: null }, error: options.signInError };
      const session = fakeSession(email);
      emit('SIGNED_IN', session);
      return { data: { session }, error: null };
    }),
    signUp: jest.fn(
      async ({ email }: { email: string; password: string; options: { data: { birthdate: string } } }) => {
        if (options.signUpError) return { data: { session: null }, error: options.signUpError };
        if (options.requireEmailConfirmation) return { data: { session: null }, error: null };
        const session = fakeSession(email);
        emit('SIGNED_IN', session);
        return { data: { session }, error: null };
      },
    ),
    signOut: jest.fn(async () => {
      emit('SIGNED_OUT', null);
      return { error: null };
    }),
    startAutoRefresh: jest.fn(async () => {}),
    stopAutoRefresh: jest.fn(async () => {}),
  };
  return client;
}

/** A stand-in for React Native's AppState that tests can flip between foreground and background. */
export function createFakeAppState(initial: AppStateStatus = 'active') {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const fake = {
    currentState: initial as string | null | undefined,
    addEventListener: (_type: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.add(listener);
      return { remove: () => void listeners.delete(listener) };
    },
    /** Simulates the app moving to the foreground or background. */
    set(state: AppStateStatus) {
      fake.currentState = state;
      listeners.forEach((listener) => listener(state));
    },
    listenerCount: () => listeners.size,
  };
  return fake;
}
