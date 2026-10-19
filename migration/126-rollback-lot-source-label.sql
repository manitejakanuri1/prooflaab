-- Rollback of 126: unnamed sources are labelled 'A real job posting' again.
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
           case when t.source_jd is not null then 'A real job posting' end),
         t.lot_selection->>'why', t.lot_selection->>'focus_skill',
         (select c.skills from public.lot_candidates c where c.id = t.lot_candidate_id)
    from public.tasks t
    left join public.recruiters r on r.id = t.sponsored_by
   where t.student_id = auth.uid() and t.lot_date = current_date
   limit 1;
$function$;
commit;
notify pgrst, 'reload schema';
