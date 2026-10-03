-- Rollback of 53: restores next_lot_source (from 20261011000000_auto_squads_and_content_library.sql)
-- and seed_lot_template (from 20261001001600_stage75_delink_lots_from_tracks.sql) exactly as they were.
begin;
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
  my_college as (
    select college_id from public.student_profiles where id = _student_id
  ),
  fresh as (
    select sc.id
      from public.source_content sc
     where sc.id not in (select source_content_id from mine)
       and sc.hidden_at is null
     order by
       (sc.submitted_by_college_id is not null
          and sc.submitted_by_college_id = (select college_id from my_college)) desc,
       (sc.submitted_by_college_id is not null) desc,
       sc.fetched_at asc
     limit 1
  ),
  reuse as (
    select sc.id
      from public.source_content sc
      left join public.tasks k
        on k.source_content_id = sc.id and k.student_id = _student_id
     where sc.hidden_at is null
     group by sc.id
     order by max(k.lot_date) asc nulls first
     limit 1
  )
  select coalesce((select id from fresh), (select id from reuse));
$function$;

create or replace function public.seed_lot_template(_source_content_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c record;
  fallback_rubric uuid;
begin
  select * into c from public.source_content where id = _source_content_id;
  if c is null then return; end if;

  select id into fallback_rubric from public.task_rubric_config where is_generic_fallback limit 1;

  -- ponytail: seed placeholder has no signal to pick difficulty/category from
  -- (no Track level to bucket by anymore), so it always seeds Medium/technical.
  -- Harmless — this row is overwritten by lot-writer within seconds for the
  -- first real student to reach it; nobody reads the seed for long.
  insert into public.lot_templates
    (source_content_id, title, scenario, difficulty, estimate_minutes, lot_category, origin, rubric_config_id)
  values (
    _source_content_id,
    coalesce(c.title, 'Today''s real question'),
    'Build the smallest working thing that proves you understand ' ||
      coalesce(c.title, 'this') || '. Submit what you built, then record sixty ' ||
      'seconds explaining why your approach is right and what you would do ' ||
      'differently with more time.',
    'Medium',
    20,
    'technical',
    'seed',
    fallback_rubric)
  on conflict (source_content_id) do nothing;
end $function$;
do $$ begin raise notice '53 rolled back'; end $$;
commit;
notify pgrst, 'reload schema';
