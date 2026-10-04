-- UNSAFE EMERGENCY ROLLBACK of 84.
-- This RESTORES PROVEN HOLES: any signed-in user could again create or self-approve a verified
-- recruiter / approved company / approved college, admin_users goes back to full grants for anon,
-- and 13 functions (incl. placement_questions, which trusts a caller-supplied student id) become
-- directly callable again. Use only if 84 broke a legitimate flow; re-apply a corrected 84 after.
begin;
drop trigger if exists keep_approval_closed on public.recruiters;
drop trigger if exists keep_approval_closed on public.startups;
drop trigger if exists keep_approval_closed on public.colleges;
drop function if exists public.keep_approval_closed();

alter view public.admin_users reset (security_barrier);
grant select, insert, update, delete on public.admin_users to anon, authenticated;

do $$
declare s text;
begin
  foreach s in array array['public.placement_questions(uuid)', 'public.squad_championship_achievements(uuid)', 'public.submit_placement(jsonb)',
    'public.head_to_head(uuid,uuid,uuid)', 'public.is_last_step(uuid)', 'public.season_league_last_week(uuid)',
    'public.season_phase(uuid,integer)', 'public.season_plan(uuid)', 'public.season_week(uuid)',
    'public.season_week_bounds(uuid,integer)', 'public.season_week_start(uuid,integer)', 'public.squad_town(uuid)',
    'public.unlock_ceiling(uuid,text)'] loop
    execute format('grant execute on function %s to public, anon, authenticated', s);
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
