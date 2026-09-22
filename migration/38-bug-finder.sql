-- 38: the automatic bug finder's results. A robot student uses the live app on its own test
-- accounts and records one row per step (pass/fail, how long, why it failed). Read only by admins.
begin;

create table if not exists public.bug_finder_runs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  run_id      uuid not null,
  step        text not null,
  ok          boolean not null,
  duration_ms integer,
  reason      text
);
create index if not exists bug_finder_runs_time_idx on public.bug_finder_runs (created_at desc);
create index if not exists bug_finder_runs_run_idx  on public.bug_finder_runs (run_id);

alter table public.bug_finder_runs enable row level security;
revoke all on public.bug_finder_runs from anon, authenticated;
grant select, insert, delete on public.bug_finder_runs to service_role;

create or replace function public.admin_bug_finder_runs(_limit integer default 20)
returns table (run_id uuid, started_at timestamptz, passed integer, total integer, failed_steps text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admins only'; end if;
  return query
  select r.run_id, min(r.created_at), count(*) filter (where r.ok)::int, count(*)::int,
         array_remove(array_agg(r.step order by r.created_at) filter (where not r.ok), null)
    from public.bug_finder_runs r
   group by r.run_id
   order by min(r.created_at) desc
   limit greatest(1, least(_limit, 200));
end $$;

create or replace function public.admin_bug_finder_steps(_run_id uuid)
returns table (created_at timestamptz, step text, ok boolean, duration_ms integer, reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admins only'; end if;
  return query
  select r.created_at, r.step, r.ok, r.duration_ms, r.reason
    from public.bug_finder_runs r
   where r.run_id = _run_id
   order by r.created_at;
end $$;

-- Keep 90 days, same as the student step trail.
create or replace function public.prune_bug_finder_runs()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.bug_finder_runs where created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.prune_bug_finder_runs() from public, anon, authenticated;
grant execute on function public.prune_bug_finder_runs() to service_role;

revoke all on function public.admin_bug_finder_runs(integer), public.admin_bug_finder_steps(uuid) from public, anon;
grant execute on function public.admin_bug_finder_runs(integer), public.admin_bug_finder_steps(uuid) to authenticated, service_role;

do $$ begin
  if to_regclass('public.bug_finder_runs') is null then raise exception 'bug_finder_runs missing'; end if;
end $$;
commit;
notify pgrst, 'reload schema';
