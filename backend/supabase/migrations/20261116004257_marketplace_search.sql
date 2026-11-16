-- B40 marketplace-browse (MKT-1): full-text search over program names, and the browse list's index.
--
-- What it adds to `public.programs`:
--   - `search` — a tsvector GENERATED from `name`, so it can never drift from the name and nobody
--     ever writes it. The Marketplace tab searches it with PostgREST's `wfts` (websearch_to_tsquery)
--     filter, which accepts raw user input without syntax errors.
--     'simple' config, not 'english': program names are proper nouns and gym jargon ("PHUL",
--     "5/3/1"); stemming adds nothing and 'simple' is language-neutral and predictable. It matches
--     whole words only — "starting" finds "Starting Strength", "Start" does not (recorded limitation).
--   - a GIN index on `search`, so a word search never scans the whole table;
--   - a partial index matching the browse list exactly: published, live, newest first.
--
-- Nothing else changes: no new policy (B39's "visible programs are readable" already admits
-- published rows to any signed-in user), no new function, and the three child tables stay
-- author-only. The phone never sees this column: sync reads and writes NAMED columns only
-- (`TABLE_COLUMNS.programs` on the device), and `search` must stay out of that list — an upload
-- naming a generated column is refused by Postgres.

alter table public.programs
  add column search tsvector
  generated always as (to_tsvector('simple', name)) stored;

create index programs_search_idx on public.programs using gin (search);

create index programs_published_idx
  on public.programs (created_at desc, id desc)
  where visibility = 'published' and deleted_at is null;
