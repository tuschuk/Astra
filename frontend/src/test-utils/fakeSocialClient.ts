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
 * B37 adds `team_posts` (a push gets a server id and time; reads embed `author:profiles…(…)`),
 * `team_assignments` (its primary key refuses a repeat with 23505), the owner's role update on
 * `team_members` (the owner row never changes and `owner` is never granted — silently, like the
 * policy; `.update(…).select(…)` answers with the changed rows), and server functions supplied by
 * the test through the `rpc` option (the payload functions' answers are the test's to choose).
 * Who may push, assign or read a coach's payload is NOT imitated — probed live at B37.
 *
 * B38 adds `team_feed_hides` (its primary key refuses a repeat hide with 23505), the team delete's
 * cascade (every `team_*` row of a deleted team goes with it), and the always-half of the
 * membership-removal trigger (a deleted membership takes that member's assignments in the team).
 * The trigger's other half — a removal by someone else also deletes the member's invite, a leave
 * keeps it — depends on who is acting, which the fake has no notion of; probed live at B38. Who
 * may remove, hide, unhide or delete a team is NOT imitated — probed live at B38.
 *
 * B39 adds `program_team_shares` (its primary key refuses a repeat share with 23505; a team delete
 * cascades its shares). Who may share — the author, with a Team they're in — is NOT imitated
 * (the `refuse` option lets a test stand in for that refusal); probed live at B39.
 *
 * B40 adds `programs` (seeded as server rows: `{ id, user_id, name, visibility, deleted_at,
 * created_at }`), `is(column, null)`, an `author:profiles…(…)` embed on programs (by `user_id`), and
 * `textSearch(column, query, { type: 'websearch' })` imitating `websearch_to_tsquery('simple', …)`
 * over the row's `name` (the generated column's source): every bare word must be a whole word of
 * the name and every "quoted phrase" must appear as consecutive words, case-insensitive. The
 * `-word` and `or` operators are not imitated. Who may read a program (B39's rule) is NOT imitated
 * — seed only what the reader may see; probed live at Gate 2.
 *
 * B41 adds `program_votes` (`{ program_id, user_id, value, created_at? }`) and `program_comments`
 * (`{ id, program_id, user_id, body, created_at }`; an insert gets a server id and time and comes
 * back with its author nested, like `comments`), the computed `program_scores` view (every
 * program's own columns, its net score over the rolling 7/30/365-day windows and all time, and
 * its comment count — see `programScoreRows`), the `author:profiles…(…)` embed through that view,
 * and `.maybeSingle()` on a read (the first matching row, or null). Who may vote or comment —
 * published programs only, as yourself — is NOT imitated (use `refuse`); probed live at B41.
 *
 * B50 adds `gyms` (`{ id, name, address }`) and `gym_members` (`{ user_id, gym_id, joined_at }`):
 * the membership upsert on `user_id` (the primary key — one gym per lifter, so a second join
 * replaces the first) gets a server join time on a new row and a fresh one when the gym changes
 * (the restamp trigger); reads nest `gym:gyms(…)` and `profile:profiles…(…)` on memberships. The
 * directory's `gyms_near` is supplied by the test through `rpc`. That only you may join, switch
 * or leave as yourself, and that nobody may write `gyms`, are NOT imitated — probed live at B50.
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
  /** Push rows: `{ id, team_id, author_id, kind, body, program_id, program_workout_id, created_at }` (B37). */
  team_posts: Row[];
  /** Assignment rows: `{ team_id, user_id, program_id, assigned_by, created_at }` (B37). */
  team_assignments: Row[];
  /** Feed-hide rows: `{ team_id, post_id, hidden_by }` (B38). */
  team_feed_hides: Row[];
  /** Program share rows: `{ program_id, team_id }` (B39). */
  program_team_shares: Row[];
  /** Program rows as the server holds them: `{ id, user_id, name, visibility, deleted_at, created_at }` (B40). */
  programs: Row[];
  /** Program vote rows: `{ program_id, user_id, value, created_at? }` (B41). No `created_at` = cast just now. */
  program_votes: Row[];
  /** Program comment rows: `{ id, program_id, user_id, body, created_at }` (B41). */
  program_comments: Row[];
  /** Gym rows: `{ id, name, address }` (B50). */
  gyms: Row[];
  /** Gym membership rows: `{ user_id, gym_id, joined_at }` — at most one per lifter (B50). */
  gym_members: Row[];
}

/** What a request can name: the tables, plus the computed views — `post_scores`, (B24) `post_hot_scores`, (B41) `program_scores`. */
type FakeSource = keyof FakeSocialTables | 'post_scores' | 'post_hot_scores' | 'program_scores';

/** A day in milliseconds — the `program_scores` windows are counted in days. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The `program_scores` view's window sums (B41), imitated so the fake ranks Featured programs
 * the way the server does: a vote counts in a window when it was cast within the last `days`
 * days (no `days` = all time). TEST USE ONLY — the migration is the one home of this arithmetic,
 * and this copy must follow it if the windows change.
 */
