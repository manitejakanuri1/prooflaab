-- 315 (owner E2E report 12 Nov 2026, item S3): a notification opens what it is about.
-- Clicking "QA E2E announcement" or "You are in CSE-A Titans 1" only closed the drawer: both were written with the
-- bare link '/student/dashboard', the page the student was already on. Now:
--   squad_placed    -> /student/dashboard?tab=squad
--   announcement    -> /student/dashboard?tab=lab&announcement=<id>   (the banner scrolls to and marks that one)
--   weekly_progress -> /student/dashboard?tab=squad&view=season       (its text says "open your season report")
--   retest_unlocked -> /student/dashboard?tab=profile&view=proof      (test history, where the retest is)
-- Old rows keep their link; the student drawer maps a bare dashboard link by type (StudentHeader.tsx).
-- Only the link text changes; each function body is otherwise the live one (edited in place, as 257 does).
-- Rollback: migration/315-rollback-notification-links-open-their-page.sql
begin;
do $$
declare
  f text; def text; a text; b text;
  edits text[][] := array[
    ['public.notify_squad_placement()',
     $q$'explanations, topics - adds to its score.',
          '/student/dashboard');$q$,
     $q$'explanations, topics - adds to its score.',
          '/student/dashboard?tab=squad');$q$],
    ['public.announcement_fan_out()',
     $q$case ur.role when 'student' then '/student/dashboard'$q$,
     $q$case ur.role when 'student' then '/student/dashboard?tab=lab&announcement=' || new.id$q$],
    ['public.notify_weekly_progress()',
     $q$'. Open your season report for where it came from.',
         '/student/dashboard',$q$,
     $q$'. Open your season report for where it came from.',
         '/student/dashboard?tab=squad&view=season',$q$],
    ['public.notify_retest_unlocks()',
     $q$'Same concepts, different questions.',
      '/student/dashboard');$q$,
     $q$'Same concepts, different questions.',
      '/student/dashboard?tab=profile&view=proof');$q$]];
begin
  for i in 1 .. array_length(edits, 1) loop
    f := edits[i][1]; a := edits[i][2]; b := edits[i][3];
    def := pg_get_functiondef(f::regprocedure);
    if position(b in def) > 0 then continue; end if;          -- already applied
    if position(a in def) = 0 then raise exception '315: anchor not found in %', f; end if;
    execute replace(def, a, b);
  end loop;
end $$;

do $$
begin
  if position('?tab=squad'');' in pg_get_functiondef('public.notify_squad_placement()'::regprocedure)) = 0
     or position('announcement='' || new.id' in pg_get_functiondef('public.announcement_fan_out()'::regprocedure)) = 0
     or position('view=season' in pg_get_functiondef('public.notify_weekly_progress()'::regprocedure)) = 0
     or position('view=proof' in pg_get_functiondef('public.notify_retest_unlocks()'::regprocedure)) = 0 then
    raise exception '315 self-check failed';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
