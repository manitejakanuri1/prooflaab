-- ============================================================================
-- Stage 42 — squads on import.
--
-- Four things stood between "sixty students uploaded" and "five squads on the
-- board", and none of them was the squad-forming logic, which was finished and
-- correct the whole time:
--
--   1. no college was ever given a season, and form_squads refuses without one
--      — while `authenticated` is revoked from inserting into seasons, so an
--      officer could not fix it from the app either;
--   2. form_squads and tpo_rebalance_squads counted only 'completed' students,
--      and an import writes 'invited' — so a fresh roster of sixty looked like
--      a roster of nobody;
--   3. nothing in the app ever called tpo_form_squads();
--   4. the import never told the squad system that anything had happened.
--
-- This migration closes 1 and 2. The page closes 3 and 4.
-- ============================================================================


-- ── every college has a season ──────────────────────────────────────────
-- Called from form_squads rather than left to a nightly job, because the
-- season is a precondition of squads existing at all: a college that has just
-- imported its students should not have to wait until tomorrow, or ask
-- somebody with database access, to see a leaderboard.
create or replace function public.ensure_season(_college_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare sid uuid; n integer; nm text;
begin
  if _college_id is null then return null; end if;

  select id into sid from public.seasons
   where college_id = _college_id and is_current
   order by starts_on desc limit 1;
  if sid is not null then return sid; end if;

  select count(*) into n from public.seasons where college_id = _college_id;
  nm := 'Season ' || (n + 1);

  -- Ten weeks is the planned_weeks default the table already carries; naming
  -- it here rather than leaning on the default keeps the end date honest.
  insert into public.seasons (name, college_id, starts_on, ends_on,
                              is_current, planned_weeks, status)
  values (nm, _college_id, current_date, current_date + (10 * 7), true, 10, 'active')
  returning id into sid;

  perform public.write_audit('SEASON_OPENED', 'seasons', sid, null,
    jsonb_build_object('name', nm), _college_id);

  return sid;
end $fn$;

-- Nobody calls this directly: form_squads calls it, and the trigger below
-- calls it. Leaving it ungranted keeps season creation a consequence of
-- something, never a thing an officer does by hand.
revoke all on function public.ensure_season(uuid) from public, anon, authenticated;


create or replace function public.colleges_open_season()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform public.ensure_season(new.id);
  return new;
end $fn$;

drop trigger if exists colleges_open_season_trg on public.colleges;
create trigger colleges_open_season_trg
  after insert on public.colleges
  for each row execute function public.colleges_open_season();

-- The colleges that already signed up, which is all of them so far.
select public.ensure_season(id) from public.colleges;


-- ── who counts as squad-able ────────────────────────────────────────────
-- 'completed' was the wrong line to draw. A college that has just imported a
-- branch has sixty students it is responsible for and zero of them completed,
-- and telling that officer "no squads could be formed" while showing them
-- sixty names is the kind of contradiction nobody debugs — they assume the
-- feature is broken.
--
-- 'blocked' is the only status that should keep somebody out of a squad. An
-- invited student who never signs up simply scores nothing, which the weekly
-- scoring already handles, and appears in their squad as quiet — which is
-- exactly what the officer needs to see.
create or replace function public.form_squads(_college_id uuid, _season_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  sid uuid; town text; created integer := 0; placed integer := 0;
  br record; sq uuid; theme text; full_squads integer; existing integer; i integer;
  stu record;
begin
  -- Opens one if the college has none, instead of refusing. The old exception
  -- was unreachable from the app: there was no way to create the season it
  -- was asking for.
  sid := public.ensure_season(_college_id);
  if _season_id is not null then sid := _season_id; end if;
  if sid is null then raise exception 'no season is running for this college'; end if;

  town := public.squad_town(_college_id);

  -- Squads are formed per branch, because a squad is a group of people who sit
  -- near each other and can actually meet.
  for br in
    select coalesce(nullif(trim(p.branch), ''), 'GENERAL') as branch, count(*) as students
      from public.student_profiles p
     where p.college_id = _college_id
       and p.onboarding_status <> 'blocked'
       and not exists (select 1 from public.squad_members m
                        where m.student_id = p.id and m.left_at is null)
     group by 1
  loop
    full_squads := floor(br.students / 11.0);
    continue when full_squads < 1;   -- fewer than eleven: everybody stays in reserve

    -- This college's own theme for the branch wins; the platform default for
    -- that branch is next; the platform's wildcard theme is the last resort.
    select t.theme into theme
      from public.squad_name_themes t
     where t.branch = br.branch and (t.college_id = _college_id or t.college_id is null)
     order by t.college_id nulls last
     limit 1;
    if theme is null then
      select t.theme into theme
        from public.squad_name_themes t
       where t.branch = '*' and (t.college_id = _college_id or t.college_id is null)
       order by t.college_id nulls last
       limit 1;
    end if;

    -- Running this a second time — a second import of the same branch — must
    -- not try to insert a name the first run already used. The numbering
    -- continues from what this branch already has rather than starting at one.
    select count(*) into existing
      from public.squads s
     where s.college_id = _college_id and s.season_id = sid
       and s.archived_at is null
       and s.name like town || ' Warriors ' || theme || '%';

    for i in (existing + 1)..(existing + full_squads) loop
      -- The first squad of a branch carries the plain name; later ones are
      -- numbered, so "Surampalem Warriors Titans" and "… Titans II".
      insert into public.squads (name, college_id, season_id, max_members)
      values (town || ' Warriors ' || theme ||
              case when i > 1 then ' ' || repeat('I', i) else '' end,
              _college_id, sid, 11)
      returning id into sq;
      created := created + 1;

      for stu in
        select p.id from public.student_profiles p
         where p.college_id = _college_id
           and coalesce(nullif(trim(p.branch), ''), 'GENERAL') = br.branch
           and p.onboarding_status <> 'blocked'
           and not exists (select 1 from public.squad_members m
                            where m.student_id = p.id and m.left_at is null)
         order by p.roll_number nulls last, p.full_name
         limit 11
      loop
        insert into public.squad_members (squad_id, student_id, joined_at)
        values (sq, stu.id, now());
        placed := placed + 1;
      end loop;
    end loop;
  end loop;

  perform public.write_audit('SQUADS_FORMED', 'squads', _college_id, null,
    jsonb_build_object('squads_created', created, 'students_placed', placed), _college_id);

  return jsonb_build_object(
    'ok', true, 'squads_created', created, 'students_placed', placed,
    'reserve', (select count(*) from public.student_profiles p
                 where p.college_id = _college_id
                   and p.onboarding_status <> 'blocked'
                   and not exists (select 1 from public.squad_members m
                                    where m.student_id = p.id and m.left_at is null)));
end $fn$;

revoke all on function public.form_squads(uuid, uuid) from public, anon, authenticated;


-- The same line, drawn in the same place. Two functions that disagree about
-- who is eligible is how "rebalance placed nobody" ends up sitting next to
-- "you have sixty students".
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
       and p.onboarding_status <> 'blocked'
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
                          and p.onboarding_status <> 'blocked'
                          and not exists (select 1 from public.squad_members m
                                           where m.student_id = p.id and m.left_at is null)));
end $fn$;

revoke all on function public.tpo_rebalance_squads() from public, anon;
grant execute on function public.tpo_rebalance_squads() to authenticated;
