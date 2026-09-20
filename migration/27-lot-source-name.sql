-- The Lot card shows where the question came from: the source's NAME only
-- ("PrepInsta Company Interview Experiences"), never a link, so students can see
-- it is a real question and stay inside the app (owner's request, 20 Sep 2026).
--
-- my_todays_lot() gains one column, source_name. Same body otherwise (stage75).
-- The old website ignores the extra column, so the database can be changed first.
begin;

drop function if exists public.my_todays_lot();
create or replace function public.my_todays_lot()
returns table(
  id uuid, lot_number integer, title text, description text, code_sample text,
  source_jd text, difficulty text, estimate_minutes integer, lot_category text,
  status text, due_date timestamp with time zone, sponsored_by_company text,
  sandbox_config_id uuid, rubric_config_id uuid, source_name text
)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select t.id, t.lot_number, t.title, t.description, t.code_sample, t.source_jd,
         t.difficulty, t.estimate_minutes, t.lot_category, t.status, t.due_date,
         r.company, t.sandbox_config_id, t.rubric_config_id,
         coalesce(
           (select g.name from public.source_content sc
              join public.source_registry g on g.id = sc.source_id
             where sc.id = t.source_content_id),
           case when t.source_jd is not null then 'A real job posting' end)
    from public.tasks t
    left join public.recruiters r on r.id = t.sponsored_by
   where t.student_id = auth.uid() and t.lot_date = current_date
   limit 1;
$function$;

revoke all on function public.my_todays_lot() from public, anon;
grant execute on function public.my_todays_lot() to authenticated, service_role;

do $$
begin
  if not exists (select 1 from information_schema.routines r
                  where r.routine_schema = 'public' and r.routine_name = 'my_todays_lot') then
    raise exception 'my_todays_lot missing';
  end if;
  if not has_function_privilege('authenticated', 'public.my_todays_lot()', 'EXECUTE') then
    raise exception 'students cannot call my_todays_lot';
  end if;
  if has_function_privilege('anon', 'public.my_todays_lot()', 'EXECUTE') then
    raise exception 'anon can call my_todays_lot';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
