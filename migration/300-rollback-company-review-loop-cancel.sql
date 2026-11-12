-- Rollback of 300. A 'returned' try becomes 'passed' again (or 'failed' when a newer pass exists).
-- Cancelled company tasks get their student back (status 'pending', no Lot day).
begin;
update public.task_submissions s set status = case when exists (
    select 1 from public.task_submissions x where x.task_id = s.task_id and x.student_id = s.student_id and x.status = 'passed')
  then 'failed' else 'passed' end
 where s.status = 'returned';
alter table public.task_submissions drop constraint task_submissions_status_check;
alter table public.task_submissions add constraint task_submissions_status_check
  check (status = any (array['passed', 'failed', 'needs_review']));

select set_config('app.system_write', 'on', true);
update public.tasks set status = 'pending', student_id = (ai_metadata -> 'cancelled' ->> 'student_id')::uuid
 where status = 'cancelled' and ai_metadata ? 'cancelled';

create or replace function public.company_review_submission(_submission_id uuid, _decision text, _note text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare me uuid := auth.uid();
begin
  if not public.my_company_ok() then
    raise exception 'Your company account is awaiting approval.';
  end if;
  if _decision not in ('accepted', 'needs_work', 'rejected') then
    raise exception 'Unknown decision.';
  end if;
  if not exists (select 1 from public.task_submissions s join public.tasks t on t.id = s.task_id
                  where s.id = _submission_id and (t.created_by_startup_id = me or t.sponsored_by = me)) then
    raise exception 'No such submission on your work.';
  end if;
  insert into public.submission_reviews (submission_id, reviewer_id, decision, note)
  values (_submission_id, me, _decision, nullif(trim(coalesce(_note, '')), ''))
  on conflict (submission_id) do update
    set reviewer_id = excluded.reviewer_id, decision = excluded.decision,
        note = excluded.note, reviewed_at = now();
  return jsonb_build_object('ok', true, 'submission_id', _submission_id, 'decision', _decision);
end $function$;

drop function if exists public.company_review(public.tasks);
drop function if exists public.company_cancel_lot(uuid);
drop function if exists public.tpo_student_companies(uuid);

do $$
declare def text := pg_get_functiondef('public.recruiter_home()'::regprocedure);
begin
  execute replace(def, 'where t.sponsored_by = rid and t.status is distinct from ''cancelled'' and not exists',
                       'where t.sponsored_by = rid and not exists');
end $$;
notify pgrst, 'reload schema';
commit;
