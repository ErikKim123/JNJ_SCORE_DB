-- Close the 12 Supabase Security Advisor errors: 8 tables with RLS off, and
-- 4 aggregate views that run with their owner's rights instead of the caller's.
--
-- All of these are reachable through PostgREST with the project's anon key,
-- which ships in the browser bundle of every app sharing this Supabase
-- project — so until now anyone could read *and rewrite* the vote and score
-- tables.
--
-- Nothing reads them through PostgREST: the six data tables are leftovers from
-- the sheet-import MVP (the app moved to contests/participants/judge_votes/
-- qualifiers), and the schema_migrations pair is only touched by the migration
-- runners, which connect as postgres over the pooler. So RLS with no policies
-- plus revoked grants is the correct lock — service_role and postgres both
-- bypass it. Granting specific access back is what adding a policy is for.

alter table public.competitions          enable row level security;
alter table public.round_states          enable row level security;
alter table public.contestants           enable row level security;
alter table public.contestant_attendance enable row level security;
alter table public.round_votes           enable row level security;
alter table public.final_scores          enable row level security;
alter table public.schema_migrations     enable row level security;
alter table div.schema_migrations        enable row level security;

revoke all on table
  public.competitions, public.round_states, public.contestants,
  public.contestant_attendance, public.round_votes, public.final_scores,
  public.schema_migrations, div.schema_migrations
  from anon, authenticated;

alter view public.v_round_ranking set (security_invoker = on);
alter view public.v_prelim_passed set (security_invoker = on);
alter view public.v_semi_passed   set (security_invoker = on);
alter view public.v_final_ranking set (security_invoker = on);

revoke all on
  public.v_round_ranking, public.v_prelim_passed,
  public.v_semi_passed, public.v_final_ranking
  from anon, authenticated;
