-- 137: a path matches the student's goal on any real word of its name or role, not only the role's first word.
--
-- WHY. Found on staging 23 Oct 2026 with 50 imported PRAGATI students. 132 compared only the FIRST word of the
-- path's role with the goal, so three common goals got the wrong first suggestion:
--   "Machine Learning Engineer" -> Python course   (role "ML Engineer": "ml" was too short to count)
--   "Full Stack Web Developer"  -> UI/UX Design    (role "Full Stack Developer": "full" is skipped)
--   "Cybersecurity Analyst"     -> Python course   (role "Security Analyst": "security" is not "cybersecurity")
-- NOW. goal_match counts the distinct words of the path's name + role (2+ letters, generic words such as
-- engineer / developer / analyst / full / stack skipped) that appear as whole words in the goal. More matching
-- words rank higher. A path with no role (the Python course row) never goal-matches. After that the order is
-- exactly as before (evidence, coverage, interest). Same columns; the reason text is unchanged.
-- Rollback: migration/137-rollback-suggest-tracks-goal-any-word.sql
begin;
do $$
declare
  f   constant regprocedure := 'public.suggest_tracks(uuid,integer)'::regprocedure;
  def text := pg_get_functiondef(f);
  a_old constant text := $a$coalesce(length(split_part(lower(t.role), ' ', 1)) > 3
        and split_part(lower(t.role), ' ', 1) not in ('software', 'senior', 'junior', 'full')
        and (select concat_ws(' ', (select rc.target_role from public.resume_claims rc where rc.student_id = _student_id order by rc.created_at desc limit 1),
                                  (select sp.target_role from public.student_profiles sp where sp.id = _student_id)))
            ~* ('\m' || split_part(lower(t.role), ' ', 1) || '\M'), false) as goal_match$a$;
  a_new constant text := $a$(select count(distinct w)
         from regexp_split_to_table(lower(t.name || ' ' || coalesce(t.role, '')), '[^a-z0-9]+') w
        where coalesce(t.role, '') <> '' and length(w) >= 2
          and w not in ('software', 'senior', 'junior', 'full', 'stack', 'engineer', 'engineering', 'developer',
                        'development', 'analyst', 'and', 'the', 'of', 'candidate')
          and (select concat_ws(' ', (select rc.target_role from public.resume_claims rc where rc.student_id = _student_id order by rc.created_at desc limit 1),
                                    (select sp.target_role from public.student_profiles sp where sp.id = _student_id)))
              ~* ('\m' || w || '\M'))::int as goal_match$a$;
begin
  if (length(def) - length(replace(def, a_old, ''))) / length(a_old) <> 1 then
    raise exception '137: suggest_tracks is not the version this migration expects (132)';
  end if;
  execute replace(def, a_old, a_new);
  if position('regexp_split_to_table(lower(t.name' in pg_get_functiondef(f)) = 0 then
    raise exception '137: not applied as written';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
