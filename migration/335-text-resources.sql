-- 335 (owner 12 Nov 2026, A2 option b): Resources are TEXT shown inside the student app. Students are never sent
-- outside the app, so a resource is written in the admin form (title, short summary, body, optional skill/track tag)
-- and students never see a link.
--  1) learning_resources.body (the text). url is no longer required (new resources have none; old link-only rows stay
--     for the admin, who sees "Link-only: not shown to students").
--  2) One length rule on the table, same numbers as the admin form: title 1-150 (not blank), summary <= 300,
--     body <= 20000, tag (category) <= 60.
--  3) Raw table: the old read policy let ANY signed-in user read published rows, url included. Now only admins
--     (learning_resources_admin policy) read the table; students read only through student_resources().
--  4) student_resources(): signed-in STUDENTS only; published rows with body text; never returns url/platform.
-- Rollback: migration/335-rollback-text-resources.sql
begin;

alter table public.learning_resources add column if not exists body text;
alter table public.learning_resources alter column url drop not null;

alter table public.learning_resources drop constraint if exists learning_resources_text_length;
alter table public.learning_resources add constraint learning_resources_text_length check (
  char_length(btrim(title)) between 1 and 150
  and char_length(coalesce(description, '')) <= 300
  and char_length(coalesce(body, '')) <= 20000
  and char_length(coalesce(category, '')) <= 60) not valid;
alter table public.learning_resources validate constraint learning_resources_text_length;

drop policy if exists learning_resources_read on public.learning_resources;

create or replace function public.student_resources()
returns table (resource_id uuid, title text, summary text, body text, tag text, updated_at timestamptz)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
set timezone to 'Asia/Kolkata'
as $$
begin
  if not exists (select 1 from public.student_profiles sp where sp.user_id = (select auth.uid())) then
    raise exception 'Only students can see resources' using errcode = '42501';
  end if;
  return query
  select r.id, r.title, r.description, r.body, nullif(btrim(r.category), ''), r.updated_at
    from public.learning_resources r
   where r.status = 'published'
     and btrim(coalesce(r.body, '')) <> ''
   order by r.created_at desc
   limit 200;
end
$$;
revoke all on function public.student_resources() from public, anon;
grant execute on function public.student_resources() to authenticated;

do $$
begin
  if to_regprocedure('public.student_resources()') is null then
    raise exception '335: student_resources missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'learning_resources_text_length' and convalidated) then
    raise exception '335: length constraint missing';
  end if;
  if exists (select 1 from pg_policies where tablename = 'learning_resources' and policyname = 'learning_resources_read') then
    raise exception '335: open read policy still there';
  end if;
  if exists (select 1 from pg_proc where proname = 'student_resources'
              and proargnames && array['url', 'platform']::text[]) then
    raise exception '335: student_resources returns a link column';
  end if;
  begin
    perform public.student_resources();
    raise exception '335: student_resources answered without a student session';
  exception when insufficient_privilege then null;
  end;
end $$;

commit;
notify pgrst, 'reload schema';
