-- Rollback of 390: respond_to_shortlist as in migration 85 (does not touch the notice).
-- Notice texts already rewritten by 390 are left as they are (they are correct for answered shortlists).
begin;
create or replace function public.respond_to_shortlist(_shortlist_id uuid, _accept boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare me uuid := (select auth.uid()); row_ record;
begin
  if me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into row_ from public.recruiter_shortlists where id = _shortlist_id;
  if row_ is null then raise exception 'no such shortlist'; end if;
  if row_.student_id is distinct from me then raise exception 'that is not yours to answer'; end if;
  update public.recruiter_shortlists
     set student_response = case when _accept then 'accepted' else 'declined' end,
         responded_at = now(),
         stage = case when _accept then 'contacted' else stage end
   where id = _shortlist_id;
  return jsonb_build_object('ok', true, 'accepted', _accept);
end $fn$;
revoke all on function public.respond_to_shortlist(uuid, boolean) from public, anon;
grant execute on function public.respond_to_shortlist(uuid, boolean) to authenticated, service_role;
drop function if exists public.shortlist_answered_text(boolean);
notify pgrst, 'reload schema';
commit;
