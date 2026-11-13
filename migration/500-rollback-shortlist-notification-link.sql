-- 500 rollback: restore recruiter_shortlist writing bare /student/dashboard
begin;

create or replace function public.recruiter_shortlist(_student_id uuid, _note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare rid uuid := public.my_recruiter_id(); firm text;
begin
  if rid is null or not public.is_verified_recruiter() then
    raise exception 'Your recruiter account is awaiting verification.';
  end if;
  if not public.student_is_discoverable(_student_id) then
    raise exception 'No candidate found.';
  end if;

  select r.company into firm from public.recruiters r where r.id = rid;

  insert into public.recruiter_shortlists (recruiter_id, student_id, note)
  values (rid, _student_id, nullif(trim(coalesce(_note, '')), ''))
  on conflict (recruiter_id, student_id) do update set note = excluded.note;

  insert into public.notifications
    (user_id, audience, source, type, title, message, link)
  values (_student_id, 'student', 'system', 'shortlisted',
          firm || ' shortlisted you',
          'They have seen your work and want to talk. Sharing your contact details is your choice. ' ||
          'Press Accept or Decline on your home screen.',
          '/student/dashboard');

  return jsonb_build_object('ok', true, 'company', firm);
end $fn$;

revoke all on function public.recruiter_shortlist(uuid, text) from public, anon;
grant execute on function public.recruiter_shortlist(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
