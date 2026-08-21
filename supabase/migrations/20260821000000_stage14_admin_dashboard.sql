-- ============================================================================
-- Stage 14 — the admin dashboard.
--
-- All twenty-four admin screens were already written. What was missing was
-- everything underneath them: nine tables, two views and three functions that
-- the front end and the edge functions were already calling.
--
-- Three of those calls were failing silently. logUsage, logSecurityEvent and
-- the rate limiter are all written never to throw — correctly, because
-- accounting must not be able to break the request it describes — so a missing
-- table produced no error anywhere. In practice that meant the AI spend cap was
-- not capping anything and no security event had ever been recorded.
-- ============================================================================


-- ── startups ────────────────────────────────────────────────────────────
-- The signup form has always inserted here; the row is what an admin approves.
create table public.startups (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references auth.users(id) on delete cascade,
  name                text not null,
  email               text not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'active', 'suspended')),
  verification_status text not null default 'pending'
                        check (verification_status in ('pending', 'approved', 'rejected')),
  invite_code         text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index startups_status_idx on public.startups (status, created_at desc);

-- What the startup fills in about itself, kept apart from what the admin
-- decides about it. Same split as student_profiles and student_contact.
create table public.startup_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references auth.users(id) on delete cascade,
  startup_name    text not null,
  domain_industry text,
  talent_needs    text[] not null default '{}',
  website         text,
  team_size       integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);


-- ── job opportunities ───────────────────────────────────────────────────
-- Posted by a startup, approved by an admin, read by students.
create table public.job_opportunities (
  id              uuid primary key default gen_random_uuid(),
  role            text not null,
  company_name    text not null,
  logo_url        text,
  location        text not null default 'Remote',
  job_type        text not null default 'Internship'
                    check (job_type in ('Internship', 'Full-time', 'Part-time')),
  eligible_branch text not null default 'All',
  apply_link      text not null,
  description     text,
  deadline        date,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'closed')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index job_opportunities_status_idx  on public.job_opportunities (status, created_at desc);
create index job_opportunities_creator_idx on public.job_opportunities (created_by, created_at desc);


