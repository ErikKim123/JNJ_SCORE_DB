-- JNJ Score — initial schema (sheet → DB migration).
-- All tables live in `public`. RLS stays OFF for MVP; Next.js API routes hit
-- the DB with the service_role key. Re-enable RLS when Supabase Auth lands.

set search_path = public;

create extension if not exists "pgcrypto";

-- ---------- enums ----------
create type round_kind     as enum ('prelim', 'semi', 'final');
create type round_status   as enum ('prep', 'pairing', 'open', 'live', 'calculate', 'close', 'result');
create type vote_value     as enum ('O', 'X');
create type vote_target    as enum ('all', 'leader', 'follower');
create type contestant_role as enum ('leader', 'follower', 'solo');

-- ---------- competitions ----------
-- id keeps the sheet's "고유번호" (e.g. '202606-0001') for URL/operator continuity.
create table competitions (
  id              text primary key,
  name            text not null,
  subtitle        text,
  event_date      date,
  event_date_text text,                -- "2026-06-20(토) 13:00 ~ 21:00" 원문 보존
  venue           text,
  venue_address   text,
  organizer       text,
  host            text,                -- 주관
  sponsor         text,                -- 후원
  genres          text,
  divisions       text,                -- 참가 부문
  age_groups      text,
  capacity_note   text,
  fee_note        text,
  prize_note      text,
  format_note     text,
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  homepage        text,
  notice          text,
  -- 역할별(리더/팔로워 각각) top N 컷오프. 동점자는 모두 통과(View 에서 rank 비교).
  prelim_pass_cap int not null default 0,
  semi_pass_cap   int not null default 0,
  template_no     int,
  current_round   round_kind not null default 'prelim',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- round_states ----------
-- Per-round lifecycle (시트 1.대회정보 의 예선/본선/결승 상태 셀).
create table round_states (
  competition_id text not null references competitions(id) on delete cascade,
  round          round_kind not null,
  status         round_status not null default 'prep',
  updated_at     timestamptz not null default now(),
  primary key (competition_id, round)
);

-- ---------- judges ----------
create table judges (
  id               uuid primary key default gen_random_uuid(),
  competition_id   text not null references competitions(id) on delete cascade,
  display_no       int  not null,         -- 시트 "번호" — 결승 점수 그룹 순서 결정
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

-- ---------- contestants ----------
create table contestants (
  id              uuid primary key default gen_random_uuid(),
  competition_id  text not null references competitions(id) on delete cascade,
  number          text not null,            -- 시트 "참가번호" (문자열 유지: '001' 등)
  team_or_name    text,                     -- name1
  representative  text,                     -- name2 / 대표자
  role            contestant_role,          -- null = 미지정 (솔로 등)
  photo_url       text,                     -- Drive 원본 URL (앱에서 lh3 변환)
  memo            text,                     -- 舊 비고/상태 자유 입력
  created_at      timestamptz not null default now(),
  unique (competition_id, number)
);

create index contestants_competition_role_idx on contestants(competition_id, role);

-- ---------- attendance ----------
-- 라운드별 불참(Non). 별도 테이블로 분리해 라운드마다 다르게 마킹 가능.
create table contestant_attendance (
  competition_id text not null references competitions(id) on delete cascade,
  round          round_kind not null,
  contestant_id  uuid not null references contestants(id) on delete cascade,
  absent         boolean not null default true,
  updated_at     timestamptz not null default now(),
  primary key (competition_id, round, contestant_id)
);

-- ---------- round_votes (prelim/semi) ----------
create table round_votes (
  competition_id text not null references competitions(id) on delete cascade,
  round          round_kind not null,
  judge_id       uuid not null references judges(id) on delete cascade,
  contestant_id  uuid not null references contestants(id) on delete cascade,
  vote           vote_value not null,
  updated_at     timestamptz not null default now(),
  primary key (competition_id, round, judge_id, contestant_id),
  check (round in ('prelim', 'semi'))
);

create index round_votes_lookup_idx
  on round_votes (competition_id, round, contestant_id);

-- ---------- final_scores ----------
create table final_scores (
  competition_id text not null references competitions(id) on delete cascade,
  judge_id       uuid not null references judges(id) on delete cascade,
  contestant_id  uuid not null references contestants(id) on delete cascade,
  basics         int not null check (basics     between 1 and 10),
  connection     int not null check (connection between 1 and 10),
  musicality     int not null check (musicality between 1 and 10),
  updated_at     timestamptz not null default now(),
  primary key (competition_id, judge_id, contestant_id)
);

create index final_scores_lookup_idx
  on final_scores (competition_id, contestant_id);

-- ---------- updated_at trigger ----------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_competitions_updated   before update on competitions
  for each row execute function set_updated_at();
create trigger trg_round_states_updated   before update on round_states
  for each row execute function set_updated_at();
create trigger trg_votes_updated          before update on round_votes
  for each row execute function set_updated_at();
create trigger trg_scores_updated         before update on final_scores
  for each row execute function set_updated_at();
create trigger trg_attendance_updated     before update on contestant_attendance
  for each row execute function set_updated_at();
