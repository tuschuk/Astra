/**
 * Tests for the one-time push ask after the first Post (B47): it asks the first time, never again
 * (whatever the answer), and a broken store or port never throws into the Post flow.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { ASKED_AFTER_POST_KEY, maybeAskForPushOnce, type AskOnceStorage } from './askOnce';
import type { PushRegistrationPort, PushState } from './pushRegistration';

function memoryStorage(): AskOnceStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value);
    },
  };
}

function fakePort() {
  const register = jest.fn(async (_userId: string, _options: { ask: boolean }): Promise<PushState> => 'off');
  const port: PushRegistrationPort = { register, watchTokenChanges: () => () => {}, unregister: async () => {} };
  return { port, register };
}

describe('maybeAskForPushOnce', () => {
  it('asks (with the prompt allowed) the first time, then never again', async () => {
    const storage = memoryStorage();
    const { port, register } = fakePort();
    await maybeAskForPushOnce('u', port, storage);
    await maybeAskForPushOnce('u', port, storage);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('u', { ask: true });
    expect(storage.items.get(ASKED_AFTER_POST_KEY)).toBe('1');
  });

  it('does not use up the ask while push is unavailable on this build (no prompt could show)', async () => {
    const storage = memoryStorage();
    const { port, register } = fakePort();
    register.mockResolvedValueOnce('unavailable');
    await maybeAskForPushOnce('u', port, storage);
    expect(storage.items.has(ASKED_AFTER_POST_KEY)).toBe(false);
    await maybeAskForPushOnce('u', port, storage);
    expect(register).toHaveBeenCalledTimes(2);
    expect(storage.items.get(ASKED_AFTER_POST_KEY)).toBe('1');
  });

  it('never throws, even when the store is broken', async () => {
    const { port, register } = fakePort();
    const broken: AskOnceStorage = {
      getItem: async () => {
        throw new Error('disk');
      },
      setItem: async () => {},
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(maybeAskForPushOnce('u', port, broken)).resolves.toBeUndefined();
    expect(register).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
