-- Rollback of 137: back to 132's first-word goal match.
begin;
do $$
declare
  f   constant regprocedure := 'public.suggest_tracks(uuid,integer)'::regprocedure;
  def text := pg_get_functiondef(f);
  a_old constant text := $a$(select count(distinct w)
         from regexp_split_to_table(lower(t.name || ' ' || coalesce(t.role, '')), '[^a-z0-9]+') w
        where coalesce(t.role, '') <> '' and length(w) >= 2
          and w not in ('software', 'senior', 'junior', 'full', 'stack', 'engineer', 'engineering', 'developer',
                        'development', 'analyst', 'and', 'the', 'of', 'candidate')
          and (select concat_ws(' ', (select rc.target_role from public.resume_claims rc where rc.student_id = _student_id order by rc.created_at desc limit 1),
                                    (select sp.target_role from public.student_profiles sp where sp.id = _student_id)))
              ~* ('\m' || w || '\M'))::int as goal_match$a$;
  a_new constant text := $a$coalesce(length(split_part(lower(t.role), ' ', 1)) > 3
        and split_part(lower(t.role), ' ', 1) not in ('software', 'senior', 'junior', 'full')
        and (select concat_ws(' ', (select rc.target_role from public.resume_claims rc where rc.student_id = _student_id order by rc.created_at desc limit 1),
                                  (select sp.target_role from public.student_profiles sp where sp.id = _student_id)))
            ~* ('\m' || split_part(lower(t.role), ' ', 1) || '\M'), false) as goal_match$a$;
begin
  if (length(def) - length(replace(def, a_old, ''))) / length(a_old) <> 1 then
    raise exception '137 rollback: suggest_tracks is not the 137 version';
  end if;
  execute replace(def, a_old, a_new);
end $$;
commit;
notify pgrst, 'reload schema';
