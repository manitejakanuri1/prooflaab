-- 112: "remove empty squads" removes only squads that were never used (Sidhu S41).
--
-- After a college removes students, College -> Students asks "N squads are now empty. Remove them?" and OK calls
-- tpo_delete_empty_squads() (migration 25). It deleted every squad with no CURRENT member. A squad's matches,
-- weekly scores and membership history are ON DELETE CASCADE, and a season's champion / runner-up / third are
-- SET NULL, so one OK erased: that squad's matches (and with them each OPPONENT's match record), its weekly
-- scores, its membership history, and a finished season's podium. Reproduced on PostgreSQL with the deployed
-- function (scripts/dev-tools/sidhu_s41_squad_management.test.mjs).
--
-- Now a squad is "empty" only if it was never used: no membership row at all (current or past), no match, no weekly
-- score, and not on any season's podium. Such a squad has nothing to lose. A squad with history is left as it is
-- (the nightly job and the next import refill it, migration 108). tpo_empty_squads() counts the same set, so the
-- prompt says exactly how many will go. Same names, arguments and grants: the screen does not change.
-- Rollback: 112-rollback-empty-squads-keep-history.sql (restores migration 25's bodies).
begin;

create or replace function public.squad_never_used(_squad_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select not exists (select 1 from public.squad_members m where m.squad_id = _squad_id)
     and not exists (select 1 from public.squad_matches x where x.home_squad = _squad_id or x.away_squad = _squad_id)
     and not exists (select 1 from public.squad_weekly_scores w where w.squad_id = _squad_id)
     and not exists (select 1 from public.seasons s
                      where _squad_id in (s.champion_squad_id, s.runner_up_squad_id, s.third_squad_id));
$function$;
revoke all on function public.squad_never_used(uuid) from public, anon, authenticated;

create or replace function public.tpo_empty_squads()
returns integer
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)::integer
    from public.squads s
   where s.college_id = public.my_college_id()
     and s.archived_at is null
     and public.squad_never_used(s.id);
$function$;

create or replace function public.tpo_delete_empty_squads()
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  cid uuid := public.my_college_id();
  gone integer;
begin
  if cid is null then
    raise exception 'only a college can remove its own squads';
  end if;

  -- 112: never used only. A squad with matches, scores, a podium place or any past member keeps its history.
  with d as (
    delete from public.squads s
     where s.college_id = cid
       and s.archived_at is null
       and public.squad_never_used(s.id)
    returning s.id
  )
  select count(*)::integer into gone from d;

  if gone > 0 then
    perform public.write_audit('EMPTY_SQUADS_REMOVED', 'squads', cid, null,
      jsonb_build_object('squads_removed', gone), cid);
  end if;
  return gone;
end $function$;

revoke all on function public.tpo_empty_squads()        from public, anon;
revoke all on function public.tpo_delete_empty_squads() from public, anon;
grant execute on function public.tpo_empty_squads()        to authenticated, service_role;
grant execute on function public.tpo_delete_empty_squads() to authenticated, service_role;

do $$
begin
  if position('squad_never_used' in pg_get_functiondef('public.tpo_delete_empty_squads()'::regprocedure)) = 0
     or position('squad_never_used' in pg_get_functiondef('public.tpo_empty_squads()'::regprocedure)) = 0 then
    raise exception '112 self-check: the prompt and the delete must use the same rule';
  end if;
  if not has_function_privilege('authenticated', 'public.tpo_delete_empty_squads()', 'execute')
     or has_function_privilege('anon', 'public.tpo_delete_empty_squads()', 'execute')
     or has_function_privilege('authenticated', 'public.squad_never_used(uuid)', 'execute') then
    raise exception '112 self-check: privileges wrong';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
