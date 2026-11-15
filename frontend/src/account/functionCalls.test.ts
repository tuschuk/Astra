/**
 * Tests for `callFunction` (B32): how a server-function call's result is sorted into "ok", "no
 * connection" and "the server said no", the way the Supabase client reports each.
 */
import { describe, expect, it } from '@jest/globals';

import { callFunction, type FunctionsClient } from './functionCalls';

/** A client whose invoke answers (or throws) as given, recording what it was asked. */
function fakeClient(answer: () => Promise<{ data: unknown; error: unknown }>) {
  const calls: { name: string; options?: { body?: unknown } }[] = [];
  const client: FunctionsClient = {
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, options });
        return answer();
      },
    },
  };
  return { client, calls };
}

describe('callFunction', () => {
  it('passes the name and body through and returns the data', async () => {
    const { client, calls } = fakeClient(async () => ({ data: { a: 1 }, error: null }));
    expect(await callFunction(client, 'thing', { x: 1 })).toEqual({ kind: 'ok', data: { a: 1 } });
    expect(calls).toEqual([{ name: 'thing', options: { body: { x: 1 } } }]);
  });

  it('sends no options when there is no body', async () => {
    const { client, calls } = fakeClient(async () => ({ data: {}, error: null }));
    await callFunction(client, 'thing');
    expect(calls[0].options).toBeUndefined();
  });

  it('reads a fetch error as no connection', async () => {
    const { client } = fakeClient(async () => ({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send' } }));
    expect(await callFunction(client, 'thing')).toEqual({ kind: 'offline' });
  });

  it('reads a thrown error as no connection', async () => {
    const { client } = fakeClient(async () => {
      throw new Error('network down');
    });
    expect(await callFunction(client, 'thing')).toEqual({ kind: 'offline' });
  });

  it('reads an HTTP error with its status', async () => {
    const { client } = fakeClient(async () => ({ data: null, error: { name: 'FunctionsHttpError', context: { status: 409 } } }));
    expect(await callFunction(client, 'thing')).toEqual({ kind: 'failed', status: 409 });
  });

  it('reads any other error as a failure with no status', async () => {
    const { client } = fakeClient(async () => ({ data: null, error: { name: 'FunctionsRelayError' } }));
    expect(await callFunction(client, 'thing')).toEqual({ kind: 'failed', status: null });
  });
});
