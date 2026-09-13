-- A college may correct and retire its own students. Nothing more.
--
-- Today a college can add students by CSV and read everything about them, but
-- cannot fix a misspelled name or mark a student who has left. Every college
-- buying this product will ask for both on the first day.
--
-- What this grants, scoped to students whose college_id is one the caller owns
-- and which is approved:
--
--     correct   full_name, branch, cohort, and contact email / phone
--     retire    status -> 'inactive'   (and back to 'active')
--
-- What it deliberately does not grant:
--
--     delete    a removed student takes their proofs, XP, squad results and the
--               college's own past reports with them. 'inactive' achieves the
--               same visible outcome - all six active-student queries filter on
--               status = 'active' - without destroying the evidence the product
--               is sold on.
--     college_id  stays frozen, so a college cannot move another college's
--               student to itself, nor push its own student elsewhere.
--     total_xp, trust_score, and the rest of the system-owned columns stay
--               frozen exactly as before.
--
-- There is a trap here worth naming. A policy alone would not have worked:
-- protect_columns() freezes status and roll_number for every authenticated
-- caller who is not an admin, so a college would have pressed save, seen no
-- error, and watched the change quietly revert. That silent reversion is worse
-- than a refusal, so the guard is taught about colleges rather than bypassed.

begin;

-- ---------------------------------------------------------------------------
-- 1. does this caller own the student's college?
-- ---------------------------------------------------------------------------

