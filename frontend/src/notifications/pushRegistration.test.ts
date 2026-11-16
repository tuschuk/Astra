/**
 * Tests for push registration (B47) over a fake `expo-notifications` and a fake server: the three
 * reasons push can be unavailable (no module, no project id, an unsupported platform), never
 * prompting unless asked, asking when asked, saving the token with the platform and device name,
 * re-saving on a token change, and the best-effort, time-capped unregister on sign-out.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { createPushRegistration, isExpoGoOnAndroid, type PushTokenServer } from './pushRegistration';

type NotificationsModule = typeof import('expo-notifications');

const TOKEN = 'ExponentPushToken[abc123]';

/** A fake notifications module: permission as given, a fixed token, and a captured token listener. */
function fakeModule(permission: { granted: boolean; canAskAgain: boolean }, answer = { granted: true, canAskAgain: true }) {
  let tokenListener: (() => void) | null = null;
  const calls = { requested: 0, channels: 0, tokens: 0, removed: 0 };
  const module = {
    getPermissionsAsync: async () => permission,
    requestPermissionsAsync: async () => {
      calls.requested += 1;
      return answer;
    },
    setNotificationChannelAsync: async () => {
      calls.channels += 1;
    },
    AndroidImportance: { DEFAULT: 3 },
    getExpoPushTokenAsync: async ({ projectId }: { projectId: string }) => {
      calls.tokens += 1;
      if (projectId !== 'proj') throw new Error('wrong project');
      return { type: 'expo', data: TOKEN };
    },
    addPushTokenListener: (listener: () => void) => {
      tokenListener = listener;
      return {
        remove: () => {
          calls.removed += 1;
          tokenListener = null;
        },
      };
    },
  };
  return { module: module as unknown as NotificationsModule, calls, fireTokenChange: () => tokenListener?.() };
}

/** A fake server recording what was saved and removed. */
function fakeServer(options: { failRegister?: boolean; hangRemove?: boolean } = {}) {
  const saved: { token: string; platform: string; deviceName: string | null }[] = [];
  const removed: string[] = [];
  const server: PushTokenServer = {
    async register(token, platform, deviceName) {
      if (options.failRegister) throw new Error('offline');
      saved.push({ token, platform, deviceName });
    },
    async remove(token) {
      if (options.hangRemove) return new Promise<void>(() => {});
      removed.push(token);
    },
  };
  return { server, saved, removed };
}

function build(
  module: NotificationsModule | null,
  server: PushTokenServer,
  overrides: Partial<{ projectId: string | null; platform: string; remotePushSupported: boolean }> = {},
) {
  return createPushRegistration({
    load: () => module,
    projectId: () => ('projectId' in overrides ? (overrides.projectId ?? null) : 'proj'),
    platform: overrides.platform ?? 'ios',
    remotePushSupported: () => overrides.remotePushSupported ?? true,
    deviceName: () => 'Test Phone',
    server,
  });
}

describe('push registration — unavailable', () => {
  it('with no notification module', async () => {
    const { server, saved } = fakeServer();
    expect(await build(null, server).register('u', { ask: true })).toBe('unavailable');
    expect(saved).toEqual([]);
  });

  it('with no Expo project id — and the module is never even loaded', async () => {
    const load = jest.fn(() => null);
    const port = createPushRegistration({
      load,
      projectId: () => null,
      platform: 'ios',
      remotePushSupported: () => true,
      deviceName: () => null,
      server: fakeServer().server,
    });
    expect(await port.register('u', { ask: true })).toBe('unavailable');
    expect(load).not.toHaveBeenCalled();
  });

  it('on a build that cannot receive remote push (Expo Go on Android), without trying for a token', async () => {
    const { module, calls } = fakeModule({ granted: true, canAskAgain: true });
    const port = build(module, fakeServer().server, { platform: 'android', remotePushSupported: false });
    expect(await port.register('u', { ask: true })).toBe('unavailable');
    expect(calls.tokens).toBe(0);
    expect(calls.requested).toBe(0);
  });

  it('isExpoGoOnAndroid is false off Android', () => {
    expect(isExpoGoOnAndroid('ios')).toBe(false);
  });

  it('on a platform that is not iOS or Android', async () => {
    const { module } = fakeModule({ granted: true, canAskAgain: true });
    expect(await build(module, fakeServer().server, { platform: 'web' }).register('u', { ask: false })).toBe('unavailable');
  });
});

