-- 126: a Lot's "Source:" line names the page it was really written from.
--
-- my_todays_lot labels the source with the source registry's name, and when that name is empty
-- it fell back to 'A real job posting' for any Lot with source text. On staging, 19 Oct 2026, two
-- Daily Lots written from the official Python tutorial ("3. An Informal Introduction to Python",
-- "4. More Control Flow Tools", docs.python.org) both read "Source: A real job posting".
-- The fallback is now the page's own title and site; the job-posting label stays for a Lot written
-- from a job description with no page behind it.
begin;

CREATE OR REPLACE FUNCTION public.my_todays_lot()
 RETURNS TABLE(id uuid, lot_number integer, title text, description text, code_sample text, source_jd text, difficulty text, estimate_minutes integer, lot_category text, status text, due_date timestamp with time zone, sponsored_by_company text, sandbox_config_id uuid, rubric_config_id uuid, source_name text, why_selected text, focus_skill text, lot_skills text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select t.id, t.lot_number, t.title, t.description, t.code_sample, t.source_jd,
         t.difficulty, t.estimate_minutes, t.lot_category, t.status, t.due_date,
         r.company, t.sandbox_config_id, t.rubric_config_id,
         coalesce(
           (select g.name from public.source_content sc
              join public.source_registry g on g.id = sc.source_id
             where sc.id = t.source_content_id),
           -- 126: a page whose source has no name is named by its own title and site, e.g.
           -- "4. More Control Flow Tools (docs.python.org)". "A real job posting" is kept for a Lot
           -- written from a job description with no page behind it.
           (select concat_ws(' ', nullif(sc.title, ''), '(' || substring(sc.url from '^https?://([^/]+)') || ')')
              from public.source_content sc where sc.id = t.source_content_id),
           case when t.source_jd is not null then 'A real job posting' end),
         t.lot_selection->>'why', t.lot_selection->>'focus_skill',
         (select c.skills from public.lot_candidates c where c.id = t.lot_candidate_id)
    from public.tasks t
    left join public.recruiters r on r.id = t.sponsored_by
   where t.student_id = auth.uid() and t.lot_date = current_date
   limit 1;
$function$;

-- Self-check: no Lot that comes from a page is labelled a job posting by the fallback any more.
do $$
declare n int;
begin
  select count(*) into n from public.tasks t
    join public.source_content sc on sc.id = t.source_content_id
    left join public.source_registry g on g.id = sc.source_id
   where t.lot_date is not null and g.name is null and nullif(sc.title, '') is null and sc.url is null;
  raise notice '126 self-check: % page-backed Lots still have neither a source name nor a title or address', n;
end $$;

commit;
notify pgrst, 'reload schema';
