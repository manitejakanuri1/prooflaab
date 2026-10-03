-- 58: a college's own material reaches only that college's students (§16).
--
-- source_content.visibility: 'platform' (crawled public pages: every student) or
-- 'college' (submitted by a college: only that college's students). Material a
-- college submits is 'college' by default; it becomes platform-wide only if
-- someone deliberately sets 'platform' (no screen does today).
--
-- next_lot_source - the only path from a page to a student's Lot - filters on it,
-- in the database, for both fresh pages and re-use.
--
-- lot_templates was readable by every signed-in user (policy using (true)), which
-- included Lots written from one college's private material. No screen reads it:
-- students get their Lot through tasks/my_todays_lot, admins through
-- admin_content_library (definer). It is now admin-only.
--
-- Rollback: migration/58-rollback-college-source-privacy.sql
begin;

alter table public.source_content add column if not exists visibility text not null default 'platform';
alter table public.source_content drop constraint if exists source_content_visibility_check;
alter table public.source_content add constraint source_content_visibility_check
  check (visibility in ('platform', 'college') and (visibility = 'platform' or submitted_by_college_id is not null));
update public.source_content set visibility = 'college'
 where submitted_by_college_id is not null and visibility <> 'college';

create or replace function public.default_source_visibility()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.submitted_by_college_id is not null then
    new.visibility := 'college';
  end if;
  return new;
end $$;
drop trigger if exists default_source_visibility on public.source_content;
create trigger default_source_visibility before insert on public.source_content
  for each row execute function public.default_source_visibility();

create or replace function public.next_lot_source(_student_id uuid)
returns uuid
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with mine as (
    select distinct k.source_content_id
      from public.tasks k
     where k.student_id = _student_id and k.source_content_id is not null
  ),
  me as (
    select p.college_id,
           array_remove(
             coalesce(p.preferred_skills, '{}') || coalesce(p.key_interests, '{}') ||
             coalesce(p.secondary_roles, '{}') || string_to_array(coalesce(p.target_role, ''), ' '),
             '') as words
      from public.student_profiles p where p.id = _student_id
  ),
  allowed as (
    select sc.* from public.source_content sc
     where sc.hidden_at is null
       and (sc.visibility = 'platform'
            or (sc.submitted_by_college_id is not null
                and sc.submitted_by_college_id = (select college_id from me)))
  ),
  fresh as (
    select a.id
      from allowed a
     where a.id not in (select source_content_id from mine)
     order by
       (a.submitted_by_college_id is not null
          and a.submitted_by_college_id = (select college_id from me)) desc,
       exists (select 1 from unnest((select words from me)) w
                where length(w) > 2 and a.title ilike '%' || w || '%') desc,
       md5(_student_id::text || a.id::text)
     limit 1
  ),
  reuse as (
    select a.id
      from allowed a
      left join public.tasks k
        on k.source_content_id = a.id and k.student_id = _student_id
     group by a.id
     order by max(k.lot_date) asc nulls first, md5(_student_id::text || a.id::text)
     limit 1
  )
  select coalesce((select id from fresh), (select id from reuse));
$function$;

drop policy if exists lot_templates_read on public.lot_templates;
drop policy if exists lot_templates_admin_read on public.lot_templates;
create policy lot_templates_admin_read on public.lot_templates
  for select to authenticated using ((select public.is_admin()));

do $$
declare c record; s uuid; got uuid;
begin
  if exists (select 1 from public.source_content where submitted_by_college_id is not null and visibility <> 'college') then
    raise exception 'college material left platform-wide';
  end if;
  if exists (select 1 from pg_policies where tablename = 'lot_templates' and qual = 'true') then
    raise exception 'lot_templates still readable by everyone';
  end if;
  -- behaviour: no student ever receives another college's private page
  for c in select id, submitted_by_college_id from public.source_content where visibility = 'college' loop
    for s in select p.id from public.student_profiles p
              where p.college_id is distinct from c.submitted_by_college_id limit 50 loop
      if exists (
        with me as (select college_id from public.student_profiles where id = s)
        select 1 from public.source_content sc
         where sc.id = c.id and not (sc.visibility = 'platform' or sc.submitted_by_college_id = (select college_id from me))
           and public.next_lot_source(s) = sc.id) then
        raise exception 'student % would receive private material of another college', s;
      end if;
    end loop;
  end loop;
  raise notice '58: college material is college-only; lot templates admin-only';
end $$;

commit;
notify pgrst, 'reload schema';
