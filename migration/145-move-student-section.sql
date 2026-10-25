-- 145: a college can move a student to another section (owner request, 26 Oct 2026).
--
-- WHY. A student's section (cohort, for example CSE-A) was set once, by the CSV import (migration 52). A wrong
-- section could only be fixed by importing the file again. There was no way to change one student.
--
-- NOW.
--   tpo_sections()                          the college's sections with how many students each has
--   tpo_move_student_section(student, name) moves ONE student of this college to a section
-- Rules: only the student's own approved college may do it; the section name is trimmed and, if it matches an
-- existing section ignoring capital letters, that spelling is used (so "cse-a" does not make a second section).
-- If the student sits in a live squad of a DIFFERENT section, the seat is released (left_at is set, the history
-- row stays) and the student becomes a reserve of the new section for the college to place. Same-section
-- squads, other students and past seasons are not touched. Every move is written to the audit log.
begin;

create or replace function public.tpo_sections()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare cid uuid := public.my_college_id();
begin
  if cid is null then raise exception 'Only a college can read this.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('cohort', x.cohort, 'students', x.n) order by x.cohort)
      from (select cohort, count(*) as n
              from public.student_profiles
             where college_id = cid and cohort is not null
             group by cohort) x), '[]'::jsonb);
end $fn$;

create or replace function public.tpo_move_student_section(_student_id uuid, _cohort text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  cid uuid := public.my_college_id();
  st record;
  wanted text := nullif(btrim(_cohort), '');
  existing text;
  released integer := 0;
begin
  if cid is null then raise exception 'Only a college can move its students.'; end if;
  if wanted is null then raise exception 'Choose a section.'; end if;
  if length(wanted) > 60 then raise exception 'That section name is too long.'; end if;

  select id, full_name, college_id, cohort into st from public.student_profiles where id = _student_id;
  if st.id is null then raise exception 'No such student.'; end if;
  if st.college_id is distinct from cid then raise exception 'That student belongs to another college.'; end if;

  -- Reuse an existing spelling of the section, so a case difference never creates a second section.
  select x.c into existing
    from (select p.cohort as c, 1 as ord from public.student_profiles p
           where p.college_id = cid and p.cohort is not null
          union all
          select q.cohort, 2 from public.squads q
           where q.college_id = cid and q.cohort is not null and q.archived_at is null) x
   where lower(x.c) = lower(wanted)
   order by (x.c = wanted) desc, x.ord, x.c
   limit 1;
  wanted := coalesce(existing, wanted);

  if st.cohort is not distinct from wanted then
    return jsonb_build_object('ok', true, 'changed', false, 'cohort', wanted, 'released_squad', false);
  end if;

  update public.student_profiles set cohort = wanted where id = _student_id;

  -- A squad plays inside one section. A seat in a squad of another section is released; the row is closed, not deleted.
  update public.squad_members m
     set left_at = now()
    from public.squads q
   where m.student_id = _student_id and m.left_at is null
     and q.id = m.squad_id and q.archived_at is null
     and lower(coalesce(q.cohort, 'GENERAL')) is distinct from lower(wanted);
  get diagnostics released = row_count;

  perform public.write_audit('STUDENT_SECTION_MOVED', 'student_profiles', _student_id,
    jsonb_build_object('cohort', st.cohort), jsonb_build_object('cohort', wanted, 'released_squad', released > 0), cid);

  return jsonb_build_object('ok', true, 'changed', true, 'from', st.cohort, 'cohort', wanted,
                            'released_squad', released > 0);
end $fn$;

revoke all on function public.tpo_sections(), public.tpo_move_student_section(uuid, text) from public, anon, authenticated;
grant execute on function public.tpo_sections(), public.tpo_move_student_section(uuid, text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.tpo_move_student_section(uuid,text)', 'execute') then
    raise exception '145 self-check: anon can move students between sections';
  end if;
  if not has_function_privilege('authenticated', 'public.tpo_move_student_section(uuid,text)', 'execute') then
    raise exception '145 self-check: a college cannot move a student';
  end if;
  if not has_function_privilege('authenticated', 'public.tpo_sections()', 'execute') then
    raise exception '145 self-check: a college cannot list its sections';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
