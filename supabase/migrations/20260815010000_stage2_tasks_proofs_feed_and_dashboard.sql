-- ============================================================================
-- Stage 2 — everything the dashboard reads when a student lands on it.
--
-- Stage 1 took a student from signup to their result screen. This carries them
-- through to a working dashboard: tasks, submitted proofs, the feed, the
-- notification bell, and the counters the overview shows.
--
-- student_id always holds an auth user id, the same value as
-- student_profiles.id. There is one id space and this stage does not break it.
-- ============================================================================

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.student_profiles(id) on delete cascade,
  title text not null,
  description text,
  category text,
  status text not null default 'pending',
  visibility text not null default 'private',
  source text,
  created_by_type text,
  created_by_admin_id uuid references auth.users(id) on delete set null,
  created_by_college_id uuid references public.colleges(id) on delete set null,
  created_by_startup_id uuid,
  approved_by_admin boolean not null default false,
  is_ai_generated boolean not null default false,
  is_paid boolean not null default false,
  ai_metadata jsonb,
  required_skills text[] not null default '{}',
  difficulty text,
  duration_days integer,
  due_date timestamptz not null default (now() + interval '7 days'),
  upload_deadline timestamptz,
  posted_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  level_id uuid,
  roadmap_scorecard_id uuid references public.resume_scorecards(id) on delete set null,
  roadmap_stage_index integer,
  suggested_xp integer,
  xp integer not null default 0,
  xp_reward integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  status text not null default 'assigned',
  review_status text,
  feedback text,
  reviewed_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (task_id, student_id)
);

create table public.proof_uploads (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  status text not null default 'pending',
  is_public boolean not null default false,
  submission_notes text,
  file_name text, file_path text, file_type text, file_url text, file_size bigint,
  declaration_acknowledged boolean not null default false,
  declaration_text text,
  ai_status text, ai_score integer, ai_summary text, ai_feedback text,
  moss_status text, moss_score integer, moss_url text,
  reflection_requested boolean not null default false,
  reflection_status text, reflection_score integer, reflection_reasoning text,
  reflection_questions jsonb, reflection_answers jsonb,
  reflection_trigger_time timestamptz, reflection_verified_at timestamptz,
  admin_review_status text, review_comment text, review_flag boolean not null default false,
  review_override_reason text, reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_by_name text,
  reviewer_id uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now()
);

create table public.proof_posts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  proof_id uuid references public.proof_uploads(id) on delete set null,
  title text not null,
  description text,
  emoji_code text not null default 'rocket',
  external_link text,
  skills text[] not null default '{}',
  status text not null default 'published',
  visibility text not null default 'public',
  verified_badge boolean not null default false,
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  view_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.proof_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.proof_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  comment text not null,
  created_at timestamptz not null default now()
);

