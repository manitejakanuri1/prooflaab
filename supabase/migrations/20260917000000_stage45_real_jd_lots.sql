-- ============================================================================
-- Stage 42 — real job descriptions feed the Daily Lot engine.
--
-- lot-writer used to have the AI invent a flavor phrase for "what job this
-- work resembles" (source_jd). It now looks for a real, admin- or
-- college-posted job_opportunities row whose role or description mentions the
-- topic's skill, and quotes that instead. Invented phrasing stays as the
-- fallback for topics with no matching real posting yet — nothing breaks
-- while the pool is empty.
--
-- Two gaps blocked colleges (and, in practice, admins too) from ever filling
-- that pool:
--
-- 1. job_opportunities_post only allowed the 'startup' role. An admin using
--    Manage Jobs, or a college posting one, was rejected by RLS before the
--    request reached the table at all.
-- 2. The 'source' check constraint only allowed 'admin' | 'startup' | 'crawler'
--    — a college's own insert would have failed the CHECK even past RLS.
-- ============================================================================

drop policy job_opportunities_post on public.job_opportunities;

create policy job_opportunities_post on public.job_opportunities
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      public.is_admin()
      or exists (
        select 1 from public.user_roles r
         where r.user_id = (select auth.uid())
           and r.role in ('startup'::app_role, 'college_admin'::app_role)
      )
    )
  );

alter table public.job_opportunities drop constraint job_opportunities_source_check;
alter table public.job_opportunities
  add constraint job_opportunities_source_check
  check (source in ('admin', 'startup', 'college', 'crawler'));
