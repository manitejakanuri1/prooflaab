-- Rollback of 58: restores next_lot_source from 53, the open lot_templates read policy,
-- and drops the visibility column + trigger.
begin;
drop trigger if exists default_source_visibility on public.source_content;
drop function if exists public.default_source_visibility();
drop policy if exists lot_templates_admin_read on public.lot_templates;
create policy lot_templates_read on public.lot_templates for select to authenticated using (true);
alter table public.source_content drop constraint if exists source_content_visibility_check;
alter table public.source_content drop column if exists visibility;
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
  fresh as (
    select sc.id
      from public.source_content sc
     where sc.id not in (select source_content_id from mine)
       and sc.hidden_at is null
     order by
       (sc.submitted_by_college_id is not null
          and sc.submitted_by_college_id = (select college_id from me)) desc,
       (sc.submitted_by_college_id is not null) desc,
       exists (select 1 from unnest((select words from me)) w
                where length(w) > 2 and sc.title ilike '%' || w || '%') desc,
       md5(_student_id::text || sc.id::text)
     limit 1
  ),
  reuse as (
    select sc.id
      from public.source_content sc
      left join public.tasks k
        on k.source_content_id = sc.id and k.student_id = _student_id
     where sc.hidden_at is null
     group by sc.id
     order by max(k.lot_date) asc nulls first, md5(_student_id::text || sc.id::text)
     limit 1
  )
  select coalesce((select id from fresh), (select id from reuse));
$function$;
do $$ begin raise notice '58 rolled back'; end $$;
commit;
notify pgrst, 'reload schema';
