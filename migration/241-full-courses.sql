-- 241 (owner 12 Nov 2026, option Y, TEST first): full courses on the roadmap.
--   courses          one row per course (title, short credit line; null credit = hand-written)
--   course_chapters  every chapter in reading order (easy to hard), Markdown text, outside links already removed
--   course_tracks    which roadmap tracks show which course ("Full course" button)
--   course_reads     the chapters a student marked as read (own rows only)
-- Chapters are loaded by scripts/dev-tools/courses/load_courses.py (no AI). Reading needs a signed-in user.
-- Rollback: migration/241-rollback-full-courses.sql
begin;
create table if not exists public.courses (
  slug text primary key,
  title text not null,
  credit text,
  chapters integer not null default 0
);
create table if not exists public.course_chapters (
  course_slug text not null references public.courses(slug) on delete cascade,
  position integer not null,
  title text not null,
  body text not null,
  primary key (course_slug, position)
);
create table if not exists public.course_tracks (
  track_slug text not null,
  course_slug text not null references public.courses(slug) on delete cascade,
  primary key (track_slug, course_slug)
);
create table if not exists public.course_reads (
  student_id uuid not null default auth.uid(),
  course_slug text not null,
  position integer not null,
  read_at timestamptz not null default now(),
  primary key (student_id, course_slug, position),
  foreign key (course_slug, position) references public.course_chapters(course_slug, position) on delete cascade
);
alter table public.courses enable row level security;
alter table public.course_chapters enable row level security;
alter table public.course_tracks enable row level security;
alter table public.course_reads enable row level security;
drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses for select to authenticated using (true);
drop policy if exists course_chapters_read on public.course_chapters;
create policy course_chapters_read on public.course_chapters for select to authenticated using (true);
drop policy if exists course_tracks_read on public.course_tracks;
create policy course_tracks_read on public.course_tracks for select to authenticated using (true);
drop policy if exists course_reads_own on public.course_reads;
create policy course_reads_own on public.course_reads for all to authenticated
  using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
grant select on public.courses, public.course_chapters, public.course_tracks to authenticated;
grant select, insert, delete on public.course_reads to authenticated;
revoke all on public.courses, public.course_chapters, public.course_tracks, public.course_reads from anon;
do $$ begin
  if has_table_privilege('anon', 'public.course_chapters', 'select') then raise exception '241 self-check: anon can read chapters'; end if;
  if not has_table_privilege('authenticated', 'public.course_reads', 'insert') then raise exception '241 self-check: students cannot mark read'; end if;
end $$;
notify pgrst, 'reload schema';
commit;
