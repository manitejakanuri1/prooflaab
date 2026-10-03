-- Rollback of 76: put the previous functions image back first (scheduled-job calls the batch function), then:
drop function if exists public.assign_todays_lots_batch(uuid, integer);
notify pgrst, 'reload schema';
