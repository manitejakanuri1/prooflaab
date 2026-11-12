-- 257 (owner 12 Nov 2026, assigned-work test item 7):
--   1. recruiter_home "open" = sent Lots with no submission yet (was status 'pending' only, so a started Lot was
--      neither open nor submitted and "2 open · 3 submitted" did not add up to the Lots list).
--   2. sponsor_company(tasks): the company name of a company's Lot, readable by the student it was set for
--      (students cannot read the recruiters table), so the card says "Set by Acme" not "Set by a company".
-- Rollback: migration/257-rollback-company-lot-names-counts.sql
begin;
do $$
declare def text := pg_get_functiondef('public.recruiter_home()'::regprocedure);
  a constant text := 'where t.sponsored_by = rid and t.status = ''pending'')';
  b constant text := 'where t.sponsored_by = rid and not exists (select 1 from public.task_submissions ts where ts.task_id = t.id))';
begin
  if position(b in def) = 0 then
    if position(a in def) = 0 then raise exception '257: recruiter_home anchor not found'; end if;
    execute replace(def, a, b);
  end if;
end $$;

create or replace function public.sponsor_company(public.tasks)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select r.company from public.recruiters r
   where r.id = $1.sponsored_by
     and ($1.student_id in (select id from public.student_profiles where user_id = (select auth.uid()))
          or coalesce(public.is_admin(), false));
$f$;
revoke all on function public.sponsor_company(public.tasks) from public, anon;
grant execute on function public.sponsor_company(public.tasks) to authenticated, service_role;

do $$
begin
  if position('not exists (select 1 from public.task_submissions ts where ts.task_id = t.id)' in pg_get_functiondef('public.recruiter_home()'::regprocedure)) = 0 then
    raise exception '257 self-check: recruiter_home';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
