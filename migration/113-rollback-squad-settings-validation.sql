-- 113 rollback: tpo_squad_update exactly as stage 24 left it (copied verbatim). Squads saved meanwhile keep their values.
begin;

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

revoke all on function public.tpo_squad_update(uuid, text, integer, boolean, boolean) from public, anon;
grant execute on function public.tpo_squad_update(uuid, text, integer, boolean, boolean) to authenticated;

commit;
notify pgrst, 'reload schema';