-- Both columns hold auth user ids. The previous schema stored an auth id in
-- follower_id but a student_profiles id in following_id, while every function
-- assumed both were auth ids — so follow counts read zero for everyone and
-- follow notifications reached nobody. Same id space on both sides now, and a
-- check that stops the self-follow that would otherwise inflate counts.
create table public.user_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  constraint user_follows_no_self check (follower_id <> following_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  post_id uuid references public.proof_posts(id) on delete cascade,
  audience text not null default 'student',
  source text not null default 'system',
  type text not null,
  title text not null,
  message text not null,
  link text,
  metadata jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.xp_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  xp_points integer not null,
  source text,
  created_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  active_minutes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

create table public.student_credits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.student_profiles(id) on delete cascade,
  credits_available integer not null default 10,
  credits_used_today integer not null default 0,
  premium_status boolean not null default false,
  last_refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  theme text default 'system',
  compact_mode boolean not null default false,
  email_notifications boolean not null default true,
  push_notifications boolean not null default true,
  task_reminders boolean not null default true,
  weekly_digest boolean not null default true,
  portfolio_public boolean not null default false,
  show_progress_to_others boolean not null default true,
  show_xp_rank boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger task_assignments_set_updated_at before update on public.task_assignments
  for each row execute function public.set_updated_at();
create trigger activity_logs_set_updated_at before update on public.activity_logs
  for each row execute function public.set_updated_at();
create trigger student_credits_set_updated_at before update on public.student_credits
  for each row execute function public.set_updated_at();
create trigger user_preferences_set_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- Every foreign key gets an index, plus two partial ones for the queries that
-- actually run on every page load: the public feed, and the unread bell count.
create index tasks_student_id_idx on public.tasks (student_id);
create index tasks_created_by_admin_idx on public.tasks (created_by_admin_id);
create index tasks_created_by_college_idx on public.tasks (created_by_college_id);
create index tasks_roadmap_scorecard_idx on public.tasks (roadmap_scorecard_id);
create index tasks_status_idx on public.tasks (status);
create index task_assignments_task_id_idx on public.task_assignments (task_id);
create index task_assignments_student_id_idx on public.task_assignments (student_id);
create index task_assignments_reviewed_by_idx on public.task_assignments (reviewed_by);
create index proof_uploads_task_id_idx on public.proof_uploads (task_id);
create index proof_uploads_student_id_idx on public.proof_uploads (student_id);
create index proof_uploads_reviewed_by_idx on public.proof_uploads (reviewed_by);
create index proof_uploads_reviewer_id_idx on public.proof_uploads (reviewer_id);
create index proof_posts_student_id_idx on public.proof_posts (student_id);
create index proof_posts_proof_id_idx on public.proof_posts (proof_id);
create index proof_posts_feed_idx on public.proof_posts (created_at desc) where visibility = 'public';
create index post_likes_post_id_idx on public.post_likes (post_id);
create index post_likes_user_id_idx on public.post_likes (user_id);
create index post_comments_post_id_idx on public.post_comments (post_id);
create index post_comments_user_id_idx on public.post_comments (user_id);
create index user_follows_follower_idx on public.user_follows (follower_id);
create index user_follows_following_idx on public.user_follows (following_id);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where is_read = false;
create index notifications_actor_idx on public.notifications (actor_id);
create index notifications_post_idx on public.notifications (post_id);
create index xp_logs_student_id_idx on public.xp_logs (student_id);
create index activity_logs_user_id_idx on public.activity_logs (user_id);

alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;
alter table public.proof_uploads enable row level security;
alter table public.proof_posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.user_follows enable row level security;
alter table public.notifications enable row level security;
alter table public.xp_logs enable row level security;
alter table public.activity_logs enable row level security;
alter table public.student_credits enable row level security;
alter table public.user_preferences enable row level security;

create policy tasks_read on public.tasks for select to authenticated
  using (student_id = (select auth.uid()) or visibility = 'public' or public.is_admin());
create policy tasks_own_insert on public.tasks for insert to authenticated
  with check (student_id = (select auth.uid()) or public.is_admin());
create policy tasks_own_update on public.tasks for update to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());
create policy tasks_admin_delete on public.tasks for delete to authenticated
  using (public.is_admin());

-- A student may move their own assignment along but may not hand themselves a
-- task, so insert stays admin-only.
create policy task_assignments_read on public.task_assignments for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());
create policy task_assignments_own_update on public.task_assignments for update to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());
create policy task_assignments_admin_insert on public.task_assignments for insert to authenticated
  with check (public.is_admin());
create policy task_assignments_admin_delete on public.task_assignments for delete to authenticated
  using (public.is_admin());

create policy proof_uploads_own_all on public.proof_uploads for all to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());

-- The feed exists to show other students' work, so a published public post is
-- readable by any signed-in account. Writing stays owner-only.
create policy proof_posts_read on public.proof_posts for select to authenticated
  using ((visibility = 'public' and status = 'published')
         or student_id = (select auth.uid()) or public.is_admin());
create policy proof_posts_own_insert on public.proof_posts for insert to authenticated
  with check (student_id = (select auth.uid()));
create policy proof_posts_own_update on public.proof_posts for update to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());
create policy proof_posts_own_delete on public.proof_posts for delete to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());

create policy post_likes_read on public.post_likes for select to authenticated using (true);
create policy post_likes_own_insert on public.post_likes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy post_likes_own_delete on public.post_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy post_comments_read on public.post_comments for select to authenticated using (true);
create policy post_comments_own_insert on public.post_comments for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy post_comments_own_update on public.post_comments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy post_comments_own_delete on public.post_comments for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy user_follows_read on public.user_follows for select to authenticated using (true);
create policy user_follows_own_insert on public.user_follows for insert to authenticated
  with check (follower_id = (select auth.uid()));
create policy user_follows_own_delete on public.user_follows for delete to authenticated
  using (follower_id = (select auth.uid()));

create policy notifications_own_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_own_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_own_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- Read-only to the student: XP is awarded by the system, never self-declared.
create policy xp_logs_own_read on public.xp_logs for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());

create policy activity_logs_own_all on public.activity_logs for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

create policy student_credits_own_read on public.student_credits for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());
create policy student_credits_own_insert on public.student_credits for insert to authenticated
  with check (student_id = (select auth.uid()) or public.is_admin());
create policy student_credits_own_update on public.student_credits for update to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());

create policy user_preferences_own_all on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

-- Grants are checked before row level security, so a table with perfect
-- policies and no grant fails every query. See 20260815000300.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
