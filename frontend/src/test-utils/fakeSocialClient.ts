/**
 * A fake Supabase client for the social screens — TEST USE ONLY (nothing in the app imports it).
 *
 * Why: the Testing rules forbid touching the real project, but the feed's correctness lives in
 * the *requests* it builds — "only these authors", "older than this bookmark", "names like
 * this". A recording-only fake can't tell whether those requests would actually return the
 * right rows, so this one keeps small in-memory tables (profiles, follows, blocks, posts) and
 * *runs* the subset of the query builder the social code uses: `select`, `eq`, `neq`, `in`,
 * `not(column, 'in', '(…)')`,
 * `or` (PostgREST's filter-string syntax, including `and(...)` and double-quoted values),
 * `order`, `limit`, `insert` and `delete`. Every request is also recorded for assertions.
 *
 * What it does NOT do: row-level security or embedding. Posts are seeded already shaped the way
 * the server's embed returns them (author, flair and workout nested in), and the follow insert
 * imitates the one RLS refusal the app handles (a block in either direction). Server-side
 * visibility itself is proven live at Gate 2, not here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;

/** One recorded builder call: its method name and arguments. */
export type FakeCall = [string, ...unknown[]];

/** The in-memory tables the fake serves. */
export interface FakeSocialTables {
  profiles: Row[];
  follows: Row[];
  blocks: Row[];
  /** Feed-shaped posts (see feedFixtures `rawPost`): typed loosely so any fixture shape fits. */
  posts: object[];
}

/** Splits a PostgREST filter list at top-level commas (not inside parentheses or quotes). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted && ch === '\\') {
      current += ch + (text[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** A filter value as PostgREST reads it: a double-quoted value loses its quotes and escapes. */
function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\(.)/g, '$1');
  return value;
}

/** A SQL `ilike` pattern as a case-insensitive regular expression (`\` escapes the next char). */
function likeToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      source += (pattern[i + 1] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
    } else if (ch === '%') source += '.*';
    else if (ch === '_') source += '.';
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i');
}

/** Turns one `or(...)` item — `and(...)` or `column.op.value` — into a row test. Throws on syntax it doesn't know, like PostgREST's 400. */
function parseCondition(text: string): Predicate {
  if (text.startsWith('and(') && text.endsWith(')')) {
    const parts = splitTopLevel(text.slice(4, -1)).map(parseCondition);
    return (row) => parts.every((p) => p(row));
  }
  const match = /^([a-z_]+)\.(eq|lt|gt|ilike)\.(.+)$/.exec(text);
  if (!match) throw new Error(`fake: unparseable filter "${text}"`);
  const [, column, op, raw] = match;
  if (!raw.startsWith('"') && /[,()]/.test(raw)) throw new Error(`fake: reserved character in "${text}"`);
  const value = unquote(raw);
  return (row) => {
    const cell = row[column];
    if (cell == null) return false;
    const s = String(cell);
    if (op === 'eq') return s === value;
    if (op === 'lt') return s < value;
    if (op === 'gt') return s > value;
    return likeToRegExp(value).test(s);
  };
}

/** Parses a whole `or()` filter string into one row test (any item may match). */
export function parseOrFilter(filter: string): Predicate {
  const parts = splitTopLevel(filter).map(parseCondition);
  return (row) => parts.some((p) => p(row));
}

interface FakeOptions {
  /** Make every request fail as a dropped connection would. */
  offline?: boolean;
}

/**
 * Builds the fake. `tables` is live: tests can read it after a follow to see the new row.
 * Returns the client (typed as the real one at this seam only), the tables, the recorded
 * requests, and a switch to go offline or back online mid-test.
 */
export function createFakeSocialClient(seed: Partial<FakeSocialTables> = {}, options: FakeOptions = {}) {
  const tables: FakeSocialTables = {
    profiles: [...(seed.profiles ?? [])],
    follows: [...(seed.follows ?? [])],
    blocks: [...(seed.blocks ?? [])],
    posts: [...(seed.posts ?? [])],
  };
  const requests: FakeCall[][] = [];
  let offline = options.offline ?? false;

  /** Runs one finished request against the tables. */
  function execute(table: keyof FakeSocialTables, calls: FakeCall[]): { data: unknown; error: { message: string; code?: string } | null } {
    if (offline) return { data: null, error: { message: 'Network request failed' } };
    const filters: Predicate[] = [];
    const orders: { column: string; ascending: boolean }[] = [];
    let limit = Infinity;
    let insert: Row | null = null;
    let isDelete = false;
    for (const [method, ...args] of calls) {
      if (method === 'eq') filters.push((r) => r[args[0] as string] === args[1]);
      if (method === 'neq') filters.push((r) => r[args[0] as string] !== args[1]);
      if (method === 'in') filters.push((r) => (args[1] as unknown[]).includes(r[args[0] as string]));
      if (method === 'not') {
        // Only the form the app uses: not(column, 'in', '(a,b,c)').
        if (args[1] !== 'in') throw new Error(`fake: unsupported not() operator ${String(args[1])}`);
        const excluded = String(args[2]).replace(/^\(|\)$/g, '').split(',');
        filters.push((r) => !excluded.includes(String(r[args[0] as string])));
      }
      if (method === 'or') filters.push(parseOrFilter(args[0] as string));
      if (method === 'order') orders.push({ column: args[0] as string, ascending: (args[1] as { ascending: boolean }).ascending });
      if (method === 'limit') limit = args[0] as number;
      if (method === 'insert') insert = args[0] as Row;
      if (method === 'delete') isDelete = true;
    }
    const rows = tables[table] as Row[];
    if (insert) {
      const row: Row = insert;
      if (table === 'follows') {
        const a = row.follower_id;
        const b = row.followee_id;
        const blocked = tables.blocks.some(
          (x) => (x.blocker_id === a && x.blocked_id === b) || (x.blocker_id === b && x.blocked_id === a),
        );
        if (blocked) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
        if (rows.some((x) => x.follower_id === a && x.followee_id === b)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
      }
      rows.push(row);
      return { data: null, error: null };
    }
    const matching = rows.filter((r) => filters.every((f) => f(r)));
    if (isDelete) {
      tables[table] = rows.filter((r) => !matching.includes(r));
      return { data: null, error: null };
    }
    const sorted = [...matching].sort((x, y) => {
      for (const { column, ascending } of orders) {
        const a = String(x[column]);
        const b = String(y[column]);
        if (a !== b) return (a < b ? -1 : 1) * (ascending ? 1 : -1);
      }
      return 0;
    });
    return { data: sorted.slice(0, limit), error: null };
  }

  const client = {
    from(table: keyof FakeSocialTables) {
      const calls: FakeCall[] = [['from', table]];
      requests.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'in', 'not', 'or', 'order', 'limit', 'insert', 'delete']) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(execute(table, calls)).then(resolve);
        } catch (error) {
          // An unparseable filter is the server's 400: an error response, not a throw.
          return Promise.resolve({ data: null, error: { message: String(error) } }).then(resolve, reject);
        }
      };
      return builder;
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    tables,
    requests,
    setOffline(value: boolean) {
      offline = value;
    },
  };
}
