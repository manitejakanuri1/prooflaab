-- 315 ROLLBACK: notifications go back to the bare '/student/dashboard' link (undoes 315).
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
    f := edits[i][1]; a := edits[i][3]; b := edits[i][2];
    def := pg_get_functiondef(f::regprocedure);
    if position(b in def) > 0 then continue; end if;          -- already applied
    if position(a in def) = 0 then raise exception '315 rollback: anchor not found in %', f; end if;
    execute replace(def, a, b);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
