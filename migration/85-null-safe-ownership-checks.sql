-- 85 (D4, staging 5 Oct 2026): two ownership checks that an ANONYMOUS caller slipped past.
--
-- respond_to_shortlist and save_mock_interview_answer checked `row.student_id <> auth.uid()`.
-- For an anonymous caller auth.uid() is NULL, so the comparison is NULL (not true) and the check
-- passed. Proven on staging: an anonymous API call declined a synthetic student's shortlist. (A
-- signed-in student was correctly refused; only "nobody" got through.) Same pattern in
-- save_mock_interview_answer (could append answers to any open mock interview).
-- Fix: refuse when not signed in, compare with IS DISTINCT FROM, and no anonymous EXECUTE.
begin;

create or replace function public.respond_to_shortlist(_shortlist_id uuid, _accept boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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
end $function$;

create or replace function public.save_mock_interview_answer(_interview_id uuid, _storage_path text, _transcript text, _duration_seconds integer)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare row_ record; next_n integer;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into row_ from public.mock_interviews where id = _interview_id;
  if row_ is null then raise exception 'no such interview'; end if;
  if row_.student_id is distinct from auth.uid() then raise exception 'not yours'; end if;
  if row_.status <> 'answering' then raise exception 'this interview is no longer taking answers'; end if;
  next_n := jsonb_array_length(row_.answers);
  if next_n >= jsonb_array_length(row_.questions) then
    raise exception 'all questions already answered';
  end if;
  update public.mock_interviews
     set answers = answers || jsonb_build_array(jsonb_build_object(
           'n', next_n, 'storage_path', _storage_path,
           'transcript', _transcript, 'duration_seconds', _duration_seconds))
   where id = _interview_id;
  return jsonb_build_object('ok', true, 'answered', next_n + 1,
                             'total', jsonb_array_length(row_.questions));
end $function$;

revoke all on function public.respond_to_shortlist(uuid, boolean) from public, anon;
grant execute on function public.respond_to_shortlist(uuid, boolean) to authenticated, service_role;
revoke all on function public.save_mock_interview_answer(uuid, text, text, integer) from public, anon;
grant execute on function public.save_mock_interview_answer(uuid, text, text, integer) to authenticated, service_role;

do $$
declare sl record; got text;
begin
  if has_function_privilege('anon', 'public.respond_to_shortlist(uuid,boolean)', 'execute')
     or has_function_privilege('anon', 'public.save_mock_interview_answer(uuid,text,text,integer)', 'execute') then
    raise exception '85: anonymous can still execute the fixed functions';
  end if;
  -- No ownership check in any security-definer function may compare a row to auth.uid() with <> / !=.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and p.prosrc ~* '(<>|!=)\s*(\(select\s+)?auth\.uid\(\)|auth\.uid\(\)\s*(<>|!=)') then
    raise exception '85: a security-definer function still compares to auth.uid() with <>';
  end if;
  -- Behaviour (rolled back): a caller without a user id cannot answer somebody's shortlist.
  select * into sl from public.recruiter_shortlists limit 1;
  if sl.id is not null then
    begin
      perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
      perform public.respond_to_shortlist(sl.id, false);
      got := 'ALLOWED';
    exception when others then got := sqlerrm;
    end;
    perform set_config('request.jwt.claims', '', true);
    if got = 'ALLOWED' then raise exception '85: a caller without a user id could still answer a shortlist'; end if;
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
