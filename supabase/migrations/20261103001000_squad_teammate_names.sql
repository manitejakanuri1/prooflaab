-- 60: a student can see the names of their own squad (N3).
-- student_profiles is readable only by its owner, so the Squad page's embedded
-- read returned null for every teammate and the Members tab showed "—".
-- my_squad_members() returns name, XP, role and contribution for the caller's
-- CURRENT squad only - nothing else from the profile, and no other squad.
begin;

create or replace function public.my_squad_members()
returns table(student_id uuid, full_name text, total_xp integer, role text, contribution integer, joined_at timestamptz)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select m.student_id, p.full_name, p.total_xp, m.role, m.contribution, m.joined_at
    from public.squad_members m
    join public.student_profiles p on p.id = m.student_id
   where m.left_at is null
     and m.squad_id = (select mine.squad_id from public.squad_members mine
                        where mine.student_id = (select auth.uid()) and mine.left_at is null
                        order by mine.joined_at desc limit 1)
   order by m.joined_at;
$function$;

revoke all on function public.my_squad_members() from public, anon;
grant execute on function public.my_squad_members() to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.my_squad_members()', 'execute') then
    raise exception '60 self-check: anon can execute my_squad_members';
  end if;
  if not has_function_privilege('authenticated', 'public.my_squad_members()', 'execute') then
    raise exception '60 self-check: signed-in users cannot execute my_squad_members';
  end if;
  -- No caller identity inside the migration: the function must return nothing.
  if exists (select 1 from public.my_squad_members()) then
    raise exception '60 self-check: my_squad_members returned rows without a caller';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
