-- Rollback of 79. WARNING: this restores the unsafe state (anyone could write skill_aliases).
-- Use only if 79 broke something, and re-apply a corrected 79 soon after.
begin;
alter table public.skill_aliases disable row level security;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.skill_aliases to anon, authenticated, service_role;
commit;
notify pgrst, 'reload schema';
