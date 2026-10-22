-- Rollback of 128: removes my_coding_breakdown. Nothing else was changed by 128.
begin;
drop function if exists public.my_coding_breakdown(uuid);
commit;
notify pgrst, 'reload schema';
