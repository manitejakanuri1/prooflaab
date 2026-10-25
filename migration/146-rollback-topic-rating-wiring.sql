-- Rollback of 146: stops recording graded Lots and removes the student read. Ratings already recorded stay
-- (they are real attempts); only the trigger, the functions and the dedupe log go. topic_priorities is
-- handed back to signed-in students exactly as migration 55 had it.
begin;
drop trigger if exists task_submissions_topic_rating on public.task_submissions;
drop function if exists public.task_submissions_topic_rating();
drop function if exists public.record_lot_topic_rating(uuid);
drop function if exists public.my_topic_ratings();
drop table if exists public.topic_rating_log;
grant execute on function public.topic_priorities(uuid, integer) to authenticated;
commit;
notify pgrst, 'reload schema';
