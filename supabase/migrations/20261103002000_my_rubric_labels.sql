-- 70: the Build-log can show a written result as "criterion name  points/max" (results UI).
-- A submission stores {criterion_id, points, evidence}; the criterion's NAME and MAXIMUM live
-- in task_rubric_config, which a student must not read (it also holds the reference answer).
-- my_rubric_labels() returns only id, name and max_points, and only for rubrics of tasks the
-- caller has already submitted. No scoring changes: it labels numbers that already exist.
begin;

create or replace function public.my_rubric_labels()
returns table (task_id uuid, criterion_id text, name text, max_points integer, pass_threshold integer)
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select distinct on (s.task_id, c ->> 'id')
         s.task_id, c ->> 'id', c ->> 'name', (c ->> 'max_points')::integer, r.pass_threshold
    from public.task_submissions s
    join public.task_rubric_config r on r.id = s.rubric_config_id
   cross join lateral jsonb_array_elements(r.criteria) c
   where s.student_id = (select auth.uid());
$function$;

revoke all on function public.my_rubric_labels() from public, anon;
grant execute on function public.my_rubric_labels() to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.my_rubric_labels()', 'execute') then
    raise exception '70 self-check: anon can read rubric labels';
  end if;
  if pg_get_functiondef('public.my_rubric_labels()'::regprocedure) ~ 'reference_answer|prompt_text|description' then
    raise exception '70 self-check: my_rubric_labels exposes more than labels';
  end if;
  if exists (select 1 from public.my_rubric_labels()) then
    raise exception '70 self-check: labels returned without a caller';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
