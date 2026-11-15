/**
 * Tests for Settings → Export your data (B32, NFR-6): the server's document is written to a
 * dated JSON file, handed to the share sheet, and the cache copy deleted afterwards — and each
 * way it can fail says the right thing. The phone (files, share sheet, date) is a fake.
 */
import { describe, expect, it } from '@jest/globals';

import { EXPORT_CANT_SHARE, EXPORT_FAILED, EXPORT_OFFLINE, exportFileName, exportMyData, type ExportDevice } from './exportData';
import type { FunctionsClient } from './functionCalls';

const DOC = { format: 'astra-export', version: 1, workouts: [{ id: 'w1', exercises: [] }] };

/** A client whose export call answers as given. */
function client(answer: { data: unknown; error: unknown }): FunctionsClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    functions: {
      invoke: async (name) => {
        calls.push(name);
        return answer;
      },
    },
  };
}

/** A fake phone that logs what happened, with switches to make steps fail. */
function fakeDevice(overrides: Partial<ExportDevice> = {}) {
  const log: string[] = [];
  const files = new Map<string, string>();
  const device: ExportDevice = {
    cacheDirectory: 'file:///cache/',
    writeFile: async (uri, text) => {
      log.push(`write ${uri}`);
      files.set(uri, text);
    },
    removeFile: async (uri) => {
      log.push(`remove ${uri}`);
      files.delete(uri);
    },
    canShare: async () => true,
    share: async (uri) => {
      log.push(`share ${uri} (${files.has(uri) ? 'present' : 'missing'})`);
    },
    today: () => '2026-11-15',
    ...overrides,
  };
  return { device, log, files };
}

const URI = 'file:///cache/astra-export-2026-11-15.json';

describe('exportFileName', () => {
  it('names the file by day', () => {
    expect(exportFileName('2026-11-15')).toBe('astra-export-2026-11-15.json');
  });
});

describe('exportMyData', () => {
  it('writes the document, shares the file, then deletes the cache copy', async () => {
    const c = client({ data: DOC, error: null });
    const { device, log, files } = fakeDevice();
    let written = '';
    const spying: ExportDevice = {
      ...device,
      writeFile: async (uri, text) => {
        written = text;
        await device.writeFile(uri, text);
      },
    };
    expect(await exportMyData(c, spying)).toEqual({ ok: true });
    expect(c.calls).toEqual(['export-data']);
    expect(JSON.parse(written)).toEqual(DOC);
    expect(log).toEqual([`write ${URI}`, `share ${URI} (present)`, `remove ${URI}`]);
    expect(files.size).toBe(0);
  });

  it('says it needs a connection when the request gets no answer, and writes nothing', async () => {
    const { device, log } = fakeDevice();
    const result = await exportMyData(client({ data: null, error: { name: 'FunctionsFetchError' } }), device);
    expect(result).toEqual({ ok: false, message: EXPORT_OFFLINE });
    expect(log).toEqual([]);
  });

  it('says it failed when the server answers with an error', async () => {
    const { device, log } = fakeDevice();
    const result = await exportMyData(client({ data: null, error: { name: 'FunctionsHttpError', context: { status: 500 } } }), device);
    expect(result).toEqual({ ok: false, message: EXPORT_FAILED });
    expect(log).toEqual([]);
  });

  it('says it failed on an empty reply', async () => {
    const { device } = fakeDevice();
    expect(await exportMyData(client({ data: null, error: null }), device)).toEqual({ ok: false, message: EXPORT_FAILED });
  });

  it('does not ask the server when the phone can’t share', async () => {
    const c = client({ data: DOC, error: null });
    const { device } = fakeDevice({ canShare: async () => false });
    expect(await exportMyData(c, device)).toEqual({ ok: false, message: EXPORT_CANT_SHARE });
    expect(c.calls).toEqual([]);
  });

  it('says it failed when the file can’t be written, and never opens the share sheet', async () => {
    const { device, log } = fakeDevice({
      writeFile: async () => {
        throw new Error('disk full');
      },
    });
    expect(await exportMyData(client({ data: DOC, error: null }), device)).toEqual({ ok: false, message: EXPORT_FAILED });
    expect(log.some((l) => l.startsWith('share'))).toBe(false);
  });

  it('still deletes the cache copy when the share sheet fails', async () => {
    const { device, log, files } = fakeDevice({
      share: async () => {
        throw new Error('no activity');
      },
    });
    expect(await exportMyData(client({ data: DOC, error: null }), device)).toEqual({ ok: false, message: EXPORT_FAILED });
    expect(log).toContain(`remove ${URI}`);
    expect(files.size).toBe(0);
  });
});
