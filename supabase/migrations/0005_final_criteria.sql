-- Expand the final-round scoring criteria from a fixed 3-tuple
-- (basics/connection/musicality) to a configurable subset of 6:
--   basics         (기본기   / Fundamentals)
--   connection     (연결성   / Connection)
--   musicality     (음악성   / Musicality)
--   creativity     (창의성   / Creativity)        — new
--   crowd_reaction (호응도   / Crowd Reaction)    — new
--   showmanship    (쇼맨십   / Showmanship)       — new
--
-- Each competition decides which subset is active via competitions.final_criteria
-- (a text[] of criterion keys). Existing data keeps the original 3 active.
--
-- Score storage: all six columns are nullable. The judge UI submits values
-- only for active criteria; the ranking view sums whatever non-null values
-- are recorded (COALESCE(col, 0)), so totals scale with the active subset.

set search_path = public;

-- 1) Add the new score columns and make the original three nullable so
--    competitions that disable one of them can still record per-judge rows.
alter table final_scores
  alter column basics      drop not null,
  alter column connection  drop not null,
  alter column musicality  drop not null,
  add column if not exists creativity     int check (creativity     between 1 and 10),
  add column if not exists crowd_reaction int check (crowd_reaction between 1 and 10),
  add column if not exists showmanship    int check (showmanship    between 1 and 10);

-- 2) Per-competition active criteria. Default = original 3 (back-compat).
alter table competitions
  add column if not exists final_criteria text[] not null
    default array['basics','connection','musicality'];

-- Optional sanity: each element must be one of the 6 known keys.
alter table competitions
  drop constraint if exists competitions_final_criteria_chk;
alter table competitions
  add constraint competitions_final_criteria_chk
  check (
    final_criteria <@ array['basics','connection','musicality','creativity','crowd_reaction','showmanship']
  );

-- 3) v_final_ranking — sum whatever non-null scores are recorded.
create or replace view v_final_ranking as
with totals as (
  select
    c.competition_id,
    c.id            as contestant_id,
    c.role,
    sum(
      coalesce(fs.basics, 0)
      + coalesce(fs.connection, 0)
      + coalesce(fs.musicality, 0)
      + coalesce(fs.creativity, 0)
      + coalesce(fs.crowd_reaction, 0)
      + coalesce(fs.showmanship, 0)
    ) as total_score,
    count(distinct fs.judge_id) as judge_count
  from contestants c
  join final_scores fs
    on fs.competition_id = c.competition_id
   and fs.contestant_id  = c.id
  group by c.competition_id, c.id, c.role
)
select
  competition_id,
  contestant_id,
  role,
  total_score,
  judge_count,
  dense_rank() over (
    partition by competition_id, role
    order by total_score desc
  ) as rank_in_role
from totals;
