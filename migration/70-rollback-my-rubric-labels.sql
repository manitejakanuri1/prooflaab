-- Rollback of 70: removes my_rubric_labels(). The Build-log then shows criterion ids instead of names.
drop function if exists public.my_rubric_labels();
notify pgrst, 'reload schema';
