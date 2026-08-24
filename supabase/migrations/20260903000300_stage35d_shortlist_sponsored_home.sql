-- ============================================================================
-- Stage 35d — shortlisting with the student's consent, sponsored work, the
-- hiring outcome, Home, and the admin verification switch.
--
-- A sponsored task is a row in `tasks` with a recruiter attached, not a second
-- task system. It arrives on the student's Daily Card, is submitted through
-- proof_uploads, and is reviewed beside the same evidence as everything else —
-- which is the point of having built the platform first and the hiring
-- afterwards.
--
-- One name to watch: the local variable holding a company name is `firm`, not
-- `company`. A variable that shadows the column it reads makes RETURNING
-- ambiguous, and that is exactly how the first version of this failed.
-- ============================================================================

alter table public.tasks
  add column if not exists sponsored_by uuid references public.recruiters(id) on delete set null,
  add column if not exists sponsor_criteria text;

create index if not exists tasks_sponsored_idx on public.tasks (sponsored_by)
  where sponsored_by is not null;

-- Additive: tasks_read already covers the owner, so this takes nothing away.
create policy tasks_sponsored_read on public.tasks for select to authenticated
  using (sponsored_by is not null and sponsored_by = (select auth.uid()));


-- ── shortlist, and the student's answer ─────────────────────────────────
create or replace function public.recruiter_shortlist(_student_id uuid, _note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare rid uuid := public.my_recruiter_id(); firm text;
begin
  if rid is null or not public.is_verified_recruiter() then
    raise exception 'Your recruiter account is awaiting verification.';
  end if;
  if not public.student_is_discoverable(_student_id) then
    raise exception 'No candidate found.';
  end if;

  select r.company into firm from public.recruiters r where r.id = rid;

  insert into public.recruiter_shortlists (recruiter_id, student_id, note)
  values (rid, _student_id, nullif(trim(coalesce(_note, '')), ''))
  on conflict (recruiter_id, student_id) do update set note = excluded.note;

  -- Being findable is not agreeing to be approached. The student is told, and
  -- whether this recruiter gets their contact details is their decision.
  insert into public.notifications
    (user_id, audience, source, type, title, message, link)
  values (_student_id, 'student', 'system', 'shortlisted',
          firm || ' shortlisted you',
          'They have seen your work and want to talk. Sharing your contact ' ||
          'details is your choice — open your profile to accept or decline.',
          '/student/dashboard');

  return jsonb_build_object('ok', true, 'company', firm);
end $fn$;

create or replace function public.respond_to_shortlist(_shortlist_id uuid, _accept boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare me uuid := (select auth.uid()); row_ record;
begin
  select * into row_ from public.recruiter_shortlists where id = _shortlist_id;
  if row_ is null then raise exception 'no such shortlist'; end if;
  if row_.student_id <> me then raise exception 'that is not yours to answer'; end if;

  update public.recruiter_shortlists
     set student_response = case when _accept then 'accepted' else 'declined' end,
         responded_at = now(),
         stage = case when _accept then 'contacted' else stage end
   where id = _shortlist_id;

  return jsonb_build_object('ok', true, 'accepted', _accept);
end $fn$;

create or replace function public.my_shortlists()
returns table (id uuid, company text, note text, stage text,
               student_response text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select sl.id, r.company, sl.note, sl.stage, sl.student_response, sl.created_at
    from public.recruiter_shortlists sl
    join public.recruiters r on r.id = sl.recruiter_id
   where sl.student_id = (select auth.uid())
   order by sl.created_at desc;
$fn$;


-- ── sponsored work ──────────────────────────────────────────────────────
create or replace function public.sponsor_lot(
  _student_id uuid, _title text, _brief text,
  _criteria text default null, _days integer default 7
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  rid uuid := public.my_recruiter_id();
  firm text; tid uuid; n integer;
begin
  if rid is null or not public.is_verified_recruiter() then
    raise exception 'Your recruiter account is awaiting verification.';
  end if;
  if not public.student_is_discoverable(_student_id) then
    raise exception 'No candidate found.';
  end if;
  if not exists (select 1 from public.recruiter_shortlists
                  where recruiter_id = rid and student_id = _student_id) then
    raise exception 'Shortlist this candidate before sponsoring work for them.';
  end if;
  if nullif(trim(coalesce(_title, '')), '') is null
     or nullif(trim(coalesce(_brief, '')), '') is null then
    raise exception 'A sponsored task needs a title and a brief.';
  end if;

  select r.company into firm from public.recruiters r where r.id = rid;
  select count(*) + 1 into n from public.tasks
   where student_id = _student_id and lot_date is not null;

  -- Dated today so it lands on the Daily Card — unless today's Lot already
  -- exists, since only one Lot per student per day is allowed.
  insert into public.tasks
    (student_id, title, description, sponsored_by, sponsor_criteria,
     lot_number, lot_date, lot_category, difficulty, estimate_minutes,
     status, visibility, due_date, created_by_type, source)
  values
    (_student_id, trim(_title), trim(_brief), rid,
     nullif(trim(coalesce(_criteria, '')), ''),
     n,
     case when exists (select 1 from public.tasks t
                        where t.student_id = _student_id and t.lot_date = current_date)
          then current_date + 1 else current_date end,
     'technical', 'Medium', 45,
     'pending', 'private',
     now() + make_interval(days => greatest(1, coalesce(_days, 7))),
     'recruiter', 'sponsored')
  returning id into tid;

  update public.recruiter_shortlists set stage = 'sponsored'
   where recruiter_id = rid and student_id = _student_id;

  insert into public.notifications
    (user_id, audience, source, type, title, message, link)
  values (_student_id, 'student', 'system', 'sponsored_task',
          firm || ' set you a task',
          'A recruiter has sponsored a piece of work for you. It is on your ' ||
          'Daily Card, and they will review what you submit.',
          '/student/dashboard');

  return jsonb_build_object('ok', true, 'task_id', tid, 'company', firm);
end $fn$;

create or replace function public.recruiter_lots()
returns table (task_id uuid, title text, student_id uuid, student_name text,
               created_at timestamptz, due_date timestamptz, task_status text,
               proof_id uuid, submitted_at timestamptz, proof_status text,
               ai_score integer, outcome text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select t.id, t.title, t.student_id, p.full_name,
         t.created_at, t.due_date, t.status,
         pu.id, pu.submitted_at, pu.status, pu.ai_score,
         sl.stage
    from public.tasks t
    join public.student_profiles p on p.id = t.student_id
    left join lateral (
      select * from public.proof_uploads x
       where x.task_id = t.id order by x.submitted_at desc limit 1
    ) pu on true
    left join public.recruiter_shortlists sl
      on sl.recruiter_id = t.sponsored_by and sl.student_id = t.student_id
   where t.sponsored_by = public.my_recruiter_id()
   order by t.created_at desc;
$fn$;

-- The decision, kept separate from every score the platform produced. Neither
-- overwrites the other.
create or replace function public.record_outcome(_student_id uuid, _outcome text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare rid uuid := public.my_recruiter_id();
begin
  if rid is null then raise exception 'not a recruiter'; end if;
  if _outcome not in ('saved','contacted','sponsored','interviewing','offered','hired','passed') then
    raise exception 'unknown outcome %', _outcome;
  end if;

  update public.recruiter_shortlists set stage = _outcome
   where recruiter_id = rid and student_id = _student_id;
  if not found then raise exception 'that candidate is not on your shortlist'; end if;

  if _outcome in ('offered', 'hired') then
    insert into public.notifications
      (user_id, audience, source, type, title, message, link)
    select _student_id, 'student', 'system', 'hiring_outcome',
           r.company || ': ' || _outcome,
           'Check your shortlist for details.', '/student/dashboard'
      from public.recruiters r where r.id = rid;
  end if;

  return jsonb_build_object('ok', true, 'outcome', _outcome);
end $fn$;


-- ── Home ────────────────────────────────────────────────────────────────
create or replace function public.recruiter_home()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare rid uuid := public.my_recruiter_id(); me record;
begin
  if rid is null then return jsonb_build_object('error', 'not a recruiter'); end if;
  select * into me from public.recruiters where id = rid;

  if not me.verified then
    return jsonb_build_object(
      'verified', false,
      'company', me.company,
      'message', 'Your account is awaiting verification. Candidates appear once ' ||
                 'an administrator has approved you.');
  end if;

  return jsonb_build_object(
    'verified', true,
    'company', me.company,
    'candidates_available', (select count(*) from public.student_profiles p
                              where public.student_is_discoverable(p.id)),
    'new_this_week', (select count(*) from public.student_profiles p
                       where public.student_is_discoverable(p.id)
                         and p.created_at >= now() - interval '7 days'),
    'shortlisted', (select count(*) from public.recruiter_shortlists
                     where recruiter_id = rid),
    'awaiting_response', (select count(*) from public.recruiter_shortlists
                           where recruiter_id = rid and student_response is null),
    'accepted', (select count(*) from public.recruiter_shortlists
                  where recruiter_id = rid and student_response = 'accepted'),
    'lots_open', (select count(*) from public.tasks t
                   where t.sponsored_by = rid and t.status = 'pending'),
    'lots_submitted', (select count(*) from public.tasks t
                        where t.sponsored_by = rid
                          and exists (select 1 from public.proof_uploads pu
                                       where pu.task_id = t.id)),
    'pipeline', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (
        select stage, count(*) as n from public.recruiter_shortlists
         where recruiter_id = rid group by stage) s),
    'recommended', (select coalesce(jsonb_agg(r order by r.skills_proven desc), '[]'::jsonb) from (
        select t.student_id, t.full_name, t.branch, t.target_role,
               t.skills_proven, t.proofs_verified, t.comms_score, t.days_since_active
          from public.recruiter_talent(null, null, null, null, null, 30, 5, 0) t
         where not t.shortlisted) r),
    'recent_views', (select coalesce(jsonb_agg(v order by v.viewed_at desc), '[]'::jsonb) from (
        select rv.student_id, p.full_name, rv.viewed_at
          from public.recruiter_views rv
          join public.student_profiles p on p.id = rv.student_id
         where rv.recruiter_id = rid
         order by rv.viewed_at desc limit 8) v)
  );
end $fn$;


-- ── admin: the queue and the switch ─────────────────────────────────────
create or replace function public.admin_recruiters()
returns table (id uuid, company text, contact_name text, work_email text,
               website text, verified boolean, created_at timestamptz,
               shortlists bigint, sponsored bigint)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select r.id, r.company, r.contact_name, r.work_email, r.website,
         r.verified, r.created_at,
         (select count(*) from public.recruiter_shortlists s where s.recruiter_id = r.id),
         (select count(*) from public.tasks t where t.sponsored_by = r.id)
    from public.recruiters r
   where public.is_admin()
   order by r.verified, r.created_at desc;
$fn$;

create or replace function public.admin_verify_recruiter(_recruiter_id uuid, _verified boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare firm text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;

  update public.recruiters
     set verified = _verified,
         verified_at = case when _verified then now() else null end,
         verified_by = case when _verified then (select auth.uid()) else null end
   where id = _recruiter_id
  returning recruiters.company into firm;

  if firm is null then raise exception 'no such recruiter'; end if;

  perform public.write_audit(
    case when _verified then 'RECRUITER_VERIFIED' else 'RECRUITER_UNVERIFIED' end,
    'recruiters', _recruiter_id, null,
    jsonb_build_object('company', firm), null);

  return jsonb_build_object('ok', true, 'company', firm, 'verified', _verified);
end $fn$;

revoke all on function public.recruiter_shortlist(uuid, text)                 from public, anon;
revoke all on function public.respond_to_shortlist(uuid, boolean)             from public, anon;
revoke all on function public.my_shortlists()                                 from public, anon;
revoke all on function public.sponsor_lot(uuid, text, text, text, integer)    from public, anon;
revoke all on function public.recruiter_lots()                                from public, anon;
revoke all on function public.record_outcome(uuid, text)                      from public, anon;
revoke all on function public.recruiter_home()                                from public, anon;
revoke all on function public.admin_recruiters()                              from public, anon;
revoke all on function public.admin_verify_recruiter(uuid, boolean)           from public, anon;

grant execute on function public.recruiter_shortlist(uuid, text)              to authenticated;
grant execute on function public.respond_to_shortlist(uuid, boolean)          to authenticated;
grant execute on function public.my_shortlists()                              to authenticated;
grant execute on function public.sponsor_lot(uuid, text, text, text, integer) to authenticated;
grant execute on function public.recruiter_lots()                             to authenticated;
grant execute on function public.record_outcome(uuid, text)                   to authenticated;
grant execute on function public.recruiter_home()                             to authenticated;
grant execute on function public.admin_recruiters()                           to authenticated;
grant execute on function public.admin_verify_recruiter(uuid, boolean)        to authenticated;
