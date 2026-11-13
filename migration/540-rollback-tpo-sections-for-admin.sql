-- Rollback 540: remove the admin-aware overload; tpo_sections() (no arguments) stays as it was.
drop function if exists public.tpo_sections(uuid);
notify pgrst, 'reload schema';
