-- ROLLBACK 86c (production only; on staging service_role had this grant before 86c, so do not run it there).
-- After this, company-lot cannot set Lots on production.
begin;
revoke execute on function public.student_is_discoverable(uuid) from service_role;
commit;
