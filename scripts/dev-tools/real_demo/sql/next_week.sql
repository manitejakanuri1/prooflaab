-- Moves ONLY the ProofLab QA Demo season forward one week. Every other season is never read or written.
-- No fast clock: the season stays on 7-day weeks. It is the same as 7 real days passing for this one college:
--   the season's dates, its matches and its students' Lot history all move back 7 days together, so work done
--   this week still counts for this week. Then the same steps run_all_seasons does nightly, for this season only.
-- Voice recordings keep their real dates (so the 7-day recording rule is not triggered early).
select set_config('app.system_write', 'on', true);
do $w$
declare cid uuid; s record; wk integer; pw integer; closing boolean;
begin
  select id into strict cid from public.colleges where email = 'college@qa-demo.prooflab.invalid' and name = 'ProofLab QA Demo';
  select * into s from public.seasons where college_id = cid and is_current and status = 'active';
  if s.id is null then raise exception 'The demo season is closed. Nothing was moved.'; end if;

  update public.seasons set starts_on = starts_on - 7, ends_on = ends_on - 7, created_at = created_at - interval '7 days' where id = s.id;
  update public.squad_matches set scheduled_at = scheduled_at - interval '7 days' where season_id = s.id;
  update public.task_submissions x set created_at = x.created_at - interval '7 days'
    from public.student_profiles p where p.id = x.student_id and p.college_id = cid;
  update public.tasks x set created_at = x.created_at - interval '7 days', lot_date = x.lot_date - 7
    from public.student_profiles p where p.id = x.student_id and p.college_id = cid;
  update public.daily_marks x set lot_at = x.lot_at - interval '7 days' where x.season_id = s.id;

  select * into s from public.seasons where id = s.id;
  -- Same steps as run_all_seasons (migration 202), one season only.
  closing := current_date >= s.starts_on + s.planned_weeks * 7;
  wk := case when closing then s.planned_weeks + 1 else public.season_week(s.id) end;
  for pw in 1..(wk - 1) loop
    if not exists (select 1 from public.squad_weekly_scores x where x.season_id = s.id and x.week = pw)
       or exists (select 1 from public.squad_matches m where m.season_id = s.id and m.round_number = pw and m.status = 'scheduled')
       or (select max(x.computed_at) from public.squad_weekly_scores x where x.season_id = s.id and x.week = pw)
          < (select b.ends_at from public.season_week_bounds(s.id, pw) b) then
      perform public.run_squad_week(s.id, pw);
    end if;
  end loop;
  if closing then
    perform public.close_season(s.id);
  elsif (select count(*) from public.squads where season_id = s.id and archived_at is null) >= 2 then
    perform public.advance_season(s.id);
  end if;
end $w$;
