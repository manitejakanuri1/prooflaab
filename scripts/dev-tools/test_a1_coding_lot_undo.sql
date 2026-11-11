-- TEST only. Undoes retest A1 (11 Nov 2026): Student 19's Lot for 11 Nov was replaced with the new coding Lot
-- "Array Push, Pop, and Includes Check" (page d1991f76). This puts the saved original back from qa_backup.a1_task,
-- but only while the Lot has no tries. The new Lot template itself stays (it is a normal AI-written page Lot). Not run.
begin;
select set_config('app.system_write', 'on', true);
update public.tasks t
   set title = b.title, description = b.description, code_sample = b.code_sample, source_jd = b.source_jd,
       difficulty = b.difficulty, estimate_minutes = b.estimate_minutes, lot_category = b.lot_category,
       source_content_id = b.source_content_id, grading_type = b.grading_type,
       sandbox_config_id = b.sandbox_config_id, rubric_config_id = b.rubric_config_id,
       is_ai_generated = b.is_ai_generated, status = b.status, started_at = b.started_at
  from qa_backup.a1_task b
 where t.id = b.id
   and not exists (select 1 from public.task_submissions s where s.task_id = t.id);
commit;
