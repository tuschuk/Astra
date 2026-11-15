/**
 * Tests for `wipeDeviceData` (B32): after an account is deleted the phone signs out first, then
 * deletes the database, clears saved preferences and deletes waiting photos — a failing step
 * never stops the ones after it, and a refused sign-out (the auth provider reports failure
 * rather than throwing) is reported back. Also checks the real key-value step empties the
 * store. The other native steps are fakes.
 */
import { describe, expect, it, jest } from '@jest/globals';
import KeyValueStore from 'expo-sqlite/kv-store';

import { deviceWipeSteps, wipeDeviceData, type WipeSteps } from './wipeDevice';

/** Steps that log their name, with the named ones failing. */
function loggingSteps(log: string[], failing: readonly string[] = []): WipeSteps {
  const step = (name: string) => async () => {
    log.push(name);
    if (failing.includes(name)) throw new Error(`${name} broke`);
  };
  return {
    deleteDatabase: step('delete-db'),
    clearKeyValueStore: step('clear-kv'),
    deleteWaitingPhotos: step('delete-photos'),
  };
}

describe('wipeDeviceData', () => {
  it('signs out first, then wipes in order', async () => {
    const log: string[] = [];
    const result = await wipeDeviceData(async () => {
      log.push('sign-out');
      return { ok: true };
    }, loggingSteps(log));
    expect(log).toEqual(['sign-out', 'delete-db', 'clear-kv', 'delete-photos']);
    expect(result).toEqual({ signedOut: true });
  });

  it('carries on past every failing step and never throws', async () => {
    const log: string[] = [];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await wipeDeviceData(async () => {
      log.push('sign-out');
      throw new Error('sign-out broke');
    }, loggingSteps(log, ['delete-db', 'clear-kv']));
    expect(log).toEqual(['sign-out', 'delete-db', 'clear-kv', 'delete-photos']);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ signedOut: false });
    warn.mockRestore();
  });

  it('reports a refused sign-out (an answer, not a throw) and still wipes', async () => {
    const log: string[] = [];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await wipeDeviceData(async () => ({ ok: false }), loggingSteps(log));
    expect(result).toEqual({ signedOut: false });
    expect(log).toEqual(['delete-db', 'clear-kv', 'delete-photos']);
    warn.mockRestore();
  });

  it('really empties the key-value store', async () => {
    await KeyValueStore.setItem('astra.plateRack', '{"kg":[20]}');
    await deviceWipeSteps.clearKeyValueStore();
    expect(await KeyValueStore.getItem('astra.plateRack')).toBeNull();
  });
});
