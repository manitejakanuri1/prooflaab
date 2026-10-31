-- 195 (owner, 31 Oct 2026): a section's waiting students make a new squad from FIVE, not eleven.
--   Before (184): free seats first, then whole elevens only; fewer than eleven waited in Reserve, so a section with
--   fewer than 11 students never got a squad.
--   Now, after the free seats: squads of 11, and when 5 or more are left over they make one more squad
--   (27 waiting -> 11 + 11 + 5; 24 -> 11 + 11 and 2 wait). Students are still dealt by the same strong-to-weak
--   snake order, so the small squad is not the weakest; it simply stops taking students at its size. Later
--   students fill the emptiest squad first (unchanged), so the small squad fills up first.
--   my_reserve_status(): a waiting student's own section and how many of the five are waiting, for the student
--   screen.
-- Rollback: migration/195-rollback-squad-of-five.sql
begin;

do $do$
declare body text; nb text;
begin
  body := pg_get_functiondef('public.form_squads_in(uuid)'::regprocedure);
  nb := replace(body,
    E'    -- whole elevens only; fewer than eleven wait in Reserve\n    k := n / 11;\n',
    E'    -- 195: squads of eleven; five or more left over make one more squad; fewer than five wait in Reserve\n    k := n / 11 + case when n % 11 >= 5 then 1 else 0 end;\n');
  nb := replace(nb, E'       limit k * 11\n', E'       limit least(n, k * 11)\n');
  nb := replace(nb,
    E'      if cycle % 2 = 1 then idx := k - 1 - idx; end if;\n',
    E'      if cycle % 2 = 1 then idx := k - 1 - idx; end if;\n'
    || E'      -- 195: the last squad of a 5-10 remainder takes only the remainder\n'
    || E'      while (select count(*) from public.squad_members m where m.squad_id = squad_ids[idx + 1] and m.left_at is null)\n'
    || E'            >= case when idx = k - 1 and n < k * 11 then n - (k - 1) * 11 else 11 end loop\n'
    || E'        idx := (idx + 1) % k;\n'
    || E'      end loop;\n');
  if nb = body or position('n % 11 >= 5' in nb) = 0 or position('least(n, k * 11)' in nb) = 0
     or position('takes only the remainder' in nb) = 0 then
    raise exception '195: form_squads_in did not have the expected text';
  end if;
  execute nb;
end $do$;

create or replace function public.my_reserve_status()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select case when p.id is null then null else jsonb_build_object(
    'in_squad', exists (select 1 from public.squad_members m where m.student_id = p.id and m.left_at is null),
    'section', coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL'),
    'waiting', (select count(*) from public.student_profiles o
                 where o.college_id = p.college_id
                   and o.passing_out_year is not distinct from p.passing_out_year
                   and coalesce(nullif(trim(o.cohort), ''), nullif(trim(o.branch), ''), 'GENERAL')
                     = coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL')
                   and o.onboarding_status <> 'blocked'
                   and not exists (select 1 from public.squad_members m where m.student_id = o.id and m.left_at is null)),
    'needed', 5) end
  from (select auth.uid() as uid) u left join public.student_profiles p on p.id = u.uid;
$fn$;
revoke all on function public.my_reserve_status() from public, anon;
grant execute on function public.my_reserve_status() to authenticated, service_role;

do $$
begin
  if position('n % 11 >= 5' in pg_get_functiondef('public.form_squads_in(uuid)'::regprocedure)) = 0 then
    raise exception '195 self-check: form_squads_in still makes elevens only';
  end if;
  if has_function_privilege('anon', 'public.my_reserve_status()', 'EXECUTE') then
    raise exception '195 self-check: my_reserve_status is open to signed-out callers';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
