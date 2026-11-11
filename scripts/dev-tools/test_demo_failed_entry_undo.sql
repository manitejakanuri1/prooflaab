-- TEST only. Removes the hand-made "Submitted, not passed (5.5/10)" demo entry made on 11 Nov 2026 for the
-- owner's retest (Student 08, Lot "Explain GitHub Workflow to a New Teammate", 6 Nov). Not run yet.
begin;
select set_config('app.system_write', 'on', true);
delete from public.task_submissions
 where task_id = 'a260c2ca-05c8-4454-ba5b-ea89c7b41918' and code like '[TEST demo entry%';
update public.tasks set status = 'pending'
 where id = 'a260c2ca-05c8-4454-ba5b-ea89c7b41918'
   and not exists (select 1 from public.task_submissions where task_id = 'a260c2ca-05c8-4454-ba5b-ea89c7b41918');
commit;
