-- Judge login credentials.
--
-- Until now /api/db/* trusted whatever judgeId the browser sent, so anyone who
-- knew a UUID could cast or overwrite votes. Judges now claim a 4-digit PIN on
-- first login and prove it on every later one.
--
-- Identity is (contest_id, display_order), not judges.id: the same person has
-- one judges row per round (prelim/semi/final), and the PIN belongs to the
-- person. Hence a separate table rather than a column on judges.

create table public.judge_accounts (
  contest_id      text not null references public.contests(id) on delete cascade,
  display_order   int  not null,
  -- scrypt, stored as "<salt hex>:<derived key hex>". A 4-digit PIN is small
  -- enough to enumerate offline, so the lockout below is the real defence.
  pin_hash        text not null,
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (contest_id, display_order)
);

-- Reached only by the API routes via service_role, same as every other table
-- since 0007 — never through PostgREST.
alter table public.judge_accounts enable row level security;
revoke all on table public.judge_accounts from anon, authenticated;
