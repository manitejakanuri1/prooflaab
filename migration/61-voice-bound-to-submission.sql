-- 61: a spoken explanation is evidence about ONE submission (Wave 6a/6b).
--   * voice_explanations.submission_id - set by the database, never by the browser:
--     the student's latest submission for that task. No submission yet -> refused
--     ("Submit your work first").
--   * attempt_no + current_authoritative - retries are kept as history; exactly one
--     server-transcribed recording per submission is the authoritative one.
--   * evidence is immutable: identity columns never change; a completed transcript
--     and a saved score never change; a student can no longer delete a row.
--     Privacy: withdraw_voice_explanation() erases the transcript, keeps the row
--     marked withdrawn (the screen also removes the audio file).
--     A retry that fails (silence, noise) hands authority back to the newest scored one.
--   * evaluation jsonb - evaluator version, content-match score, quality flags.
--   * company_submissions / recruiter_lots read the recording bound to the submission.
begin;

alter table public.voice_explanations
  add column if not exists submission_id uuid references public.task_submissions(id) on delete cascade,
  add column if not exists attempt_no integer not null default 1,
  add column if not exists current_authoritative boolean not null default false,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists evaluation jsonb;

-- Re-runnable: the backfill below runs without the index and triggers this file creates.
drop index if exists public.voice_one_authoritative_per_submission;
drop trigger if exists voice_evidence_immutable on public.voice_explanations;
drop trigger if exists voice_authority_fallback on public.voice_explanations;
update public.voice_explanations set current_authoritative = false where current_authoritative;

-- Backfill (before the immutability trigger exists): the submission the student
-- was explaining = their latest one at recording time, else their first one.
update public.voice_explanations v
   set submission_id = coalesce(
         (select s.id from public.task_submissions s
           where s.student_id = v.student_id and s.task_id = v.task_id and s.created_at <= v.created_at
           order by s.created_at desc limit 1),
         (select s.id from public.task_submissions s
           where s.student_id = v.student_id and s.task_id = v.task_id
           order by s.created_at limit 1))
 where v.submission_id is null and v.task_id is not null;

update public.voice_explanations v
   set attempt_no = n.rn,
       current_authoritative = (n.newest_server = 1 and v.transcript_source = 'server' and v.withdrawn_at is null)
  from (select id,
               row_number() over (partition by submission_id order by created_at) as rn,
               row_number() over (partition by submission_id, (transcript_source = 'server')
                                  order by (status = 'scored' and withdrawn_at is null) desc,
                                           created_at desc) as newest_server
          from public.voice_explanations where submission_id is not null) n
 where n.id = v.id;

create index if not exists voice_explanations_submission_idx
  on public.voice_explanations (submission_id, created_at desc);
create unique index if not exists voice_one_authoritative_per_submission
  on public.voice_explanations (submission_id) where current_authoritative;

-- Insert: bind to the submission, number the attempt, hand over "authoritative".
create or replace function public.bind_voice_to_submission()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare prev text := coalesce(current_setting('app.system_write', true), '');
begin
  if new.submission_id is not null then
    if not exists (select 1 from public.task_submissions s
                    where s.id = new.submission_id and s.student_id = new.student_id
                      and (new.task_id is null or s.task_id = new.task_id)) then
      raise exception 'that submission does not belong to this student and task';
    end if;
    if new.task_id is null then
      select s.task_id into new.task_id from public.task_submissions s where s.id = new.submission_id;
    end if;
  elsif new.task_id is not null then
    select s.id into new.submission_id from public.task_submissions s
     where s.student_id = new.student_id and s.task_id = new.task_id
     order by s.created_at desc limit 1;
  end if;

  new.withdrawn_at := null;
  new.evaluation := null;
  new.current_authoritative := false;
  new.attempt_no := 1;

  if new.submission_id is null then
    -- A recording for a task, or any recording made by a signed-in student, must
    -- have a submission behind it. (A server-made row with no task is test tooling.)
    if new.task_id is not null or auth.role() = 'authenticated' then
      raise exception 'Submit your work first, then record your explanation.';
    end if;
    return new;
  end if;

  -- One at a time per submission, so two uploads cannot both become "current".
  perform pg_advisory_xact_lock(hashtextextended(new.submission_id::text, 0));
  select coalesce(max(v.attempt_no), 0) + 1 into new.attempt_no
    from public.voice_explanations v where v.submission_id = new.submission_id;

  -- Only a recording the server will transcribe can be the authoritative one.
  if auth.role() = 'service_role' and new.transcript_source = 'server' then
    perform set_config('app.system_write', 'on', true);
    update public.voice_explanations set current_authoritative = false
     where submission_id = new.submission_id and current_authoritative;
    perform set_config('app.system_write', prev, true);
    new.current_authoritative := true;
  end if;
  return new;
