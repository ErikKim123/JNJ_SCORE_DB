-- Fix v_prelim_passed / v_semi_passed: use ROW_NUMBER cap to find vote
-- threshold (the Nth person's O-vote count), then include all who tie at
-- or above it. Excludes 0-vote contestants (nobody passes with 0 votes).
--
-- v_round_ranking stays as-is (it just exposes O/X counts + DENSE_RANK for UI).
--
-- Rule (user): "1.대회정보 의 통과 인원 N 을 보고 역할별 등수 안에 들면 통과,
-- 동점자는 모두 통과."

set search_path = public;

create or replace view v_prelim_passed as
with positions as (
  select
    r.competition_id, r.contestant_id, r.role, r.o_votes,
    row_number() over (
      partition by r.competition_id, r.role
      order by r.o_votes desc
    ) as row_pos
  from v_round_ranking r
  where r.round = 'prelim' and r.o_votes > 0
),
threshold as (
  select p.competition_id, p.role, min(p.o_votes) as cutoff
  from positions p
  join competitions c on c.id = p.competition_id
  where p.row_pos <= c.prelim_pass_cap
  group by p.competition_id, p.role
)
select
  p.competition_id, p.contestant_id, p.role, p.o_votes,
  -- rank_in_role re-derived against full ranking for UI consistency
  dense_rank() over (
    partition by p.competition_id, p.role
    order by p.o_votes desc
  ) as rank_in_role
from positions p
join threshold t
  on t.competition_id = p.competition_id
 and t.role is not distinct from p.role
where p.o_votes >= t.cutoff;

create or replace view v_semi_passed as
with positions as (
  select
    r.competition_id, r.contestant_id, r.role, r.o_votes,
    row_number() over (
      partition by r.competition_id, r.role
      order by r.o_votes desc
    ) as row_pos
  from v_round_ranking r
  where r.round = 'semi' and r.o_votes > 0
),
threshold as (
  select p.competition_id, p.role, min(p.o_votes) as cutoff
  from positions p
  join competitions c on c.id = p.competition_id
  where p.row_pos <= c.semi_pass_cap
  group by p.competition_id, p.role
)
select
  p.competition_id, p.contestant_id, p.role, p.o_votes,
  dense_rank() over (
    partition by p.competition_id, p.role
    order by p.o_votes desc
  ) as rank_in_role
from positions p
join threshold t
  on t.competition_id = p.competition_id
 and t.role is not distinct from p.role
where p.o_votes >= t.cutoff;
