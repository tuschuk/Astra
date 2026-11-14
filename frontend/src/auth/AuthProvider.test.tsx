/**
 * Session-logic tests for AuthProvider, all against a fake Supabase client:
 * launch restore (the "kill the app, reopen, still signed in" path), the
 * sign-in / sign-up / sign-out transitions, the 18+ gate never reaching the
 * server, and listener cleanup.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

import { UNDER_AGE_MESSAGE } from './age';
import { AuthProvider, useAuth, type AuthContextValue } from './AuthProvider';
import { createFakeAppState, createFakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

const TODAY = () => '2026-11-14';
const ADULT = { month: '3', day: '7', year: '1995' };

/** Renders the provider and exposes the live context value to the test. */
async function setup(client = createFakeAuthClient(), appState = createFakeAppState()) {
  const latestRef: { current: AuthContextValue | null } = { current: null };
  function Probe() {
    const auth = useAuth();
    // Publish the latest context value to the test after each commit.
    useEffect(() => {
      latestRef.current = auth;
    });
    return <Text>{auth.status}</Text>;
  }
  const screen = await render(
    <AuthProvider client={client} appState={appState} today={TODAY}>
      <Probe />
    </AuthProvider>,
  );
  const auth = () => {
    if (!latestRef.current) throw new Error('provider not rendered');
    return latestRef.current;
  };
  return { screen, client, appState, auth };
}

describe('AuthProvider — launch restore', () => {
  it('restores a saved session straight to signedIn (reopen after kill)', async () => {
    const stored = fakeSession('saved@example.com');
    const { screen, auth } = await setup(createFakeAuthClient({ storedSession: stored }));
    await waitFor(() => expect(screen.getByText('signedIn')).toBeTruthy());
    expect(auth().session?.user.email).toBe('saved@example.com');
  });

  it('resolves to signedOut when nothing is saved', async () => {
    const { screen, auth } = await setup();
    await waitFor(() => expect(screen.getByText('signedOut')).toBeTruthy());
    expect(auth().session).toBeNull();
  });

  it('resolves to signedOut (never hangs) when the restore throws', async () => {
    const { screen } = await setup(createFakeAuthClient({ restoreThrows: true }));
    await waitFor(() => expect(screen.getByText('signedOut')).toBeTruthy());
  });

  it('a late restore never overrides an auth event that already settled the state', async () => {
    const client = createFakeAuthClient({ storedSession: null });
    let release: () => void = () => {};
    client.getSession = () =>
      new Promise((resolve) => {
        release = () => resolve({ data: { session: null }, error: null });
      });
    const { screen } = await setup(client);
    await act(async () => client.emit('SIGNED_IN', fakeSession()));
    await act(async () => release());
    expect(screen.getByText('signedIn')).toBeTruthy();
  });
});