describe('push registration — permission', () => {
  it('never prompts when not asked: an un-asked phone answers off and saves nothing', async () => {
    const { module, calls } = fakeModule({ granted: false, canAskAgain: true });
    const { server, saved } = fakeServer();
    expect(await build(module, server).register('u', { ask: false })).toBe('off');
    expect(calls.requested).toBe(0);
    expect(saved).toEqual([]);
  });

  it('prompts when asked, and saves the token if the lifter says yes', async () => {
    const { module, calls } = fakeModule({ granted: false, canAskAgain: true });
    const { server, saved } = fakeServer();
    expect(await build(module, server).register('u', { ask: true })).toBe('on');
    expect(calls.requested).toBe(1);
    expect(saved).toEqual([{ token: TOKEN, platform: 'ios', deviceName: 'Test Phone' }]);
  });

  it('answers off when the lifter says no but may be asked again, denied when they may not', async () => {
    const no = fakeModule({ granted: false, canAskAgain: true }, { granted: false, canAskAgain: true });
    expect(await build(no.module, fakeServer().server).register('u', { ask: true })).toBe('off');
    const never = fakeModule({ granted: false, canAskAgain: true }, { granted: false, canAskAgain: false });
    expect(await build(never.module, fakeServer().server).register('u', { ask: true })).toBe('denied');
  });

  it('does not prompt a phone that already refused for good', async () => {
    const { module, calls } = fakeModule({ granted: false, canAskAgain: false });
    expect(await build(module, fakeServer().server).register('u', { ask: true })).toBe('denied');
    expect(calls.requested).toBe(0);
  });

  it('with permission already given, saves silently without prompting (the app-start path)', async () => {
    const { module, calls } = fakeModule({ granted: true, canAskAgain: true });
    const { server, saved } = fakeServer();
    expect(await build(module, server).register('u', { ask: false })).toBe('on');
    expect(calls.requested).toBe(0);
    expect(saved).toHaveLength(1);
  });
});

describe('push registration — saving', () => {
  it('sets up the Android channel once before the first token', async () => {
    const { module, calls } = fakeModule({ granted: true, canAskAgain: true });
    const { server, saved } = fakeServer();
    const port = build(module, server, { platform: 'android' });
    await port.register('u', { ask: false });
    await port.register('u', { ask: false });
    expect(calls.channels).toBe(1);
    expect(saved.map((s) => s.platform)).toEqual(['android', 'android']);
  });

  it('answers failed (not a crash) when the server save fails', async () => {
    const { module } = fakeModule({ granted: true, canAskAgain: true });
    expect(await build(module, fakeServer({ failRegister: true }).server).register('u', { ask: false })).toBe('failed');
  });

  it('re-saves when Expo hands the phone a new token, and stops when told to', async () => {
    const { module, calls, fireTokenChange } = fakeModule({ granted: true, canAskAgain: true });
    const { server, saved } = fakeServer();
    const port = build(module, server);
    await port.register('u', { ask: false });
    const stop = port.watchTokenChanges('u');
    fireTokenChange();
    await new Promise((resolve) => setImmediate(resolve));
    expect(saved).toHaveLength(2);
    stop();
    expect(calls.removed).toBe(1);
  });

  it('ignores a token change before any save for that lifter (nothing to refresh)', async () => {
    const { module, fireTokenChange } = fakeModule({ granted: false, canAskAgain: true });
    const { server, saved } = fakeServer();
    const port = build(module, server);
    port.watchTokenChanges('u');
    fireTokenChange();
    await new Promise((resolve) => setImmediate(resolve));
    expect(saved).toEqual([]);
  });
});

describe('push registration — unregister', () => {
  it('forgets the saved token on the server, once', async () => {
    const { module } = fakeModule({ granted: true, canAskAgain: true });
    const { server, removed } = fakeServer();
    const port = build(module, server);
    await port.register('u', { ask: false });
    await port.unregister();
    await port.unregister();
    expect(removed).toEqual([TOKEN]);
  });

  it('does nothing when nothing was saved this session', async () => {
    const { server, removed } = fakeServer();
    await build(null, server).unregister();
    expect(removed).toEqual([]);
  });

  it('gives up after the timeout instead of holding sign-out hostage', async () => {
    const { module } = fakeModule({ granted: true, canAskAgain: true });
    const port = build(module, fakeServer({ hangRemove: true }).server);
    await port.register('u', { ask: false });
    const started = Date.now();
    await port.unregister(20);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('swallows a server failure', async () => {
    const { module } = fakeModule({ granted: true, canAskAgain: true });
    const server: PushTokenServer = {
      register: async () => {},
      remove: async () => {
        throw new Error('offline');
      },
    };
    const port = build(module, server);
    await port.register('u', { ask: false });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(port.unregister()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
