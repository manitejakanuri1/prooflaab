-- 37: the student step trail.
-- app_events: one row per step a student takes in the app (page, click, server call, error), kept 90 days.
-- Never holds what the student typed, resume text, voice or passwords: only which step, how long, did it work.
-- Read only through the admin_trace_* functions below (admins only). Written only by the client-log function.
begin;

create table if not exists public.app_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  student_id  uuid references public.student_profiles(id) on delete cascade,
  session_id  text,
  request_id  text,
  kind        text not null check (kind in ('page', 'click', 'call', 'error')),
  screen      text,
  action      text,
  target      text,
  status      text,
  duration_ms integer,
  detail      jsonb,
  app_version text
);
create index if not exists app_events_student_time_idx on public.app_events (student_id, created_at desc);
create index if not exists app_events_time_idx        on public.app_events (created_at desc);
create index if not exists app_events_call_idx        on public.app_events (target, created_at desc) where kind = 'call';
create index if not exists app_events_request_idx     on public.app_events (request_id) where request_id is not null;

alter table public.app_events enable row level security;
revoke all on public.app_events from anon, authenticated;
grant select, insert, delete on public.app_events to service_role;

-- ---------------------------------------------------------------- admin reads
create or replace function public.admin_trace_search(_q text default '')
returns table (student_id uuid, full_name text, email text, roll_number text, events_7d bigint, last_seen timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admins only'; end if;
  return query
  select p.id, p.full_name, c.email, p.roll_number,
         (select count(*) from public.app_events e where e.student_id = p.id and e.created_at > now() - interval '7 days'),
         (select max(e.created_at) from public.app_events e where e.student_id = p.id)
    from public.student_profiles p
    left join public.student_contact c on c.student_id = p.id
   where coalesce(_q, '') = ''
      or p.full_name ilike '%' || _q || '%' or c.email ilike '%' || _q || '%' or p.roll_number ilike '%' || _q || '%'
   order by 6 desc nulls last, p.full_name
   limit 30;
end $$;

create or replace function public.admin_trace_student(_student_id uuid, _hours integer default 72, _limit integer default 500)
returns table (created_at timestamptz, session_id text, request_id text, kind text, screen text, action text, target text, status text, duration_ms integer, detail jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admins only'; end if;
  return query
  select e.created_at, e.session_id, e.request_id, e.kind, e.screen, e.action, e.target, e.status, e.duration_ms, e.detail
    from public.app_events e
   where e.student_id = _student_id and e.created_at > now() - make_interval(hours => greatest(1, least(_hours, 720)))
   order by e.created_at desc
   limit greatest(1, least(_limit, 2000));
end $$;

create or replace function public.admin_trace_funnels(_days integer default 7)
returns table (funnel text, step_order integer, step_label text, students bigint, calls bigint, errors bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admins only'; end if;
  return query
  with steps(funnel, ord, label, target) as (values
    ('Resume', 1, 'Resume read', 'resume-parser'),
    ('Resume', 2, 'Test built', 'resume-question-generator'),
    ('Resume', 3, 'Test submitted', 'resume-assessment-submit'),
    ('Resume', 4, 'Coding round run', 'resume-code-execute'),
    ('Lessons', 1, 'Lesson opened', 'level-open'),
    ('Lessons', 2, 'Quiz submitted', 'level-quiz-submit'),
    ('Daily task', 1, 'Task explained', 'task-explain'),
    ('Daily task', 2, 'Written answer submitted', 'submit-written-task'),
    ('Daily task', 3, 'Code answer submitted', 'submit-sandbox-task'),
    ('Voice', 1, 'Recording scored', 'voice-score'))
  select s.funnel, s.ord, s.label,
         count(distinct e.student_id) filter (where e.status = 'ok'),
         count(e.id),
         count(e.id) filter (where e.status is distinct from 'ok')
    from steps s
    left join public.app_events e
      on e.kind = 'call' and e.target = s.target and e.created_at > now() - make_interval(days => greatest(1, least(_days, 90)))
   group by s.funnel, s.ord, s.label
   order by s.funnel, s.ord;
end $$;

create or replace function public.admin_trace_errors(_days integer default 7)
returns table (where_ text, what text, times bigint, students bigint, last_seen timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admins only'; end if;
  return query
  select coalesce(e.target, e.screen, '?'), left(coalesce(e.detail ->> 'message', 'HTTP ' || coalesce(e.detail ->> 'http', '?')), 100),
         count(*), count(distinct e.student_id), max(e.created_at)
    from public.app_events e
   where e.created_at > now() - make_interval(days => greatest(1, least(_days, 90)))
     and (e.kind = 'error' or (e.kind = 'call' and e.status is distinct from 'ok'))
   group by 1, 2
   order by 3 desc
   limit 50;
end $$;

create or replace function public.admin_trace_slow(_days integer default 7)
returns table (target text, calls bigint, avg_ms integer, p95_ms integer, max_ms integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admins only'; end if;
  return query
  select e.target, count(*), round(avg(e.duration_ms))::integer,
         (percentile_cont(0.95) within group (order by e.duration_ms))::integer, max(e.duration_ms)
    from public.app_events e
   where e.kind = 'call' and e.duration_ms is not null and e.created_at > now() - make_interval(days => greatest(1, least(_days, 90)))
   group by e.target
  having count(*) >= 3
   order by 4 desc
   limit 20;
end $$;

revoke all on function public.admin_trace_search(text), public.admin_trace_student(uuid, integer, integer), public.admin_trace_funnels(integer),
  public.admin_trace_errors(integer), public.admin_trace_slow(integer) from public, anon;
grant execute on function public.admin_trace_search(text), public.admin_trace_student(uuid, integer, integer), public.admin_trace_funnels(integer),
  public.admin_trace_errors(integer), public.admin_trace_slow(integer) to authenticated, service_role;

-- ---------------------------------------------------------------- retention: keep 90 days
create or replace function public.prune_app_events()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.app_events where created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.prune_app_events() from public, anon, authenticated;
grant execute on function public.prune_app_events() to service_role;

do $$ begin
  if to_regclass('public.app_events') is null then raise exception 'app_events missing'; end if;
  if to_regprocedure('public.admin_trace_funnels(integer)') is null then raise exception 'admin_trace_funnels missing'; end if;
end $$;
commit;
notify pgrst, 'reload schema';
