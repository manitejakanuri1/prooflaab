-- ============================================================================
-- Stage 6 — the 60-second Explain, and the streak the Daily Card shows.
--
-- The design deck puts Explain on the main screen as one of only two buttons.
-- It is also the only part of this product that cannot be faked by pasting:
-- you cannot read an AI answer aloud, in your own words, in sixty seconds,
-- without it sounding exactly like reading an AI answer aloud.
--
-- Recordings are their own table rather than columns on proof_uploads, because
-- the deck shows a build-log entry that is ONLY a recording — "60s pitch:
-- campus laundry pickup app" — with no code submission behind it.
--
-- The transcript is captured in the BROWSER while recording. This project has
-- no audio-capable model any more; that went when Gemini was removed. Browser
-- speech recognition costs nothing, needs no new key, and the audio itself is
-- kept as the evidence a human can always fall back on.
-- ============================================================================

create table public.voice_explanations (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references public.student_profiles(id) on delete cascade,
  proof_id            uuid references public.proof_uploads(id) on delete cascade,
  task_id             uuid references public.tasks(id) on delete set null,
  storage_path        text not null,
  duration_seconds    integer,
  transcript          text,
  transcript_source   text not null default 'browser'
                        check (transcript_source in ('browser', 'server', 'manual')),
  word_count          integer,
  communication_score integer,
  communication_notes text,
  status              text not null default 'recorded'
                        check (status in ('recorded', 'scored', 'failed')),
  created_at          timestamptz not null default now()
);

create table public.student_streaks (
  student_id     uuid primary key references public.student_profiles(id) on delete cascade,
  current_days   integer not null default 0,
  longest_days   integer not null default 0,
  last_active_on date,
  updated_at     timestamptz not null default now()
);

create index voice_explanations_student_idx on public.voice_explanations (student_id, created_at desc);
create index voice_explanations_proof_idx on public.voice_explanations (proof_id);
create index voice_explanations_task_idx on public.voice_explanations (task_id);

alter table public.voice_explanations enable row level security;
alter table public.student_streaks enable row level security;

create policy voice_own_read on public.voice_explanations for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());
create policy voice_own_insert on public.voice_explanations for insert to authenticated
  with check (student_id = (select auth.uid()));

create policy streaks_own_read on public.student_streaks for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());

-- The score is written by the grader, never by the speaker.
create trigger protect_voice_explanations before update on public.voice_explanations
  for each row execute function public.protect_columns(
    'communication_score', 'communication_notes', 'status', 'transcript');

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke insert, update, delete on public.student_streaks from authenticated, anon;

-- Moves the streak on, once per day. Yesterday continues the run; any longer
-- gap starts a new one.
create or replace function public.touch_streak(_student_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare last_on date;
begin
  select last_active_on into last_on from public.student_streaks where student_id = _student_id;
  if last_on = current_date then return; end if;

  insert into public.student_streaks (student_id, current_days, longest_days, last_active_on)
  values (_student_id, 1, 1, current_date)
  on conflict (student_id) do update set
    current_days = case when public.student_streaks.last_active_on = current_date - 1
                        then public.student_streaks.current_days + 1 else 1 end,
    longest_days = greatest(public.student_streaks.longest_days,
      case when public.student_streaks.last_active_on = current_date - 1
           then public.student_streaks.current_days + 1 else 1 end),
    last_active_on = current_date,
    updated_at = now();
end $fn$;

revoke all on function public.touch_streak(uuid) from public, anon, authenticated;
