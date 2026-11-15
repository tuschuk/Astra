/**
 * Tests for `createDatabaseHolder` — the one shared database handle behind `openAppDatabase` and
 * (B32) `closeAppDatabase`: opening is shared and retried after a failure; closing closes the
 * connection, makes the next open start afresh, and never throws. The opener is a fake.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { createDatabaseHolder } from './database';
import type { SqlDriver } from './driver';

/** A minimal driver whose close is observable. */
function fakeDriver(close: () => Promise<void> = async () => undefined): SqlDriver {
  return {
    execAsync: async () => undefined,
    runAsync: async () => ({ changes: 0 }),
    getAllAsync: async () => [],
    getFirstAsync: async () => null,
    withTransactionAsync: async (task) => task({} as never),
    closeAsync: close,
  };
}

describe('createDatabaseHolder', () => {
  it('opens once and shares the handle', async () => {
    const opener = jest.fn(async () => fakeDriver());
    const holder = createDatabaseHolder(opener);
    const first = await holder.open();
    expect(await holder.open()).toBe(first);
    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failed open', async () => {
    const opener = jest.fn<() => Promise<SqlDriver>>().mockRejectedValueOnce(new Error('no disk')).mockResolvedValue(fakeDriver());
    const holder = createDatabaseHolder(opener);
    await expect(holder.open()).rejects.toThrow('no disk');
    await expect(holder.open()).resolves.toBeTruthy();
  });

  it('close closes the handle and the next open reopens', async () => {
    const close = jest.fn(async () => undefined);
    const opener = jest.fn(async () => fakeDriver(close));
    const holder = createDatabaseHolder(opener);
    const first = await holder.open();
    await holder.close();
    expect(close).toHaveBeenCalledTimes(1);
    const second = await holder.open();
    expect(second).not.toBe(first);
    expect(opener).toHaveBeenCalledTimes(2);
  });

  it('close does nothing when nothing was opened', async () => {
    const opener = jest.fn(async () => fakeDriver());
    await expect(createDatabaseHolder(opener).close()).resolves.toBeUndefined();
    expect(opener).not.toHaveBeenCalled();
  });

  it('close never throws when the close itself fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const holder = createDatabaseHolder(async () => fakeDriver(async () => Promise.reject(new Error('busy'))));
    await holder.open();
    await expect(holder.close()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('close runs afterClose once the handle is closed, and an open asked for meanwhile waits for it', async () => {
    const log: string[] = [];
    const opener = jest.fn(async () => {
      log.push('open');
      return fakeDriver(async () => {
        log.push('close');
      });
    });
    const holder = createDatabaseHolder(opener);
    await holder.open();
    log.length = 0;
    let finishDelete: () => void = () => undefined;
    const closing = holder.close(
      () =>
        new Promise<void>((resolve) => {
          log.push('delete started');
          finishDelete = () => {
            log.push('delete done');
            resolve();
          };
        }),
    );
    // The sync hook asks for the database while the file is being deleted.
    const reopening = holder.open();
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['close', 'delete started']);
    finishDelete();
    await closing;
    await reopening;
    expect(log).toEqual(['close', 'delete started', 'delete done', 'open']);
  });

  it('close throws afterClose’s error, and the next open still works', async () => {
    const holder = createDatabaseHolder(async () => fakeDriver());
    await holder.open();
    await expect(holder.close(async () => Promise.reject(new Error('file locked')))).rejects.toThrow('file locked');
    await expect(holder.open()).resolves.toBeTruthy();
  });

  it('a failed open during a close leaves a newer open alone', async () => {
    let fail: (e: Error) => void = () => undefined;
    const opener = jest
      .fn<() => Promise<SqlDriver>>()
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
      .mockResolvedValue(fakeDriver());
    const holder = createDatabaseHolder(opener);
    const firstOpen = holder.open();
    const closing = holder.close();
    const secondOpen = holder.open();
    fail(new Error('no disk'));
    await expect(firstOpen).rejects.toThrow('no disk');
    await expect(closing).resolves.toBeUndefined();
    const second = await secondOpen;
    expect(await holder.open()).toBe(second);
    expect(opener).toHaveBeenCalledTimes(2);
  });
});
