/**
 * `delete-account` — the server function behind Settings → Delete account (B32, NFR-6). The
 * decisions are in `handler.ts`; this file is only wiring.
 *
 * Called by the phone with the lifter's own login token:
 *   POST /functions/v1/delete-account   { "confirm": "DELETE" }
 * The platform's JWT check is on, so a request without a valid login never reaches this code.
 *
 * Two database clients per request (the `moderate` pattern):
 *   - one AS THE CALLER (their token), used only to learn who they are — that id is the only
 *     account this function can ever delete;
 *   - one with the server's own key, used for the moderator check, the storage sweep and the
 *     login delete. None of those is possible for an app user through the security rules.
 * Answers: 200 `{ deleted }`; 400 / 409 with `{ error }` (see handler.ts); 401 without a valid
 * login; 405 for anything but POST; 500 if the database or storage fails (nothing was deleted
 * that a retry can't finish — the login is always the last thing to go).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handleDeleteAccountRequest, type DeleteAccountDeps } from './handler.ts';

/** Files listed per page of a storage folder read (the storage API's own page cap is 1000). */
const LIST_PAGE = 1000;

/** A JSON response with the given status. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Throws a database or storage error as a normal Error, naming what was being done. */
function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** The real access, all with the server key. */
function supabaseDeps(asServer: SupabaseClient): DeleteAccountDeps {
  return {
    // Read with the server key, so nothing in the request can influence the answer.
    async isModerator(userId) {
      const { data, error } = await asServer.from('moderators').select('user_id').eq('user_id', userId).maybeSingle();
      check(error, 'Reading moderators failed');
      return data != null;
    },
    // Every file path in the lifter's folder of `bucket`.
    async listFolder(bucket, folder) {
      // The whole folder is listed before anything is removed, so paging at growing offsets
      // walks an unchanged folder and never skips a file.
      const paths: string[] = [];
      for (let offset = 0; ; offset += LIST_PAGE) {
        const { data, error } = await asServer.storage.from(bucket).list(folder, { limit: LIST_PAGE, offset });
        check(error, `Listing ${bucket} failed`);
        const page = data ?? [];
        // Folders show up as entries without an id; lifters' folders hold files only.
        paths.push(...page.filter((f) => f.id != null).map((f) => `${folder}/${f.name}`));
        if (page.length < LIST_PAGE) break;
      }
      return paths;
    },
    // Deletes those files (one request per bucket).
    async removeObjects(bucket, paths) {
      const { error } = await asServer.storage.from(bucket).remove([...paths]);
      check(error, `Removing files from ${bucket} failed`);
    },
    // Deletes the login; the database's cascades remove every row the lifter owns.
    async deleteAccount(userId) {
      const { error } = await asServer.auth.admin.deleteUser(userId);
      check(error, 'Deleting the account failed');
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json(401, { error: 'Sign in first' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'The request body must be JSON' });
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    ...noSession,
    global: { headers: { Authorization: authorization } },
  });
  const asServer = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', noSession);

  try {
    const token = authorization.replace(/^Bearer\s+/i, '');
    const { data: who, error: whoError } = await asCaller.auth.getUser(token);
    if (whoError || !who.user) return json(401, { error: 'Sign in first' });

    const result = await handleDeleteAccountRequest(body, who.user.id, supabaseDeps(asServer));
    return json(result.status, result.body);
  } catch (error) {
    console.error('delete-account failed', error);
    return json(500, { error: 'Your account could not be deleted right now. It is still here — try again.' });
  }
});
