-- ============================================================================
-- Program votes, comments and the featured ranking (B41 — MKT-2, MKT-3)
-- ============================================================================
-- What this migration does, in plain language:
--
--   1. `program_votes` — one lifter's thumbs-up (+1) or thumbs-down (−1) on a
--      Marketplace program. At most one per lifter per program: changing your
--      mind rewrites the row, it never adds a second. Exactly the post votes'
--      shape (B23), keyed by program instead of post. Programs have no flair,
--      so both arrows are always allowed (the upvote-only rule is a Physique
--      Check post rule, not a program rule).
--
--   2. `program_comments` — short text on a program, shown oldest first. The
--      same 1–500 character, not-just-whitespace rule as post comments.
--
--   3. Who can do what:
--        * read votes and comments: whoever may see the program (B39's rule,
--          `private.program_visible`, its one home — reached through
--          `private.can_view_program`);
--        * vote or comment: only as yourself, and only on a program that is
--          published and not deleted (`private.program_published`) — the
--          Marketplace is the only place that offers these controls, and a
--          vote can then never hang on a program the public shelf doesn't carry;
--        * take back your own vote or comment: always (no program condition).
--      Comments have no update policy — there is no editing.
--
--   4. `program_scores` — every program the viewer may see, with its net score
--      over four ROLLING windows (the last 7 / 30 / 365 days, and all time)
--      and its comment count. The Marketplace's Featured section reads through
--      it and sorts by a window's column. A vote counts in a window when it was
--      CAST inside it: a changed vote is rewritten in place and keeps its
--      original created_at, so flipping it moves every window it already sat
--      in (by 2 for up→down) — and toggling can never bump a program into
--      "this week".
--
--   Nothing here is mirrored on the phone: like post votes and comments, these
--   are read and written online only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
-- May the caller see this program? Mirrors private.can_view_post. Security
-- definer so it reads the true program row; the decision itself is still
-- program_visible's (B39), as the current user.
create or replace function private.can_view_program(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.programs p
    where p.id = pid
      and private.program_visible(p.id, p.user_id, p.visibility, p.deleted_at)
  )
$$;

-- Is this program on the public shelf (published and not deleted)? The gate
-- on casting a vote or writing a comment.
create or replace function private.program_published(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.programs p
    where p.id = pid and p.visibility = 'published' and p.deleted_at is null
  )
$$;

-- ----------------------------------------------------------------------------
-- program_votes — one row per lifter per program
-- ----------------------------------------------------------------------------
create table public.program_votes (
  program_id uuid not null references public.programs (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Up or down, nothing else.
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The one-vote-per-lifter-per-program rule (its index also serves "all votes
  -- on this program", program_id leading).
  primary key (program_id, user_id)
);

create trigger set_updated_at
  before update on public.program_votes
  for each row execute function extensions.moddatetime (updated_at);

alter table public.program_votes enable row level security;

-- Seeing a program means seeing its score truthfully: every viewer of the
-- program may read all its votes.
create policy "program votes visible with their program"
  on public.program_votes for select
  to authenticated
  using (private.can_view_program(program_id));

create policy "users vote on published programs as themselves"
  on public.program_votes for insert
  to authenticated
  with check (user_id = (select auth.uid()) and private.program_published(program_id));

create policy "users change their own program votes"
  on public.program_votes for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.program_published(program_id));

create policy "users remove their own program votes"
  on public.program_votes for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- program_comments — flat, in conversation order
-- ----------------------------------------------------------------------------
create table public.program_comments (
  -- Server-generated: written online only, so no retry needs a client id.
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Same rule as comments.body (B23, as tightened): 1–500 characters, not just
  -- whitespace. Mirrored by COMMENT_MAX_CHARS in
  -- frontend/src/social/commentLimits.ts — the SAME module as post comments;
  -- change the two CHECKs and that module together.
  body       text not null check (char_length(body) between 1 and 500 and body ~ '\S'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A program's comments, oldest first, id as the tiebreak — the screen's order.
create index program_comments_program_created_idx
  on public.program_comments (program_id, created_at, id);
create index program_comments_user_idx on public.program_comments (user_id);

create trigger set_updated_at
  before update on public.program_comments
  for each row execute function extensions.moddatetime (updated_at);

alter table public.program_comments enable row level security;

create policy "program comments visible with their program"
  on public.program_comments for select
  to authenticated
  using (private.can_view_program(program_id));

create policy "users comment on published programs as themselves"
  on public.program_comments for insert
  to authenticated
  with check (user_id = (select auth.uid()) and private.program_published(program_id));

-- No update policy on purpose: there is no editing, so RLS refuses updates.
create policy "users delete their own program comments"
  on public.program_comments for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- program_scores — popularity over four windows (the Featured section)
-- ----------------------------------------------------------------------------
-- security_invoker: the viewer's own RLS applies to programs, votes and
-- comments, so the view grants no new reading power. Built on programs so every
-- visible program has a row (score 0, not missing). It carries the Marketplace
-- read's own columns (the post_hot_scores precedent — the column list is the
-- contract) so the app reads THROUGH the view with the author embed and the
-- shelf filters (visibility = published, deleted_at is null — RLS alone would
-- also return the caller's own private/deleted programs), ordered by a window.
create view public.program_scores
  with (security_invoker = true) as
  select p.id,
         p.user_id,
         p.name,
         p.visibility,
         p.created_at,
         p.deleted_at,
         coalesce(v.score, 0)::int       as score,
         coalesce(v.score_week, 0)::int  as score_week,
         coalesce(v.score_month, 0)::int as score_month,
         coalesce(v.score_year, 0)::int  as score_year,
         coalesce(c.comments, 0)::int    as comment_count
  from public.programs p
  left join (
    select program_id,
           sum(value)                                                          as score,
           sum(value) filter (where created_at >= now() - interval '7 days')   as score_week,
           sum(value) filter (where created_at >= now() - interval '30 days')  as score_month,
           sum(value) filter (where created_at >= now() - interval '365 days') as score_year
    from public.program_votes
    group by program_id
  ) v on v.program_id = p.id
  left join (
    select program_id, count(*) as comments
    from public.program_comments
    group by program_id
  ) c on c.program_id = p.id;

comment on view public.program_scores is
  'Marketplace popularity (B41, MKT-2): net program votes over rolling 7/30/365-day windows and all time, plus comment count. security_invoker; carries the Marketplace read''s programs columns.';

grant select on public.program_scores to authenticated;
