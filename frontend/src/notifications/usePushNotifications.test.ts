/**
 * Tests for the app-wide push hook (B47): it registers silently (never asking) while signed in and
 * not at all when signed out, and a tapped notification opens its screen only when the path is
 * one a push may open — including the tap that launched the app, followed once.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { PushRegistrationPort } from './pushRegistration';
import { usePushNotifications } from './usePushNotifications';

type NotificationsModule = typeof import('expo-notifications');

const ID = 'a0000000-0000-4000-8000-000000000001';

function fakePort() {
  const register = jest.fn(async (_userId: string, _options: { ask: boolean }) => 'off' as const);
  const stop = jest.fn();
  const port: PushRegistrationPort = { register, watchTokenChanges: jest.fn(() => stop), unregister: async () => {} };
  return { port, register, stop };
}

/** A response as expo-notifications hands it over. */
const response = (identifier: string, path: unknown) => ({ notification: { request: { identifier, content: { data: { path } } } } });
type Response = ReturnType<typeof response>;

function fakeModule(last: Response | null = null) {
  let listener: ((r: Response) => void) | null = null;
  const cleared = jest.fn(async () => {});
  const module = {
    addNotificationResponseReceivedListener: (fn: (r: Response) => void) => {
      listener = fn;
      return {
        remove: () => {
          listener = null;
        },
      };
    },
    getLastNotificationResponseAsync: async () => last,
    clearLastNotificationResponseAsync: cleared,
  } as unknown as NotificationsModule;
  return { module, tap: (r: Response) => act(() => listener?.(r)), cleared };
}

describe('usePushNotifications', () => {
  it('registers without asking while signed in, and stops watching tokens on sign-out', async () => {
    const { port, register, stop } = fakePort();
    const { module } = fakeModule();
    const view = await renderHook(
      (props: { userId: string | null }) =>
        usePushNotifications({ userId: props.userId, ready: true, navigate: jest.fn(), port, load: () => module }),
      { initialProps: { userId: 'u1' } },
    );
    expect(register).toHaveBeenCalledWith('u1', { ask: false });
    await view.rerender({ userId: null });
    expect(stop).toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('does nothing while signed out', async () => {
    const { port, register } = fakePort();
    await renderHook(() => usePushNotifications({ userId: null, ready: true, navigate: jest.fn(), port, load: () => null }));
    expect(register).not.toHaveBeenCalled();
  });

  it('opens a tapped notification’s screen, and ignores a path a push may not open', async () => {
    const { port } = fakePort();
    const { module, tap } = fakeModule();
    const navigate = jest.fn();
    await renderHook(() => usePushNotifications({ userId: 'u1', ready: true, navigate, port, load: () => module }));
    await tap(response('n1', `/post-comments/${ID}`));
    await tap(response('n2', '/delete-account'));
    await tap(response('n1', `/post-comments/${ID}`)); // the same tap twice is followed once
    expect(navigate.mock.calls).toEqual([[`/post-comments/${ID}`]]);
  });

  it('follows the tap that launched the app once, then forgets it', async () => {
    const { port } = fakePort();
    const { module, cleared } = fakeModule(response('cold', `/team/${ID}`));
    const navigate = jest.fn();
    await renderHook(() => usePushNotifications({ userId: 'u1', ready: true, navigate, port, load: () => module }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/team/${ID}`));
    await waitFor(() => expect(cleared).toHaveBeenCalled());
  });

  it('does not follow taps until the navigator is ready', async () => {
    const { port } = fakePort();
    const { module, tap } = fakeModule();
    const navigate = jest.fn();
    await renderHook(() => usePushNotifications({ userId: 'u1', ready: false, navigate, port, load: () => module }));
    await tap(response('n1', `/profile/${ID}`));
    expect(navigate).not.toHaveBeenCalled();
  });
});
