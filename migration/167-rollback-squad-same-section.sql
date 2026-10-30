-- Rollback of 167: drop the one-section trigger and its function.
begin;
drop trigger if exists squad_members_same_section on public.squad_members;
drop function if exists public.squad_section_guard();
commit;