end $function$;

drop trigger if exists bind_voice_submission on public.voice_explanations;
create trigger bind_voice_submission before insert on public.voice_explanations
  for each row execute function public.bind_voice_to_submission();

-- Update: evidence does not change after the fact - for anyone, including the server.
create or replace function public.voice_evidence_immutable()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $function$
begin
  if new.student_id <> old.student_id or new.storage_path <> old.storage_path
     or new.created_at <> old.created_at or new.attempt_no <> old.attempt_no
     or (old.submission_id is not null and new.submission_id is distinct from old.submission_id)
     or (new.task_id is distinct from old.task_id and new.task_id is not null) then
    raise exception 'a recording cannot be moved to another student, task, submission or audio file';
  end if;
  if old.withdrawn_at is not null and (new.withdrawn_at is null or new.current_authoritative) then
    raise exception 'a withdrawn recording stays withdrawn';
  end if;
  if coalesce(current_setting('app.voice_withdraw', true), '') = 'on' then
    return new;
  end if;
  if old.transcription_status = 'completed' and old.transcript is not null
     and new.transcript is distinct from old.transcript then
    raise exception 'a finished transcript cannot be changed; record a new attempt';
  end if;
  if old.status = 'scored' and (new.status <> 'scored'
       or new.communication_score is distinct from old.communication_score
       or new.communication_notes is distinct from old.communication_notes
       or new.evaluation is distinct from old.evaluation) then
    raise exception 'a scored explanation cannot be changed; record a new attempt';
  end if;
  return new;
end $function$;

drop trigger if exists voice_evidence_immutable on public.voice_explanations;
create trigger voice_evidence_immutable before update on public.voice_explanations
  for each row execute function public.voice_evidence_immutable();

-- A retry that could not be scored (silence, noise) must not hide an earlier
-- scored explanation: authority returns to the newest scored attempt.
create or replace function public.voice_authority_fallback()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare better uuid; prev text := coalesce(current_setting('app.system_write', true), '');
begin
  if new.status = 'failed' and old.status <> 'failed' and new.current_authoritative
     and new.submission_id is not null then
    select v.id into better from public.voice_explanations v
     where v.submission_id = new.submission_id and v.status = 'scored'
       and v.withdrawn_at is null and v.transcript_source = 'server'
     order by v.attempt_no desc limit 1;
    if better is not null then
      perform set_config('app.system_write', 'on', true);
      update public.voice_explanations set current_authoritative = false where id = new.id;
      update public.voice_explanations set current_authoritative = true where id = better;
      perform set_config('app.system_write', prev, true);
    end if;
  end if;
  return null;
end $function$;

drop trigger if exists voice_authority_fallback on public.voice_explanations;
create trigger voice_authority_fallback after update on public.voice_explanations
  for each row execute function public.voice_authority_fallback();

-- Students no longer delete evidence rows. Their privacy right is a withdrawal.
drop policy if exists voice_own_delete on public.voice_explanations;

create or replace function public.withdraw_voice_explanation(_id uuid)
returns boolean language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare n integer;
begin
  if not exists (select 1 from public.voice_explanations v
                  where v.id = _id and v.student_id = (select auth.uid())) then
    raise exception 'No such recording of yours.';
  end if;
  perform set_config('app.voice_withdraw', 'on', true);
  perform set_config('app.system_write', 'on', true);
  update public.voice_explanations
     set withdrawn_at = now(), current_authoritative = false,
         transcript = null, transcript_segments = null
   where id = _id and withdrawn_at is null;
  get diagnostics n = row_count;
  perform set_config('app.voice_withdraw', '', true);
  perform set_config('app.system_write', '', true);
  return n > 0;
end $function$;
revoke all on function public.withdraw_voice_explanation(uuid) from public, anon;
grant execute on function public.withdraw_voice_explanation(uuid) to authenticated, service_role;

