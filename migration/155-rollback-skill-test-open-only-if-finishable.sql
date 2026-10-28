-- ROLLBACK for 155: resume_test_open_part goes back to the 154 body (expired tests count again).
begin;

create or replace function public.resume_test_open_part(_assessment_id uuid)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when ra.status = 'pending'
     and jsonb_array_length(coalesce(ra.questions, '[]')) > 0
     and exists (select 1 from resume_question_clock c where c.assessment_id = ra.id)
      then 'quiz'
    when ra.status <> 'pending'
     and exists (select 1 from jsonb_array_elements(coalesce(ra.coding_questions, '[]')) q
                   join resume_question_clock c on c.assessment_id = ra.id and c.question_id = q ->> 'id')
     and exists (select 1 from jsonb_array_elements(coalesce(ra.coding_questions, '[]')) q
                  where not (coalesce(ra.coding_results, '{}') ? (q ->> 'id')))
      then 'coding'
  end
  from resume_assessments ra
  where ra.id = _assessment_id
$$;

commit;
