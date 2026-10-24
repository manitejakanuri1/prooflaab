-- Rollback of 143: removes squad swaps. Swaps already done stay done (memberships and points are not moved back);
-- only the codes, the request history and the functions go.
begin;
drop function if exists public.admin_squads(uuid);
drop function if exists public.squad_swaps_list(uuid);
drop function if exists public.answer_squad_swap(uuid, boolean, text);
drop function if exists public.cancel_squad_swap(uuid);
drop function if exists public.request_squad_swap(text, uuid);
drop function if exists public.squad_swap_lookup(text);
drop function if exists public.my_squad_swap();
drop function if exists public.squad_swap_used(uuid, uuid);
drop function if exists public.squad_swap_me();
drop function if exists public.squad_swap_closes(uuid);
drop function if exists public.squad_code_for(uuid);
drop table if exists public.squad_swaps;
drop table if exists public.squad_codes;
commit;
notify pgrst, 'reload schema';
