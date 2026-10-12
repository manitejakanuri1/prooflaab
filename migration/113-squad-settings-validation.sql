-- 113: squad settings follow the same rules as creating a squad (Sidhu S41).
--
-- College -> Squads -> Manage saves a squad's name, seat limit, lock and archive through tpo_squad_update()
-- (stage 24). Tested on PostgreSQL with the deployed body (scripts/dev-tools/sidhu_s41_squad_settings.test.mjs), two
-- gaps: an empty squad could be set to 0 seats (the seat box is read on click, so an emptied box arrives as 0; the
-- browser's min=1 is never checked), leaving a squad nobody can join; and a squad could be renamed to the name of
-- another squad of the same season, which tpo_create_squad refuses. The body below is stage 24's, with only those
-- two checks added. Same name, arguments and grants; no screen change.
-- Rollback: 113-rollback-squad-settings-validation.sql (stage 24's body, verbatim).
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
  -- 113: the same rules as creating a squad. At least one seat (the screen reads its number box on click, so an
  -- emptied box arrives as 0), and a name no other active squad of the same season already uses.
  if _max_members is not null and _max_members < 1 then
    raise exception 'a squad needs at least one seat';
  end if;
  if nullif(trim(coalesce(_name, '')), '') is not null
     and exists (select 1 from public.squads o
                  where o.season_id = sq.season_id and o.archived_at is null and o.id <> _squad_id
                    and lower(o.name) = lower(trim(_name))) then
    raise exception 'there is already a squad called % this season', trim(_name);
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

do $$
declare d text := pg_get_functiondef('public.tpo_squad_update(uuid,text,integer,boolean,boolean)'::regprocedure);
begin
  if position('a squad needs at least one seat' in d) = 0 or position('already a squad called' in d) = 0 then
    raise exception '113 self-check: a check is missing';
  end if;
  if has_function_privilege('anon', 'public.tpo_squad_update(uuid,text,integer,boolean,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.tpo_squad_update(uuid,text,integer,boolean,boolean)', 'execute') then
    raise exception '113 self-check: privileges wrong';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
