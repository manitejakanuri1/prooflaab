-- 123: a squad member's contribution is their own points for that squad.
--
-- squad_members.contribution is shown as "My share" and "Squad pulse" on the student Squad page,
-- in the college Squads > Members table, in the student profile and in the season report.
-- Nothing ever wrote it: on staging, 19 Oct 2026, all 13,465 squad members had contribution 0,
-- including the champion squad's members (squad 14,230 points). So every student read
-- "My share 0%" and "0 of 11 members have contributed. 11 need a nudge."
--
-- The weekly scorer (run_squad_week) already writes each student's points per squad per week
-- to student_weekly_scores. A trigger there now keeps contribution = the sum of those rows for
-- that student and squad, and every existing member is filled in once below. Squad points
-- (squads.points) are unchanged: they also include squad-level bonuses, so the members' sum can
-- be a little lower than the squad total.
begin;

create or replace function public.squad_member_contribution_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare sid uuid; qid uuid;
begin
  for sid, qid in
    select x.student_id, x.squad_id
      from (values (new.student_id, new.squad_id), (old.student_id, old.squad_id)) x(student_id, squad_id)
     where x.student_id is not null and x.squad_id is not null
  loop
    update public.squad_members m
       set contribution = (select coalesce(sum(w.points), 0) from public.student_weekly_scores w
                            where w.student_id = sid and w.squad_id = qid)
     where m.student_id = sid and m.squad_id = qid;
  end loop;
  return null;
end $function$;

revoke all on function public.squad_member_contribution_sync() from public, anon, authenticated;

drop trigger if exists student_weekly_scores_contribution on public.student_weekly_scores;
create trigger student_weekly_scores_contribution
  after insert or update of points, student_id, squad_id or delete on public.student_weekly_scores
  for each row execute function public.squad_member_contribution_sync();

-- Fill in every member once.
update public.squad_members m
   set contribution = coalesce(s.total, 0)
  from (select m2.student_id, m2.squad_id,
               (select sum(w.points) from public.student_weekly_scores w
                 where w.student_id = m2.student_id and w.squad_id = m2.squad_id) as total
          from public.squad_members m2) s
 where s.student_id = m.student_id and s.squad_id = m.squad_id
   and m.contribution is distinct from coalesce(s.total, 0);

-- Self-check: every member equals their weekly sum, and a new weekly row moves it (rolled back).
do $$
declare bad int; sid uuid; qid uuid; season uuid; before int; after int;
begin
  select count(*) into bad from public.squad_members m
   where m.contribution <> coalesce((select sum(w.points) from public.student_weekly_scores w
                                      where w.student_id = m.student_id and w.squad_id = m.squad_id), 0);
  if bad > 0 then raise exception '123 self-check: % members do not match their weekly points', bad; end if;

  select m.student_id, m.squad_id, q.season_id, m.contribution into sid, qid, season, before
    from public.squad_members m join public.squads q on q.id = m.squad_id
   where q.season_id is not null limit 1;
  if sid is null then raise notice '123 self-check: no squad member to try'; return; end if;
  insert into public.student_weekly_scores (season_id, student_id, squad_id, week, points, breakdown)
  values (season, sid, qid, 999, 7, '{}'::jsonb);
  select contribution into after from public.squad_members where student_id = sid and squad_id = qid;
  if after <> before + 7 then raise exception '123 self-check: expected %, got %', before + 7, after; end if;
  raise exception 'self-check passed' using errcode = 'P0123';
exception when sqlstate 'P0123' then
  raise notice '123 self-check passed (test row rolled back)';
end $$;

commit;
