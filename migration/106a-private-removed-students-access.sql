-- 106a: restore server-only ACL on removed_students before 107.
-- Staging 107 stopped because anon/authenticated had effective SELECT.
-- The table holds sensitive removed-student snapshots. Original migration 17
-- requires server-only access. Do not change UI, rows, or user accounts.
-- Precondition: 106 fixed the defunct proof_uploads reader.
begin;

do $$
begin
  if to_regclass('public.removed_students') is null then
    raise exception '106a: removed_students table missing';
  end if;
  if not exists (select 1 from public.schema_migrations
                 where version = '106-remove-students-restore-submissions-backup') then
    raise exception '106a: verified migration 106 must be applied first';
  end if;
  if exists (select 1 from public.schema_migrations
             where version = '107-consent-guard-and-login-tracking') then
    raise exception '106a: 107 already recorded; investigate schema drift instead';
  end if;
end $$;

revoke all privileges on table public.removed_students from public, anon, authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.removed_students', 'select')
     or has_table_privilege('authenticated', 'public.removed_students', 'select')
     or has_table_privilege('anon', 'public.removed_students', 'delete')
     or has_table_privilege('authenticated', 'public.removed_students', 'delete') then
    raise exception '106a: browser role retains table privileges; transaction rolled back';
  end if;
  if not has_table_privilege('service_role', 'public.removed_students', 'select')
     or not has_table_privilege('service_role', 'public.removed_students', 'insert') then
    raise exception '106a: removal service lost required privileges; transaction rolled back';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
