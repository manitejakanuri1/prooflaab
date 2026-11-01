-- Rollback of 210: every patch undone (same text, swapped), announcements.college_id and open_due_seasons removed.
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
  if hits = 0 then raise exception '210 rollback: % does not contain the text to patch: %', _fn, left(_old, 80); end if;
end $p$;

select pg_temp.patch('my_announcements',
  'and public.announcement_role_matches(a.audience, ur.role::text)
                    and public.announcement_college_matches(a.college_id, ur.user_id))',
  'and public.announcement_role_matches(a.audience, ur.role::text))');
select pg_temp.patch('announcement_fan_out',
  'where ur.role <> ''admin'' and public.announcement_role_matches(new.audience, ur.role::text)
       and public.announcement_college_matches(new.college_id, ur.user_id)',
  'where ur.role <> ''admin'' and public.announcement_role_matches(new.audience, ur.role::text)');
select pg_temp.patch('company_create_lot',
  $x$made := made || tid;
    -- 210 (E2E-22): the days to finish count from the Lot day
    update public.tasks set due_date = greatest(due_date, ld::timestamptz + make_interval(days => greatest(1, coalesce(_days, 7))))
     where id = tid;$x$,
  'made := made || tid;');
select pg_temp.patch('company_create_lot',
  $x$where not exists (select 1 from public.tasks t where t.student_id = sid and t.lot_date = d::date)
           and public.lot_day_kind(d::date) <> 'rest')$x$,
  'where not exists (select 1 from public.tasks t where t.student_id = sid and t.lot_date = d::date))');
select pg_temp.patch('generate_section_finals',
  $x$continue when a is null or c is null or a = c;
    -- 210 (E2E-4): no league match played in this section means no champion (close_season), so no final
    continue when not exists (select 1 from public.squad_matches lm join public.squads lq on lq.id = lm.home_squad
                               where lm.season_id = _season_id and lm.stage = 'league' and lm.status = 'played'
                                 and lq.bracket = b.bracket);$x$,
  'continue when a is null or c is null or a = c;');
select pg_temp.patch('tpo_college_report',
  $x$where s.college_id = cid
     and (s.status <> 'complete' or exists (select 1 from public.squads q where q.season_id = s.id));$x$,
  $y$where s.college_id = cid;$y$);
select pg_temp.patch('tpo_insights',
  'from public.squads where college_id = cid and archived_at is null)',
  'from public.squads where college_id = cid)');
select pg_temp.patch('tpo_attention',
  $x$case when b.quiet >= 999 then 'Has not started yet'
                when b.quiet >= 7 then 'No activity for ' || b.quiet || ' days' end$x$,
  $y$case when b.quiet >= 7 then 'No activity for ' || b.quiet || ' days' end$y$);
drop function if exists public.open_due_seasons();
drop function if exists public.announcement_college_matches(uuid, uuid);
alter table public.announcements drop column if exists college_id;
notify pgrst, 'reload schema';
commit;
