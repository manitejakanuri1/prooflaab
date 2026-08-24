-- ============================================================================
-- Stage 39 — #17, the last item in the 21-step journey: mock interviews.
--
-- Same shape as the 60-second explain: student speaks, browser transcribes,
-- server grades. Four AI-generated questions for their target role instead of
-- one fixed prompt, and the storage bucket is the existing voice-explanations
-- one — its RLS is scoped by the student_id path prefix, not by filename, so
-- a mock-interview/ subfolder needs nothing new there.
--
-- All writes go through SECURITY DEFINER functions or the service-role edge
-- functions that call them; there is deliberately no INSERT/UPDATE policy for
-- authenticated, matching how the rest of this schema treats table access.
-- ============================================================================

create table public.mock_interviews (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.student_profiles(id) on delete cascade,
  target_role     text,
  status          text not null default 'answering'
                    check (status in ('answering', 'scoring', 'completed', 'failed')),
  questions       jsonb not null default '[]'::jsonb,   -- ["question text", ...]
  answers         jsonb not null default '[]'::jsonb,   -- [{n, storage_path, transcript, duration_seconds}]
  overall_score   integer,
  overall_feedback text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index mock_interviews_student_idx on public.mock_interviews (student_id, created_at desc);

alter table public.mock_interviews enable row level security;

create policy mock_interviews_own_read on public.mock_interviews for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());

-- The client submits one answer at a time, in order. Appending only (no
-- editing a past answer) keeps this a one-line jsonb concat instead of a
-- read-modify-write race, and matches the explain modal's own one-shot design.
create function public.save_mock_interview_answer(
  _interview_id uuid, _storage_path text, _transcript text, _duration_seconds integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
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
end $$;

grant execute on function public.save_mock_interview_answer(uuid, text, text, integer) to authenticated;
