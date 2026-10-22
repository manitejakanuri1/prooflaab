-- ROLLBACK for 131: removes the Backend Development path. Refuses if any student has joined it.
begin;
do $$ begin
  if exists (select 1 from public.student_tracks where track_slug = 'backend') then
    raise exception 'rollback 131: students are on the backend path; move them first';
  end if;
end $$;
delete from public.track_phases where track_slug = 'backend';
delete from public.levels where track_slug = 'backend';
delete from public.level_tracks where slug = 'backend';
commit;
notify pgrst, 'reload schema';
