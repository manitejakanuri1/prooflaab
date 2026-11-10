-- Rollback of 217: demo students hidden from every company again (as in 173).
begin;
create or replace function public.student_is_discoverable(_student_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1
      from public.student_profiles p
      join public.student_portfolios f on f.student_id = p.id
     where p.id = _student_id
       and p.status = 'active'
       and f.is_public = true)
     and not public.is_demo_student(_student_id);   -- 173 (MF-056)
$fn$;
drop function if exists public.viewer_is_demo();
commit;
notify pgrst, 'reload schema';
