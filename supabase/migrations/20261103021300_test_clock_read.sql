-- 213 (owner 2 Nov 2026, B5): TEST ONLY. NEVER apply to REAL. Signed-in users may read the TEST clock
-- (test_now, from 209) so the student Daily Card date follows it. Read-only; it returns a time.
-- REMOVE with 197, 208 and 209 after Grok's testing: migration/213-rollback-test-clock-read.sql (run it before 209's rollback).
begin;
do $$ begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception '213 is TEST-only';
  end if;
end $$;
grant execute on function public.test_now() to authenticated;
do $$ begin
  if not has_function_privilege('authenticated', 'public.test_now()', 'execute') then
    raise exception '213 self-check: authenticated cannot read test_now';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
