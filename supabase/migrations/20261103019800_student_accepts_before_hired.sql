-- 198 (MF-047, owner 31 Oct 2026): a company can move a student to interviewing / offered / hired only after
--   the student has pressed Accept. One trigger on recruiter_shortlists covers both ways in (record_outcome and
--   the company's direct row update allowed by RLS). Only the student (or an admin) may set student_response.
--   If the student declines, a stage past "contacted" drops back to "saved", so a decline never counts as a hire.
--   The "shortlisted" notice now points at the new Accept / Decline card on the student's home screen.
--   Existing rows are not changed (the trigger only checks new changes).
-- Rollback: migration/198-rollback-student-accepts-before-hired.sql
begin;

create or replace function public.shortlist_needs_student_yes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare me uuid := (select auth.uid());
begin
  if new.student_response is distinct from old.student_response
     and me is distinct from old.student_id and not public.is_admin() then
    raise exception 'Only the student can accept or decline.' using errcode = '42501';
  end if;
  if new.student_response = 'declined' and new.stage in ('interviewing', 'offered', 'hired') then
    new.stage := 'saved';
  end if;
  if new.stage is distinct from old.stage and new.stage in ('interviewing', 'offered', 'hired')
     and new.student_response is distinct from 'accepted' then
    raise exception 'The student has not accepted yet. You can move them to % after they press Accept.', new.stage;
  end if;
  return new;
end $fn$;
revoke all on function public.shortlist_needs_student_yes() from public, anon, authenticated;

drop trigger if exists shortlist_needs_student_yes on public.recruiter_shortlists;
create trigger shortlist_needs_student_yes before update on public.recruiter_shortlists
  for each row execute function public.shortlist_needs_student_yes();

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

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'shortlist_needs_student_yes'
                  and tgrelid = 'public.recruiter_shortlists'::regclass) then
    raise exception '198 self-check: trigger missing';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
