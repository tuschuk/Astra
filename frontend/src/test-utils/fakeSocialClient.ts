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
 * `order`, `limit`, `insert`, `upsert` (on a conflict key), `delete`, and `.select(…).single()`
 * after a write. Every request is also recorded for assertions.
 *
 * B23 adds `votes` and `comments` tables and the server pieces the app leans on for them:
 *   - `post_scores` is computed on every read from the votes and comments tables, like the view;
 *   - a posts read nests each post's votes under `my_vote`, and a filter on the alias
 *     (`eq('my_vote.user_id', me)`) narrows that list, as PostgREST does;
 *   - the upvote-only trigger: a −1 vote on a post whose flair has `upvotes_only` is refused with
 *     the trigger's code, P0001;
 *   - a comment insert gets a server id and time and comes back with its author nested in.
 *
 * B24 adds the `post_hot_scores` view: every post with a hot score computed by the same formula
 * as the migration, so a "Hot" read ranks as the server would. Comparisons and ordering treat
 * number cells as numbers (a hot score is a float). The view also refuses an un-hinted
 * `profiles(` embed, as the live server does (see `FEED_SELECT`).
 *
 * B25 adds what a profile reads and writes: `workouts` and `personal_records` tables (seeded
 * already nested, like posts), `update` (with the `profiles` table's unique and CHECK refusals),
 * `not(column, 'is', null)`, and `rpc('follow_counts', …)` counting every follow row the way the
 * server's definer function does.
 *
 * B26 lets an update end in `.select('id')`, answering with the rows it changed (the post
 * privacy control's "did anything change?" check). Posts are updated in place, so a later feed
 * read shows the new visibility.
 *
 * B27 adds `mutes` and `reports` tables, and the unique-key refusal (23505) on blocks, mutes and
 * reports, so "tapped twice" paths can be tested. The server's report trigger and the RLS that
 * makes muted/blocked content disappear are not imitated — they were probed live.
 *
 * B28 adds the re-share insert's one refusal the app handles: a second re-share of the same post
 * by the same lifter is 23505 (the partial unique index). Re-shares are seeded with
 * `shared_post_id` (feedFixtures `rawReshare`), and the app reads their originals back from
 * `posts` by id. The server's re-share trigger (chains, self re-shares, the flair stamp) and the
 * read rule that hides a re-share whose original you can't see are not imitated — probed live.
 *
 * B36 adds `teams`, `team_members` and `team_invites`, and the server pieces the Teams screens
 * lean on: a team insert gets a server id, `join_mode` 'open' and its owner's membership row (the
 * creation trigger) and answers `.select(…).single()`; a member insert into an invite-only team
 * without an invite is refused 42501 (the join policy), a repeat join or invite is 23505, and a
 * join uses the invite up (the consume trigger); an owner's own membership row can't be deleted
 * (the leave policy — silently, like RLS); `.delete(…).select(…)` answers with the removed rows.
 * Reads nest `team:teams(…)` on memberships and invites, and `profile:profiles…(…)` on
 * memberships. Owner-only rights (the mode switch, inviting) and roster visibility are NOT
 * imitated — the fake has no signed-in identity; those were probed live (rolled back) at B36.
 *
 * What it does NOT do: row-level security or general embedding. Posts are seeded already shaped
 * the way the server's embed returns them (author, flair and workout nested in), and the follow
 * insert imitates the one RLS refusal the app handles (a block in either direction). Server-side
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
  /** Vote rows: `{ post_id, user_id, value }` (B23). */
  votes: Row[];
  /** Comment rows: `{ id, post_id, user_id, body, created_at }` (B23). */
  comments: Row[];
  /**
   * Workouts as another lifter's profile History reads them (B25): `{ id, user_id, title,
   * started_at, ended_at, workout_exercises: [...] }`, already nested the way `HISTORY_SELECT`
   * returns them. Seed only what the viewer may see — RLS is not imitated.
   */
  workouts: Row[];
  /** Record rows as the profile's PR read returns them (B25): with `exercise: { name }` nested in. */
  personal_records: Row[];
  /** Mute rows: `{ muter_id, muted_id }` (B27). */
  mutes: Row[];
  /** Report rows as the app inserts them: `{ reporter_id, target_kind, target_id, reason, details }` (B27). */
  reports: Row[];
  /** Team rows: `{ id, name, join_mode, created_by, created_at }` (B36). */
  teams: Row[];
  /** Membership rows: `{ team_id, user_id, role, joined_at }` (B36). */
  team_members: Row[];
  /** Invite rows: `{ team_id, user_id }` (B36). */
  team_invites: Row[];
}