-- Company screens: the recording bound to the submission being shown.
create or replace function public.company_submissions()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if not public.my_company_ok() then
    raise exception 'Your company account is awaiting approval.';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.submitted_at desc)
      from (
        select s.id as submission_id, t.id as task_id, t.title as task_title,
               case when t.sponsored_by = me then 'sponsored' else 'posted' end as source,
               p.id as student_id, p.full_name as student_name, c.name as college_name,
               s.status, s.sandbox_score as score, s.passed_count, s.total_count,
               case when s.sandbox_config_id is not null then 'code' else 'written' end as kind,
               s.language, s.code as work, s.created_at as submitted_at,
               (select count(*) from public.task_submissions a
                 where a.task_id = s.task_id and a.student_id = s.student_id) as attempts,
               coalesce(v.status, 'missing') as voice_status, v.communication_score as voice_score,
               v.communication_notes as voice_notes, v.transcript as voice_transcript,
               v.attempt_no as voice_attempt, (v.submission_id = s.id) as voice_for_this_submission,
               r.decision as review_decision, r.note as review_note, r.reviewed_at
          from public.task_submissions s
          join public.tasks t on t.id = s.task_id
          join public.student_profiles p on p.id = s.student_id
          left join public.colleges c on c.id = p.college_id
          left join lateral (
            select ve.status, ve.communication_score, ve.communication_notes, ve.transcript,
                   ve.attempt_no, ve.submission_id
              from public.voice_explanations ve
             where ve.task_id = s.task_id and ve.student_id = s.student_id and ve.withdrawn_at is null
             order by (ve.submission_id = s.id and ve.current_authoritative) desc,
                      (ve.submission_id = s.id) desc, ve.created_at desc
             limit 1) v on true
          left join public.submission_reviews r on r.submission_id = s.id
         where (t.created_by_startup_id = me or t.sponsored_by = me)
           and s.created_at = (select max(l.created_at) from public.task_submissions l
                                where l.task_id = s.task_id and l.student_id = s.student_id)
      ) x), '[]'::jsonb);
end $$;

create or replace function public.recruiter_lots()
returns table (task_id uuid, title text, student_id uuid, student_name text,
               created_at timestamptz, due_date timestamptz, task_status text,
               submission_id uuid, submitted_at timestamptz, submission_status text,
               score integer, voice_status text, outcome text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select t.id, t.title, t.student_id, p.full_name,
         t.created_at, t.due_date, t.status,
         s.id, s.created_at, s.status, s.sandbox_score,
         v.status, sl.stage
    from public.tasks t
    join public.student_profiles p on p.id = t.student_id
    left join lateral (
      select x.id, x.created_at, x.status, x.sandbox_score from public.task_submissions x
       where x.task_id = t.id and x.student_id = t.student_id
       order by x.created_at desc limit 1) s on true
    left join lateral (
      select ve.status from public.voice_explanations ve
       where ve.task_id = t.id and ve.student_id = t.student_id and ve.withdrawn_at is null
       order by (ve.submission_id = s.id and ve.current_authoritative) desc,
                (ve.submission_id = s.id) desc, ve.created_at desc limit 1) v on true
    left join public.recruiter_shortlists sl
      on sl.recruiter_id = t.sponsored_by and sl.student_id = t.student_id
   where t.sponsored_by = public.my_recruiter_id()
   order by t.created_at desc;
$fn$;

do $$
declare n integer;
begin
  select count(*) into n from (
    select submission_id from public.voice_explanations
     where current_authoritative group by submission_id having count(*) > 1) d;
  if n > 0 then raise exception '61 self-check: % submissions have two authoritative recordings', n; end if;

  select count(*) into n from public.voice_explanations v
   where v.submission_id is not null and not exists (
     select 1 from public.task_submissions s
      where s.id = v.submission_id and s.student_id = v.student_id and s.task_id = v.task_id);
  if n > 0 then raise exception '61 self-check: % recordings bound to a foreign submission', n; end if;

  if exists (select 1 from pg_policies where tablename = 'voice_explanations' and cmd = 'DELETE') then
    raise exception '61 self-check: a delete policy still exists on voice_explanations';
  end if;
  if has_function_privilege('anon', 'public.withdraw_voice_explanation(uuid)', 'execute') then
    raise exception '61 self-check: anon can withdraw recordings';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.voice_explanations'::regclass
       and tgname in ('bind_voice_submission', 'voice_evidence_immutable')) <> 2 then
    raise exception '61 self-check: voice triggers missing';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