describe('AuthProvider — actions', () => {
  it('signIn moves to signedIn', async () => {
    const { screen, client, auth } = await setup();
    await waitFor(() => expect(screen.getByText('signedOut')).toBeTruthy());
    let result;
    await act(async () => {
      result = await auth().signIn(' lifter@example.com ', 'secret123');
    });
    expect(result).toEqual({ ok: true });
    expect(client.signInWithPassword).toHaveBeenCalledWith({ email: 'lifter@example.com', password: 'secret123' });
    expect(screen.getByText('signedIn')).toBeTruthy();
  });

  it('signIn with bad credentials stays signedOut and returns a friendly message', async () => {
    const client = createFakeAuthClient({
      signInError: { message: 'Invalid login credentials', code: 'invalid_credentials' },
    });
    const { screen, auth } = await setup(client);
    let result;
    await act(async () => {
      result = await auth().signIn('a@b.co', 'wrong');
    });
    expect(result).toEqual({ ok: false, message: "That email and password don't match an account." });
    expect(screen.getByText('signedOut')).toBeTruthy();
  });

  it('signIn with empty fields never calls the server', async () => {
    const { client, auth } = await setup();
    const result = await auth().signIn('', '');
    expect(result.ok).toBe(false);
    expect(client.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signIn reports a thrown network failure instead of crashing', async () => {
    const client = createFakeAuthClient();
    client.signInWithPassword = async () => {
      throw new Error('Network request failed');
    };
    const { auth } = await setup(client);
    const result = await auth().signIn('a@b.co', 'secret123');
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/connection/) });
  });

  it('signUp sends the checked birthdate as metadata and signs the user in', async () => {
    const { screen, client, auth } = await setup();
    let result;
    await act(async () => {
      result = await auth().signUp({ email: 'new@example.com', password: 'secret123', birthdate: ADULT });
    });
    expect(result).toEqual({ ok: true, needsEmailConfirmation: false });
    expect(client.signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'secret123',
      options: { data: { birthdate: '1995-03-07' } },
    });
    expect(screen.getByText('signedIn')).toBeTruthy();
  });

  it('signUp refuses an under-18 birthdate without ever calling the server', async () => {
    const { screen, client, auth } = await setup();
    const result = await auth().signUp({
      email: 'kid@example.com',
      password: 'secret123',
      birthdate: { month: '11', day: '15', year: '2008' },
    });
    expect(result).toEqual({ ok: false, message: UNDER_AGE_MESSAGE });
    expect(client.signUp).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('signedOut')).toBeTruthy());
  });

  it('signUp refuses an invalid birthdate and a short password without calling the server', async () => {
    const { client, auth } = await setup();
    expect(
      (await auth().signUp({ email: 'a@b.co', password: 'secret123', birthdate: { month: '2', day: '30', year: '1990' } }))
        .ok,
    ).toBe(false);
    expect((await auth().signUp({ email: 'a@b.co', password: '123', birthdate: ADULT })).ok).toBe(false);
    expect((await auth().signUp({ email: '  ', password: 'secret123', birthdate: ADULT })).ok).toBe(false);
    expect(client.signUp).not.toHaveBeenCalled();
  });

  it('signUp reports when email confirmation is required (no session returned)', async () => {
    const { screen, auth } = await setup(createFakeAuthClient({ requireEmailConfirmation: true }));
    let result;
    await act(async () => {
      result = await auth().signUp({ email: 'new@example.com', password: 'secret123', birthdate: ADULT });
    });
    expect(result).toEqual({ ok: true, needsEmailConfirmation: true });
    expect(screen.getByText('signedOut')).toBeTruthy();
  });

  it('signUp maps the server-side gate refusal to a friendly message', async () => {
    const client = createFakeAuthClient({ signUpError: { message: 'Database error saving new user', status: 500 } });
    const { auth } = await setup(client);
    const result = await auth().signUp({ email: 'a@b.co', password: 'secret123', birthdate: ADULT });
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/couldn't create your account/) });
  });

  it('signOut clears the session locally and moves to signedOut', async () => {
    const { screen, client, auth } = await setup(createFakeAuthClient({ storedSession: fakeSession() }));
    await waitFor(() => expect(screen.getByText('signedIn')).toBeTruthy());
    await act(async () => {
      await auth().signOut();
    });
    expect(client.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.getByText('signedOut')).toBeTruthy();
  });
});

describe('AuthProvider — lifecycle', () => {
  it('refreshes tokens only while the app is in the foreground', async () => {
    const { client, appState } = await setup();
    expect(client.startAutoRefresh).toHaveBeenCalledTimes(1);
    await act(async () => appState.set('background'));
    expect(client.stopAutoRefresh).toHaveBeenCalledTimes(1);
    await act(async () => appState.set('active'));
    expect(client.startAutoRefresh).toHaveBeenCalledTimes(2);
  });

  it('removes its auth and AppState listeners on unmount', async () => {
    const { screen, client, appState } = await setup();
    expect(client.listenerCount()).toBe(1);
    expect(appState.listenerCount()).toBe(1);
    await screen.unmount();
    expect(client.listenerCount()).toBe(0);
    expect(appState.listenerCount()).toBe(0);
  });

  it('useAuth outside the provider fails loudly', async () => {
    function Orphan() {
      useAuth();
      return null;
    }
    // React 19's concurrent root reports render errors to error boundaries
    // rather than rejecting render(), so catch it with a tiny boundary.
    let caught: Error | null = null;
    class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error: Error) {
        caught = error;
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await render(
      <Boundary>
        <Orphan />
      </Boundary>,
    );
    spy.mockRestore();
    expect(String(caught)).toMatch(/inside <AuthProvider>/);
  });
});
