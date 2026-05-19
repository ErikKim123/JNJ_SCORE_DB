-- Aggregation views that replace the Google Sheet's auto-computed columns
-- (예선통과 / 본선통과 / 결승진출 / 결승 등수).
--
-- Pass rule per user: "1.대회정보 의 통과 인원 N 을 보고 역할별 등수 안에
-- 들면 통과", 동점자는 모두 통과(=DENSE_RANK <= N).

set search_path = public;

-- ---------- 예선/본선 라운드 집계 (O 득표수, 역할별 등수) ----------
-- 각 라운드의 (참가자별 O 득표수, 역할 내 DENSE_RANK) 계산.
-- 불참(contestant_attendance.absent = true) 인 참가자는 ranking 에서 제외.
create or replace view v_round_ranking as
with vote_counts as (
  select
    c.competition_id,
    rv.round,
    c.id          as contestant_id,
    c.role        as role,
    count(*) filter (where rv.vote = 'O') as o_votes,
    count(*) filter (where rv.vote = 'X') as x_votes
  from contestants c
  join round_votes rv
    on rv.competition_id = c.competition_id
   and rv.contestant_id  = c.id
  where rv.round in ('prelim', 'semi')
  group by c.competition_id, rv.round, c.id, c.role
),
filtered as (
  select v.*
  from vote_counts v
  left join contestant_attendance a
    on a.competition_id = v.competition_id
   and a.round          = v.round
   and a.contestant_id  = v.contestant_id
  where coalesce(a.absent, false) = false
)
select
  competition_id,
  round,
  contestant_id,
  role,
  o_votes,
  x_votes,
  -- 역할별 등수 (동점자 같은 rank). role 이 null 이면 단일 그룹으로 묶임.
  dense_rank() over (
    partition by competition_id, round, role
    order by o_votes desc
  ) as rank_in_role
from filtered;

-- 예선 통과자: prelim_pass_cap 이내 등수 (동점자 모두 통과)
create or replace view v_prelim_passed as
select r.competition_id, r.contestant_id, r.role, r.o_votes, r.rank_in_role
from   v_round_ranking r
join   competitions c on c.id = r.competition_id
where  r.round = 'prelim'
  and  r.rank_in_role <= c.prelim_pass_cap;

-- 본선 통과자(=결승 진출자): semi_pass_cap 이내 등수
create or replace view v_semi_passed as
select r.competition_id, r.contestant_id, r.role, r.o_votes, r.rank_in_role
from   v_round_ranking r
join   competitions c on c.id = r.competition_id
where  r.round = 'semi'
  and  r.rank_in_role <= c.semi_pass_cap;

-- ---------- 결승 점수 집계 (역할별 등수) ----------
create or replace view v_final_ranking as
with totals as (
  select
    c.competition_id,
    c.id            as contestant_id,
    c.role,
    -- 심사위원별 (basics+connection+musicality) 의 단순 합.
    -- 추후 가중치/평균 변경 시 이 SUM 만 수정.
    sum(fs.basics + fs.connection + fs.musicality) as total_score,
    count(distinct fs.judge_id)                    as judge_count
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
