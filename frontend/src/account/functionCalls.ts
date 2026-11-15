/**
 * The small shared piece of the two account flows (B32): calling a server function and telling
 * "no connection" apart from "the server said no".
 *
 * Why it exists: Export and Delete both call a server function with the lifter's login and must
 * show a calm, specific line when it fails. The Supabase client reports a request that never got
 * an answer as a `FunctionsFetchError`, and an answer with a bad status as a `FunctionsHttpError`
 * carrying the response — this file reads those so the flows don't each re-learn it.
 */

/** The one method of the Supabase client the account flows use (the real client fits it). */
export interface FunctionsClient {
  functions: {
    invoke(name: string, options?: { body?: unknown }): Promise<{ data: unknown; error: unknown }>;
  };
}

/** How a call went: the reply's data, no answer at all, or an answer with an error status. */
export type CallOutcome = { kind: 'ok'; data: unknown } | { kind: 'offline' } | { kind: 'failed'; status: number | null };

/**
 * Calls server function `name` with `body` and sorts the result (see `CallOutcome`). Never
 * throws: a thrown error from the client counts as no answer.
 */
export async function callFunction(client: FunctionsClient, name: string, body?: unknown): Promise<CallOutcome> {
  try {
    const { data, error } = await client.functions.invoke(name, body === undefined ? undefined : { body });
    if (!error) return { kind: 'ok', data };
    const named = error as { name?: string; context?: { status?: unknown } };
    if (named.name === 'FunctionsFetchError') return { kind: 'offline' };
    const status = typeof named.context?.status === 'number' ? named.context.status : null;
    return { kind: 'failed', status };
  } catch {
    return { kind: 'offline' };
  }
}
