-- Rollback of 535: restores accepted-is-final guard on company_review_submission (as in migration 410).
begin;
CREATE OR REPLACE FUNCTION public.company_review_submission(_submission_id uuid, _decision text, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
declare
  me uuid := auth.uid(); s record; firm text; prev text; back text;
  n text := nullif(trim(coalesce(_note, '')), '');
begin
  if not public.my_company_ok() then
    raise exception 'Your company account is awaiting approval.';
  end if;
  if _decision not in ('accepted', 'needs_work', 'rejected') then
    raise exception 'Unknown decision.';
  end if;
  select ts.id, ts.task_id, ts.student_id, ts.status, t.title, t.student_id as owner, p.user_id
    into s
    from public.task_submissions ts
    join public.tasks t on t.id = ts.task_id
    join public.student_profiles p on p.id = ts.student_id
   where ts.id = _submission_id and (t.created_by_startup_id = me or t.sponsored_by = me);
  if s.id is null then
    raise exception 'No such submission on your work.';
  end if;
  -- 410 (P6): an accepted submission is final; a second decision is refused.
  if exists (select 1 from public.submission_reviews r where r.submission_id = _submission_id and r.decision = 'accepted') then
    raise exception 'You already accepted this work. An accepted submission is final.';
  end if;
  insert into public.submission_reviews (submission_id, reviewer_id, decision, note)
  values (_submission_id, me, _decision, n)
  on conflict (submission_id) do update
    set reviewer_id = excluded.reviewer_id, decision = excluded.decision,
        note = excluded.note, reviewed_at = now();

  prev := current_setting('app.system_write', true);
  perform set_config('app.system_write', 'on', true);
  if _decision = 'needs_work' and s.status = 'passed' then
    -- Ask for changes: this try no longer counts as the pass, and the task is open again.
    update public.task_submissions set status = 'returned' where id = s.id;
    if s.owner = s.student_id then
      update public.tasks set status = 'In Progress', completed_at = null
       where id = s.task_id and status in ('pending_voice', 'completed');
    else
      update public.task_assignments set status = 'in_progress', completed_at = null
       where task_id = s.task_id and student_id = s.student_id and status in ('pending_voice', 'completed');
    end if;
  elsif _decision <> 'needs_work' and s.status = 'returned'
        and not exists (select 1 from public.task_submissions x
                         where x.task_id = s.task_id and x.student_id = s.student_id and x.status = 'passed') then
    -- Changed its mind before a new try: the try is the pass again, the task back where it was.
    update public.task_submissions set status = 'passed' where id = s.id;
    back := case when exists (select 1 from public.voice_explanations v
                               where v.submission_id = s.id and v.status = 'scored' and v.withdrawn_at is null)
                 then 'completed' else 'pending_voice' end;
    if s.owner = s.student_id then
      update public.tasks set status = back, completed_at = case when back = 'completed' then coalesce(completed_at, now()) end
       where id = s.task_id and status not in ('pending_voice', 'completed');
    else
      update public.task_assignments set status = back, completed_at = case when back = 'completed' then coalesce(completed_at, now()) end
       where task_id = s.task_id and student_id = s.student_id and status not in ('pending_voice', 'completed');
    end if;
  end if;
  perform set_config('app.system_write', coalesce(prev, ''), true);

  firm := coalesce((select r.company from public.recruiters r where r.id = me),
                   (select st.name from public.startups st where st.user_id = me limit 1), 'The company');
  if s.user_id is not null then
    insert into public.notifications (user_id, audience, source, type, title, message, link, dedupe_key)
    values (s.user_id, 'student', 'system', 'sponsored_task',
            case _decision when 'accepted' then firm || ' accepted your work'
                           when 'needs_work' then firm || ' asked for changes'
                           else firm || ' reviewed your work' end,
            case _decision when 'accepted' then '"' || left(s.title, 80) || '" was accepted.'
                           when 'needs_work' then 'Open "' || left(s.title, 80) || '", read their note and submit a new version.'
                           else '"' || left(s.title, 80) || '" was not accepted this time.' end
              || coalesce(' Their note: ' || left(n, 300), ''),
            '/student/tasks/assigned?open=' || s.task_id,
            'company_review:' || s.id || ':' || _decision)
    on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return jsonb_build_object('ok', true, 'submission_id', _submission_id, 'decision', _decision);
end $function$;

do $$ declare src text; begin
  select prosrc into src from pg_proc where proname = 'company_review_submission' and pronamespace = 'public'::regnamespace;
  if src not like '%An accepted submission is final%' then raise exception '410 self-check: accepted guard missing'; end if;
  if src not like '%status = ''returned''%' then raise exception '410 self-check: 300 ask-for-changes loop lost'; end if;
end $$;

notify pgrst, 'reload schema';
commit;