function fakeWindowScore(votes: Row[], days?: number): number {
  const since = days == null ? -Infinity : Date.now() - days * DAY_MS;
  return votes
    .filter((v) => v.created_at == null || Date.parse(String(v.created_at)) >= since)
    .reduce((sum, v) => sum + Number(v.value), 0);
}

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

/** A name's words as the 'simple' text-search config sees them: lower-cased runs of letters and digits. */
function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * (B40) `websearch_to_tsquery('simple', query) @@ to_tsvector('simple', name)`, imitated for the
 * forms the Marketplace's search box produces: bare words (each must be a whole word of the name)
 * and "quoted phrases" (consecutive words). A query with no words matches nothing, like the server.
 */
function websearchMatch(query: string): Predicate {
  const phrases: string[][] = [];
  const rest = query.replace(/"([^"]*)"/g, (_match, phrase: string) => {
    phrases.push(words(phrase));
    return ' ';
  });
  const terms = [...words(rest).map((w) => [w]), ...phrases.filter((p) => p.length > 0)];
  return (row) => {
    if (terms.length === 0) return false;
    const name = words(String(row.name ?? ''));
    return terms.every((term) => name.some((_word, i) => term.every((w, j) => name[i + j] === w)));
  };
}

interface FakeOptions {
  /** Make every request fail as a dropped connection would. */
  offline?: boolean;
  /**
   * (B37) Extra server functions: name → the answer for the given arguments. `follow_counts`
   * is built in; anything else not listed here answers PGRST202 like a missing function.
   */
  rpc?: Record<string, (params: Record<string, unknown>) => unknown>;
  /**
   * (B39) Inserts into these tables are refused with this error, standing in for a security
   * rule the fake can't judge (it has no signed-in identity) — e.g. sharing with a Team you're not in.
   */
  refuse?: Partial<Record<keyof FakeSocialTables, { code: string; message: string }>>;
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
    team_posts: [...(seed.team_posts ?? [])],
    team_assignments: [...(seed.team_assignments ?? [])],
    team_feed_hides: [...(seed.team_feed_hides ?? [])],
    program_team_shares: [...(seed.program_team_shares ?? [])],
    programs: [...(seed.programs ?? [])],
    program_votes: [...(seed.program_votes ?? [])],
    program_comments: [...(seed.program_comments ?? [])],
    gyms: [...(seed.gyms ?? [])],
    gym_members: [...(seed.gym_members ?? [])],
  };
  const requests: FakeCall[][] = [];
  let offline = options.offline ?? false;
  let commentCounter = 0;
  let teamCounter = 0;
  let pushCounter = 0;
  let gymJoinCounter = 0;

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
    if (table === 'team_posts' && select.includes('author:profiles')) {
      out.author = tables.profiles.find((p) => p.id === row.author_id) ?? null;
    }
    if (table === 'gym_members' && select.includes('gym:gyms(')) {
      out.gym = tables.gyms.find((g) => g.id === row.gym_id) ?? null;
    }
    if (table === 'gym_members' && select.includes('profile:profiles')) {
      out.profile = tables.profiles.find((p) => p.id === row.user_id) ?? null;
    }
    if ((table === 'programs' || table === 'program_scores') && select.includes('author:profiles')) {
      out.author = tables.profiles.find((p) => p.id === row.user_id) ?? null;
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

  /**
   * The `program_scores` view, computed now (B41): each program's own columns, its net votes over
   * the rolling windows (`fakeWindowScore`) and all time, and its comment count.
   */
  function programScoreRows(): Row[] {
    return tables.programs.map((p) => {
      const votes = tables.program_votes.filter((v) => v.program_id === p.id);
      return {
        ...p,
        score: fakeWindowScore(votes),
        score_week: fakeWindowScore(votes, 7),
        score_month: fakeWindowScore(votes, 30),
        score_year: fakeWindowScore(votes, 365),
        comment_count: tables.program_comments.filter((c) => c.program_id === p.id).length,
      };
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
    let maybeSingle = false;
    for (const [method, ...args] of calls) {
      if (method === 'maybeSingle') maybeSingle = true;
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
      if (method === 'is') filters.push((r) => (args[1] === null ? r[args[0] as string] == null : r[args[0] as string] === args[1]));
      if (method === 'textSearch') filters.push(websearchMatch(String(args[1])));
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
    // The views — hot (every post with its hot score) and (B41) program scores — are computed now
    // and read-only, like the real views.
    if (table === 'program_scores' && (upsert || insert || update || isDelete)) {
      throw new Error('fake: a view cannot be written to');
    }
    const rows =
      table === 'post_hot_scores' ? hotRows() : table === 'program_scores' ? programScoreRows() : (tables[table] as Row[]);
    if (upsert) {
      const { row, onConflict } = upsert;
      const refusal = table in tables ? options.refuse?.[table as keyof FakeSocialTables] : undefined;
      if (refusal) return { data: null, error: refusal };
      if (table === 'votes') {
        const refused = voteRefusal(row);
        if (refused) return { data: null, error: refused };
      }
      const existing = rows.find((r) => onConflict.every((k) => r[k] === row[k]));
      if (table === 'gym_members') {
        // B50: the server stamps the join time — on a new row, and again when the gym changes.
        gymJoinCounter += 1;
        const now = new Date(Date.UTC(2026, 10, 16, 9, 0, gymJoinCounter)).toISOString();
        if (!existing) {
          rows.push({ ...row, joined_at: now });
        } else {
          if (existing.gym_id !== row.gym_id) existing.joined_at = now;
          existing.gym_id = row.gym_id;
        }
        return { data: null, error: null };
      }
      if (existing) Object.assign(existing, row);
      else rows.push({ ...row });
      return { data: single ? (existing ?? row) : null, error: null };
    }
    if (insert) {
      let row: Row = insert;
      const refusal = table in tables ? options.refuse?.[table as keyof FakeSocialTables] : undefined;
      if (refusal) return { data: null, error: refusal };
      if (table === 'votes') {
        const refused = voteRefusal(row);
        if (refused) return { data: null, error: refused };
        if (rows.some((x) => x.post_id === row.post_id && x.user_id === row.user_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
      }
      if (table === 'comments' || table === 'program_comments') {
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
      if (table === 'team_posts') {
        // B37: the server's defaults — a fresh id and an ever-later time.
        pushCounter += 1;
        rows.push({
          id: `push-${pushCounter}`,
          body: null,
          program_id: null,
          program_workout_id: null,
          created_at: new Date(Date.UTC(2026, 10, 15, 23, 0, pushCounter)).toISOString(),
          ...row,
        });
        return { data: null, error: null };
      }
      // B27: each table's primary / unique key, refused with Postgres's 23505 like the server.
      const uniqueKeys: Partial<Record<FakeSource, string[]>> = {
        blocks: ['blocker_id', 'blocked_id'],
        mutes: ['muter_id', 'muted_id'],
        reports: ['reporter_id', 'target_kind', 'target_id'],
        team_invites: ['team_id', 'user_id'],
        team_assignments: ['team_id', 'user_id', 'program_id'],
        team_feed_hides: ['team_id', 'post_id'],
        program_team_shares: ['program_id', 'team_id'],
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
      // B37: the role policy — the owner row never changes and nobody is made owner (silently).
      const changing =
        table === 'team_members' ? (update.role === 'owner' ? [] : matching.filter((r) => r.role !== 'owner')) : matching;
      for (const row of changing) Object.assign(row, update);
      // `.update(…).select('id')` (B26) returns the changed rows — none when nothing matched,
      // which is how the app learns a post was gone or not the lifter's.
      const returning = calls.some(([m]) => m === 'select');
      return { data: returning ? changing.map((r) => ({ id: r.id, user_id: r.user_id })) : null, error: null };
    }
    if (isDelete) {
      if (table === 'post_hot_scores' || table === 'program_scores') throw new Error('fake: a view cannot be deleted from');
      // B36: the leave policy never lets an owner's own row go — silently, as RLS does.
      const removed = table === 'team_members' ? matching.filter((r) => r.role !== 'owner') : matching;
      tables[table] = rows.filter((r) => !removed.includes(r));
      if (table === 'team_members') {
        // B38: the removal trigger's always-half — a departed member's assignments go too.
        const gone = (a: Row) => removed.some((m) => m.team_id === a.team_id && m.user_id === a.user_id);
        tables.team_assignments = tables.team_assignments.filter((a) => !gone(a));
      }
      if (table === 'teams') {
        // B38: every team-scoped table cascades from teams.
        const ids = new Set(removed.map((t) => t.id));
        for (const child of ['team_members', 'team_invites', 'team_posts', 'team_assignments', 'team_feed_hides', 'program_team_shares'] as const) {
          tables[child] = tables[child].filter((r) => !ids.has(r.team_id));
        }
      }
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
    if (table === 'comments' || table === 'program_comments') out = out.map(withAuthor);
    if (
      table === 'team_members' ||
      table === 'team_invites' ||
      table === 'team_posts' ||
      table === 'programs' ||
      table === 'program_scores' ||
      table === 'gym_members'
    ) {
      const select = calls.find(([m]) => m === 'select')?.[1];
      out = out.map((r) => withTeamEmbeds(table, r, select));
    }
    // `.maybeSingle()` (B41): the one matching row, or null when none matched.
    if (maybeSingle) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  const client = {
    from(table: FakeSource) {
      const calls: FakeCall[] = [['from', table]];
      requests.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'in', 'not', 'or', 'is', 'textSearch', 'order', 'limit', 'insert', 'update', 'upsert', 'delete', 'single', 'maybeSingle']) {
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
    /** A server function call (B25): `follow_counts`, plus any the test supplies (B37). Recorded like a request. */
    rpc(fn: string, params: Record<string, unknown>) {
      requests.push([['rpc', fn, params]]);
      if (offline) return Promise.resolve({ data: null, error: { message: 'Network request failed' } });
      const extra = options.rpc?.[fn];
      if (extra) return Promise.resolve({ data: extra(params), error: null });
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
