-- 62: a student import record is written all-or-nothing (F19).
-- create-student-users wrote the role, the profile and the contact row as three separate
-- calls and ignored a failed role write, so a failure in the middle left a login with a
-- role and no profile, or a profile with no role. import_student_record() does the three
-- writes in one transaction and is safe to run again for the same account (a re-import
-- converges instead of duplicating).
begin;

create or replace function public.import_student_record(
  _user_id uuid, _college_id uuid, _email text, _full_name text,
  _branch text default '', _year_of_study text default '',
  _preferred_skills text[] default '{}', _key_interests text[] default '{}',
  _career_goals text default '', _roll_number text default null,
  _batch text default null, _phone text default null,
  _existing_profile_id uuid default null)
returns uuid
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare pid uuid; existing_role text;
begin
  if _user_id is null or _college_id is null
     or coalesce(trim(_email), '') = '' or coalesce(trim(_full_name), '') = '' then
    raise exception 'import_student_record: user, college, email and name are required';
  end if;
  if not exists (select 1 from public.colleges c where c.id = _college_id) then
    raise exception 'import_student_record: no such college';
  end if;

  select r.role::text into existing_role from public.user_roles r where r.user_id = _user_id;
  if existing_role is not null and existing_role <> 'student' then
    raise exception 'import_student_record: this account already has the role %', existing_role;
  end if;
  insert into public.user_roles (user_id, role, has_completed_wizard)
  values (_user_id, 'student', true)
  on conflict (user_id) do nothing;

  if _existing_profile_id is not null then
    -- A profile that lost its login is re-attached to the new one.
    update public.student_profiles
       set user_id = _user_id, full_name = _full_name, branch = coalesce(_branch, ''),
           year_of_study = coalesce(_year_of_study, ''), preferred_skills = coalesce(_preferred_skills, '{}'),
           key_interests = coalesce(_key_interests, '{}'), career_goals = coalesce(_career_goals, ''),
           status = 'active', college_id = _college_id, source = 'College',
           roll_number = _roll_number, batch = _batch,
           onboarding_status = 'invited', invited_at = now()
     where id = _existing_profile_id
    returning id into pid;
    if pid is null then raise exception 'import_student_record: that profile no longer exists'; end if;
  else
    insert into public.student_profiles (
      user_id, full_name, branch, year_of_study, preferred_skills, key_interests, career_goals,
      total_xp, status, college_id, source, roll_number, batch, onboarding_status, invited_at)
    values (
      _user_id, _full_name, coalesce(_branch, ''), coalesce(_year_of_study, ''),
      coalesce(_preferred_skills, '{}'), coalesce(_key_interests, '{}'), coalesce(_career_goals, ''),
      0, 'active', _college_id, 'College', _roll_number, _batch, 'invited', now())
    on conflict (user_id) do update
      set full_name = excluded.full_name, branch = excluded.branch, year_of_study = excluded.year_of_study,
          college_id = excluded.college_id, roll_number = excluded.roll_number, batch = excluded.batch
    returning id into pid;
  end if;

  insert into public.student_contact (student_id, email, phone)
  values (pid, lower(trim(_email)), nullif(trim(coalesce(_phone, '')), ''))
  on conflict (student_id) do update
    set email = excluded.email, phone = coalesce(excluded.phone, public.student_contact.phone);

  return pid;
end $function$;

revoke all on function public.import_student_record(uuid, uuid, text, text, text, text, text[], text[], text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.import_student_record(uuid, uuid, text, text, text, text, text[], text[], text, text, text, text, uuid)
  to service_role;

do $$
declare sig text := 'public.import_student_record(uuid, uuid, text, text, text, text, text[], text[], text, text, text, text, uuid)';
begin
  if has_function_privilege('authenticated', sig, 'execute') or has_function_privilege('anon', sig, 'execute') then
    raise exception '62 self-check: import_student_record is callable from a browser';
  end if;
  if not has_function_privilege('service_role', sig, 'execute') then
    raise exception '62 self-check: the server cannot call import_student_record';
  end if;
  -- A bad college must fail before anything is written.
  begin
    perform public.import_student_record(gen_random_uuid(), gen_random_uuid(), 'x@test.invalid', 'X');
    raise exception '62 self-check: an unknown college was accepted';
  exception when others then
    if sqlerrm not like '%no such college%' then raise; end if;
  end;
end $$;

commit;

notify pgrst, 'reload schema';
