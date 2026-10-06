-- 86c: the backend role (service_role) may run student_is_discoverable(uuid), as on staging.
--
-- WHY. Found on a restored production copy (Stage 0.4 rehearsal, 6 Oct 2026): production grants it only to
-- prooflab_app and authenticated. The company-lot function calls it with the service-role client; on
-- production it would get "permission denied", read that as "not discoverable" and refuse every company
-- Lot ("Shortlist the student (with a public profile) before setting them a Lot.").
-- EXECUTE for service_role only; no other role's rights change. The backend already reads every table
-- this function reads, so letting it call the function exposes nothing new.
--
-- ORDER. Any time; placed after 86b. Must be applied before the new functions image goes live.
-- STAGING. Already granted there: this changes nothing.
-- Rollback: 86c-rollback-service-role-runs-student-is-discoverable.sql (production only).
begin;

grant execute on function public.student_is_discoverable(uuid) to service_role;

do $$
begin
  if not has_function_privilege('service_role', 'public.student_is_discoverable(uuid)', 'execute') then
    raise exception '86c self-check: service_role cannot run student_is_discoverable';
  end if;
end $$;

commit;
