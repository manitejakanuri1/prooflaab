-- ============================================================================
-- Stage 23 — the three things that were still typed in by hand.
--
--   §7  squads were created one at a time. The system should form them.
--   §15 a season published a champion and dropped second and third.
--   §17 the public portfolio could not show a score, because the view it
--       reads was never created.
--
-- Invite codes were removed in the same change. They were never reachable:
-- the sign-up form only ever sets its step to 'form' or 'email-verification',
-- nothing set it to 'invite-code', and nothing linked to /invite-verification.
-- Removing them changed the onboarding flow by nothing at all — which is the
-- only reason it was safe to do while leaving onboarding untouched.
-- ============================================================================


-- ── §17 the public scorecard ────────────────────────────────────────────
-- A view, not a table: every figure already lives on resume_scorecards, and a
-- copy is a second version that drifts from the first.
--
-- Two things are deliberately left out. voice_authenticity_score and
-- voice_notes are an internal judgement about whether a recording is really the
-- student — useful to the platform, nobody else's business. And only the latest
-- scorecard appears, because a public profile is a current claim rather than a
-- history of attempts.
create view public.public_resume_scorecards
with (security_invoker = off) as
select distinct on (s.student_id)
       s.student_id, s.resume_quality_score, s.ats_match_score,
       s.skill_proof_score, s.project_proof_score, s.reasoning_score,
       s.coding_score, s.interview_readiness_score, s.skill_gap, s.roadmap,
       s.created_at
  from public.resume_scorecards s
  join public.student_portfolios p on p.student_id = s.student_id
 where p.is_public = true
 order by s.student_id, s.created_at desc;

-- Readable signed out on purpose: this is what a recruiter opens from a shared
-- link. It only ever contains students who chose to publish.
grant select on public.public_resume_scorecards to anon, authenticated;


-- ── §7 squad formation and naming ───────────────────────────────────────
-- Themes live in a table because §7 says a college should be able to choose its
-- own later, and a list buried in a function is not something a college can
-- choose.
create table public.squad_name_themes (
  branch text primary key,
  theme  text not null
);

insert into public.squad_name_themes (branch, theme) values
  ('CSE','Titans'), ('IT','Intellects'), ('ECE','Strikers'),
  ('EEE','Chargers'), ('MECH','Warriors'), ('CIVIL','Builders'),
  ('AIML','Oracles'), ('DS','Analysts'), ('*','Challengers');

alter table public.squad_name_themes enable row level security;
create policy themes_read on public.squad_name_themes for select to authenticated using (true);
revoke insert, update, delete, truncate on public.squad_name_themes from anon, authenticated;
grant select on public.squad_name_themes to authenticated;

-- "Surampalem, Andhra Pradesh" becomes "Surampalem" — the part a student would
-- actually say out loud.
create or replace function public.squad_town(_college_id uuid)
returns text language sql stable set search_path = public, pg_temp as $fn$
  select coalesce(
    nullif(trim(split_part((select location from public.college_profiles cp
                             join public.colleges c on c.user_id = cp.user_id
                            where c.id = _college_id limit 1), ',', 1)), ''),
    (select name from public.colleges where id = _college_id));
$fn$;

