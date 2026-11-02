-- Rollback of 213 (TEST only).
begin;
revoke execute on function public.test_now() from authenticated;
notify pgrst, 'reload schema';
commit;
