-- Restore the original judges table schema.
--
-- The table was modified externally (renamed columns, added a per-round
-- column, dropped affiliation, etc.), which broke /api/db/judges and made
-- round_votes/final_scores foreign keys orphaned. We drop+recreate judges
-- with the schema from 0001_init.sql; the CASCADE wipes round_votes and
-- final_scores (which we will re-populate by running the importer).
--
-- competitions, contestants, and round_states stay intact — including any
-- final_criteria values set since 0005.

set search_path = public;

drop table if exists judges cascade;

create table judges (
  id               uuid primary key default gen_random_uuid(),
  competition_id   text not null references competitions(id) on delete cascade,
  display_no       int  not null,
  name             text not null,
  stage_name       text,
  genre            text,
  affiliation      text,
  career           text,
  contact_phone    text,
  contact_email    text,
  memo             text,
  max_prelim_votes int,
  max_semi_votes   int,
  vote_target      vote_target not null default 'all',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (competition_id, display_no)
);

create index judges_competition_idx on judges(competition_id);

create trigger trg_votes_updated_at before update on round_votes
  for each row execute function set_updated_at();

create trigger trg_scores_updated_at before update on final_scores
  for each row execute function set_updated_at();
