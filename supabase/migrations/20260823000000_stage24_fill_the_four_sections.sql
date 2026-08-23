-- ============================================================================
-- Stage 24 — fill the four sections.
--
-- The navigation itself is not touched: the same four destinations per role,
-- the same labels on them. What was missing was the content the architecture
-- says belongs inside each one — Build-log had no Skills proved, no Cosigns and
-- no History; Squad had no Achievements; Profile had no Certifications, no
-- Privacy and no Role preference; the college's Squads had no Manage, no
-- Performance and no Achievements.
--
-- Everything below reads or writes real rows. Nothing here returns a constant.
--
-- It also closes a hole found by live test: six tables were readable by every
-- signed-in user regardless of college, so one college's squads, members,
-- fixtures, weekly scores, seasons and badges were visible to another's. The
-- new Achievements and Performance views would have widened that, so it is
-- fixed first rather than after.
-- ============================================================================


-- ── 0. who is asking, and which college are they part of ────────────────
-- my_college_id() answers only for a placement officer. A student has a college
-- too, and every policy below needs the same answer for both.
create or replace function public.viewer_college_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(
    (select c.id from public.colleges c where c.user_id = (select auth.uid()) limit 1),
    (select p.college_id from public.student_profiles p where p.id = (select auth.uid()) limit 1));
$fn$;

revoke all on function public.viewer_college_id() from public, anon;
grant execute on function public.viewer_college_id() to authenticated;


-- ── 1. stop the six tables leaking across colleges ──────────────────────
-- Each call is wrapped as (select …) so Postgres evaluates it once for the
-- whole statement instead of once per row. The same wrapping took a
-- 10,000-student page from 1126ms to 3.8ms, and these are exactly the tables a
-- standings screen scans.
drop policy if exists squads_read on public.squads;
create policy squads_read on public.squads for select to authenticated
  using (college_id = (select public.viewer_college_id()) or (select public.is_admin()));

drop policy if exists seasons_read on public.seasons;
create policy seasons_read on public.seasons for select to authenticated
  using (college_id = (select public.viewer_college_id()) or (select public.is_admin()));

drop policy if exists squad_members_read on public.squad_members;
create policy squad_members_read on public.squad_members for select to authenticated
  using (exists (select 1 from public.squads s
                  where s.id = squad_id
                    and s.college_id = (select public.viewer_college_id()))
         or (select public.is_admin()));

drop policy if exists squad_matches_read on public.squad_matches;
create policy squad_matches_read on public.squad_matches for select to authenticated
  using (exists (select 1 from public.squads s
                  where s.id = home_squad
                    and s.college_id = (select public.viewer_college_id()))
         or (select public.is_admin()));

drop policy if exists weekly_scores_read on public.squad_weekly_scores;
create policy weekly_scores_read on public.squad_weekly_scores for select to authenticated
  using (exists (select 1 from public.squads s
                  where s.id = squad_id
                    and s.college_id = (select public.viewer_college_id()))
         or (select public.is_admin()));

-- A badge is a student's own record. Their college may see it, because that is
-- what the Insights and Achievements screens are for. Nobody else may.
drop policy if exists student_badges_read on public.student_badges;
create policy student_badges_read on public.student_badges for select to authenticated
  using (student_id = (select auth.uid())
         or exists (select 1 from public.student_profiles p
                     where p.id = student_id
                       and p.college_id = (select public.my_college_id()))
         or (select public.is_admin()));


-- ── 2. Build-log → Cosigns ──────────────────────────────────────────────
-- Supporting validation of evidence. A squad-mate who watched the work happen,
-- or the placement officer who checked it, puts their name against it.
create table public.cosigns (
  id            uuid primary key default gen_random_uuid(),
  proof_id      uuid not null references public.proof_uploads(id) on delete cascade,
  student_id    uuid not null references public.student_profiles(id) on delete cascade,
  cosigner_id   uuid not null references auth.users(id) on delete cascade,
  cosigner_name text not null,
  cosigner_role text not null check (cosigner_role in ('peer', 'mentor', 'college')),
  note          text,
  created_at    timestamptz not null default now(),
  unique (proof_id, cosigner_id)
);

