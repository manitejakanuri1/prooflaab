-- Removing a student, one way for everyone (18 Sep 2026, owner's decision).
--
-- A student lives in two places: the Google login (Identity Platform) and the
-- ProofLab rows. Deleting only the login - as happened in the console on
-- 18 Sep - left 21 students on every dashboard who could no longer sign in.
-- From now on every path goes through remove_students(): the college's Remove
-- button, the admin's, and the sync that notices a login deleted in the
-- console. The prooflab-accounts service calls this, then deletes the logins.
begin;

-- The backup. One row per removed student with everything that mattered about
-- them, so a mistaken removal can be looked at and rebuilt by hand.
create table if not exists public.removed_students (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null,
  college_id  uuid,
  email       text,
  full_name   text,
  removed_by  uuid,              -- null = the console sync
  reason      text not null check (reason in ('college', 'admin', 'console_sync')),
  snapshot    jsonb not null,
  removed_at  timestamptz not null default now()
);
alter table public.removed_students enable row level security;
revoke all on table public.removed_students from public, anon, authenticated;
grant select, insert on table public.removed_students to service_role;

-- Every student and the login id Identity Platform knows them by: the
-- recorded provider id for accounts made after the move, else the uuid itself.
create or replace function public.student_logins()
returns table (student_id uuid, provider_uid text, email text)
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select p.id,
         coalesce(ai.provider_uid, p.id::text),
         coalesce(c.email, u.email::text)
    from public.student_profiles p
    join public.user_roles r on r.user_id = p.id and r.role = 'student'
    left join public.account_identities ai on ai.user_id = p.id
    left join public.student_contact c on c.student_id = p.id
    left join auth.users u on u.id = p.id;
$$;

-- Removes students and returns the login ids to delete.
--   _by = the signed-in admin or college_admin asking; null only for the sync.
-- A college may remove only its own students; an admin any student. Nobody who
-- is not a student can be removed this way.
create or replace function public.remove_students(_ids uuid[], _by uuid, _reason text)
returns table (student_id uuid, provider_uid text, email text)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
#variable_conflict use_column
declare
  is_admin boolean := exists (select 1 from public.user_roles where user_id = _by and role = 'admin');
  my_college uuid := (select id from public.colleges where user_id = _by limit 1);
  s record;
begin
  if _reason not in ('college', 'admin', 'console_sync') then
    raise exception 'unknown reason %', _reason;
  end if;
  if _by is null and _reason <> 'console_sync' then
    raise exception 'only the console sync may remove without a person';
  end if;
  if _by is not null and not is_admin and my_college is null then
    raise exception 'only a college or an administrator can remove students';
  end if;

  for s in
    select l.student_id, l.provider_uid, l.email, p.full_name, p.college_id
      from public.student_logins() l
      join public.student_profiles p on p.id = l.student_id
     where l.student_id = any(_ids)
  loop
    if _by is not null and not is_admin and s.college_id is distinct from my_college then
      raise exception 'that student belongs to another college';
    end if;

    insert into public.removed_students (student_id, college_id, email, full_name, removed_by, reason, snapshot)
    values (s.student_id, s.college_id, s.email, s.full_name, _by, _reason, jsonb_build_object(
      'profile',     (select to_jsonb(p) from public.student_profiles p where p.id = s.student_id),
      'contact',     (select to_jsonb(c) from public.student_contact c where c.student_id = s.student_id),
      'provider_uid', s.provider_uid,
      'squad',       (select jsonb_agg(to_jsonb(m)) from public.squad_members m where m.student_id = s.student_id),
      'tasks',       (select jsonb_agg(to_jsonb(t)) from public.tasks t where t.student_id = s.student_id),
      'proofs',      (select jsonb_agg(to_jsonb(x)) from public.proof_uploads x where x.student_id = s.student_id),
      'scorecards',  (select jsonb_agg(to_jsonb(x)) from public.resume_scorecards x where x.student_id = s.student_id),
      'tracks',      (select jsonb_agg(to_jsonb(x)) from public.student_tracks x where x.student_id = s.student_id),
      'levels',      (select jsonb_agg(to_jsonb(x)) from public.student_levels x where x.student_id = s.student_id),
      'voice',       (select jsonb_agg(to_jsonb(x)) from public.voice_explanations x where x.student_id = s.student_id)
    ));

    delete from public.account_identities where user_id = s.student_id;
    delete from public.student_intake    where user_id = s.student_id;
    delete from auth.users               where id      = s.student_id;  -- everything else cascades

    student_id := s.student_id; provider_uid := s.provider_uid; email := s.email;
    return next;
  end loop;
end;
$$;

revoke all on function public.student_logins()                      from public, anon, authenticated;
revoke all on function public.remove_students(uuid[], uuid, text)   from public, anon, authenticated;
grant execute on function public.student_logins()                    to service_role;
grant execute on function public.remove_students(uuid[], uuid, text) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.remove_students(uuid[], uuid, text)', 'EXECUTE') then
    raise exception 'a browser session could call remove_students directly';
  end if;
  if not has_function_privilege('service_role', 'public.remove_students(uuid[], uuid, text)', 'EXECUTE') then
    raise exception 'service_role cannot call remove_students';
  end if;
  if (select count(*) from public.student_logins()) <> (select count(*) from public.student_profiles p
        join public.user_roles r on r.user_id = p.id and r.role = 'student') then
    raise exception 'student_logins does not list every student';
  end if;
end $$;

commit;
