-- 128: a student can see how their onboarding coding score was made, per question.
--
-- WHY. The coding round shows one number (e.g. 38). Tested on staging 22 Oct 2026: a student who
-- solved question 1 fully and skipped question 2 saw only "38" and thought the grader was wrong.
-- coding_results holds the per-question counts, but it also holds the hidden tests' input and
-- expected output, so migration 50 made it server-only. That stays.
--
-- NOW. my_coding_breakdown(_assessment_id) returns, for the caller's OWN assessment only, one row
-- per coding question in the order it was asked: question number, tests passed, tests counted,
-- skipped. Never a test's input, expected output or the question text. An admin may read any.
-- The counts are the same ones the coding score is computed from (resume-code-execute).
--
-- Rollback: migration/128-rollback-my-coding-breakdown.sql
begin;

create or replace function public.my_coding_breakdown(_assessment_id uuid)
returns table (question_no int, passed int, counted int, skipped boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select q.ord::int,
         coalesce((a.coding_results -> (q.item ->> 'id') ->> 'pass_count')::int, 0),
         coalesce((a.coding_results -> (q.item ->> 'id') ->> 'total')::int, 0),
         coalesce((a.coding_results -> (q.item ->> 'id') ->> 'skipped')::boolean, false)
    from public.resume_assessments a
    cross join lateral jsonb_array_elements(coalesce(a.coding_questions, '[]'::jsonb))
         with ordinality as q(item, ord)
   where a.id = _assessment_id
     and (a.student_id = (select auth.uid()) or public.is_admin())
     and a.coding_results ? (q.item ->> 'id')
   order by q.ord;
$function$;

revoke all on function public.my_coding_breakdown(uuid) from public, anon;
grant execute on function public.my_coding_breakdown(uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.my_coding_breakdown(uuid)', 'EXECUTE') then
    raise exception 'anon can call my_coding_breakdown';
  end if;
  if not has_function_privilege('authenticated', 'public.my_coding_breakdown(uuid)', 'EXECUTE') then
    raise exception 'students cannot call my_coding_breakdown';
  end if;
  -- Migration 50 must still hold: the raw hidden tests stay server-only.
  if has_column_privilege('authenticated', 'public.resume_assessments', 'coding_results', 'SELECT') then
    raise exception 'coding_results became readable by students';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