create index cosigns_student_idx  on public.cosigns (student_id, created_at desc);
create index cosigns_cosigner_idx on public.cosigns (cosigner_id, created_at desc);

alter table public.cosigns enable row level security;

-- Readable by the student it is about, by whoever gave it, and by their
-- college. Written only through the function below, which is why insert is
-- revoked here.
create policy cosigns_read on public.cosigns for select to authenticated
  using (student_id = (select auth.uid())
         or cosigner_id = (select auth.uid())
         or exists (select 1 from public.student_profiles p
                     where p.id = student_id
                       and p.college_id = (select public.my_college_id()))
         or (select public.is_admin()));

revoke insert, update, delete, truncate on public.cosigns from anon, authenticated;
grant select on public.cosigns to authenticated;

-- Who may cosign whom is decided by the relationship rather than by a role name
-- typed into the request: same squad is a peer, the college that owns the
-- student is the college, an admin signs as a mentor. Anyone else is refused.
create or replace function public.cosign_proof(_proof_id uuid, _note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  me         uuid := (select auth.uid());
  owner_id   uuid;
  owner_clg  uuid;
  my_clg     uuid;
  my_name    text;
  as_role    text;
begin
  if me is null then raise exception 'not signed in'; end if;

  select p.student_id into owner_id from public.proof_uploads p where p.id = _proof_id;
  if owner_id is null then raise exception 'no such piece of work'; end if;
  if owner_id = me then raise exception 'you cannot cosign your own work'; end if;

  select sp.college_id into owner_clg from public.student_profiles sp where sp.id = owner_id;
  select c.id into my_clg from public.colleges c where c.user_id = me;

  if my_clg is not null and my_clg = owner_clg then
    as_role := 'college';
    select coalesce(c.name, 'Placement office') into my_name
      from public.colleges c where c.id = my_clg;
  elsif exists (
    select 1
      from public.squad_members mine
      join public.squad_members theirs on theirs.squad_id = mine.squad_id
     where mine.student_id = me and mine.left_at is null
       and theirs.student_id = owner_id and theirs.left_at is null
  ) then
    as_role := 'peer';
    select sp.full_name into my_name from public.student_profiles sp where sp.id = me;
  elsif public.is_admin() then
    as_role := 'mentor';
    my_name := 'ProofLab review';
  else
    raise exception 'you can only cosign work by someone in your own squad';
  end if;

  insert into public.cosigns (proof_id, student_id, cosigner_id, cosigner_name, cosigner_role, note)
  values (_proof_id, owner_id, me, coalesce(my_name, 'Someone'), as_role,
          nullif(trim(coalesce(_note, '')), ''))
  on conflict (proof_id, cosigner_id) do update set note = excluded.note;

  return jsonb_build_object('ok', true, 'role', as_role, 'by', my_name);
end $fn$;

-- Both directions in one call: what my work has collected, and what I have put
-- my name to. A tab that only showed one of the two would look empty to
-- whichever half of the pair opened it first.
create or replace function public.my_cosigns()
returns table (direction text, cosign_id uuid, proof_id uuid, work text,
               student_name text, cosigner_name text, cosigner_role text,
               note text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select 'received', c.id, c.proof_id, coalesce(t.title, 'Submitted work'),
         sp.full_name, c.cosigner_name, c.cosigner_role, c.note, c.created_at
    from public.cosigns c
    join public.proof_uploads pu on pu.id = c.proof_id
    left join public.tasks t on t.id = pu.task_id
    join public.student_profiles sp on sp.id = c.student_id
   where c.student_id = (select auth.uid())
  union all
  select 'given', c.id, c.proof_id, coalesce(t.title, 'Submitted work'),
         sp.full_name, c.cosigner_name, c.cosigner_role, c.note, c.created_at
    from public.cosigns c
    join public.proof_uploads pu on pu.id = c.proof_id
    left join public.tasks t on t.id = pu.task_id
    join public.student_profiles sp on sp.id = c.student_id
   where c.cosigner_id = (select auth.uid())
   order by 9 desc;
$fn$;

-- What I could cosign right now. Without this the tab is a list of things that
-- already happened and no way to make one happen.
create or replace function public.cosignable_proofs()
returns table (proof_id uuid, student_id uuid, student_name text, work text,
               submitted_at timestamptz, status text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select pu.id, pu.student_id, sp.full_name, coalesce(t.title, 'Submitted work'),
         pu.submitted_at, pu.status
    from public.squad_members mine
    join public.squad_members theirs
      on theirs.squad_id = mine.squad_id and theirs.left_at is null
    join public.proof_uploads pu on pu.student_id = theirs.student_id
    join public.student_profiles sp on sp.id = pu.student_id
    left join public.tasks t on t.id = pu.task_id
   where mine.student_id = (select auth.uid())
     and mine.left_at is null
     and theirs.student_id <> (select auth.uid())
     and pu.submitted_at > now() - interval '30 days'
     and not exists (select 1 from public.cosigns c
                      where c.proof_id = pu.id and c.cosigner_id = (select auth.uid()))
   order by pu.submitted_at desc
   limit 25;
$fn$;

revoke all on function public.cosign_proof(uuid, text) from public, anon;
revoke all on function public.my_cosigns()             from public, anon;
revoke all on function public.cosignable_proofs()      from public, anon;
grant execute on function public.cosign_proof(uuid, text) to authenticated;
grant execute on function public.my_cosigns()             to authenticated;
grant execute on function public.cosignable_proofs()      to authenticated;


-- ── 3. Build-log → Skills proved ────────────────────────────────────────
-- The skill rows already existed and nothing displayed them. Evidence is
-- counted from the ladder rather than restated: a skill is proved by topics
-- cleared under it, lots submitted for it and explanations recorded.
create or replace function public.my_skills_proved()
returns table (skill text, status text, claimed_from text, assessed_score integer,
               proven_lots integer, proven_voice integer, topics_cleared bigint,
               topics_total bigint, needs_improvement boolean, last_evidence_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select s.skill, s.status, s.claimed_from, s.assessed_score,
         s.proven_lots, s.proven_voice,
         coalesce(ev.cleared, 0), coalesce(ev.total, 0),
         s.status = 'needs_improvement', s.last_evidence_at
    from public.student_skills s
    left join lateral (
      select count(*) filter (where sl.status in ('cleared', 'mastered')) as cleared,
             count(*) as total
        from public.levels l
        left join public.student_levels sl
          on sl.level_id = l.id and sl.student_id = s.student_id
       where lower(l.skill) = lower(s.skill)
    ) ev on true
   where s.student_id = (select auth.uid())
   order by array_position(array['needs_improvement', 'proven', 'assessed', 'claimed'], s.status),
            s.skill;
$fn$;

revoke all on function public.my_skills_proved() from public, anon;
grant execute on function public.my_skills_proved() to authenticated;


-- ── 4. Build-log → History ──────────────────────────────────────────────
-- The activity table has been filling since the triggers went in and had no
-- reader. Paginated, because a student a year in has thousands of rows and a
-- page that fetches all of them is a page that stops loading.
create or replace function public.my_history(_limit integer default 50, _offset integer default 0)
returns table (occurred_at timestamptz, event_type text, source_type text,
               source_id uuid, metadata jsonb, total bigint)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select e.occurred_at, e.event_type, e.source_type, e.source_id, e.metadata,
         count(*) over ()
    from public.student_activity_events e
   where e.student_id = (select auth.uid())
   order by e.occurred_at desc
   limit greatest(1, least(coalesce(_limit, 50), 200))
  offset greatest(0, coalesce(_offset, 0));
$fn$;

revoke all on function public.my_history(integer, integer) from public, anon;
grant execute on function public.my_history(integer, integer) to authenticated;


-- ── 5. Squad → Achievements ─────────────────────────────────────────────
-- Wins, weeks at the top, milestones and the student's own badges, all derived
-- from rows that already exist. Nothing is stored twice: an achievement is a
-- reading of the record, not a second copy of it that can disagree with it.
create or replace function public.my_squad_achievements()
returns table (kind text, title text, detail text, achieved_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare sq uuid;
begin
  select m.squad_id into sq from public.squad_members m
   where m.student_id = (select auth.uid()) and m.left_at is null limit 1;

  return query
    -- every match the squad won
    select 'win'::text,
           'Match won'::text,
           ('Beat ' || coalesce(o.name, 'the other squad') || ' ' ||
             greatest(coalesce(mt.home_points, 0), coalesce(mt.away_points, 0)) || '–' ||
             least(coalesce(mt.home_points, 0), coalesce(mt.away_points, 0)))::text,
           mt.scheduled_at
      from public.squad_matches mt
      left join public.squads o
        on o.id = case when mt.home_squad = sq then mt.away_squad else mt.home_squad end
     where mt.status = 'played'
       and (mt.home_squad = sq or mt.away_squad = sq)
       and case when mt.home_squad = sq
                then coalesce(mt.home_points, 0) > coalesce(mt.away_points, 0)
                else coalesce(mt.away_points, 0) > coalesce(mt.home_points, 0) end

    union all
    -- weeks the squad finished top of the table
    select 'week'::text,
           'Top of the table'::text,
           ('Week ' || w.week || ' — ' || w.points || ' points from ' ||
             w.active_members || ' of ' || w.total_members || ' members')::text,
           w.computed_at
      from public.squad_weekly_scores w
     where w.squad_id = sq and w.rank = 1

    union all
    -- point milestones the squad has passed
    select 'milestone'::text,
           m.label::text,
           (s.name || ' has ' || s.points || ' points')::text,
           s.updated_at
      from public.squads s
      cross join (values (100, 'First hundred'), (500, 'Five hundred points'),
                         (1000, 'A thousand points')) as m(threshold, label)
     where s.id = sq and s.points >= m.threshold

    union all
    -- the student's own badges
    select 'badge'::text, b.name::text, b.description::text, sb.awarded_at
      from public.student_badges sb
      join public.badges b on b.slug = sb.badge_slug
     where sb.student_id = (select auth.uid())

    order by 4 desc nulls last;
end $fn$;

revoke all on function public.my_squad_achievements() from public, anon;
grant execute on function public.my_squad_achievements() to authenticated;


-- ── 6. Profile → Certifications ─────────────────────────────────────────
-- Credentials were read out of a resume once and then had nowhere to live. A
-- table, because a student adds one the week they earn it and the resume they
-- uploaded in March cannot be edited.
create table public.student_certifications (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.student_profiles(id) on delete cascade,
  name           text not null,
  issuer         text,
  issued_on      date,
  expires_on     date,
  credential_id  text,
  credential_url text,
  source         text not null default 'self' check (source in ('self', 'resume')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index student_certifications_student_idx
  on public.student_certifications (student_id, issued_on desc nulls last);
create unique index student_certifications_no_duplicates
  on public.student_certifications (student_id, lower(name));

create trigger student_certifications_set_updated_at
  before update on public.student_certifications
  for each row execute function public.set_updated_at();

alter table public.student_certifications enable row level security;

-- The placement office may read a student's credentials. The student sitting
-- next to them may not: viewer_college_id() answers for a student as well, so
-- the college branch has to be my_college_id(), which only an officer has.
create policy certifications_read on public.student_certifications for select to authenticated
  using (student_id = (select auth.uid())
         or exists (select 1 from public.student_profiles p
                     where p.id = student_id
                       and p.college_id = (select public.my_college_id()))
         or (select public.is_admin()));

create policy certifications_own_insert on public.student_certifications for insert to authenticated
  with check (student_id = (select auth.uid()));
create policy certifications_own_update on public.student_certifications for update to authenticated
  using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy certifications_own_delete on public.student_certifications for delete to authenticated
  using (student_id = (select auth.uid()));

-- Carry across what the resume already said, so the tab opens with the
-- student's real credentials rather than an empty state they have to fill in
-- again. source records where each one came from.
insert into public.student_certifications (student_id, name, source)
select distinct on (rc.student_id, lower(trim(cert))) rc.student_id, trim(cert), 'resume'
  from public.resume_claims rc
  cross join unnest(rc.certifications) as cert
 where trim(coalesce(cert, '')) <> ''
on conflict do nothing;


-- ── 7. Profile → Role preference ────────────────────────────────────────
alter table public.student_profiles
  add column if not exists target_role         text,
  add column if not exists secondary_roles     text[] not null default '{}',
  add column if not exists work_preference     text not null default 'either',
  add column if not exists preferred_locations text[] not null default '{}',
  add column if not exists open_to_relocate    boolean not null default true;

alter table public.student_profiles
  drop constraint if exists student_profiles_work_preference_check;
alter table public.student_profiles
  add constraint student_profiles_work_preference_check
  check (work_preference in ('internship', 'full_time', 'either'));

-- Onboarding already asked for this, on both paths. Reading it forward means
-- the tab is filled in for everyone who has ever answered, and the onboarding
-- flow itself is untouched.
update public.student_profiles p
   set target_role = coalesce(
         (select rc.target_role from public.resume_claims rc
           where rc.student_id = p.id and rc.target_role is not null
           order by rc.created_at desc limit 1),
         (select si.target_role from public.student_interests si
           where si.student_id = p.id and si.target_role is not null
           order by si.created_at desc limit 1))
 where p.target_role is null;


-- ── 8. TPO → Squads → Manage ────────────────────────────────────────────
alter table public.squads
  add column if not exists is_locked   boolean not null default false,
  add column if not exists archived_at timestamptz;

-- Locking has to hold everywhere, not only on the button that sets it. A
-- trigger catches every path into the table — the assign screen, squad
-- formation, and anything added later — instead of one check in one function.
create or replace function public.squad_membership_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $fn$
declare s record;
begin
  select name, is_locked, archived_at into s from public.squads where id = new.squad_id;
  if s.archived_at is not null then
    raise exception '% is archived and cannot take members', s.name;
  end if;
  if s.is_locked then
    raise exception '% is locked. Unlock it in Manage before moving anyone in.', s.name;
  end if;
  return new;
end $fn$;

drop trigger if exists squad_members_respect_lock on public.squad_members;
create trigger squad_members_respect_lock
  before insert on public.squad_members
  for each row execute function public.squad_membership_guard();

create or replace function public.tpo_squad_update(
  _squad_id    uuid,
  _name        text    default null,
  _max_members integer default null,
  _is_locked   boolean default null,
  _archived    boolean default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  cid  uuid := public.my_college_id();
  sq   record;
  live integer;
begin
  select * into sq from public.squads where id = _squad_id;
  if sq is null then raise exception 'no such squad'; end if;
  if sq.college_id is distinct from cid and not public.is_admin() then
    raise exception 'that squad belongs to another college';
  end if;

  if _max_members is not null then
    select count(*) into live from public.squad_members
     where squad_id = _squad_id and left_at is null;
    if _max_members < live then
      raise exception '% already has % members, so the limit cannot be %',
        sq.name, live, _max_members;
    end if;
  end if;

  update public.squads
     set name        = coalesce(nullif(trim(coalesce(_name, '')), ''), name),
         max_members = coalesce(_max_members, max_members),
         is_locked   = coalesce(_is_locked, is_locked),
         archived_at = case when _archived is null then archived_at
                            when _archived then coalesce(archived_at, now())
                            else null end
   where id = _squad_id;

  perform public.write_audit('SQUAD_UPDATED', 'squads', _squad_id,
    to_jsonb(sq), (select to_jsonb(s) from public.squads s where s.id = _squad_id),
    sq.college_id);

  return (select jsonb_build_object('ok', true, 'name', s.name,
                                    'max_members', s.max_members,
                                    'is_locked', s.is_locked,
                                    'archived', s.archived_at is not null)
            from public.squads s where s.id = _squad_id);
end $fn$;

-- Rebalance: every student who is onboarded and in no squad is placed into one
-- that still has room, smallest squad first. Locked and archived squads are
-- skipped, so an officer can freeze a team before pressing it.
create or replace function public.tpo_rebalance_squads()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  cid    uuid := public.my_college_id();
  moved  integer := 0;
  stu    record;
  target uuid;
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can rebalance its own squads';
  end if;

  for stu in
    select p.id
      from public.student_profiles p
     where p.college_id = cid
       and p.onboarding_status = 'completed'
       and not exists (select 1 from public.squad_members m
                        where m.student_id = p.id and m.left_at is null)
     order by p.roll_number nulls last, p.full_name
  loop
    select s.id into target
      from public.squads s
     where s.college_id = cid
       and s.archived_at is null
       and not s.is_locked
       and (select count(*) from public.squad_members m
             where m.squad_id = s.id and m.left_at is null) < s.max_members
     order by (select count(*) from public.squad_members m
                where m.squad_id = s.id and m.left_at is null)
     limit 1;

    exit when target is null;

    insert into public.squad_members (squad_id, student_id, joined_at)
    values (target, stu.id, now());
    moved := moved + 1;
  end loop;

  perform public.write_audit('SQUADS_REBALANCED', 'squads', cid, null,
    jsonb_build_object('students_placed', moved), cid);

  return jsonb_build_object('ok', true, 'students_placed', moved,
    'still_unplaced', (select count(*) from public.student_profiles p
                        where p.college_id = cid
                          and p.onboarding_status = 'completed'
                          and not exists (select 1 from public.squad_members m
                                           where m.student_id = p.id and m.left_at is null)));
end $fn$;


-- ── 9. TPO → Squads → Performance ───────────────────────────────────────
-- Week by week for every squad in the college, with the change on the week
-- before, which is the number an officer actually looks for.
create or replace function public.tpo_squad_performance(_weeks integer default 8)
returns table (squad_id uuid, squad_name text, week integer, points integer,
               active_members integer, total_members integer, rank integer,
               change integer, participation numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with mine as (
    select s.id, s.name from public.squads s
     where s.college_id = coalesce(public.my_college_id(), public.viewer_college_id())
       and s.archived_at is null
  ), scored as (
    select w.squad_id, m.name, w.week, w.points, w.active_members, w.total_members, w.rank,
           (w.points - lag(w.points) over (partition by w.squad_id order by w.week))::integer as change
      from public.squad_weekly_scores w
      join mine m on m.id = w.squad_id
  )
  select squad_id, name, week, points, active_members, total_members, rank, change,
         case when total_members > 0
              then round(active_members::numeric * 100 / total_members, 0)
              else 0 end
    from scored
   where week > (select coalesce(max(week), 0) - greatest(1, coalesce(_weeks, 8)) from scored)
   order by week desc, points desc;
$fn$;


-- ── 10. TPO → Squads → Achievements ─────────────────────────────────────
create or replace function public.tpo_squad_achievements()
returns table (squad_id uuid, squad_name text, wins bigint, losses bigint,
               weeks_led bigint, best_rank integer, best_week_points integer,
               member_badges bigint, is_locked boolean, archived boolean)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select s.id, s.name,
         (select count(*) from public.squad_matches m
           where m.status = 'played'
             and ((m.home_squad = s.id and coalesce(m.home_points, 0) > coalesce(m.away_points, 0))
               or (m.away_squad = s.id and coalesce(m.away_points, 0) > coalesce(m.home_points, 0)))),
         (select count(*) from public.squad_matches m
           where m.status = 'played'
             and ((m.home_squad = s.id and coalesce(m.home_points, 0) < coalesce(m.away_points, 0))
               or (m.away_squad = s.id and coalesce(m.away_points, 0) < coalesce(m.home_points, 0)))),
         (select count(*) from public.squad_weekly_scores w where w.squad_id = s.id and w.rank = 1),
         (select min(w.rank) from public.squad_weekly_scores w where w.squad_id = s.id),
         (select max(w.points) from public.squad_weekly_scores w where w.squad_id = s.id),
         (select count(*) from public.student_badges b
            join public.squad_members m on m.student_id = b.student_id and m.left_at is null
           where m.squad_id = s.id),
         s.is_locked, s.archived_at is not null
    from public.squads s
   where s.college_id = coalesce(public.my_college_id(), public.viewer_college_id())
   order by s.points desc;
$fn$;

revoke all on function public.tpo_squad_update(uuid, text, integer, boolean, boolean) from public, anon;
revoke all on function public.tpo_rebalance_squads()         from public, anon;
revoke all on function public.tpo_squad_performance(integer) from public, anon;
revoke all on function public.tpo_squad_achievements()       from public, anon;
grant execute on function public.tpo_squad_update(uuid, text, integer, boolean, boolean) to authenticated;
grant execute on function public.tpo_rebalance_squads()         to authenticated;
grant execute on function public.tpo_squad_performance(integer) to authenticated;
grant execute on function public.tpo_squad_achievements()       to authenticated;
