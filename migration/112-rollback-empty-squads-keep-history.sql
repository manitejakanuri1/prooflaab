-- 112 rollback: tpo_empty_squads and tpo_delete_empty_squads exactly as migration 25 left them (copied verbatim).
-- After this, removing empty squads again deletes squads with history (their matches, scores and podium places).
begin;

create or replace function public.tpo_empty_squads()
returns integer
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)::integer
    from public.squads s
   where s.college_id = public.my_college_id()
     and s.archived_at is null
     and not exists (select 1 from public.squad_members m
                      where m.squad_id = s.id and m.left_at is null);
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

  with d as (
    delete from public.squads s
     where s.college_id = cid
       and s.archived_at is null
       and not exists (select 1 from public.squad_members m
                        where m.squad_id = s.id and m.left_at is null)
    returning s.id
  )
  select count(*)::integer into gone from d;

  if gone > 0 then
    perform public.write_audit('EMPTY_SQUADS_REMOVED', 'squads', cid, null,
      jsonb_build_object('squads_removed', gone), cid);
  end if;
  return gone;
end $function$;

drop function if exists public.squad_never_used(uuid);

commit;
notify pgrst, 'reload schema';
