-- ============================================================================
-- Found by attacking the finished build as a signed-in student.
--
-- Row level security answers "is this your row?". It never answers "is this
-- your column?". Every own-row UPDATE policy therefore let a student rewrite
-- the exact fields that decide their own score. Eight worked:
--
--   1  total_xp = 999999, trust_score = 100     on their own profile
--   2  proof status = 'Verified'                on their own submission
--   3  quiz answer_scores = 100                 40% of the integrity score
--   4  verified_badge = true                    the badge in the public feed
--   5  credits_available = 999999               unlimited AI spend, real money
--   6  resume_quality_score = 100               feeds the scorecard
--   7  task review_status = 'approved'          approving their own work
--   8  task xp_reward = 99999
--
-- Column-level GRANTs cannot fix this: admins are also `authenticated` and must
-- keep writing those fields. The check has to know WHO is asking, so it reads
-- the verified JWT that PostgREST sets from the signed token — a value the
-- browser cannot forge.
--
-- Protected columns are silently restored to their previous value rather than
-- raising: a student editing their display name should not get an error just
-- because the form also posted total_xp.
--
-- Two mistakes were made writing this guard, both caught by re-running the
-- attack, and both worth remembering:
--
--   * The first version checked current_user. Inside SECURITY DEFINER that is
--     the function's OWNER, not the caller — so every attack looked like it
--     came from postgres and all eight sailed through. It reported success and
--     changed nothing.
--   * The second version called is_admin() before checking the token was
--     readable. auth.uid() parses the token itself, so a malformed one threw
--     inside the exemption check rather than being clamped.
-- ============================================================================

create or replace function public.protect_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raw      text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role text;
  clamp    boolean := true;
  col  text;
  newj jsonb;
  oldj jsonb;
begin
  -- No web request at all: a migration or the SQL editor. Trusted.
  if raw is null then
    return new;
  end if;

  begin
    jwt_role := raw::jsonb ->> 'role';
    if jwt_role is distinct from 'authenticated' then
      clamp := false;              -- service_role: an edge function
    elsif public.is_admin() then
      clamp := false;
    end if;
  exception when others then
    clamp := true;                 -- unreadable token: fail closed
  end;

  if not clamp then
    return new;
  end if;

  newj := to_jsonb(new);
  oldj := to_jsonb(old);
  foreach col in array tg_argv loop
    newj := jsonb_set(newj, array[col], oldj -> col);
  end loop;
  return jsonb_populate_record(new, newj);
end $$;

-- Inserts need the same guard. Without it a student does not have to update the
-- badge on — they can simply create the post already wearing it.
create or replace function public.protect_insert_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raw      text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role text;
  clamp    boolean := true;
begin
  if raw is null then
    return new;
  end if;

  begin
    jwt_role := raw::jsonb ->> 'role';
    if jwt_role is distinct from 'authenticated' then
      clamp := false;
    elsif public.is_admin() then
      clamp := false;
    end if;
  exception when others then
    clamp := true;
  end;

  if not clamp then
    return new;
  end if;

  new.verified_badge := false;
  new.likes_count := 0;
  new.comments_count := 0;
  new.view_count := 0;
  return new;
end $$;

create trigger protect_student_profiles before update on public.student_profiles
  for each row execute function public.protect_columns(
    'total_xp', 'trust_score', 'college_id', 'status', 'source', 'profile_completed');

create trigger protect_proof_uploads before update on public.proof_uploads
  for each row execute function public.protect_columns(
    'status', 'ai_status', 'ai_score', 'ai_summary', 'ai_feedback',
    'moss_status', 'moss_score', 'moss_url',
    'admin_review_status', 'review_comment', 'review_flag', 'review_override_reason',
    'reviewed_at', 'reviewed_by', 'reviewed_by_name', 'reviewer_id',
    'reflection_score', 'reflection_status', 'reflection_verified_at');

create trigger protect_proof_posts before update on public.proof_posts
  for each row execute function public.protect_columns(
    'verified_badge', 'likes_count', 'comments_count', 'view_count', 'status');

create trigger protect_proof_posts_insert before insert on public.proof_posts
  for each row execute function public.protect_insert_defaults();

create trigger protect_student_credits before update on public.student_credits
  for each row execute function public.protect_columns(
    'credits_available', 'credits_used_today', 'premium_status', 'last_refreshed_at');

create trigger protect_resume_claims before update on public.resume_claims
  for each row execute function public.protect_columns(
    'resume_quality_score', 'ats_match_score', 'resume_quality_notes',
    'ats_match_notes', 'skill_relevance_notes', 'ai_improved_resume', 'raw_extraction');

create trigger protect_task_assignments before update on public.task_assignments
  for each row execute function public.protect_columns(
    'status', 'review_status', 'feedback', 'reviewed_by', 'completed_at');

create trigger protect_tasks before update on public.tasks
  for each row execute function public.protect_columns(
    'xp', 'xp_reward', 'suggested_xp', 'approved_by_admin', 'status');

create trigger protect_conceptual_tests before update on public.conceptual_tests
  for each row execute function public.protect_columns('answer_scores', 'status');

revoke all on function public.protect_columns() from public, anon, authenticated;
revoke all on function public.protect_insert_defaults() from public, anon, authenticated;
