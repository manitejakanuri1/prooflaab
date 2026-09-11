-- stage70b: the pg_trgm similarity check submit-written-task actually calls,
-- using the trigram index stage70 already built on task_submissions.code.

begin;

create or replace function public.similar_written_submission(
  _rubric_config_id uuid, _student_id uuid, _answer text, _threshold real default 0.8
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.task_submissions s
     where s.rubric_config_id = _rubric_config_id
       and s.student_id <> _student_id
       and s.status in ('passed', 'needs_review')
       and similarity(s.code, _answer) >= _threshold
  );
$$;

revoke all on function public.similar_written_submission(uuid, uuid, text, real) from public, anon, authenticated;
grant execute on function public.similar_written_submission(uuid, uuid, text, real) to service_role;

comment on function public.similar_written_submission(uuid, uuid, text, real) is
  'True when another student already has a passed/pending answer to this same rubric config that trigram-matches above threshold. Called from submit-written-task before AI grading, to flag likely-shared answers.';

commit;
