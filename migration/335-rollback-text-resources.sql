-- Rollback for 335: student function and length rule removed, old read policy back (any signed-in user reads
-- published rows). body column is KEPT (dropping it would delete written text); url stays nullable unless every
-- row has one.
begin;
drop function if exists public.student_resources();
alter table public.learning_resources drop constraint if exists learning_resources_text_length;
drop policy if exists learning_resources_read on public.learning_resources;
create policy learning_resources_read on public.learning_resources for select to authenticated
  using (status = 'published' or (select public.is_admin()));
do $$ begin
  if not exists (select 1 from public.learning_resources where url is null) then
    alter table public.learning_resources alter column url set not null;
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
