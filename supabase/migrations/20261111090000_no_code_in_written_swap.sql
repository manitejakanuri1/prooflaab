-- 227: a ready Lot handed out instead of a seed must not be a written Lot that asks for code.
--
-- 222 (sweep S3) swaps an unwritten seed Lot for a ready template. It accepted any written template, including
-- ones whose text asks for a program ("Plot honey production ... using pandas", Python starter code), which then
-- show only an answer box. Now a written template is skipped when lot_text_asks_for_code() says its text asks
-- for code or its Given box holds code. Code Lots (with tests) are still picked. No AI is called.
--
-- Rollback: migration/227-rollback-no-code-in-written-swap.sql
begin;

-- True when Lot text asks the student for a program or shows code (used to keep such text off written Lots).
create or replace function public.lot_text_asks_for_code(_title text, _scenario text, _code text)
 returns boolean language sql immutable set search_path to 'public', 'pg_temp' as $f$
  select (coalesce(_title, '') || ' ' || coalesce(_scenario, '')) ~* (
           '\m(write|build|create|implement|develop|code)\M\s+(a|an|the|your|one)?\s*([a-z-]+\s+){0,4}'
           || '(program|script|function|application|app|solver|calculator|simulator|cli|command-line tool)\M'
           || '|\m(python|java|javascript|c\+\+) (program|script|function|code)\M'
           || '|\m(pandas|matplotlib|numpy|your code|python code)\M')
      or coalesce(_code, '') ~ '(^|\n)\s*(import |from \w+ import |def \w+\(|class \w+|#include|public static)'
$f$;

CREATE OR REPLACE FUNCTION public.create_lot_for(_student_id uuid, _for_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
declare
  d    date := coalesce(_for_date, current_date);
  pick jsonb;
  scid uuid;
  cand uuid;
  tpl  record;
  n    integer;
  tid  uuid;
  cur  record;
begin
  select t.id, t.source_content_id into cur
    from public.tasks t where t.student_id = _student_id and t.lot_date = d limit 1;
  if cur.id is not null then
    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'source_content_id', cur.source_content_id,
                              'needs_writer', public.lot_needs_writer(cur.id));
  end if;
  if public.lot_day_kind(d) = 'rest' then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'rest day', 'needs_writer', false);
  end if;
  -- 184: no Daily Lot in the days off between two seasons (roadmap only)
  if public.in_season_gap(_student_id) is not null then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'between seasons', 'next_season_at', public.in_season_gap(_student_id), 'needs_writer', false);
  end if;
  pick := public.next_lot_pick(_student_id, d);
  scid := (pick->>'source_content_id')::uuid;
  cand := (pick->>'candidate_id')::uuid;
  if scid is null then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'no content available', 'needs_writer', false);
  end if;
  if cand is not null then
    select t.* into tpl from public.lot_templates t
      join public.lot_candidates c on c.lot_template_id = t.id where c.id = cand;
  end if;
  if tpl is null then
    select * into tpl from public.lot_templates where source_content_id = scid;
  end if;
  if tpl is null then
    perform public.seed_lot_template(scid);
    select * into tpl from public.lot_templates where source_content_id = scid;
    cand := (select c.id from public.lot_candidates c where c.lot_template_id = tpl.id);
  end if;
  if tpl is null then
    return jsonb_build_object('ok', false, 'reason', 'no template', 'needs_writer', false);
  end if;

  -- 222 (sweep S3, owner 11 Nov 2026): never hand out an unwritten Lot. If this page's template is still the
  -- seed, give a ready (written) template this student has not had, same kind first. No AI is called.
  -- Only when no ready template is left does the seed stay (the writer then fills it, as before).
  if tpl.origin = 'seed' then
    declare r record;
    begin
      select t.* into r
        from public.lot_templates t
       where t.origin = 'ai'
         and coalesce(t.sandbox_config_id, t.rubric_config_id) is not null
         -- 227: a written template whose text asks for a program would give an answer box for code.
         and not (t.sandbox_config_id is null and public.lot_text_asks_for_code(t.title, t.scenario, t.code_sample))
         and not exists (select 1 from public.tasks k
                          where k.student_id = _student_id and k.source_content_id = t.source_content_id)
       order by (t.lot_category is not distinct from tpl.lot_category) desc,
                md5(_student_id::text || t.id::text)
       limit 1;
      if r.id is not null then
        tpl := r;
        scid := r.source_content_id;
        cand := (select c.id from public.lot_candidates c where c.lot_template_id = r.id limit 1);
        pick := coalesce(pick, '{}'::jsonb) || jsonb_build_object('rule', 'ready_instead_of_seed',
                  'source_content_id', scid, 'candidate_id', cand);
      end if;
    end;
  end if;
  select count(*) + 1 into n from public.tasks where student_id = _student_id and lot_date is not null;
  insert into public.tasks
    (student_id, title, description, code_sample, source_jd, difficulty,
     estimate_minutes, lot_category, lot_number, lot_date, source_content_id,
     status, visibility, due_date, is_ai_generated, created_by_type, source,
     xp_reward, sandbox_config_id, rubric_config_id, lot_candidate_id, lot_selection)
  values
    (_student_id, tpl.title, tpl.scenario, tpl.code_sample, tpl.source_jd, tpl.difficulty,
     tpl.estimate_minutes, tpl.lot_category, n, d, scid,
     'pending', 'private', (d + 1)::timestamptz - interval '1 second',
     tpl.origin = 'ai', 'system', 'daily_lot',
     tpl.xp_reward, tpl.sandbox_config_id, tpl.rubric_config_id, cand, pick)
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
  return jsonb_build_object('ok', true, 'task_id', tid, 'created', true, 'source_content_id', scid,
                            'rule', pick->>'rule', 'needs_writer', tpl.origin = 'seed');
end $function$;

do $$
begin
  if position('lot_text_asks_for_code' in pg_get_functiondef('public.create_lot_for'::regproc)) = 0 then
    raise exception '227 self-check: create_lot_for was not replaced';
  end if;
  if not public.lot_text_asks_for_code('Plot honey production', 'Load the CSV using pandas.', null)
     or not public.lot_text_asks_for_code('x', 'y', E'import pandas as pd
df = 1')
     or public.lot_text_asks_for_code('Solve Time and Work Problems', 'Solve the three problems step by step.', '1. A takes 12 days?') then
    raise exception '227 self-check: lot_text_asks_for_code gives a wrong answer';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
