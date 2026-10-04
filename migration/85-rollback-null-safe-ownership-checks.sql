-- UNSAFE EMERGENCY ROLLBACK of 85.
-- This RESTORES A PROVEN HOLE: an anonymous caller could again answer any student's shortlist and
-- append answers to any open mock interview. Use only if 85 broke a legitimate flow.
begin;
create or replace function public.respond_to_shortlist(_shortlist_id uuid, _accept boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare me uuid := (select auth.uid()); row_ record;
begin
  select * into row_ from public.recruiter_shortlists where id = _shortlist_id;
  if row_ is null then raise exception 'no such shortlist'; end if;
  if row_.student_id <> me then raise exception 'that is not yours to answer'; end if;
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
  select * into row_ from public.mock_interviews where id = _interview_id;
  if row_ is null then raise exception 'no such interview'; end if;
  if row_.student_id <> auth.uid() then raise exception 'not yours'; end if;
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
grant execute on function public.respond_to_shortlist(uuid, boolean) to public;
grant execute on function public.save_mock_interview_answer(uuid, text, text, integer) to public;
commit;
notify pgrst, 'reload schema';
