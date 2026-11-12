-- 390 (polish P3, 12 Nov 2026): the "<company> shortlisted you" notice kept saying "Press Accept or Decline on
--   your home screen" after the student had answered and the buttons were gone. respond_to_shortlist now
--   rewrites that notice to say what the student chose and marks it read. Existing answered notices are fixed too.
--   The notice is found by its title (recruiter_shortlist writes '<company> shortlisted you', migration 198).
-- Rollback: migration/390-rollback-shortlist-notice-answered.sql
begin;

create or replace function public.shortlist_answered_text(_accept boolean) returns text
language sql immutable as $$
  select case when _accept then 'You accepted. They can now see your contact details and get in touch.'
              else 'You declined. The company has been told.' end
$$;
revoke all on function public.shortlist_answered_text(boolean) from public, anon, authenticated;

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
  -- 390: the notice that asked for an answer now says the answer.
  update public.notifications n
     set message = public.shortlist_answered_text(_accept), is_read = true, read_at = coalesce(n.read_at, now())
   where n.user_id = me and n.type = 'shortlisted'
     and n.title = (select r.company from public.recruiters r where r.id = row_.recruiter_id) || ' shortlisted you';
  return jsonb_build_object('ok', true, 'accepted', _accept);
end $fn$;
revoke all on function public.respond_to_shortlist(uuid, boolean) from public, anon;
grant execute on function public.respond_to_shortlist(uuid, boolean) to authenticated, service_role;

-- Notices already answered before this change.
update public.notifications n
   set message = public.shortlist_answered_text(s.student_response = 'accepted'), is_read = true,
       read_at = coalesce(n.read_at, now())
  from public.recruiter_shortlists s join public.recruiters r on r.id = s.recruiter_id
 where n.type = 'shortlisted' and n.user_id = s.student_id and n.title = r.company || ' shortlisted you'
   and s.student_response in ('accepted', 'declined');

do $$ begin
  if exists (select 1 from public.notifications n
               join public.recruiter_shortlists s on s.student_id = n.user_id
               join public.recruiters r on r.id = s.recruiter_id and n.title = r.company || ' shortlisted you'
              where n.type = 'shortlisted' and s.student_response is not null
                and n.message ilike '%accept or decline%') then
    raise exception '390 self-check: an answered shortlist notice still asks for an answer';
  end if;
  if position('shortlist_answered_text' in pg_get_functiondef('public.respond_to_shortlist(uuid,boolean)'::regprocedure)) = 0 then
    raise exception '390 self-check: respond_to_shortlist does not update the notice';
  end if;
  if has_function_privilege('anon', 'public.respond_to_shortlist(uuid,boolean)', 'execute') then
    raise exception '390 self-check: anon can call respond_to_shortlist';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