create or replace function public.college_owns_student(_college_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select _college_id is not null
     and exists (
       select 1 from public.colleges
        where id = _college_id
          and user_id = (select auth.uid())
          and verification_status = 'approved'
     );
$$;

comment on function public.college_owns_student(uuid) is
  'True when the current caller is the approved college that owns this college_id. '
  'Mirrors my_approved_college_ids(), including the approval requirement.';

revoke all on function public.college_owns_student(uuid) from public;
grant execute on function public.college_owns_student(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. teach the column guard about colleges
-- ---------------------------------------------------------------------------

/**
 * Same behaviour as protect_columns(), with one exception: the college that owns
 * a student may change that student's status and roll_number.
 *
 * Only student_profiles uses this. The nine other tables carrying
 * protect_columns() are untouched.
 */
create or replace function public.protect_student_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raw      text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role text;
  clamp    boolean := true;
  cols     text[] := tg_argv::text[];
  col      text;
  newj     jsonb;
  oldj     jsonb;
begin
  -- A system function is doing this on the student's behalf.
  if coalesce(current_setting('app.system_write', true), '') = 'on' then
    return new;
  end if;

  if raw is null then
    return new;                        -- direct database access
  end if;

  begin
    jwt_role := raw::jsonb ->> 'role';
    if jwt_role is distinct from 'authenticated' then
      clamp := false;                  -- service role: an edge function
    elsif public.is_admin() then
      clamp := false;
    end if;
  exception when others then
    clamp := true;                     -- unreadable token: fail closed
  end;

  if not clamp then
    return new;
  end if;

  -- The college that owns this student may set these two, and only these two.
  -- old.college_id is used, not new.college_id: a caller must not be able to
  -- unlock the row by claiming the student is theirs in the same statement.
  if public.college_owns_student(old.college_id) then
    if new.status is distinct from old.status
       and new.status not in ('active', 'inactive') then
      raise exception 'a college may only set a student active or inactive, not %', new.status;
    end if;
    cols := array_remove(array_remove(cols, 'status'), 'roll_number');
  end if;

  newj := to_jsonb(new);
  oldj := to_jsonb(old);
  foreach col in array cols loop
    newj := jsonb_set(newj, array[col], oldj -> col);
  end loop;
  return jsonb_populate_record(new, newj);
end $$;

-- Swap the trigger over, keeping the same frozen-column list it had.
drop trigger if exists protect_student_profiles on public.student_profiles;
create trigger protect_student_profiles
  before update on public.student_profiles
  for each row execute function public.protect_student_profile_columns(
    'total_xp', 'trust_score', 'college_id', 'status', 'source',
    'profile_completed', 'onboarding_status', 'calibration_completed',
    'first_task_completed', 'invited_at', 'onboarded_at', 'roll_number'
  );

-- ---------------------------------------------------------------------------
-- 3. let the college's edit reach the row at all
-- ---------------------------------------------------------------------------

drop policy if exists student_profiles_college_update on public.student_profiles;
create policy student_profiles_college_update
  on public.student_profiles
  for update
  to authenticated
  using (public.college_owns_student(college_id))
  -- The row must still belong to this college afterwards. college_id is frozen
  -- by the trigger as well; this is the same rule said twice, on purpose.
  with check (public.college_owns_student(college_id));

drop policy if exists student_contact_college_update on public.student_contact;
create policy student_contact_college_update
  on public.student_contact
  for update
  to authenticated
  using (
    exists (
      select 1 from public.student_profiles s
       where s.id = student_contact.student_id
         and public.college_owns_student(s.college_id)
    )
  )
  with check (
    exists (
      select 1 from public.student_profiles s
       where s.id = student_contact.student_id
         and public.college_owns_student(s.college_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 4. prove it, including the part that must still be refused
-- ---------------------------------------------------------------------------

do $$
declare
  tpo_a uuid := 'aaaa1111-0000-4000-8000-000000000001';
  tpo_b uuid := 'bbbb1111-0000-4000-8000-000000000001';
  stu_a uuid := 'cccc1111-0000-4000-8000-000000000001';
  col_a uuid := 'eeee1111-0000-4000-8000-00000000000a';
  col_b uuid := 'eeee1111-0000-4000-8000-00000000000b';
  got   text;
  xp    integer;
begin
  insert into auth.users (id, email) values
    (tpo_a, 'selftest.tpo.a@test.invalid'),
    (tpo_b, 'selftest.tpo.b@test.invalid'),
    (stu_a, 'selftest.student.a@test.invalid');
  insert into public.user_roles (user_id, role) values
    (tpo_a, 'college_admin'), (tpo_b, 'college_admin'), (stu_a, 'student');
  insert into public.colleges (id, user_id, name, email, verification_status) values
    (col_a, tpo_a, 'Selftest Alpha', 'sa@test.invalid', 'approved'),
    (col_b, tpo_b, 'Selftest Beta',  'sb@test.invalid', 'approved');
  insert into public.student_profiles (id, user_id, full_name, college_id, status, total_xp)
    values (stu_a, stu_a, 'Wrong Name', col_a, 'active', 50);

  -- Act as a signed-in college, not as the table owner. An owner bypasses
  -- row-level security entirely, so a check that skips this proves nothing -
  -- it is how the first version of this very block wrongly reported a leak.
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', tpo_a), true);
  execute 'set local role authenticated';

  update public.student_profiles
     set full_name = 'Correct Name', status = 'inactive', total_xp = 999999
   where id = stu_a;

  select full_name, status, total_xp into got, got, xp from public.student_profiles where id = stu_a;
  select status, total_xp into got, xp from public.student_profiles where id = stu_a;
  if got <> 'inactive' then
    raise exception 'the owning college could not retire its student (status=%)', got;
  end if;
  if xp <> 50 then
    raise exception 'the college changed total_xp to %; system columns must stay frozen', xp;
  end if;
  select full_name into got from public.student_profiles where id = stu_a;
  if got <> 'Correct Name' then
    raise exception 'the owning college could not correct the name (name=%)', got;
  end if;

  -- A status the college is not allowed to set.
  begin
    update public.student_profiles set status = 'approved' where id = stu_a;
    raise exception 'a college was allowed to set an arbitrary status';
  exception when others then
    if sqlerrm not like '%active or inactive%' then raise; end if;
  end;

  -- Beta tries to touch Alpha's student. The update matches no row, because
  -- the policy hides it - so it succeeds quietly and changes nothing, which is
  -- the correct outcome and the reason the value is checked afterwards.
  execute 'reset role';
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', tpo_b), true);
  execute 'set local role authenticated';

  update public.student_profiles set full_name = 'Stolen' where id = stu_a;

  execute 'reset role';
  select full_name into got from public.student_profiles where id = stu_a;
  if got <> 'Correct Name' then
    raise exception 'a rival college changed another college''s student (name is now %)', got;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'college can correct and retire its own students; rival refused; xp frozen';

  delete from public.student_profiles where id = stu_a;
  delete from public.colleges where id in (col_a, col_b);
  delete from public.user_roles where user_id in (tpo_a, tpo_b, stu_a);
  delete from auth.users where id in (tpo_a, tpo_b, stu_a);
end $$;

commit;
