-- ROLLBACK for 88-daily-lots-v2-evidence-selection.sql
-- Restores create_lot_for, my_todays_lot and protect_tasks exactly as they were before 88 (copied from the
-- live staging definitions on 2026-10-06) and removes everything 88 added.
-- WARNING: drops tasks.lot_candidate_id / tasks.lot_selection, so the stored WHY_SELECTED reasons are lost.
begin;
drop function if exists public.admin_daily_lots(date, text, integer, integer);
drop function if exists public.next_lot_pick(uuid);
drop function if exists public.lot_candidate_pool(uuid, uuid);
drop function if exists public.lot_skill_evidence(uuid, integer);
drop trigger if exists lot_template_to_candidate on public.lot_templates;
drop function if exists public.lot_template_to_candidate();
drop function if exists public.sync_lot_candidate(uuid);
CREATE OR REPLACE FUNCTION public.create_lot_for(_student_id uuid, _for_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d    date := coalesce(_for_date, current_date);
  scid uuid;
  tpl  record;
  n    integer;
  tid  uuid;
  cur  record;
begin
  select t.id, t.source_content_id
    into cur
    from public.tasks t
   where t.student_id = _student_id and t.lot_date = d
   limit 1;

  if cur.id is not null then
    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'source_content_id', cur.source_content_id,
                              'needs_writer', public.lot_needs_writer(cur.id));
  end if;

  scid := public.next_lot_source(_student_id);
  if scid is null then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'no content available', 'needs_writer', false);
  end if;

  select * into tpl from public.lot_templates where source_content_id = scid;
  if tpl is null then
    perform public.seed_lot_template(scid);
    select * into tpl from public.lot_templates where source_content_id = scid;
  end if;
  if tpl is null then
    return jsonb_build_object('ok', false, 'reason', 'no template', 'needs_writer', false);
  end if;

  select count(*) + 1 into n from public.tasks
   where student_id = _student_id and lot_date is not null;

  insert into public.tasks
    (student_id, title, description, code_sample, source_jd, difficulty,
     estimate_minutes, lot_category, lot_number, lot_date, source_content_id,
     status, visibility, due_date, is_ai_generated, created_by_type, source,
     xp_reward, sandbox_config_id, rubric_config_id)
  values
    (_student_id, tpl.title, tpl.scenario, tpl.code_sample, tpl.source_jd, tpl.difficulty,
     tpl.estimate_minutes, tpl.lot_category, n, d, scid,
     'pending', 'private', (d + 1)::timestamptz - interval '1 second',
     tpl.origin = 'ai', 'system', 'daily_lot',
     tpl.xp_reward, tpl.sandbox_config_id, tpl.rubric_config_id)
  on conflict (student_id, lot_date) where lot_date is not null do nothing
  returning id into tid;

  if tid is null then
    select t.id, t.source_content_id into cur from public.tasks t
     where t.student_id = _student_id and t.lot_date = d limit 1;
    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'reason', 'another request created it first',
                              'source_content_id', cur.source_content_id,
                              'needs_writer', public.lot_needs_writer(cur.id));
  end if;

  return jsonb_build_object('ok', true, 'task_id', tid, 'created', true,
                            'source_content_id', scid, 'needs_writer', tpl.origin = 'seed');
end
$function$;

drop function if exists public.my_todays_lot();
CREATE FUNCTION public.my_todays_lot()
 RETURNS TABLE(id uuid, lot_number integer, title text, description text, code_sample text, source_jd text, difficulty text, estimate_minutes integer, lot_category text, status text, due_date timestamp with time zone, sponsored_by_company text, sandbox_config_id uuid, rubric_config_id uuid, source_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select t.id, t.lot_number, t.title, t.description, t.code_sample, t.source_jd,
         t.difficulty, t.estimate_minutes, t.lot_category, t.status, t.due_date,
         r.company, t.sandbox_config_id, t.rubric_config_id,
         coalesce(
           (select g.name from public.source_content sc
              join public.source_registry g on g.id = sc.source_id
             where sc.id = t.source_content_id),
           case when t.source_jd is not null then 'A real job posting' end)
    from public.tasks t
    left join public.recruiters r on r.id = t.sponsored_by
   where t.student_id = auth.uid() and t.lot_date = current_date
   limit 1;
$function$;

-- ACLs exactly as before 88
revoke all on function public.create_lot_for(uuid, date) from public, anon, authenticated;
grant execute on function public.create_lot_for(uuid, date) to service_role;
grant execute on function public.my_todays_lot() to public, anon, authenticated, service_role;
drop trigger if exists protect_tasks on public.tasks;
create trigger protect_tasks before update on public.tasks
  for each row execute function public.protect_columns(
    'xp', 'xp_reward', 'suggested_xp', 'approved_by_admin', 'status', 'sandbox_config_id', 'rubric_config_id');
alter table public.tasks drop column if exists lot_selection;
alter table public.tasks drop column if exists lot_candidate_id;
drop table if exists public.lot_candidates;
drop function if exists public.tag_skills(text);
drop table if exists public.skill_vocab;
do $$ begin
  if to_regclass('public.lot_candidates') is not null then raise exception 'rollback 88: lot_candidates still there'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'tasks' and column_name in ('lot_selection','lot_candidate_id')) then raise exception 'rollback 88: task columns still there'; end if;
  if position('next_lot_source' in (select prosrc from pg_proc where oid = 'public.create_lot_for(uuid,date)'::regprocedure)) = 0 then raise exception 'rollback 88: create_lot_for not restored'; end if;
end $$;
commit;
notify pgrst, 'reload schema';