-- ── learning resources ──────────────────────────────────────────────────
create table public.learning_resources (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  url         text not null,
  platform    text not null default 'Other',
  branch      text not null default 'All',
  category    text,
  is_premium  boolean not null default false,
  status      text not null default 'published'
                check (status in ('draft', 'published', 'archived')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index learning_resources_status_idx on public.learning_resources (status, created_at desc);


-- ── announcements ───────────────────────────────────────────────────────
create table public.announcements (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  status           text not null default 'draft'
                     check (status in ('draft', 'published', 'scheduled')),
  expiry_date      timestamptz,
  created_by_admin uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index announcements_status_idx on public.announcements (status, created_at desc);


-- ── security events ─────────────────────────────────────────────────────
-- Append-only by design. Nobody gets update or delete, admins included: an
-- audit log an administrator can edit is not evidence of anything.
create table public.security_events (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null,
  severity   text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  source     text not null default 'server' check (source in ('server', 'client')),
  user_id    uuid references auth.users(id) on delete set null,
  email      text,
  ip         text,
  user_agent text,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index security_events_recent_idx   on public.security_events (created_at desc);
create index security_events_type_idx     on public.security_events (event_type, created_at desc);
create index security_events_severity_idx on public.security_events (severity, created_at desc);


-- ── manual adjustments ──────────────────────────────────────────────────
-- The one place an admin can move a number a student earned. Every such move
-- leaves a row here, with who did it and why, before the number changes.
create table public.manual_adjustment_log (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.student_profiles(id) on delete cascade,
  adjustment_type text not null,
  amount          integer not null,
  reason          text not null check (length(trim(reason)) > 0),
  admin_id        uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create index manual_adjustment_log_student_idx on public.manual_adjustment_log (student_id, created_at desc);
create index manual_adjustment_log_recent_idx  on public.manual_adjustment_log (created_at desc);


-- ── AI spend ────────────────────────────────────────────────────────────
-- One row per call to a provider. The edge functions have been posting here
-- since the LLM helper was written.
create table public.llm_usage (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete set null,
  student_id        uuid references public.student_profiles(id) on delete set null,
  feature           text not null,
  provider          text not null,
  model             text,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens      integer not null default 0,
  truncated         boolean not null default false,
  created_at        timestamptz not null default now()
);

create index llm_usage_student_idx on public.llm_usage (student_id, created_at desc);
create index llm_usage_feature_idx on public.llm_usage (feature, created_at desc);
create index llm_usage_recent_idx  on public.llm_usage (created_at desc);

-- Identical prompts, answered once. Separate from ai_templates: that one caches
-- a deliberately shared answer under a key we design, this one catches exact
-- repeats of any prompt at all.
create table public.llm_cache (
  prompt_hash  text primary key,
  feature      text not null,
  response     text not null,
  model        text,
  saved_tokens integer not null default 0,
  hit_count    integer not null default 0,
  created_at   timestamptz not null default now(),
  last_hit_at  timestamptz
);

create index llm_cache_feature_idx on public.llm_cache (feature, hit_count desc);

-- Counted in Postgres rather than in the function, because edge functions run
-- as many short-lived isolates and an in-process counter caps nothing.
create table public.rate_limits (
  bucket       text not null,
  subject      text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, subject, window_start)
);

create index rate_limits_window_idx on public.rate_limits (window_start);


-- ── the three functions the edge functions already call ─────────────────

-- Records a security event. Service role only: an event a browser can write is
-- not a record of what happened, it is a record of what somebody typed.
create or replace function public.log_security_event(
  p_event_type text,
  p_severity   text default 'info',
  p_source     text default 'server',
  p_user_id    uuid default null,
  p_email      text default null,
  p_ip         text default null,
  p_user_agent text default null,
  p_detail     jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  insert into public.security_events
    (event_type, severity, source, user_id, email, ip, user_agent, detail)
  values
    (p_event_type,
     case when p_severity in ('info','warning','critical') then p_severity else 'info' end,
     case when p_source in ('server','client') then p_source else 'server' end,
     p_user_id, p_email, p_ip, left(p_user_agent, 500), coalesce(p_detail, '{}'::jsonb));
end $fn$;

-- Counts one hit and says whether it is allowed. The whole decision happens in
-- a single statement so two isolates arriving together cannot both read the
-- old count and both decide they are under the limit.
create or replace function public.check_rate_limit(
  p_bucket text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  win_start timestamptz;
  win_end   timestamptz;
  n         integer;
begin
  -- Windows are fixed rather than rolling: every subject in the same window
  -- shares one row, so the count is a single upsert instead of a scan.
  win_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  win_end   := win_start + make_interval(secs => p_window_seconds);

  insert into public.rate_limits (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, win_start, 1)
  on conflict (bucket, subject, window_start)
    do update set hits = public.rate_limits.hits + 1
  returning hits into n;

  return jsonb_build_object(
    'allowed',     n <= p_limit,
    'hits',        n,
    'limit',       p_limit,
    'remaining',   greatest(p_limit - n, 0),
    'reset_at',    win_end,
    'retry_after', greatest(ceil(extract(epoch from (win_end - now())))::int, 1)
  );
end $fn$;

create or replace function public.bump_llm_cache_hit(p_hash text)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  update public.llm_cache
     set hit_count = hit_count + 1, last_hit_at = now()
   where prompt_hash = p_hash;
end $fn$;

-- Old windows are dead weight the moment they close.
create or replace function public.prune_rate_limits()
returns void language sql security definer set search_path = public, pg_temp as $fn$
  delete from public.rate_limits where window_start < now() - interval '1 day';
$fn$;


-- ── security ────────────────────────────────────────────────────────────
alter table public.startups             enable row level security;
alter table public.startup_profiles     enable row level security;
alter table public.job_opportunities    enable row level security;
alter table public.learning_resources   enable row level security;
alter table public.announcements        enable row level security;
alter table public.security_events      enable row level security;
alter table public.manual_adjustment_log enable row level security;
alter table public.llm_usage            enable row level security;
alter table public.llm_cache            enable row level security;
alter table public.rate_limits          enable row level security;

-- A startup sees its own row and can fill in its own profile. Only an admin
-- moves it from pending to active — approving yourself is not approval.
create policy startups_own_read on public.startups for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy startups_self_signup on public.startups for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy startups_admin_write on public.startups for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy startups_admin_delete on public.startups for delete to authenticated
  using (public.is_admin());

create policy startup_profiles_own on public.startup_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy startup_profiles_own_write on public.startup_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy startup_profiles_own_update on public.startup_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Students see approved jobs, a startup sees its own at every stage, and an
-- admin sees all of them because rejecting one is the job.
create policy job_opportunities_read on public.job_opportunities for select to authenticated
  using (status = 'approved' or created_by = (select auth.uid()) or public.is_admin());
create policy job_opportunities_post on public.job_opportunities for insert to authenticated
  with check (created_by = (select auth.uid()) and public.has_role((select auth.uid()), 'startup'::app_role));
create policy job_opportunities_edit on public.job_opportunities for update to authenticated
  using (created_by = (select auth.uid()) or public.is_admin())
  with check (created_by = (select auth.uid()) or public.is_admin());
create policy job_opportunities_delete on public.job_opportunities for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_admin());

create policy learning_resources_read on public.learning_resources for select to authenticated
  using (status = 'published' or public.is_admin());
create policy learning_resources_admin on public.learning_resources for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy announcements_read on public.announcements for select to authenticated
  using ((status = 'published' and (expiry_date is null or expiry_date > now())) or public.is_admin());
create policy announcements_admin on public.announcements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Read-only, admin-only, and no write policy at all: the only way a row gets
-- in is log_security_event running as the service role.
create policy security_events_admin_read on public.security_events for select to authenticated
  using (public.is_admin());

create policy manual_adjustment_log_read on public.manual_adjustment_log for select to authenticated
  using (public.is_admin() or student_id = (select auth.uid()));
create policy manual_adjustment_log_write on public.manual_adjustment_log for insert to authenticated
  with check (public.is_admin() and admin_id = (select auth.uid()));

-- llm_usage, llm_cache and rate_limits have no policy on purpose. Nothing
-- holding a browser key has any business reading what a prompt cost, what the
-- cached answers say, or how close somebody is to their limit.

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

revoke all on public.llm_usage    from anon, authenticated;
revoke all on public.llm_cache    from anon, authenticated;
revoke all on public.rate_limits  from anon, authenticated;
revoke insert, update, delete, truncate on public.security_events from anon, authenticated;
revoke update, delete, truncate on public.manual_adjustment_log from anon, authenticated;
revoke truncate on public.startups, public.startup_profiles, public.job_opportunities,
                   public.learning_resources, public.announcements from anon, authenticated;

-- These run as the service role from an edge function. A browser calling them
-- directly is the whole thing they exist to prevent.
revoke all on function public.log_security_event(text, text, text, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.check_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.bump_llm_cache_hit(text) from public, anon, authenticated;
revoke all on function public.prune_rate_limits() from public, anon, authenticated;


-- ── what the Token Usage screen reads ───────────────────────────────────
-- A view rather than a query in the browser, because rolling up spend needs to
-- read every student's rows and no browser should be able to do that. The
-- is_admin() check lives inside the view: a non-admin gets zero rows rather
-- than a permission error, which is the same answer with less to leak.
create view public.llm_usage_by_student
with (security_invoker = off) as
select u.student_id,
       c.email,
       p.full_name,
       u.feature,
       u.provider,
       count(*)                        as calls,
       sum(u.prompt_tokens)::bigint    as prompt_tokens,
       sum(u.completion_tokens)::bigint as completion_tokens,
       sum(u.total_tokens)::bigint     as total_tokens,
       max(u.created_at)               as last_used
  from public.llm_usage u
  left join public.student_profiles p on p.id = u.student_id
  left join public.student_contact  c on c.student_id = u.student_id
 where public.is_admin()
 group by u.student_id, c.email, p.full_name, u.feature, u.provider;

grant select on public.llm_usage_by_student to authenticated;


-- ── who the administrators are ──────────────────────────────────────────
-- A view over user_roles, not a table of its own. Two tables that both claim
-- to say who is an admin will eventually disagree, and the day they disagree
-- is the day somebody keeps access they were supposed to lose.
create view public.admin_users
with (security_invoker = off) as
select r.id,
       coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)) as name,
       u.email,
       r.role::text as role,
       'active'     as status,
       r.created_at,
       u.last_sign_in_at
  from public.user_roles r
  join auth.users u on u.id = r.user_id
 where r.role = 'admin'::app_role
   and public.is_admin();

grant select on public.admin_users to authenticated;

-- Granting and revoking admin through the view, so the screen keeps working
-- while user_roles stays the only place the answer is stored.
create or replace function public.admin_users_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  target uuid;
begin
  if not public.is_admin() then
    raise exception 'only an administrator can change administrators';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.role, 'admin') <> 'admin' then
      raise exception 'only the admin role exists; there is no separate moderator tier';
    end if;

    select id into target from auth.users where lower(email) = lower(new.email);
    if target is null then
      raise exception 'no account exists for %; they must sign up before being made an admin', new.email;
    end if;

    -- user_roles holds one role per person, so promoting somebody replaces the
    -- role they had. That is the intent: an admin is not also a student.
    insert into public.user_roles (user_id, role, created_by)
    values (target, 'admin'::app_role, (select auth.uid()))
    on conflict (user_id) do update set role = 'admin'::app_role;
    return new;
  end if;

  -- The screen deactivates by setting status; for a role, that means removing it.
  if tg_op = 'UPDATE' then
    if new.status = 'active' then return new; end if;

    select user_id into target from public.user_roles where id = old.id;
    if target = (select auth.uid()) then
      raise exception 'you cannot remove your own admin access';
    end if;
    if (select count(*) from public.user_roles where role = 'admin'::app_role) <= 1 then
      raise exception 'this is the last administrator; promote somebody else first';
    end if;

    delete from public.user_roles where id = old.id;
    return new;
  end if;

  return null;
end $fn$;

create trigger admin_users_insert instead of insert on public.admin_users
  for each row execute function public.admin_users_write();
create trigger admin_users_update instead of update on public.admin_users
  for each row execute function public.admin_users_write();

grant insert, update on public.admin_users to authenticated;


-- ── keeping updated_at honest ───────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

create trigger startups_touch before update on public.startups
  for each row execute function public.touch_updated_at();
create trigger startup_profiles_touch before update on public.startup_profiles
  for each row execute function public.touch_updated_at();
create trigger job_opportunities_touch before update on public.job_opportunities
  for each row execute function public.touch_updated_at();
create trigger learning_resources_touch before update on public.learning_resources
  for each row execute function public.touch_updated_at();
create trigger announcements_touch before update on public.announcements
  for each row execute function public.touch_updated_at();