/** What a request can name: the tables, plus the computed `post_scores` and (B24) `post_hot_scores` views. */
type FakeSource = keyof FakeSocialTables | 'post_scores' | 'post_hot_scores';

/**
 * The server's hot score (the `post_hot_scores` view, B24), imitated so the fake ranks the way
 * the server does: Reddit's formula over a post's net votes and its age. TEST USE ONLY — the app
 * never computes this; the migration is its one home and this copy must follow it if it changes.
 */
function fakeHotScore(netVotes: number, createdAt: string): number {
  const order = Math.log10(Math.max(Math.abs(netVotes), 1));
  return Math.sign(netVotes) * order + (Date.parse(createdAt) / 1000 - 1134028003) / 45000;
}

/** Compares a stored cell with a filter value: as numbers when the cell is a number, else as text. */
function compareCell(cell: unknown, value: string): number {
  if (typeof cell === 'number') return cell - Number(value);
  const s = String(cell);
  return s === value ? 0 : s < value ? -1 : 1;
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
    if (op === 'eq') return compareCell(cell, value) === 0;
    if (op === 'lt') return compareCell(cell, value) < 0;
    if (op === 'gt') return compareCell(cell, value) > 0;
    return likeToRegExp(value).test(String(cell));
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
    votes: [...(seed.votes ?? [])],
    comments: [...(seed.comments ?? [])],
    workouts: [...(seed.workouts ?? [])],
    personal_records: [...(seed.personal_records ?? [])],
    mutes: [...(seed.mutes ?? [])],
    reports: [...(seed.reports ?? [])],
    teams: [...(seed.teams ?? [])],
    team_members: [...(seed.team_members ?? [])],
    team_invites: [...(seed.team_invites ?? [])],
  };
  const requests: FakeCall[][] = [];
  let offline = options.offline ?? false;
  let commentCounter = 0;
  let teamCounter = 0;

  /**
   * (B36) PostgREST's embeds on the team tables, for the two the app asks for: a membership or
   * invite row's `team:teams(…)`, and a membership row's `profile:profiles…(…)`.
   */
  function withTeamEmbeds(table: FakeSource, row: Row, select: unknown): Row {
    if (typeof select !== 'string') return row;
    const out: Row = { ...row };
    if ((table === 'team_members' || table === 'team_invites') && select.includes('team:teams(')) {
      out.team = tables.teams.find((t) => t.id === row.team_id) ?? null;
    }
    if (table === 'team_members' && select.includes('profile:profiles')) {
      out.profile = tables.profiles.find((p) => p.id === row.user_id) ?? null;
    }
    return out;
  }

  /** The `post_scores` view, computed now: every post's net score and comment count. */
  function postScores(): Row[] {
    return (tables.posts as Row[]).map((p) => ({
      post_id: p.id,
      score: tables.votes.filter((v) => v.post_id === p.id).reduce((sum, v) => sum + Number(v.value), 0),
      comment_count: tables.comments.filter((c) => c.post_id === p.id).length,
    }));
  }

  /** The `post_hot_scores` view, computed now (B24): each post's own columns plus its hot score. */
  function hotRows(): Row[] {
    return (tables.posts as Row[]).map((p) => {
      const net = tables.votes.filter((v) => v.post_id === p.id).reduce((sum, v) => sum + Number(v.value), 0);
      return { ...p, hot_score: fakeHotScore(net, String(p.created_at)) };
    });
  }

  /** The upvote-only trigger: refuses a downvote on a post whose flair takes upvotes only. */
  function voteRefusal(vote: Row): { message: string; code: string } | null {
    const post = (tables.posts as Row[]).find((p) => p.id === vote.post_id);
    const flair = post?.flair as { upvotes_only?: boolean } | null | undefined;
    return vote.value === -1 && flair?.upvotes_only === true ? { code: 'P0001', message: 'This post takes upvotes only' } : null;
  }

  /** A comment row as `COMMENT_SELECT` returns it: the author nested in from profiles. */
  function withAuthor(comment: Row): Row {
    const author = tables.profiles.find((p) => p.id === comment.user_id) ?? null;
    return { ...comment, author };
  }

  /**
   * The `profiles` table's server rules on an update (B25), imitated: a username another profile
   * holds (any case — the column is citext) is 23505; the B02 CHECKs and the B25 own-folder
   * avatar CHECK are 23514, named the way Postgres names them.
   */
  function profileRefusal(change: Row, targets: Row[]): { code: string; message: string } | null {
    const username = change.username;
    if (typeof username === 'string') {
      const taken = tables.profiles.some(
        (p) => !targets.includes(p) && typeof p.username === 'string' && p.username.toLowerCase() === username.toLowerCase(),
      );
      if (taken) return { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' };
      if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
        return { code: '23514', message: 'new row violates check constraint "profiles_username_check"' };
      }
    }
    const check = (name: string) => ({ code: '23514', message: `new row violates check constraint "${name}"` });
    if (typeof change.display_name === 'string' && Array.from(change.display_name).length > 50) return check('profiles_display_name_check');
    if (typeof change.bio === 'string' && Array.from(change.bio).length > 300) return check('profiles_bio_check');
    const avatar = change.avatar_url;
    if (typeof avatar === 'string' && targets.some((t) => !avatar.startsWith(`${String(t.id)}/`))) {
      return check('profiles_avatar_in_own_folder');
    }
    return null;
  }

  /**
   * `follow_counts` (B25), computed like the server function: every follow row, whoever the
   * caller is — the server's definer function sees past follows RLS, and so does this.
   */
  function followCounts(profileId: unknown): Row[] {
    return [
      {
        followers: tables.follows.filter((f) => f.followee_id === profileId).length,
        following: tables.follows.filter((f) => f.follower_id === profileId).length,
      },
    ];
  }

  /** Runs one finished request against the tables. */
  function execute(table: FakeSource, calls: FakeCall[]): { data: unknown; error: { message: string; code?: string } | null } {
    if (offline) return { data: null, error: { message: 'Network request failed' } };
    const filters: Predicate[] = [];
    // Filters on an embedded list by its alias ("my_vote.user_id"): [alias, column, value].
    const embedFilters: [string, string, unknown][] = [];
    const orders: { column: string; ascending: boolean }[] = [];
    let limit = Infinity;
    let insert: Row | null = null;
    let update: Row | null = null;
    let upsert: { row: Row; onConflict: string[] } | null = null;
    let isDelete = false;
    let single = false;
    for (const [method, ...args] of calls) {
      if (method === 'eq' && String(args[0]).includes('.')) {
        const [alias, column] = String(args[0]).split('.');
        embedFilters.push([alias, column, args[1]]);
        continue;
      }
      if (method === 'single') single = true;
      if (method === 'upsert') {
        const conflict = (args[1] as { onConflict?: string } | undefined)?.onConflict ?? 'id';
        upsert = { row: args[0] as Row, onConflict: conflict.split(',') };
      }
      if (method === 'eq') filters.push((r) => r[args[0] as string] === args[1]);
      if (method === 'neq') filters.push((r) => r[args[0] as string] !== args[1]);
      if (method === 'in') filters.push((r) => (args[1] as unknown[]).includes(r[args[0] as string]));
      if (method === 'not' && args[1] === 'is' && args[2] === null) {
        // not(column, 'is', null) — "has a value" (B25: finished workouts only).
        filters.push((r) => r[args[0] as string] != null);
        continue;
      }
      if (method === 'not') {
        // The other form the app uses: not(column, 'in', '(a,b,c)').
        if (args[1] !== 'in') throw new Error(`fake: unsupported not() operator ${String(args[1])}`);
        const excluded = String(args[2]).replace(/^\(|\)$/g, '').split(',');
        filters.push((r) => !excluded.includes(String(r[args[0] as string])));
      }
      if (method === 'or') filters.push(parseOrFilter(args[0] as string));
      if (method === 'order') orders.push({ column: args[0] as string, ascending: (args[1] as { ascending: boolean }).ascending });
      if (method === 'limit') limit = args[0] as number;
      if (method === 'insert') insert = args[0] as Row;
      if (method === 'update') update = args[0] as Row;
      if (method === 'delete') isDelete = true;
    }
    if (table === 'post_scores') {
      const matching = postScores().filter((r) => filters.every((f) => f(r)));
      return { data: matching, error: null };
    }
    if (table === 'post_hot_scores') {
      // The live server's refusal (probed at B24): through the view, `profiles` is reachable
      // both as the author and through `votes`, so an un-hinted embed is ambiguous (PGRST201).
      const select = calls.find(([m]) => m === 'select')?.[1];
      if (typeof select === 'string' && /(^|[,:(])profiles\(/.test(select)) {
        return { data: null, error: { code: 'PGRST201', message: "Could not embed because more than one relationship was found for 'post_hot_scores' and 'profiles'" } };
      }
    }
    // The hot view: every post with its hot score beside it, read-only like the real view.
    const rows = table === 'post_hot_scores' ? hotRows() : (tables[table] as Row[]);
    if (upsert) {
      const { row, onConflict } = upsert;
      if (table === 'votes') {
        const refused = voteRefusal(row);
        if (refused) return { data: null, error: refused };
      }
      const existing = rows.find((r) => onConflict.every((k) => r[k] === row[k]));
      if (existing) Object.assign(existing, row);
      else rows.push({ ...row });
      return { data: single ? (existing ?? row) : null, error: null };
    }
    if (insert) {
      let row: Row = insert;
      if (table === 'votes') {
        const refused = voteRefusal(row);
        if (refused) return { data: null, error: refused };
        if (rows.some((x) => x.post_id === row.post_id && x.user_id === row.user_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
      }
      if (table === 'comments') {
        commentCounter += 1;
        // The server's defaults: a fresh id and "now" (a fixed, ever-later time keeps tests stable).
        row = {
          id: `comment-${commentCounter}`,
          created_at: new Date(Date.UTC(2026, 10, 15, 20, 0, commentCounter)).toISOString(),
          ...row,
        };
        rows.push(row);
        return { data: single ? withAuthor(row) : null, error: null };
      }
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
      if (table === 'teams') {
        // B36: the server's defaults, then the creation trigger's owner row.
        teamCounter += 1;
        const team: Row = {
          id: `team-${teamCounter}`,
          join_mode: 'open',
          created_at: new Date(Date.UTC(2026, 10, 15, 21, 0, teamCounter)).toISOString(),
          ...row,
        };
        rows.push(team);
        tables.team_members.push({ team_id: team.id, user_id: team.created_by, role: 'owner', joined_at: team.created_at });
        return { data: single ? team : null, error: null };
      }
      if (table === 'team_members') {
        // B36: the join policy (open, or invited; members only) and the primary key.
        const team = tables.teams.find((t) => t.id === row.team_id);
        const invited = tables.team_invites.some((i) => i.team_id === row.team_id && i.user_id === row.user_id);
        const role = row.role ?? 'member';
        if (!team || role !== 'member' || (team.join_mode !== 'open' && !invited)) {
          return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "team_members"' } };
        }
        if (rows.some((x) => x.team_id === row.team_id && x.user_id === row.user_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "team_members_pkey"' } };
        }
        teamCounter += 1;
        rows.push({ role, joined_at: new Date(Date.UTC(2026, 10, 15, 22, 0, teamCounter)).toISOString(), ...row });
        // The consume trigger: joining uses the invite up.
        tables.team_invites = tables.team_invites.filter((i) => !(i.team_id === row.team_id && i.user_id === row.user_id));
        return { data: null, error: null };
      }
      // B27: each table's primary / unique key, refused with Postgres's 23505 like the server.
      const uniqueKeys: Partial<Record<FakeSource, string[]>> = {
        blocks: ['blocker_id', 'blocked_id'],
        mutes: ['muter_id', 'muted_id'],
        reports: ['reporter_id', 'target_kind', 'target_id'],
        team_invites: ['team_id', 'user_id'],
      };
      const key = uniqueKeys[table];
      if (key && rows.some((x) => key.every((k) => x[k] === row[k]))) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      // B28: one re-share per lifter per post (the partial unique index `posts_reshare_unique`).
      if (
        table === 'posts' &&
        row.shared_post_id != null &&
        rows.some((x) => x.user_id === row.user_id && x.shared_post_id === row.shared_post_id)
      ) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "posts_reshare_unique"' } };
      }
      rows.push(row);
      return { data: null, error: null };
    }
    const matching = rows.filter((r) => filters.every((f) => f(r)));
    if (update) {
      if (table === 'profiles') {
        const refused = profileRefusal(update, matching);
        if (refused) return { data: null, error: refused };
      }
      for (const row of matching) Object.assign(row, update);
      // `.update(…).select('id')` (B26) returns the changed rows — none when nothing matched,
      // which is how the app learns a post was gone or not the lifter's.
      const returning = calls.some(([m]) => m === 'select');
      return { data: returning ? matching.map((r) => ({ id: r.id })) : null, error: null };
    }
    if (isDelete) {
      if (table === 'post_hot_scores') throw new Error('fake: a view cannot be deleted from');
      // B36: the leave policy never lets an owner's own row go — silently, as RLS does.
      const removed = table === 'team_members' ? matching.filter((r) => r.role !== 'owner') : matching;
      tables[table] = rows.filter((r) => !removed.includes(r));
      // `.delete(…).select(…)` (B36) answers with the removed rows.
      const returning = calls.some(([m]) => m === 'select');
      return { data: returning ? removed : null, error: null };
    }
    const sorted = [...matching].sort((x, y) => {
      for (const { column, ascending } of orders) {
        const diff = compareCell(x[column], String(y[column]));
        if (diff !== 0) return (diff < 0 ? -1 : 1) * (ascending ? 1 : -1);
      }
      return 0;
    });
    let out: Row[] = sorted.slice(0, limit);
    if (table === 'posts' || table === 'post_hot_scores') {
      // Nest each post's votes under `my_vote`, then narrow by any alias filter — PostgREST's embed.
      out = out.map((post) => {
        let votes = tables.votes.filter((v) => v.post_id === post.id);
        for (const [alias, column, value] of embedFilters) {
          if (alias === 'my_vote') votes = votes.filter((v) => v[column] === value);
        }
        return { ...post, my_vote: votes.map((v) => ({ value: v.value })) };
      });
    }
    if (table === 'comments') out = out.map(withAuthor);
    if (table === 'team_members' || table === 'team_invites') {
      const select = calls.find(([m]) => m === 'select')?.[1];
      out = out.map((r) => withTeamEmbeds(table, r, select));
    }
    return { data: out, error: null };
  }

  const client = {
    from(table: FakeSource) {
      const calls: FakeCall[] = [['from', table]];
      requests.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'in', 'not', 'or', 'order', 'limit', 'insert', 'update', 'upsert', 'delete', 'single']) {
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
    /** A server function call (B25): only `follow_counts` exists. Recorded like a request. */
    rpc(fn: string, params: Record<string, unknown>) {
      requests.push([['rpc', fn, params]]);
      if (offline) return Promise.resolve({ data: null, error: { message: 'Network request failed' } });
      if (fn !== 'follow_counts') return Promise.resolve({ data: null, error: { code: 'PGRST202', message: `fake: no function ${fn}` } });
      return Promise.resolve({ data: followCounts(params.profile_id), error: null });
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
