/**
 * Tests for useAutosaveText — the debounced, flushable autosave behind every title and note box
 * in the logger (LOG-3). The save is a fake (a jest mock), and the "store" only answers whether
 * the workout is still active, so each rule of the hook's contract is checked on its own:
 * debounce, flush, unmount-flushes, dead-workout drop, errors reported, and the registry.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { ActiveWorkoutStatus } from './activeWorkout';
import { AutosaveRegistryContext, createAutosaveRegistry, useAutosaveText, type AutosaveRegistry } from './useAutosaveText';

/** A short delay so tests run on real timers without dragging. */
const DELAY = 40;

/** A stand-in store whose status a test can change. */
function fakeStore(initial: ActiveWorkoutStatus = 'active') {
  let status = initial;
  return {
    getStatus: () => status,
    set(next: ActiveWorkoutStatus) {
      status = next;
    },
  };
}

/** Waits a little longer than the debounce. */
const settle = () => new Promise((resolve) => setTimeout(resolve, DELAY * 3));

async function setup({
  initial = null as string | null,
  save = jest.fn((_text: string): Promise<unknown> => Promise.resolve()),
  store = fakeStore(),
  registry = null as AutosaveRegistry | null,
} = {}) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(AutosaveRegistryContext.Provider, { value: registry }, children);
  const hook = await renderHook(() => useAutosaveText({ initial, save, store, delayMs: DELAY }), { wrapper });
  return { ...hook, save, store };
}

describe('useAutosaveText', () => {
  it('starts with the saved text (or empty) and saves nothing until typed into', async () => {
    const { result, save } = await setup({ initial: 'Push day' });
    expect(result.current.text).toBe('Push day');
    await settle();
    expect(save).not.toHaveBeenCalled();
    const empty = await setup();
    expect(empty.result.current.text).toBe('');
  });

  it('saves once, with the final text, after typing settles', async () => {
    const { result, save } = await setup();
    await act(async () => {
      result.current.onChangeText('P');
      result.current.onChangeText('Pu');
      result.current.onChangeText('Push');
    });
    expect(result.current.text).toBe('Push');
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith('Push');
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush saves pending text at once and resolves after the save is done', async () => {
    let finishSave: () => void = () => undefined;
    const save = jest.fn((_text: string) => new Promise<void>((resolve) => (finishSave = resolve)));
    const { result } = await setup({ save });
    await act(async () => result.current.onChangeText('belt on'));
    let flushed = false;
    let flush: Promise<void> = Promise.resolve();
    await act(async () => {
      flush = result.current.flush().then(() => {
        flushed = true;
      });
    });
    expect(save).toHaveBeenCalledWith('belt on');
    expect(flushed).toBe(false);
    await act(async () => {
      finishSave();
      await flush;
    });
    expect(flushed).toBe(true);
    // The timer was cancelled by the flush: no second save.
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing pending saves nothing', async () => {
    const { result, save } = await setup({ initial: 'x' });
    await act(async () => result.current.flush());
    expect(save).not.toHaveBeenCalled();
  });

  it('drops a pending save silently once the workout is no longer active', async () => {
    const store = fakeStore();
    const { result, save } = await setup({ store });
    await act(async () => result.current.onChangeText('too late'));
    store.set('finished');
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    await act(async () => result.current.onChangeText('still too late'));
    store.set('discarded');
    await act(async () => result.current.flush());
    expect(save).not.toHaveBeenCalled();
  });

  it('unmount saves pending text instead of losing it', async () => {
    const { result, save, unmount } = await setup();
    await act(async () => result.current.onChangeText('typed then left'));
    await act(async () => unmount());
    expect(save).toHaveBeenCalledWith('typed then left');
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reports a refused save in `error` instead of throwing, and clears it on the next success', async () => {
    const save = jest.fn((text: string) =>
      text.length > 3 ? Promise.reject(new RangeError('notes must be at most 3 characters')) : Promise.resolve(),
    );
    const { result } = await setup({ save });
    await act(async () => result.current.onChangeText('toolong'));
    await act(async () => result.current.flush());
    expect(result.current.error).toBeInstanceOf(RangeError);
    await act(async () => result.current.onChangeText('ok'));
    await act(async () => result.current.flush());
    expect(result.current.error).toBeNull();
  });

  it('flush reports whether the latest save landed — including one the timer already ran', async () => {
    const save = jest.fn((text: string) =>
      text === 'bad' ? Promise.reject(new RangeError('too long')) : Promise.resolve(),
    );
    const { result } = await setup({ save });
    expect(await result.current.flush()).toBe(true); // nothing typed yet
    await act(async () => result.current.onChangeText('bad'));
    // The timer runs the refused save on its own; a later flush with nothing new still says so.
    await waitFor(() => expect(save).toHaveBeenCalledWith('bad'));
    let ok = true;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(false);
    await act(async () => result.current.onChangeText('good'));
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
  });

  it('flushAll resolves false when any box’s save was refused', async () => {
    const registry = createAutosaveRegistry();
    const fine = await setup({ registry });
    const refused = await setup({
      registry,
      save: jest.fn((_text: string) => Promise.reject(new RangeError('too long'))),
    });
    await act(async () => {
      fine.result.current.onChangeText('ok');
      refused.result.current.onChangeText('x');
    });
    let ok = true;
    await act(async () => {
      ok = await registry.flushAll();
    });
    expect(ok).toBe(false);
    expect(fine.save).toHaveBeenCalledWith('ok');
    expect(refused.result.current.error).toBeInstanceOf(RangeError);
  });

  it('joins the screen registry, so flushAll saves it with the others', async () => {
    const registry = createAutosaveRegistry();
    const a = await setup({ registry });
    const b = await setup({ registry });
    await act(async () => {
      a.result.current.onChangeText('title');
      b.result.current.onChangeText('note');
    });
    await act(async () => registry.flushAll());
    expect(a.save).toHaveBeenCalledWith('title');
    expect(b.save).toHaveBeenCalledWith('note');
    // An unmounted box leaves the registry.
    await act(async () => a.unmount());
    await act(async () => b.result.current.onChangeText('note 2'));
    await act(async () => registry.flushAll());
    expect(a.save).toHaveBeenCalledTimes(1);
    expect(b.save).toHaveBeenCalledTimes(2);
  });
});
