-- 210 (owner 1 Nov 2026, Grok's end-to-end findings). Safe for REAL and TEST.
-- Function edits are small text patches on the function as it stands, so the TEST-only clocks
-- (197/208/209) that also rewrite some of these functions are kept as they are. Each patch must find
-- its text, or the migration stops.
--   E2E-3   College "Needs attention": a never-active student says "Has not started yet", not "999 days".
--   E2E-2/6 College Insights: squad health and squad count read only live squads (not every past season's);
--           the season report leaves out finished seasons that never had a squad ("No year set", 0 squads).
--   E2E-4   No section final when no league match there was played: close_season then names no champion,
--           and a 0-0 final "won as higher seed" contradicted it.
--   E2E-10  A company Lot never lands on the Sunday rest day (130).
--   E2E-22  A company Lot's due date counts from its Lot day, not from the moment it was sent.
--   E2E-16  An announcement can go to one college (announcements.college_id; empty = every college).
--   E2E-5   open_due_seasons(): the next season opens once its days off are over (the time the college and
--           students are shown), called by the season job, not only by the 05:35 squad job.
-- Rollback: migration/210-rollback-e2e-fixes.sql
begin;

create or replace function pg_temp.patch(_fn text, _old text, _new text) returns void language plpgsql as $p$
declare f record; def text; hits int := 0;
begin
  for f in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = _fn loop
    def := pg_get_functiondef(f.oid);
    if position(_old in def) > 0 then
      execute replace(def, _old, _new);
      hits := hits + 1;
    end if;
  end loop;
  if hits = 0 then raise exception '210: % does not contain the text to patch: %', _fn, left(_old, 80); end if;
end $p$;

-- E2E-3
select pg_temp.patch('tpo_attention',
  $o$case when b.quiet >= 7 then 'No activity for ' || b.quiet || ' days' end$o$,
  $n$case when b.quiet >= 999 then 'Has not started yet'
                when b.quiet >= 7 then 'No activity for ' || b.quiet || ' days' end$n$);

-- E2E-2 / E2E-6: live squads only
select pg_temp.patch('tpo_insights',
  'from public.squads where college_id = cid)',
  'from public.squads where college_id = cid and archived_at is null)');
select pg_temp.patch('tpo_college_report',
  $o$where s.college_id = cid;$o$,
  $n$where s.college_id = cid
     and (s.status <> 'complete' or exists (select 1 from public.squads q where q.season_id = s.id));$n$);

-- E2E-4
select pg_temp.patch('generate_section_finals',
  'continue when a is null or c is null or a = c;',
  $n$continue when a is null or c is null or a = c;
    -- 210 (E2E-4): no league match played in this section means no champion (close_season), so no final
    continue when not exists (select 1 from public.squad_matches lm join public.squads lq on lq.id = lm.home_squad
                               where lm.season_id = _season_id and lm.stage = 'league' and lm.status = 'played'
                                 and lq.bracket = b.bracket);$n$);

-- E2E-10 and E2E-22
select pg_temp.patch('company_create_lot',
  'where not exists (select 1 from public.tasks t where t.student_id = sid and t.lot_date = d::date))',
  $n$where not exists (select 1 from public.tasks t where t.student_id = sid and t.lot_date = d::date)
           and public.lot_day_kind(d::date) <> 'rest')$n$);
select pg_temp.patch('company_create_lot',
  'made := made || tid;',
  $n$made := made || tid;
    -- 210 (E2E-22): the days to finish count from the Lot day
    update public.tasks set due_date = greatest(due_date, ld::timestamptz + make_interval(days => greatest(1, coalesce(_days, 7))))
     where id = tid;$n$);

-- E2E-16
alter table public.announcements add column if not exists college_id uuid references public.colleges(id) on delete cascade;

create or replace function public.announcement_college_matches(_college uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select _college is null
      or exists (select 1 from public.student_profiles p where p.user_id = _user and p.college_id = _college)
      or exists (select 1 from public.colleges c where c.user_id = _user and c.id = _college);
$fn$;
revoke all on function public.announcement_college_matches(uuid, uuid) from public, anon;

select pg_temp.patch('announcement_fan_out',
  'where ur.role <> ''admin'' and public.announcement_role_matches(new.audience, ur.role::text)',
  'where ur.role <> ''admin'' and public.announcement_role_matches(new.audience, ur.role::text)
       and public.announcement_college_matches(new.college_id, ur.user_id)');
select pg_temp.patch('my_announcements',
  'and public.announcement_role_matches(a.audience, ur.role::text))',
  'and public.announcement_role_matches(a.audience, ur.role::text)
                    and public.announcement_college_matches(a.college_id, ur.user_id))');

-- E2E-5
create or replace function public.open_due_seasons()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare c record; n integer := 0;
begin
  for c in
    select distinct s.college_id from public.seasons s
     where s.status = 'complete'
       and s.completed_at > now() - interval '7 days'
       and now() >= s.completed_at + public.season_gap(s.id)
       and s.completed_at = (select max(x.completed_at) from public.seasons x
                              where x.college_id = s.college_id and x.year_group is not distinct from s.year_group)
       and not exists (select 1 from public.seasons x where x.college_id = s.college_id and x.is_current
                          and x.year_group is not distinct from s.year_group)
       and exists (select 1 from public.student_profiles p
                    where p.college_id = s.college_id and p.passing_out_year is not distinct from s.year_group
                      and p.onboarding_status <> 'blocked'
                      and not exists (select 1 from public.squad_members m where m.student_id = p.id and m.left_at is null))
  loop
    begin
      perform public.form_squads(c.college_id);
      n := n + 1;
    exception when others then
      raise notice 'open_due_seasons: college % not opened: %', c.college_id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'colleges', n);
end $fn$;
revoke all on function public.open_due_seasons() from public, anon, authenticated;
grant execute on function public.open_due_seasons() to service_role;

do $$ declare src text; begin
  select prosrc into src from pg_proc where proname = 'company_create_lot' and pronamespace = 'public'::regnamespace;
  if src not like '%lot_day_kind(d::date) <> ''rest''%' then raise exception '210 self-check: company Lot rest day'; end if;
  select prosrc into src from pg_proc where proname = 'generate_section_finals' and pronamespace = 'public'::regnamespace;
  if src not like '%E2E-4%' then raise exception '210 self-check: section final'; end if;
  if public.announcement_college_matches('00000000-0000-0000-0000-000000000000', null) then
    raise exception '210 self-check: college match';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
