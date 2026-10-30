-- 181 (MF-080, 30 Oct 2026): the role a student gives during onboarding becomes their target role.
--   Both onboarding paths (resume and interests) save the role in resume_claims.target_role, but nothing copied it
--   to student_profiles.target_role, so Role preference said "Not set yet" (60 TEST students, 18 of them had a role).
--   A trigger on resume_claims now fills student_profiles.target_role when it is still empty; a role the student
--   set or changed themselves is never overwritten. Students who already onboarded are filled now (newest claim,
--   confirmed first).
-- Rollback: migration/181-rollback-role-from-onboarding.sql
begin;

create or replace function public.claim_sets_target_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if nullif(trim(new.target_role), '') is not null then
    perform set_config('app.system_write', 'on', true);
    update public.student_profiles
       set target_role = trim(new.target_role)
     where id = new.student_id and nullif(trim(target_role), '') is null;
    perform set_config('app.system_write', 'off', true);
  end if;
  return new;
end $fn$;

drop trigger if exists resume_claims_set_target_role on public.resume_claims;
create trigger resume_claims_set_target_role
  after insert or update of target_role on public.resume_claims
  for each row execute function public.claim_sets_target_role();

-- Students who already onboarded.
select set_config('app.system_write', 'on', true);
update public.student_profiles p
   set target_role = c.role
  from (select distinct on (student_id) student_id, trim(target_role) as role
          from public.resume_claims
         where nullif(trim(target_role), '') is not null
         order by student_id, (status = 'confirmed') desc, created_at desc) c
 where c.student_id = p.id and nullif(trim(p.target_role), '') is null;
select set_config('app.system_write', 'off', true);

do $$
begin
  if exists (select 1 from public.student_profiles p
              where nullif(trim(p.target_role), '') is null
                and exists (select 1 from public.resume_claims c
                             where c.student_id = p.id and nullif(trim(c.target_role), '') is not null)) then
    raise exception '181: a student who gave a role during onboarding still has none';
  end if;
end $$;

commit;
