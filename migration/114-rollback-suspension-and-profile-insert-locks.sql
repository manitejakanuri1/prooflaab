-- Rollback for 114: keep_approval_closed back to 84's body and student_profiles_own_insert back to stage 1's,
-- both verbatim. NOT APPLIED ANYWHERE. Running this re-opens both gaps 114 closes (owner self-unsuspend,
-- self-made student profile in any college). No row is changed.
begin;

create or replace function public.keep_approval_closed()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  raw  text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role text;
begin
  if raw is null then
    return new;                                   -- direct database access (migrations, operators)
  end if;
  begin
    jwt_role := raw::jsonb ->> 'role';
  exception when others then
    jwt_role := null;                               -- unreadable token: treat as an ordinary caller
  end;
  if jwt_role = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_table_name = 'recruiters' then
    if tg_op = 'INSERT' then
      new.verified := false; new.verified_at := null; new.verified_by := null;
    else
      new.verified := old.verified; new.verified_at := old.verified_at; new.verified_by := old.verified_by;
    end if;
  else                                            -- colleges, startups
    if tg_op = 'INSERT' then
      new.verification_status := 'pending';
    else
      new.verification_status := old.verification_status;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.keep_approval_closed() from public, anon, authenticated;

drop policy if exists student_profiles_own_insert on public.student_profiles;
create policy student_profiles_own_insert on public.student_profiles
  for insert to authenticated with check (id = (select auth.uid()) or public.is_admin());

commit;
