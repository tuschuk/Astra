/**
 * Supabase requests report failure by returning an `error` instead of throwing. Every reader of
 * the server (sync, the feed, follows) wants a failed request to throw instead, so the caller's
 * one `catch` handles it. This is that one helper.
 *
 * Input: the request's `error` (or null) and a few words naming what was being done.
 * Output: nothing when there was no error; otherwise it throws "<what>: <server message>".
 */
export function throwIfError(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}
