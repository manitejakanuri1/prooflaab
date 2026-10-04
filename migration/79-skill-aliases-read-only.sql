-- 79: skill_aliases can no longer be changed (or read) by app callers.
-- The table had no row-level security and the schema's default privileges had given anon,
-- authenticated and service_role every right on it, so an anonymous request could insert rows
-- through the API (proven on staging, 4 Oct). Nothing in the app reads it directly: only
-- suggest_tracks() does, as security definer owned by postgres, which keeps working.
-- (78 is reserved for the pending coding-verification change.)
begin;

revoke all on table public.skill_aliases from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.skill_aliases from service_role;
-- Second guard: RLS on with no policy. The owner (postgres, and suggest_tracks running as it) is
-- not affected because RLS is not forced.
alter table public.skill_aliases enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.skill_aliases', 'select')
       or has_table_privilege(r, 'public.skill_aliases', 'insert')
       or has_table_privilege(r, 'public.skill_aliases', 'update')
       or has_table_privilege(r, 'public.skill_aliases', 'delete')
       or has_table_privilege(r, 'public.skill_aliases', 'truncate') then
      raise exception '79 self-check: % still has a privilege on skill_aliases', r;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.skill_aliases', 'insert')
     or has_table_privilege('service_role', 'public.skill_aliases', 'delete')
     or has_table_privilege('service_role', 'public.skill_aliases', 'truncate') then
    raise exception '79 self-check: service_role can still change skill_aliases';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.skill_aliases'::regclass) then
    raise exception '79 self-check: RLS is not on';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
