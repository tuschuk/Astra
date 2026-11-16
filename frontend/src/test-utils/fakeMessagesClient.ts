/**
 * A fake Supabase client for direct messages (B48) — TEST USE ONLY (nothing in the app imports it).
 *
 * Why its own fake rather than more branches in `fakeSocialClient.ts`: messages need two things
 * that fake has no notion of — a signed-in identity (who "I" am decides which conversations exist
 * for me) and Realtime channels — and the reads they use are few. So this one keeps in-memory
 * `conversations` and `messages` tables and runs just the queries `social/messages.ts` builds:
 *   - `conversations`: `select(…).eq('user_a').eq('user_b').maybeSingle()` (the pair lookup), the
 *     list read (`or(user_a.eq.me,user_b.eq.me)`, both profile embeds, the newest message), and
 *     `insert` (the pair's unique key → 23505; a refused start → 42501);
 *   - `messages`: the thread read (`eq` + newest-first order + `limit`) and
 *     `insert(…).select(…).single()` (a server time stamped on it; 42501 into a conversation I
 *     can't see; 23505 on a repeated id);
 *   - `profiles`: `select(…).eq('id').limit(1)` (the thread's header name);
 *   - `rpc('can_message_user')` answering `canStart(me, target)`;
 *   - `channel(name).on('postgres_changes', filter, callback).subscribe()` and `removeChannel` —
 *     recorded, so a test can check the subscription's exact arguments, and `emitInsert(row)`
 *     pushes a Realtime INSERT to every live channel whose filter matches, the way the server
 *     would after a message lands.
 *
 * Server rules imitated, in the plainest form (the real ones live in the migration and were
 * probed live): a conversation is visible only to its two members and not when `blocked` is on;
 * starting one needs `canStart`. Nothing else.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

/** One recorded Realtime subscription. */
export interface FakeChannel {
  name: string;
  /** The `on(...)` arguments: event type and filter. */
  bindings: { type: string; filter: Record<string, unknown>; callback: (payload: { new: Row }) => void }[];
  subscribed: boolean;
  removed: boolean;
}

interface FakeMessagesOptions {
  /** The signed-in lifter. */
  me: string;
  profiles?: Row[];
  conversations?: Row[];
  messages?: Row[];
  /** May `me` start a conversation with `other`? Default: yes. */
  canStart?: (me: string, other: string) => boolean;
  /** A block between the two members — hides their conversation and refuses sends. */
  blocked?: boolean;
  /** Every request fails as a dropped connection would. */
  offline?: boolean;
}

