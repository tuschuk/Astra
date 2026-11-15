/**
 * Tests for `requestAccountDeletion` (B32, NFR-6): it sends the confirmation word (and no account
 * id), counts only a real "deleted" answer as deleted, and names each failure calmly.
 */
import { describe, expect, it } from '@jest/globals';

import { DELETE_FAILED, DELETE_MODERATOR, DELETE_OFFLINE, requestAccountDeletion } from './deleteAccount';
import type { FunctionsClient } from './functionCalls';

/** A client whose delete call answers as given, recording what was sent. */
function client(answer: { data: unknown; error: unknown }) {
  const calls: { name: string; body: unknown }[] = [];
  const c: FunctionsClient = {
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, body: options?.body });
        return answer;
      },
    },
  };
  return { c, calls };
}

describe('requestAccountDeletion', () => {
  it('sends only the confirmation word and reports a deleted account', async () => {
    const { c, calls } = client({ data: { deleted: { userId: 'u1', filesRemoved: 2 } }, error: null });
    expect(await requestAccountDeletion(c)).toEqual({ ok: true });
    expect(calls).toEqual([{ name: 'delete-account', body: { confirm: 'DELETE' } }]);
  });

  it('reports no connection', async () => {
    const { c } = client({ data: null, error: { name: 'FunctionsFetchError' } });
    expect(await requestAccountDeletion(c)).toEqual({ ok: false, message: DELETE_OFFLINE });
  });

  it('reports a moderator refusal', async () => {
    const { c } = client({ data: null, error: { name: 'FunctionsHttpError', context: { status: 409 } } });
    expect(await requestAccountDeletion(c)).toEqual({ ok: false, message: DELETE_MODERATOR });
  });

  it('reports a server error', async () => {
    const { c } = client({ data: null, error: { name: 'FunctionsHttpError', context: { status: 500 } } });
    expect(await requestAccountDeletion(c)).toEqual({ ok: false, message: DELETE_FAILED });
  });

  it('does not count a reply without "deleted" as deleted', async () => {
    const { c } = client({ data: { something: 'else' }, error: null });
    expect(await requestAccountDeletion(c)).toEqual({ ok: false, message: DELETE_FAILED });
  });
});
