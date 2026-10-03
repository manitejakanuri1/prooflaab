-- Rollback of 60: removes my_squad_members(). The Squad page then shows "—" for teammates again.
drop function if exists public.my_squad_members();