/** Builds the fake. The tables and channels are live: tests read them after acting. */
export function createFakeMessagesClient(options: FakeMessagesOptions) {
  const state = {
    me: options.me,
    profiles: [...(options.profiles ?? [])],
    conversations: [...(options.conversations ?? [])],
    messages: [...(options.messages ?? [])],
    canStart: options.canStart ?? (() => true),
    blocked: options.blocked ?? false,
    offline: options.offline ?? false,
  };
  const channels: FakeChannel[] = [];
  const requests: { table: string; calls: [string, ...unknown[]][] }[] = [];
  let clock = Date.parse('2026-11-16T10:00:00.000Z');

  /** Can `me` see this conversation? Membership and no block — the select policy. */
  const visible = (c: Row) => !state.blocked && (c.user_a === state.me || c.user_b === state.me);

  const offlineError = { message: 'TypeError: Network request failed', code: '' };

  function from(table: string) {
    const calls: [string, ...unknown[]][] = [];
    requests.push({ table, calls });
    const filters: ((row: Row) => boolean)[] = [];
    let insertRow: Row | null = null;
    let single: 'single' | 'maybe' | null = null;
    let descending = false;
    let limit = Infinity;

    function run(): { data: unknown; error: unknown } {
      if (state.offline) return { data: null, error: offlineError };
      if (insertRow) {
        const row = insertRow;
        if (table === 'conversations') {
          const other = row.user_a === state.me ? String(row.user_b) : String(row.user_a);
          const member = row.user_a === state.me || row.user_b === state.me;
          if (!member || state.blocked || !state.canStart(state.me, other)) {
            return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
          }
          if (state.conversations.some((c) => c.user_a === row.user_a && c.user_b === row.user_b)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          state.conversations.push({ ...row, last_message_at: null, created_at: new Date(clock).toISOString() });
          return { data: null, error: null };
        }
        if (table === 'messages') {
          const conversation = state.conversations.find((c) => c.id === row.conversation_id);
          if (row.sender_id !== state.me || !conversation || !visible(conversation)) {
            return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
          }
          if (state.messages.some((m) => m.id === row.id)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          clock += 1000;
          const saved = { ...row, created_at: new Date(clock).toISOString() };
          state.messages.push(saved);
          conversation.last_message_at = saved.created_at;
          return { data: { ...saved }, error: null };
        }
        throw new Error(`fake: insert into ${table} is not imitated`);
      }

      let rows: Row[];
      if (table === 'conversations') {
        rows = state.conversations.filter(visible).map((c) => {
          const newest = state.messages
            .filter((m) => m.conversation_id === c.id)
            .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))
            .slice(0, 1)
            .map((m) => ({ sender_id: m.sender_id, body: m.body, created_at: m.created_at }));
          return {
            ...c,
            a: state.profiles.find((p) => p.id === c.user_a) ?? null,
            b: state.profiles.find((p) => p.id === c.user_b) ?? null,
            messages: newest,
          };
        });
        // Newest activity first, never-messaged last (nulls last).
        rows.sort((x, y) => String(y.last_message_at ?? '').localeCompare(String(x.last_message_at ?? '')));
      } else if (table === 'messages') {
        const seen = new Set(state.conversations.filter(visible).map((c) => c.id));
        rows = state.messages.filter((m) => seen.has(m.conversation_id));
        rows.sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)) || String(x.id).localeCompare(String(y.id)));
        if (descending) rows.reverse();
      } else if (table === 'profiles') {
        // Profiles are readable by any signed-in lifter (the B25 policy).
        rows = [...state.profiles];
      } else {
        throw new Error(`fake: reads of ${table} are not imitated`);
      }
      rows = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (single) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }

    const builder = {
      select(...args: unknown[]) {
        calls.push(['select', ...args]);
        return builder;
      },
      insert(row: Row) {
        calls.push(['insert', row]);
        insertRow = row;
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push(['eq', column, value]);
        filters.push((r) => r[column] === value);
        return builder;
      },
      or(filter: string) {
        calls.push(['or', filter]);
        const ids = [...filter.matchAll(/user_[ab]\.eq\.([^,)]+)/g)].map((m) => m[1]);
        filters.push((r) => ids.includes(String(r.user_a)) || ids.includes(String(r.user_b)));
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean; referencedTable?: string }) {
        calls.push(['order', column, opts]);
        if (!opts?.referencedTable && table === 'messages' && column === 'created_at') descending = opts?.ascending === false;
        return builder;
      },
      limit(count: number, opts?: { referencedTable?: string }) {
        calls.push(['limit', count, opts]);
        if (!opts?.referencedTable) limit = count;
        return builder;
      },
      single() {
        calls.push(['single']);
        single = 'single';
        return builder;
      },
      maybeSingle() {
        calls.push(['maybeSingle']);
        single = 'maybe';
        return builder;
      },
      then<T>(resolve: (value: { data: unknown; error: unknown }) => T, reject?: (reason: unknown) => T) {
        try {
          return Promise.resolve(resolve(run()));
        } catch (error) {
          return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
        }
      },
    };
    return builder;
  }

  function channel(name: string) {
    const record: FakeChannel = { name, bindings: [], subscribed: false, removed: false };
    channels.push(record);
    const handle = {
      on(type: string, filter: Record<string, unknown>, callback: (payload: { new: Row }) => void) {
        record.bindings.push({ type, filter, callback });
        return handle;
      },
      subscribe(callback?: (status: string) => void) {
        record.subscribed = true;
        callback?.('SUBSCRIBED');
        return handle;
      },
      __record: record,
    };
    return handle;
  }

  const client = {
    from,
    channel,
    async removeChannel(handle: { __record?: FakeChannel }) {
      if (handle.__record) handle.__record.removed = true;
      return 'ok';
    },
    async rpc(name: string, params: Record<string, unknown>) {
      if (state.offline) return { data: null, error: offlineError };
      if (name !== 'can_message_user') return { data: null, error: { code: 'PGRST202', message: 'no such function' } };
      return { data: !state.blocked && state.canStart(state.me, String(params.target)), error: null };
    },
  };

  /**
   * Pushes a Realtime INSERT of `row` (a messages row) to every live channel whose filter
   * (`conversation_id=eq.<id>`) matches — what the server does after a message lands.
   */
  function emitInsert(row: Row): void {
    for (const ch of channels) {
      if (!ch.subscribed || ch.removed) continue;
      for (const b of ch.bindings) {
        const f = b.filter;
        const match = /^conversation_id=eq\.(.+)$/.exec(String(f.filter ?? ''));
        if (f.event === 'INSERT' && f.table === 'messages' && match && match[1] === row.conversation_id) b.callback({ new: row });
      }
    }
  }

  return {
    client: client as unknown as SupabaseClient,
    state,
    channels,
    requests,
    emitInsert,
  };
}