-- floor(N / 11) full squads per branch, everybody left over stays in reserve.
--
-- Per branch rather than per college, which is a deliberate reading of §7: the
-- naming model is branch-specific — CSE becomes Titans, IT becomes Intellects —
-- so a squad cannot be a branch-themed name and a mix of branches at once. It
-- also means a squad is a group of people who sit near each other and can
-- actually meet. The cost is more reserves than the document's single-pool
-- example, and that is the trade being made.
--
-- Only onboarded students are placed. Somebody imported who has never signed in
-- is not a team-mate yet, and a squad full of names that never arrive looks
-- full and scores nothing.
create or replace function public.form_squads(_college_id uuid, _season_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  sid uuid; town text; created integer := 0; placed integer := 0;
  br record; sq uuid; theme text; full_squads integer; i integer; stu record;
begin
  select id into sid from public.seasons
   where college_id = _college_id and is_current order by starts_on desc limit 1;
  if _season_id is not null then sid := _season_id; end if;
  if sid is null then raise exception 'no season is running for this college'; end if;

  town := public.squad_town(_college_id);

  for br in
    select coalesce(nullif(trim(p.branch), ''), 'GENERAL') as branch, count(*) as students
      from public.student_profiles p
     where p.college_id = _college_id
       and p.onboarding_status = 'completed'
       and not exists (select 1 from public.squad_members m
                        where m.student_id = p.id and m.left_at is null)
     group by 1
  loop
    full_squads := floor(br.students / 11.0);
    continue when full_squads < 1;

    select coalesce(
             (select t.theme from public.squad_name_themes t where t.branch = br.branch),
             (select t.theme from public.squad_name_themes t where t.branch = '*'))
      into theme;

    for i in 1..full_squads loop
      -- The first squad of a branch carries the plain name; later ones are
      -- numbered, so "Surampalem Warriors Titans" then "… Titans II".
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
           and p.onboarding_status = 'completed'
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
                   and p.onboarding_status = 'completed'
                   and not exists (select 1 from public.squad_members m
                                    where m.student_id = p.id and m.left_at is null)));
end $fn$;

create or replace function public.tpo_form_squads()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare cid uuid := public.my_college_id();
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can form its own squads'; end if;
  return public.form_squads(cid);
end $fn$;

revoke all on function public.form_squads(uuid, uuid) from public, anon, authenticated;
revoke all on function public.squad_town(uuid) from public, anon;
revoke all on function public.tpo_form_squads() from public, anon;
grant execute on function public.tpo_form_squads() to authenticated;


-- ── §15 the whole podium ────────────────────────────────────────────────
-- A season published a champion and dropped second and third, which is most of
-- a podium missing — and second place is what most squads are actually playing
-- for by week eight.
alter table public.seasons
  add column runner_up_squad_id uuid references public.squads(id) on delete set null,
  add column third_squad_id     uuid references public.squads(id) on delete set null,
  add column completed_at       timestamptz;

create or replace function public.close_season(_season_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare podium uuid[]; names text[];
begin
  select array_agg(id order by points desc nulls last, name),
         array_agg(name order by points desc nulls last, name)
    into podium, names
    from public.squads where season_id = _season_id;

  update public.seasons
     set status = 'complete', is_current = false, completed_at = now(),
         champion_squad_id  = podium[1],
         runner_up_squad_id = podium[2],
         third_squad_id     = podium[3]
   where id = _season_id;

  perform public.write_audit('SEASON_CLOSED', 'seasons', _season_id, null,
    jsonb_build_object('champion', names[1], 'runner_up', names[2], 'third', names[3]),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3]);
end $fn$;

-- The weekly job closed a finished season inline and kept only the champion. It
-- now calls close_season, so one place decides what finishing a season means.
create or replace function public.run_all_seasons()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare s record; done integer := 0; drawn integer := 0; closed integer := 0; wk integer;
begin
  for s in select * from public.seasons where is_current and status = 'active' loop
    if not exists (select 1 from public.squad_matches where season_id = s.id)
       and (select count(*) from public.squads where season_id = s.id) >= 2 then
      perform public.generate_round_robin(s.id, false);
      drawn := drawn + 1;
    end if;

    wk := public.season_week(s.id);
    if wk > 1 then
      perform public.run_squad_week(s.id, wk - 1);
      done := done + 1;
    end if;

    if wk >= s.planned_weeks then
      perform public.close_season(s.id);
      closed := closed + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'seasons_scored', done,
                            'draws_created', drawn, 'seasons_closed', closed,
                            'ran_at', now());
end $fn$;

revoke all on function public.close_season(uuid) from public, anon, authenticated;
revoke all on function public.run_all_seasons() from public, anon, authenticated;
