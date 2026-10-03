-- 53: personalised Lot order and an honest seed Lot.
--
-- next_lot_source used to hand every student the same oldest unused page, so a
-- whole class worked on the same Lot on the same day (N6). Order now, for pages
-- this student has not had:
--   1. material their own college submitted;  2. material any college submitted;
--   3. pages whose title matches the student's target role, skills or interests;
--   4. a stable per-student shuffle (md5 of student + page), so classmates differ.
-- Still one shared, validated template per page - only the ORDER is personal, no
-- extra AI cost. When every page is used, the least recently used one returns.
--
-- The seed Lot (shown only until the real one is written) promised "record sixty
-- seconds" and asked to "submit what you built"; it now follows the wording
-- contract and asks for a written answer in the box.
--
-- Rollback: migration/53-rollback-lot-order-and-seed-wording.sql
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
  insert into public.lot_templates
    (source_content_id, title, scenario, difficulty, estimate_minutes, lot_category, origin, rubric_config_id)
  values (
    _source_content_id,
    coalesce(c.title, 'Today''s real question'),
    'Today''s work is about ' || coalesce(c.title, 'a real workplace topic') || '. The full task is being prepared.' || chr(10) ||
      'Your task: explain in your own words what this topic is about and where it is used in real work.' || chr(10) ||
      'What to write: in the answer box, 100 to 200 words with one concrete example.',
    'Medium',
    20,
    'technical',
    'seed',
    fallback_rubric)
  on conflict (source_content_id) do nothing;
end $function$;

do $$
declare s uuid; t uuid; scen text;
begin
  -- same student, same call, same answer (stable), and it returns a visible page
  select id into s from public.student_profiles limit 1;
  if s is not null and exists (select 1 from public.source_content where hidden_at is null) then
    t := public.next_lot_source(s);
    if t is null then raise exception 'next_lot_source returned nothing'; end if;
    if t is distinct from public.next_lot_source(s) then raise exception 'next_lot_source is not stable'; end if;
    if exists (select 1 from public.source_content where id = t and hidden_at is not null) then
      raise exception 'next_lot_source returned a hidden page';
    end if;
  end if;
  select prosrc into scen from pg_proc where oid = 'public.seed_lot_template(uuid)'::regprocedure;
  if scen ilike '%sixty seconds%' or scen ilike '%Submit what you built%' then raise exception 'seed text still asks for a recording'; end if;
  raise notice '53: personalised Lot order and contract seed text in place';
end $$;

commit;
notify pgrst, 'reload schema';
