/**
 * `moderate` — the server function the founder uses to remove a post, a comment or a whole
 * account (B27, NFR-7). The decisions are in `handler.ts`; this file is only wiring.
 *
 * Called by the founder with their own login token:
 *   POST /functions/v1/moderate   { "action": "remove-post", "targetId": "<uuid>" }
 * The platform's JWT check is on, so a request without a valid login never reaches this code.
 *
 * Two database clients per request (the analyze-workout pattern):
 *   - one AS THE CALLER (their token), used only to learn who they are;
 *   - one with the server's own key, used for everything else — the moderator check (so the
 *     caller can't influence it), the deletes, the storage sweep and the report bookkeeping.
 *     No app user can do any of that through the database's security rules; the handler only
 *     lets it happen for someone in the `moderators` table.
 * Answers: 200 `{ removed }`; 400 / 403 / 404 / 409 with `{ error }` (see handler.ts); 401
 * without a valid login; 405 for anything but POST; 500 if the database or storage fails.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handleModerateRequest, type ModeratedComment, type ModeratedPost, type ModerateDeps } from './handler.ts';

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
function supabaseDeps(asServer: SupabaseClient): ModerateDeps {
  return {
    async isModerator(userId) {
      const { data, error } = await asServer.from('moderators').select('user_id').eq('user_id', userId).maybeSingle();
      check(error, 'Reading moderators failed');
      return data != null;
    },
    async readPost(postId) {
      const { data, error } = await asServer.from('posts').select('id,image_path').eq('id', postId).maybeSingle();
      check(error, 'Reading the post failed');
      return (data as ModeratedPost | null) ?? null;
    },
    async deletePost(postId) {
      const { error } = await asServer.from('posts').delete().eq('id', postId);
      check(error, 'Deleting the post failed');
    },
    async readComment(commentId) {
      const { data, error } = await asServer.from('comments').select('id').eq('id', commentId).maybeSingle();
      check(error, 'Reading the comment failed');
      return (data as ModeratedComment | null) ?? null;
    },
    async deleteComment(commentId) {
      const { error } = await asServer.from('comments').delete().eq('id', commentId);
      check(error, 'Deleting the comment failed');
    },
    async resolveReports(kind, targetId) {
      const { data, error } = await asServer
        .from('reports')
        .update({ status: 'resolved' })
        .eq('target_kind', kind)
        .eq('target_id', targetId)
        .eq('status', 'open')
        .select('id');
      check(error, 'Resolving reports failed');
      return (data ?? []).length;
    },
    async accountExists(userId) {
      const { data, error } = await asServer.auth.admin.getUserById(userId);
      // The auth server answers "not found" as an error; any user object means it exists.
      if (data?.user) return true;
      if (error && (error as { status?: number }).status !== 404) check(error, 'Reading the account failed');
      return false;
    },
    async deleteAccount(userId) {
      const { error } = await asServer.auth.admin.deleteUser(userId);
      check(error, 'Deleting the account failed');
    },
    async listFolder(bucket, folder) {
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
    async removeObjects(bucket, paths) {
      const { error } = await asServer.storage.from(bucket).remove([...paths]);
      check(error, `Removing files from ${bucket} failed`);
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

    const result = await handleModerateRequest(body, who.user.id, supabaseDeps(asServer));
    return json(result.status, result.body);
  } catch (error) {
    console.error('moderate failed', error);
    return json(500, { error: 'The removal could not be done right now' });
  }
});
