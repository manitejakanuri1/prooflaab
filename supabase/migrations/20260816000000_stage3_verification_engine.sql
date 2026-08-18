-- ============================================================================
-- Stage 3 — the verification engine.
--
-- Until now a student could submit work and nothing checked it. This is the
-- part the product exists for: the Cognitive Integrity Score.
--
--   35%  commit authenticity   github_verifications
--   25%  AI authorship         ai_verifications
--   40%  conceptual quiz       conceptual_tests
--        result                trust_scores
--        who changed what      audit_logs
--        per-college pass mark verification_settings
--        disagreements         proof_appeals
--
-- One thing here is not a rebuild of what existed before. The old schema stored
-- the quiz's correct answers inside conceptual_tests.questions, and the browser
-- reads that table with select('*') — so the right answers arrived on the
-- student's machine at the same moment as the questions. The quiz is 40% of the
-- score and is meant to be the part that cannot be faked. The answers now live
-- in their own table that no signed-in request can reach.
-- ============================================================================

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create table public.github_verifications (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.proof_uploads(id) on delete cascade,
  repo_url text,
  commit_count integer,
  first_commit_at timestamptz,
  last_commit_at timestamptz,
  largest_commit_delta integer,
  unique_contributors integer,
  authenticity_score integer,
  authenticity_notes jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_verifications (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.proof_uploads(id) on delete cascade,
  ai_authorship_risk integer,
  originality_score integer,
  explanation text,
  ai_summary text,
  ai_comments text,
  raw_model_output jsonb,
  created_at timestamptz not null default now()
);

-- questions holds prompts and options ONLY. See conceptual_answer_keys below.
-- One test per proof: question-generator upserts on proof_id when a student
-- retakes, so the original created_at survives.
create table public.conceptual_tests (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null unique references public.proof_uploads(id) on delete cascade,
  questions jsonb not null default '[]'::jsonb,
  student_answers jsonb not null default '[]'::jsonb,
  answer_scores jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- Deliberately has NO policy, and the blanket grant is revoked below.
-- RLS is on, so every signed-in request returns zero rows; the revoke means the
-- request is refused outright. Only the service role — the edge functions —
-- can read it. This is what makes the 40% quiz worth anything.
create table public.conceptual_answer_keys (
  test_id uuid primary key references public.conceptual_tests(id) on delete cascade,
  answers jsonb not null,
  created_at timestamptz not null default now()
);

-- One row per student, upserted on student_id by trust-compute.
create table public.trust_scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.student_profiles(id) on delete cascade,
  proof_id uuid references public.proof_uploads(id) on delete set null,
  score integer not null default 0,
  commit_authenticity_score integer,
  ai_authorship_score integer,
  conceptual_understanding_score integer,
  cognitive_integrity_score integer,
  last_updated timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.verification_settings (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null unique references public.colleges(id) on delete cascade,
  min_trust_score integer not null default 60,
  min_authenticity_score integer not null default 50,
  min_conceptual_score integer not null default 50,
  min_ai_likelihood integer not null default 70,
  auto_approve_threshold integer not null default 60,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.proof_appeals (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.proof_uploads(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  appeal_reason text not null,
  appeal_status text not null default 'pending',
  reviewer_decision text,
  reviewer_comment text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create trigger verification_settings_set_updated_at before update on public.verification_settings
  for each row execute function public.set_updated_at();

create index audit_logs_user_id_idx on public.audit_logs (user_id);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);
create index github_verifications_proof_idx on public.github_verifications (proof_id);
create index ai_verifications_proof_idx on public.ai_verifications (proof_id);
create index trust_scores_proof_idx on public.trust_scores (proof_id);
create index proof_appeals_proof_idx on public.proof_appeals (proof_id);
create index proof_appeals_student_idx on public.proof_appeals (student_id);
create index proof_appeals_reviewed_by_idx on public.proof_appeals (reviewed_by);

alter table public.audit_logs enable row level security;
alter table public.github_verifications enable row level security;
alter table public.ai_verifications enable row level security;
alter table public.conceptual_tests enable row level security;
alter table public.conceptual_answer_keys enable row level security;
alter table public.trust_scores enable row level security;
alter table public.verification_settings enable row level security;
alter table public.proof_appeals enable row level security;

-- Written by the system only. A student able to edit the audit trail could
-- erase the record of their own score being changed.
create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using (public.is_admin());

-- A student may read the report on their own work. Previously they could not,
-- and a failed verification showed them a one-line comment with no way to see
-- why.
create policy github_verifications_read on public.github_verifications for select to authenticated
  using (public.is_admin() or proof_id in (
    select id from public.proof_uploads where student_id = (select auth.uid())));

create policy ai_verifications_read on public.ai_verifications for select to authenticated
  using (public.is_admin() or proof_id in (
    select id from public.proof_uploads where student_id = (select auth.uid())));

create policy conceptual_tests_read on public.conceptual_tests for select to authenticated
  using (public.is_admin() or proof_id in (
    select id from public.proof_uploads where student_id = (select auth.uid())));

-- The student writes their answers. Scores and status are set by the grader
-- running as the service role, and there is no insert or delete policy, so a
-- student cannot manufacture a test or destroy one.
create policy conceptual_tests_answer on public.conceptual_tests for update to authenticated
  using (proof_id in (select id from public.proof_uploads where student_id = (select auth.uid())))
  with check (proof_id in (select id from public.proof_uploads where student_id = (select auth.uid())));

-- No policy on conceptual_answer_keys. That is the point.

-- Read-only to the student: the score is computed, never self-declared.
create policy trust_scores_read on public.trust_scores for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());

create policy verification_settings_read on public.verification_settings for select to authenticated
  using (public.is_admin() or college_id in (
    select id from public.colleges where user_id = (select auth.uid())));
create policy verification_settings_write on public.verification_settings for all to authenticated
  using (public.is_admin() or college_id in (
    select id from public.colleges where user_id = (select auth.uid())))
  with check (public.is_admin() or college_id in (
    select id from public.colleges where user_id = (select auth.uid())));

-- A student may raise an appeal and read it. Only an admin may decide it.
create policy proof_appeals_read on public.proof_appeals for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());
create policy proof_appeals_own_insert on public.proof_appeals for insert to authenticated
  with check (student_id = (select auth.uid()));
create policy proof_appeals_admin_update on public.proof_appeals for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- Undo the blanket grant for the one table that must stay unreachable. Run
-- after the grant above, not before, or the grant puts it back.
revoke all on public.conceptual_answer_keys from authenticated, anon;
