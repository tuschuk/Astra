/**
 * AuthProvider — who is signed in, for the whole app.
 *
 * What it does: when the app opens it reads the saved session from the
 * device (no network needed, so a signed-in lifter can open Astra with no
 * signal), then keeps listening for sign-in, sign-out and token refreshes.
 * Screens read the result with `useAuth()`, and the root layout uses its
 * `status` to decide whether to show the sign-in screens or the tabs.
 *
 * It also offers the three account actions — sign in, sign up, sign out —
 * so screens never talk to Supabase directly. Sign up runs the 18+ age gate
 * first and never contacts the server for an under-18 birthdate.
 *
 * The Supabase client is injectable (`client` prop) — that's how the Jest
 * tests drive every path with a fake, never touching the real project.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { getSupabase, refreshWhileForegrounded, type AppStateLike } from '@/lib/supabase';

import { checkBirthdate, localToday, type BirthdateFields, type ISODate } from './age';
import { UNREACHABLE_MESSAGE, friendlyAuthError, type AuthErrorLike } from './errors';
import { PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT } from './password';

/** What Supabase returns from calls that may produce a session. */
type SessionResponse = Promise<{ data: { session: Session | null }; error: AuthErrorLike | null }>;

/**
 * The part of Supabase's auth API this app uses. The real
 * `supabase.auth` satisfies it; tests pass a small fake shaped the same way.
 */
export interface AuthClient {
  getSession(): SessionResponse;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
  signInWithPassword(credentials: { email: string; password: string }): SessionResponse;
  signUp(credentials: {
    email: string;
    password: string;
    options: { data: { birthdate: ISODate } };
  }): SessionResponse;
  signOut(options: { scope: 'local' }): Promise<{ error: AuthErrorLike | null }>;
  startAutoRefresh(): Promise<void>;
  stopAutoRefresh(): Promise<void>;
}

/** restoring = still reading the saved session at launch; the splash stays up. */
export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';

/** The outcome of an account action: success, or a message to show the user. */
export type AuthResult = { ok: true } | { ok: false; message: string };

/** Sign-up also says whether the account still needs its email confirmed. */
export type SignUpResult = { ok: true; needsEmailConfirmation: boolean } | { ok: false; message: string };

/** What the sign-up form collects. */
export interface SignUpInput {
  email: string;
  password: string;
  birthdate: BirthdateFields;
}

/** Everything `useAuth()` gives a screen: the current state plus the three account actions. */
export interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  signOut(): Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** The provider's internal state: where auth stands, and the session if signed in. */
interface AuthState {
  status: AuthStatus;
  session: Session | null;
}

/** Maps a session (or its absence) to the provider's state. */
function stateFor(session: Session | null): AuthState {
  return session ? { status: 'signedIn', session } : { status: 'signedOut', session: null };
}

interface AuthProviderProps {
  children: React.ReactNode;
  /** The auth API to use. Defaults to the app's real Supabase client. */
  client?: AuthClient;
  /** React Native's AppState, injectable so tests control foreground/background. */
  appState?: AppStateLike;
  /** Today's date for the age gate, injectable so tests can pin it. */
  today?: () => ISODate;
}

/**
 * Wrap the app in this once (the root layout does). It starts in
 * `restoring`, settles to `signedIn` or `signedOut` as soon as the saved
 * session has been read, and follows every auth change after that.
 */
export function AuthProvider({ children, client, appState, today = localToday }: AuthProviderProps) {
  // Resolve the client once; the real one is created lazily on first use.
  const auth = useMemo<AuthClient>(() => client ?? getSupabase().auth, [client]);
  const [state, setState] = useState<AuthState>({ status: 'restoring', session: null });

  useEffect(() => {
    let mounted = true;

    // Every later change (sign in, sign out, token refresh, expiry) arrives here.
    const {
      data: { subscription },
    } = auth.onAuthStateChange((_event, session) => {
      if (mounted) setState(stateFor(session));
    });

    // Launch restore: a local read of the saved session. Any failure resolves
    // to signed-out — the splash must never be stranded waiting on it. Only
    // applies if no auth event already settled the state.
    auth
      .getSession()
      .then(({ data, error }) => {
        if (mounted) setState((prev) => (prev.status === 'restoring' ? stateFor(error ? null : data.session) : prev));
      })
      .catch(() => {
        if (mounted) setState((prev) => (prev.status === 'restoring' ? stateFor(null) : prev));
      });

    const stopRefreshing = refreshWhileForegrounded(auth, appState);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      stopRefreshing();
    };
  }, [auth, appState]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const trimmed = email.trim();
      if (!trimmed || !password) {
        return { ok: false, message: 'Enter your email and password.' };
      }
      try {
        const { error } = await auth.signInWithPassword({ email: trimmed, password });
        return error ? { ok: false, message: friendlyAuthError(error) } : { ok: true };
      } catch {
        return { ok: false, message: UNREACHABLE_MESSAGE };
      }
    },
    [auth],
  );

  const signUp = useCallback(
    async ({ email, password, birthdate }: SignUpInput): Promise<SignUpResult> => {
      const trimmed = email.trim();
      if (!trimmed) {
        return { ok: false, message: 'Enter your email.' };
      }
      if (password.length < PASSWORD_MIN_LENGTH) {
        return { ok: false, message: PASSWORD_TOO_SHORT };
      }
      // The 18+ gate: an invalid or under-18 birthdate never reaches the server.
      const age = checkBirthdate(birthdate, today());
      if (!age.ok) {
        return { ok: false, message: age.message };
      }
      try {
        // The birthdate rides along as account metadata so the signup trigger
        // can re-check it and store it in user_body_data in the same step.
        const { data, error } = await auth.signUp({
          email: trimmed,
          password,
          options: { data: { birthdate: age.birthdate } },
        });
        if (error) return { ok: false, message: friendlyAuthError(error) };
        // No session back means the project requires email confirmation.
        return { ok: true, needsEmailConfirmation: data.session == null };
      } catch {
        return { ok: false, message: UNREACHABLE_MESSAGE };
      }
    },
    [auth, today],
  );

  const signOut = useCallback(async (): Promise<AuthResult> => {
    try {
      // 'local' clears this device's session before any network call, so
      // signing out works with no signal.
      const { error } = await auth.signOut({ scope: 'local' });
      return error ? { ok: false, message: friendlyAuthError(error) } : { ok: true };
    } catch {
      return { ok: false, message: UNREACHABLE_MESSAGE };
    }
  }, [auth]);

  const value = useMemo<AuthContextValue>(
    () => ({ status: state.status, session: state.session, signIn, signUp, signOut }),
    [state, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Reads the current auth state and actions. Must be used inside AuthProvider. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return value;
}
