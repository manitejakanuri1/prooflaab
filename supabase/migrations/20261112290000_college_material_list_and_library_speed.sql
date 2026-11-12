-- 290 (owner E2E 12 Nov 2026, college items C3 and C4):
--  C4) Admin Work > Content library looked blank: admin_content_library counts tasks per page with
--      (select count(*) from tasks where source_content_id = sc.id), and tasks had no index on that column,
--      so every page did a full table scan (TEST: 167 pages x full scan = 7.9 s of grey skeleton). Index added.
--  C3) A college could not see the interview material it submitted. college_my_source_material() lists the
--      signed-in college's own submissions with their status. Admin already sees all of them in Content library.
-- Rollback: migration/290-rollback-college-material-list-and-library-speed.sql
begin;

create index if not exists tasks_source_content_id_idx on public.tasks (source_content_id);

create or replace function public.college_my_source_material()
returns table (id uuid, title text, submitted_at timestamptz, lot_written boolean, times_given bigint, hidden boolean)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select sc.id, sc.title, sc.fetched_at,
         exists (select 1 from public.lot_templates t where t.source_content_id = sc.id),
         (select count(*) from public.tasks k where k.source_content_id = sc.id),
         sc.hidden_at is not null
    from public.source_content sc
   where sc.submitted_by_college_id = public.my_college_id()
     and public.my_college_id() is not null
   order by sc.fetched_at desc
   limit 200;
$$;
revoke all on function public.college_my_source_material() from public, anon;
grant execute on function public.college_my_source_material() to authenticated;

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'tasks_source_content_id_idx') then
    raise exception '290: index missing';
  end if;
  if to_regprocedure('public.college_my_source_material()') is null then
    raise exception '290: function missing';
  end if;
  -- Not signed in as a college: nothing comes back (never another college's rows).
  if exists (select 1 from public.college_my_source_material()) then
    raise exception '290: rows returned without a college session';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
