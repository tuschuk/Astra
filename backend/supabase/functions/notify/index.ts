/**
 * `notify` — sends the push notifications for follows, comments, upvotes and Team posts (B47), and
 * for direct messages (B48).
 * The decisions are in `handler.ts`; this file is only wiring.
 *
 * Called by the database, not the app: a trigger on each of the five tables queues
 *   POST /functions/v1/notify   { "event": "...", "keys": { ... } }
 * through pg_net after a row is inserted (…_push_notifications.sql). Deployed WITHOUT the
 * platform's login check (`verify_jwt = false`), because a trigger has no login to send. That is
 * safe because the handler trusts nothing in the call — it re-reads the named row with the server
 * key — and because the answer never says anything: every POST gets the same empty 204 whether
 * the row existed, was ignored, or was already handled. 405 for anything but POST; 500 (also
 * empty) if the database fails, so the failure shows in the function's logs.
 *
 * One database client, with the server key (`SUPABASE_SERVICE_ROLE_KEY`, injected by Supabase).
 * It reads across lifters' rows (tokens, settings, blocks), which no app user may do; the handler
 * only ever uses that to decide whether to send a short message to the right person.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { EXPO_PUSH_URL } from './expoPush.ts';
import { handleNotifyRequest, type NotifyDeps, type NotifySwitches } from './handler.ts';

/** Throws a database error as a normal Error, naming what was being done. */
function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Postgres's "duplicate key" code — the log row already exists. */
const UNIQUE_VIOLATION = '23505';

/** The real access, all with the server key. */
function supabaseDeps(db: SupabaseClient): NotifyDeps {
  return {
    async followExists(followerId, followeeId) {
      const { data, error } = await db
        .from('follows')
        .select('follower_id')
        .eq('follower_id', followerId)
        .eq('followee_id', followeeId)
        .maybeSingle();
      check(error, 'Reading the follow failed');
      return data != null;
    },
    async readComment(commentId) {
      const { data, error } = await db.from('comments').select('user_id,post_id,posts(user_id)').eq('id', commentId).maybeSingle();
      check(error, 'Reading the comment failed');
      const row = data as { user_id: string; post_id: string; posts: { user_id: string } | null } | null;
      return row?.posts ? { authorId: row.user_id, postId: row.post_id, postAuthorId: row.posts.user_id } : null;
    },
    async readVote(postId, voterId) {
      const { data, error } = await db
        .from('votes')
        .select('value,posts(user_id)')
        .eq('post_id', postId)
        .eq('user_id', voterId)
        .maybeSingle();
      check(error, 'Reading the vote failed');
      const row = data as { value: number; posts: { user_id: string } | null } | null;
      return row?.posts ? { value: row.value, postAuthorId: row.posts.user_id } : null;
    },
    async readTeamPost(postId) {
      const { data, error } = await db.from('team_posts').select('author_id,team_id,teams(name)').eq('id', postId).maybeSingle();
      check(error, 'Reading the team post failed');
      const row = data as { author_id: string; team_id: string; teams: { name: string } | null } | null;
      return row?.teams ? { authorId: row.author_id, teamId: row.team_id, teamName: row.teams.name } : null;
    },
    async readMessage(messageId) {
      // Ids only — the message body is deliberately not selected (it must never reach a push).
      const { data, error } = await db
        .from('messages')
        .select('sender_id,conversations(user_a,user_b)')
        .eq('id', messageId)
        .maybeSingle();
      check(error, 'Reading the message failed');
      const row = data as { sender_id: string; conversations: { user_a: string; user_b: string } | null } | null;
      return row?.conversations
        ? { senderId: row.sender_id, memberIds: [row.conversations.user_a, row.conversations.user_b] }
        : null;
    },
    async teamMemberIds(teamId) {
      const { data, error } = await db.from('team_members').select('user_id').eq('team_id', teamId);
      check(error, 'Reading the team members failed');
      return (data ?? []).map((r: { user_id: string }) => r.user_id);
    },
    async displayName(userId) {
      const { data, error } = await db.from('profiles').select('display_name,username').eq('id', userId).maybeSingle();
      check(error, 'Reading the profile failed');
      const row = data as { display_name: string | null; username: string | null } | null;
      return row?.display_name || row?.username || null;
    },
    async readSwitches(userIds) {
      const map = new Map<string, NotifySwitches>();
      if (userIds.length === 0) return map;
      const { data, error } = await db
        .from('user_settings')
        .select('user_id,notify_follows,notify_comments,notify_votes,notify_team_pushes,notify_messages')
        .in('user_id', [...userIds]);
      check(error, 'Reading notification settings failed');
      for (const row of (data ?? []) as ({ user_id: string } & NotifySwitches)[]) {
        const { user_id, ...switches } = row;
        map.set(user_id, switches);
      }
      return map;
    },
    async blockedWith(actorId, userIds) {
      if (userIds.length === 0) return new Set();
      const list = userIds.join(',');
      const { data, error } = await db
        .from('blocks')
        .select('blocker_id,blocked_id')
        .or(`and(blocker_id.eq.${actorId},blocked_id.in.(${list})),and(blocked_id.eq.${actorId},blocker_id.in.(${list}))`);
      check(error, 'Reading blocks failed');
      return new Set(
        ((data ?? []) as { blocker_id: string; blocked_id: string }[]).map((b) => (b.blocker_id === actorId ? b.blocked_id : b.blocker_id)),
      );
    },
    async mutedBy(actorId, userIds) {
      if (userIds.length === 0) return new Set();
      const { data, error } = await db.from('mutes').select('muter_id').eq('muted_id', actorId).in('muter_id', [...userIds]);
      check(error, 'Reading mutes failed');
      return new Set(((data ?? []) as { muter_id: string }[]).map((m) => m.muter_id));
    },
    async readTokens(userIds) {
      if (userIds.length === 0) return [];
      const { data, error } = await db.from('push_tokens').select('token,user_id').in('user_id', [...userIds]);
      check(error, 'Reading push tokens failed');
      return (data ?? []) as { token: string; user_id: string }[];
    },
    async claim({ event, sourceKey, recipientId, actorId, status }) {
      const { error } = await db
        .from('notification_log')
        .insert({ event, source_key: sourceKey, recipient_id: recipientId, actor_id: actorId, status });
      if (error && (error as { code?: string }).code === UNIQUE_VIOLATION) return false;
      check(error, 'Writing the notification log failed');
      return true;
    },
    async finish({ event, sourceKey, recipientId, status, tickets }) {
      const { error } = await db
        .from('notification_log')
        .update({ status, tickets })
        .eq('event', event)
        .eq('source_key', sourceKey)
        .eq('recipient_id', recipientId);
      check(error, 'Updating the notification log failed');
    },
    async sendToExpo(messages) {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      // A non-JSON reply (an outage page) parses to null and becomes error tickets in the handler.
      return await response.json().catch(() => null);
    },
    async deleteTokens(tokens) {
      const { error } = await db.from('push_tokens').delete().in('token', [...tokens]);
      check(error, 'Deleting dead push tokens failed');
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // Not JSON: the handler ignores it like any other malformed call.
  }

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const outcome = await handleNotifyRequest(body, supabaseDeps(db));
    if (outcome.size > 0) console.log('notify', [...outcome.values()].join(','));
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('notify failed', error);
    return new Response(null, { status: 500 });
  }
});
