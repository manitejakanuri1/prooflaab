-- 132: the path that matches the student's own goal is suggested first.
--
-- WHY. A student aiming at "Backend Developer" was placed on Data Science; their path never matched their
-- goal (roadmap issue A, 22 Oct 2026). suggest_tracks ranked by resume-skill overlap only, and the goal was
-- not read at all.
-- NOW. A path whose role starts with a word in the student's goal (latest resume target role, or the
-- profile's) ranks first: goal "Backend Developer" -> path role "Backend developer". Generic first words
-- (software, senior, junior, full) never count. After that the order is exactly as before (evidence,
-- coverage, interest). Same columns; the reason text is unchanged.
-- Rollback: migration/132-rollback-suggest-tracks-goal-first.sql
begin;
do $$
declare
  f   constant regprocedure := 'public.suggest_tracks(uuid,integer)'::regprocedure;
  def text := pg_get_functiondef(f);
  a_old constant text := 'exists (select 1 from interests i where i.interest = t.interest) as from_interest';
  a_new constant text := $a$exists (select 1 from interests i where i.interest = t.interest) as from_interest,
      coalesce(length(split_part(lower(t.role), ' ', 1)) > 3
        and split_part(lower(t.role), ' ', 1) not in ('software', 'senior', 'junior', 'full')
        and (select concat_ws(' ', (select rc.target_role from public.resume_claims rc where rc.student_id = _student_id order by rc.created_at desc limit 1),
                                  (select sp.target_role from public.student_profiles sp where sp.id = _student_id)))
            ~* ('\m' || split_part(lower(t.role), ' ', 1) || '\M'), false) as goal_match$a$;
  b_old constant text := 'order by s.matched_steps desc';
  b_new constant text := 'order by s.goal_match desc, s.matched_steps desc';
  g_old constant text := 'group by t.slug, t.name, t.emoji, t.role, t.sort_order';
  g_new constant text := 'group by t.slug, t.name, t.emoji, t.role, t.sort_order, t.interest';
begin
  if (length(def) - length(replace(def, a_old, ''))) / length(a_old) <> 1
     or (length(def) - length(replace(def, b_old, ''))) / length(b_old) <> 1
     or (length(def) - length(replace(def, g_old, ''))) / length(g_old) <> 1 then
    raise exception '132: suggest_tracks is not the version this migration expects';
  end if;
  execute replace(replace(replace(def, a_old, a_new), b_old, b_new), g_old, g_new);
  if position('goal_match desc' in pg_get_functiondef(f)) = 0 or position($b$'\m' ||$b$ in pg_get_functiondef(f)) = 0 then
    raise exception '132: not applied as written';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
