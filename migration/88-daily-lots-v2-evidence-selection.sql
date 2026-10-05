-- 88: Daily Lots v2 - task candidates with skill metadata, and evidence-based, explainable selection.
--
-- Product rule: ROADMAP != DAILY LOTS. Nothing here reads student_tracks, student_levels, levels,
-- total_xp or any roadmap table. The crawler, source_content, lot_templates and lot-writer are unchanged.
--
-- What it adds:
--   skill_vocab        fixed skill list + keyword patterns (deterministic tagging; no model decides a tag)
--   tag_skills(text)   text -> skills, from skill_vocab
--   lot_candidates     reusable task candidates: source_content_id, skills, topic, difficulty, task_type,
--                      grading_mode, provenance, status. Kept in sync with lot_templates by a trigger, so
--                      every template lot-writer saves becomes (or updates) a candidate with no writer change.
--                      Not unique per page: one page may hold several candidates.
--   lot_skill_evidence per-skill performance from a student's REAL stored Daily-Lot evidence
--   next_lot_pick      deterministic choice of the next candidate + WHY_SELECTED built only from that evidence
--   create_lot_for     same as before, but asks next_lot_pick first and stores the choice on the task
--   my_todays_lot      also returns why_selected, focus_skill, lot_skills
--   admin_daily_lots   admin inspection of Daily Lots (read-only)

-- 1. vocabulary ----------------------------------------------------------------------------------------
create table if not exists public.skill_vocab (
  skill   text primary key,
  pattern text not null            -- PostgreSQL ARE, matched case-insensitively with ~*
);
alter table public.skill_vocab enable row level security;
revoke all on public.skill_vocab from public, anon, authenticated;
grant select on public.skill_vocab to service_role;

insert into public.skill_vocab (skill, pattern) values
  ('Python',           '\mpython\M|\mpip install\M|\mdjango\M|\mflask\M|\mdef [a-z_]+\('),
  ('SQL',              '\msql\M|\m(inner|left|right|full|outer|cross) join\M|\mgroup by\M|\morder by\M|\mpostgres(ql)?\M|\mmysql\M|\msqlite\M|\mprimary key\M|\mforeign key\M'),
  ('JavaScript',       '\mjavascript\M|\mnode\.?js\M|\mnpm\M'),
  ('TypeScript',       '\mtypescript\M'),
  ('React',            '\mreact(\.?js)?\M|\mjsx\M|\musestate\M|\museeffect\M'),
  ('HTML/CSS',         '\mhtml\M|\mcss\M|\mflexbox\M'),
  ('Java',             '\mjava\M|\mspring boot\M|\mpublic static void\M'),
  ('C++',              'c\+\+|\mcpp\M|\mstd::'),
  ('C#',               'c#|\m\.net\M'),
  ('Linux',            '\mlinux\M|\mubuntu\M|\mchmod\M|\mgrep\M|\msudo\M|\msystemd\M'),
  ('Bash',             '\mbash\M|\mshell script(s|ing)?\M|\mcommand[- ]line\M|\mterminal\M'),
  ('Git & GitHub',     '\mgit\M|\mgithub\M|\mpull request\M|\mmerge conflict\M'),
  ('Docker',           '\mdocker(file)?\M|\mcontainer image\M'),
  ('Kubernetes',       '\mkubernetes\M|\mk8s\M|\mkubectl\M'),
  ('AWS',              '\maws\M|\mec2\M|\ms3 bucket\M|\mamazon web services\M'),
  ('Networking',       '\mtcp\M|\mudp\M|\mdns\M|\msubnet\M|\mip address\M|\mrouting table\M'),
  ('REST APIs',        '\mrest(ful)? api\M|\mapi endpoint\M|\mhttp (get|post|put|patch|delete)\M|\mstatus code\M'),
  ('Pandas',           '\mpandas\M|\mdataframe\M'),
  ('NumPy',            '\mnumpy\M'),
  ('Statistics',       '\mstatistic(s|al)\M|\mstandard deviation\M|\mvariance\M|\mhypothesis test\M'),
  ('Probability',      '\mprobabilit(y|ies)\M'),
  ('Excel',            '\mexcel\M|\mspreadsheet\M|\mvlookup\M'),
  ('Machine Learning', '\mmachine learning\M|\mscikit|\msklearn\M|\mregression model\M|\mclassifier\M|\mtraining data\M'),
  ('DSA',              '\malgorithm\M|\mdata structure\M|\mlinked list\M|\mbinary search\M|\mrecursion\M|\mhash ?map\M|\mbig[- ]o\M|\mtime complexity\M'),
  ('Cybersecurity',    '\mvulnerabilit(y|ies)\M|\mowasp\M|\mxss\M|\msql injection\M|\mphishing\M|\mfirewall\M'),
  ('Workplace Writing','\mplacement drive\M|\mwork order\M|\mmeeting notes\M|\mstatus update\M|\memail to\M')
on conflict (skill) do update set pattern = excluded.pattern;

create or replace function public.tag_skills(_text text)
returns text[]
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select coalesce(array_agg(v.skill order by v.skill), '{}')
    from public.skill_vocab v
   where coalesce(_text, '') ~* v.pattern;
$function$;

-- 2. candidates ---------------------------------------------------------------------------------------
create table if not exists public.lot_candidates (
  id                uuid primary key default gen_random_uuid(),
  source_content_id uuid not null references public.source_content(id) on delete cascade,
  lot_template_id   uuid unique references public.lot_templates(id) on delete set null,
  skills            text[] not null default '{}',
  topic             text,
  subtopic          text,
  difficulty        text,
  task_type         text check (task_type in ('code', 'written')),
  grading_mode      text check (grading_mode in ('sandbox', 'rubric')),
  provenance        jsonb not null default '{}'::jsonb,
  status            text not null default 'draft' check (status in ('active', 'draft', 'retired')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists lot_candidates_source_idx on public.lot_candidates (source_content_id);
create index if not exists lot_candidates_skills_idx on public.lot_candidates using gin (skills);
alter table public.lot_candidates enable row level security;      -- no policy: read through admin_daily_lots / my_todays_lot only
revoke all on public.lot_candidates from public, anon, authenticated;
grant select, insert, update, delete on public.lot_candidates to service_role;

-- Build a candidate row from a template (+ its page). Deterministic; no model call.
create or replace function public.sync_lot_candidate(_template_id uuid)
returns uuid
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  t  record; sc record; sk text[]; cid uuid;
begin
  select * into t from public.lot_templates where id = _template_id;
  if t is null or t.source_content_id is null then return null; end if;
  select s.id, s.title, s.url, s.canonical_url, s.rights_flag, s.visibility, s.submitted_by_college_id,
         g.name as source_name, g.domain
    into sc
    from public.source_content s left join public.source_registry g on g.id = s.source_id
   where s.id = t.source_content_id;
  sk := public.tag_skills(concat_ws(' ', t.title, t.scenario, t.code_sample, sc.title));
  if cardinality(sk) = 0 and t.lot_category = 'business' then sk := array['Workplace Writing']; end if;
  insert into public.lot_candidates as c
    (source_content_id, lot_template_id, skills, topic, difficulty, task_type, grading_mode, provenance, status)
  values
    (t.source_content_id, t.id, sk, sk[1], t.difficulty,
     case when t.sandbox_config_id is not null then 'code' when t.rubric_config_id is not null then 'written' end,
     case when t.sandbox_config_id is not null then 'sandbox' when t.rubric_config_id is not null then 'rubric' end,
     jsonb_build_object('source_content_id', sc.id, 'page_title', sc.title,
                        'url', coalesce(sc.canonical_url, sc.url), 'source_name', sc.source_name,
                        'domain', sc.domain, 'rights_flag', sc.rights_flag, 'visibility', sc.visibility,
                        'template_origin', t.origin, 'tagged_by', 'skill_vocab'),
     -- only a written template with a grading config can be chosen by the evidence rules
     case when t.origin <> 'seed' and (t.sandbox_config_id is not null or t.rubric_config_id is not null)
          then 'active' else 'draft' end)
  on conflict (lot_template_id) do update
     set skills = excluded.skills, topic = excluded.topic, difficulty = excluded.difficulty,
         task_type = excluded.task_type, grading_mode = excluded.grading_mode,
         provenance = excluded.provenance,
         status = case when c.status = 'retired' then 'retired' else excluded.status end,
         updated_at = now()
  returning id into cid;
  return cid;
end $function$;

create or replace function public.lot_template_to_candidate()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  perform public.sync_lot_candidate(new.id);
  return new;
end $function$;
drop trigger if exists lot_template_to_candidate on public.lot_templates;
create trigger lot_template_to_candidate
  after insert or update of title, scenario, code_sample, difficulty, origin, lot_category,
                            sandbox_config_id, rubric_config_id, source_content_id
  on public.lot_templates
  for each row execute function public.lot_template_to_candidate();

-- backfill: one candidate per existing page-keyed template
select public.sync_lot_candidate(id) from public.lot_templates where source_content_id is not null;

-- 3. tasks remember which candidate was chosen and why -----------------------------------------------
alter table public.tasks add column if not exists lot_candidate_id uuid references public.lot_candidates(id) on delete set null;
alter table public.tasks add column if not exists lot_selection jsonb;
comment on column public.tasks.lot_selection is
  '88: why this Daily Lot was chosen: {version, rule, focus_skill, why, evidence}. Built only from stored evidence.';
drop trigger if exists protect_tasks on public.tasks;
create trigger protect_tasks before update on public.tasks
  for each row execute function public.protect_columns(
    'xp', 'xp_reward', 'suggested_xp', 'approved_by_admin', 'status', 'sandbox_config_id', 'rubric_config_id',
    'lot_candidate_id', 'lot_selection');

-- 4. evidence -----------------------------------------------------------------------------------------
-- Per skill, over the student's last _lots Daily Lots that have at least one submission.
-- Score/tests/attempts come from task_submissions (latest submission per task); voice from the
-- latest scored voice_explanations row of that task. Nothing else is used. XP is never used.
create or replace function public.lot_skill_evidence(_student_id uuid, _lots integer default 10)
returns table (
  skill text, lots integer, avg_score integer, tests_passed integer, tests_total integer,
  attempts integer, failed integer, needs_review integer, voice_avg integer, match_avg integer,
  weakest_criterion text, last_difficulty text, last_at timestamptz, last_title text
)
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with lots as (
    select t.id, t.title, t.difficulty, t.lot_date,
           coalesce(c1.skills, c2.skills, '{}') as skills
      from public.tasks t
      left join public.lot_candidates c1 on c1.id = t.lot_candidate_id
      left join lateral (select c.skills from public.lot_candidates c
                          where c.source_content_id = t.source_content_id
                          order by c.created_at limit 1) c2 on true
     where t.student_id = _student_id and t.lot_date is not null
       and exists (select 1 from public.task_submissions s where s.task_id = t.id)
     order by t.lot_date desc
     limit greatest(1, least(coalesce(_lots, 10), 50))
  ),
  per_task as (
    select l.*, s.sandbox_score, s.passed_count, s.total_count, s.status, s.created_at as sub_at,
           s.rubric_scores, s.rubric_config_id,
           (select count(*) from public.task_submissions x where x.task_id = l.id) as n_attempts,
           v.communication_score, (v.evaluation->>'content_match')::int as content_match
      from lots l
      join lateral (select * from public.task_submissions s where s.task_id = l.id
                     order by s.created_at desc limit 1) s on true
      left join lateral (select ve.communication_score, ve.evaluation from public.voice_explanations ve
                          where ve.task_id = l.id and ve.status = 'scored' and ve.withdrawn_at is null
                          order by ve.created_at desc limit 1) v on true
  ),
  weakest as (
    select p.id,
           (select cr->>'name'
              from jsonb_array_elements(coalesce(p.rubric_scores, '[]'::jsonb)) rs
              join public.task_rubric_config rc on rc.id = p.rubric_config_id
              join lateral jsonb_array_elements(rc.criteria) cr on cr->>'id' = rs->>'criterion_id'
             where (cr->>'max_points')::numeric > 0
             order by (rs->>'points')::numeric / (cr->>'max_points')::numeric asc
             limit 1) as crit
      from per_task p
  )
  select sk,
         count(*)::int,
         round(avg(p.sandbox_score))::int,
         sum(p.passed_count) filter (where p.total_count is not null)::int,
         sum(p.total_count)::int,
         sum(p.n_attempts)::int,
         count(*) filter (where p.status = 'failed')::int,
         count(*) filter (where p.status = 'needs_review')::int,
         round(avg(p.communication_score))::int,
         round(avg(p.content_match))::int,
         (array_agg(w.crit order by p.lot_date desc) filter (where w.crit is not null))[1],
         (array_agg(p.difficulty order by p.lot_date desc))[1],
         max(p.sub_at),
         (array_agg(p.title order by p.lot_date desc))[1]
    from per_task p
    join weakest w on w.id = p.id
    cross join lateral unnest(p.skills) sk
   group by sk;
$function$;

-- 5. deterministic pick -------------------------------------------------------------------------------
-- Unseen ACTIVE candidates this student may see (same visibility rule as next_lot_source, migration 58).
create or replace function public.lot_candidate_pool(_student_id uuid, _college_id uuid)
returns table (candidate_id uuid, source_content_id uuid, skills text[], difficulty text, task_type text, own_college boolean)
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select c.id, c.source_content_id, c.skills, c.difficulty, c.task_type,
         (sc.submitted_by_college_id is not null and sc.submitted_by_college_id = _college_id)
    from public.lot_candidates c
    join public.source_content sc on sc.id = c.source_content_id
   where c.status = 'active' and c.lot_template_id is not null
     and sc.hidden_at is null
     and (sc.visibility = 'platform'
          or (sc.submitted_by_college_id is not null and sc.submitted_by_college_id = _college_id))
     and not exists (select 1 from public.tasks k
                      where k.student_id = _student_id and k.source_content_id = c.source_content_id);
$function$;

-- Same input -> same output (ties broken by md5(student, candidate)). No model, no roadmap, no XP.
create or replace function public.next_lot_pick(_student_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare
  college uuid;
  ev      record;
  ev_json jsonb;
  c_id    uuid;  c_sc uuid;  c_sk text[];  c_diff text;
  rule    text;
  why     text;
  focus   text;
  scid    uuid;
  drank   int;
  has_ev  boolean;
  ev10    jsonb;   -- evidence is read ONCE per student (15 ms each on staging) and reused below
  ev3     jsonb;
begin
  select p.college_id into college from public.student_profiles p where p.id = _student_id;
  ev10 := (select jsonb_agg(to_jsonb(e)) from public.lot_skill_evidence(_student_id, 10) e);
  has_ev := ev10 is not null;

  -- Rule 1 STRENGTHEN: weakest recent skill (avg < 70) -> an unseen candidate on that skill, nearest difficulty.
  for ev in select * from jsonb_to_recordset(coalesce(ev10, '[]')) as e(skill text, lots int, avg_score int, tests_passed int, tests_total int, attempts int, failed int, needs_review int, voice_avg int, match_avg int, weakest_criterion text, last_difficulty text, last_at timestamptz, last_title text)
             where e.avg_score < 70 order by e.avg_score asc, e.last_at desc loop
    drank := case lower(ev.last_difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end;
    select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
      from public.lot_candidate_pool(_student_id, college) p where ev.skill = any(p.skills)
     order by abs(case lower(p.difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end - drank),
              p.own_college desc, md5(_student_id::text || p.candidate_id::text)
     limit 1;
    if c_id is not null then
      rule := 'strengthen'; focus := ev.skill; ev_json := to_jsonb(ev);
      why := format('Your last %s %s Lot%s averaged %s/100', ev.lots, ev.skill, case when ev.lots = 1 then '' else 's' end, ev.avg_score)
          || case when ev.tests_total > 0 then format(' (%s of %s tests passed)', ev.tests_passed, ev.tests_total) else '' end
          || case when ev.weakest_criterion is not null then format('; weakest rubric part: %s', ev.weakest_criterion) else '' end
          || case when ev.voice_avg is not null then format('; your spoken explanation scored %s/100', ev.voice_avg) else '' end
          || format('. Today''s Lot practises %s again.', ev.skill);
      exit;
    end if;
  end loop;

  -- Rule 2 STEP UP: most recent strong skill (avg >= 85) -> same skill, harder when available.
  if c_id is null and has_ev then
    ev3 := (select jsonb_agg(to_jsonb(e)) from public.lot_skill_evidence(_student_id, 3) e);
    for ev in select * from jsonb_to_recordset(coalesce(ev3, '[]')) as e(skill text, lots int, avg_score int, tests_passed int, tests_total int, attempts int, failed int, needs_review int, voice_avg int, match_avg int, weakest_criterion text, last_difficulty text, last_at timestamptz, last_title text)
               where e.avg_score >= 85 order by e.last_at desc limit 1 loop
      drank := case lower(ev.last_difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end;
      select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
        from public.lot_candidate_pool(_student_id, college) p where ev.skill = any(p.skills)
       order by (case lower(p.difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end > drank) desc,
                p.own_college desc, md5(_student_id::text || p.candidate_id::text)
       limit 1;
      if c_id is not null then
        rule := 'step_up'; focus := ev.skill; ev_json := to_jsonb(ev);
        why := format('Your last %s %s Lot%s averaged %s/100', ev.lots, ev.skill, case when ev.lots = 1 then '' else 's' end, ev.avg_score)
            || case when ev.tests_total > 0 then format(' (%s of %s tests passed)', ev.tests_passed, ev.tests_total) else '' end
            || format('. Today''s Lot is another %s task%s.', ev.skill,
                      case when lower(coalesce(c_diff, '')) <> lower(coalesce(ev.last_difficulty, '')) then ' at ' || c_diff || ' difficulty' else '' end);
      end if;
    end loop;
  end if;

  -- Rule 3 BROADEN: a skill with no Daily-Lot evidence yet.
  if c_id is null and has_ev then
    select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
      from public.lot_candidate_pool(_student_id, college) p
     where cardinality(p.skills) > 0
       and not (p.skills && coalesce((select array_agg(e->>'skill') from jsonb_array_elements(ev10) e), '{}'))
     order by p.own_college desc, md5(_student_id::text || p.candidate_id::text)
     limit 1;
    if c_id is not null then
      rule := 'broaden'; focus := c_sk[1];
      why := format('Your recent Lots have not covered %s yet, so today''s Lot does.', array_to_string(c_sk, ', '));
    end if;
  end if;

  if c_id is not null then
    return jsonb_build_object('version', 'lot-select-1', 'rule', rule, 'candidate_id', c_id,
             'source_content_id', c_sc, 'focus_skill', focus, 'why', why, 'evidence', ev_json);
  end if;

  -- Rule 4 ROTATION: no evidence yet, or nothing unseen matches: the existing pool rotation (unchanged).
  scid := public.next_lot_source(_student_id);
  if scid is null then return null; end if;
  return jsonb_build_object('version', 'lot-select-1',
           'rule', case when has_ev then 'rotation' else 'no_evidence_yet' end,
           'candidate_id', (select c.id from public.lot_candidates c where c.source_content_id = scid
                             order by (c.status = 'active') desc, c.created_at limit 1),
           'source_content_id', scid, 'focus_skill', null,
           'why', case when has_ev
                       then 'No unused Lot matches your recent results yet, so this one comes from the shared pool.'
                       else 'You have not submitted a Lot yet, so this one comes from the shared pool. From your first submission on, Lots follow your results.' end,
           'evidence', null);
end $function$;

-- 6. create_lot_for: same flow, choice from next_lot_pick, stored on the task --------------------------
create or replace function public.create_lot_for(_student_id uuid, _for_date date default null::date)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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

  pick := public.next_lot_pick(_student_id);
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

-- 7. the student's card gets WHY -----------------------------------------------------------------------
drop function if exists public.my_todays_lot();
create function public.my_todays_lot()
returns table(
  id uuid, lot_number integer, title text, description text, code_sample text,
  source_jd text, difficulty text, estimate_minutes integer, lot_category text,
  status text, due_date timestamp with time zone, sponsored_by_company text,
  sandbox_config_id uuid, rubric_config_id uuid, source_name text,
  why_selected text, focus_skill text, lot_skills text[]
)
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select t.id, t.lot_number, t.title, t.description, t.code_sample, t.source_jd,
         t.difficulty, t.estimate_minutes, t.lot_category, t.status, t.due_date,
         r.company, t.sandbox_config_id, t.rubric_config_id,
         coalesce(
           (select g.name from public.source_content sc
              join public.source_registry g on g.id = sc.source_id
             where sc.id = t.source_content_id),
           case when t.source_jd is not null then 'A real job posting' end),
         t.lot_selection->>'why', t.lot_selection->>'focus_skill',
         (select c.skills from public.lot_candidates c where c.id = t.lot_candidate_id)
    from public.tasks t
    left join public.recruiters r on r.id = t.sponsored_by
   where t.student_id = auth.uid() and t.lot_date = current_date
   limit 1;
$function$;

-- 8. admin inspection (read-only) ---------------------------------------------------------------------
create or replace function public.admin_daily_lots(_date date default null, _q text default '',
                                                   _limit integer default 50, _offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare d date := coalesce(_date, current_date); out jsonb;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'date', d,
           'total', (select count(*) from public.tasks t join public.student_profiles p on p.id = t.student_id
                      where t.lot_date = d and (coalesce(_q, '') = '' or p.full_name ilike '%' || _q || '%' or t.title ilike '%' || _q || '%')),
           'rows', coalesce(jsonb_agg(r order by r->>'student_name'), '[]'::jsonb))
    into out
    from (
      select jsonb_build_object(
        'task_id', t.id, 'student_id', p.id, 'student_name', p.full_name, 'college', col.name,
        'title', t.title, 'lot_date', t.lot_date, 'task_status', t.status, 'difficulty', t.difficulty,
        'grading_mode', case when t.sandbox_config_id is not null then 'sandbox' when t.rubric_config_id is not null then 'rubric' end,
        'skills', c.skills, 'topic', c.topic,
        'provenance', coalesce(c.provenance, jsonb_build_object('page_title', sc.title, 'url', coalesce(sc.canonical_url, sc.url),
                                                                'source_name', g.name, 'domain', g.domain, 'rights_flag', sc.rights_flag)),
        'why_selected', coalesce(t.lot_selection->>'why', 'Chosen before evidence-based selection existed (no reason stored).'),
        'rule', t.lot_selection->>'rule',
        'submission', (select jsonb_build_object(
                          'status', s.status, 'score', s.sandbox_score, 'passed', s.passed_count, 'total', s.total_count,
                          'attempts', (select count(*) from public.task_submissions x where x.task_id = t.id),
                          'language', s.language, 'flags', s.flags, 'submitted_at', s.created_at,
                          'answer', left(s.code, 4000),
                          'tests', (select jsonb_agg(jsonb_build_object('id', e->>'id', 'passed', e->'passed', 'verdict', e->>'verdict', 'visible', e->'visible'))
                                      from jsonb_array_elements(case when jsonb_typeof(s.details) = 'array' then s.details else '[]'::jsonb end) e),
                          'rubric', (select jsonb_agg(jsonb_build_object('criterion', coalesce(cr->>'name', rs->>'criterion_id'),
                                                                         'points', rs->'points', 'max_points', cr->'max_points',
                                                                         'reason', rs->>'evidence'))
                                       from jsonb_array_elements(coalesce(s.rubric_scores, '[]'::jsonb)) rs
                                       left join public.task_rubric_config rc on rc.id = s.rubric_config_id
                                       left join lateral (select x from jsonb_array_elements(rc.criteria) x
                                                           where x->>'id' = rs->>'criterion_id' limit 1) crx(cr) on true))
                        from public.task_submissions s where s.task_id = t.id order by s.created_at desc limit 1),
        'voice', (select jsonb_build_object('status', v.status, 'communication_score', v.communication_score,
                                            'content_match', v.evaluation->'content_match', 'flags', v.evaluation->'flags',
                                            'notes', v.communication_notes)
                    from public.voice_explanations v where v.task_id = t.id and v.withdrawn_at is null
                   order by v.created_at desc limit 1)
      ) as r
        from public.tasks t
        join public.student_profiles p on p.id = t.student_id
        left join public.colleges col on col.id = p.college_id
        left join public.lot_candidates c on c.id = t.lot_candidate_id
        left join public.source_content sc on sc.id = t.source_content_id
        left join public.source_registry g on g.id = sc.source_id
       where t.lot_date = d
         and (coalesce(_q, '') = '' or p.full_name ilike '%' || _q || '%' or t.title ilike '%' || _q || '%')
       order by p.full_name
       limit greatest(1, least(coalesce(_limit, 50), 200)) offset greatest(0, coalesce(_offset, 0))
    ) x;
  return out;
end $function$;

-- 9. privileges (migration 83 closes new objects by default; grant exactly what is needed) -------------
revoke all on function public.tag_skills(text)                   from public, anon, authenticated;
revoke all on function public.sync_lot_candidate(uuid)           from public, anon, authenticated;
revoke all on function public.lot_template_to_candidate()        from public, anon, authenticated;
revoke all on function public.lot_skill_evidence(uuid, integer)  from public, anon, authenticated;
revoke all on function public.next_lot_pick(uuid)                from public, anon, authenticated;
revoke all on function public.lot_candidate_pool(uuid, uuid)     from public, anon, authenticated;
revoke all on function public.create_lot_for(uuid, date)         from public, anon, authenticated;
revoke all on function public.admin_daily_lots(date, text, integer, integer) from public, anon;
revoke all on function public.my_todays_lot()                    from public, anon;
grant execute on function public.tag_skills(text)                  to service_role;
grant execute on function public.sync_lot_candidate(uuid)          to service_role;
grant execute on function public.lot_skill_evidence(uuid, integer) to service_role;
grant execute on function public.next_lot_pick(uuid)               to service_role;
grant execute on function public.lot_candidate_pool(uuid, uuid)    to service_role;
grant execute on function public.create_lot_for(uuid, date)        to service_role;
grant execute on function public.admin_daily_lots(date, text, integer, integer) to authenticated, service_role;
grant execute on function public.my_todays_lot()                   to authenticated, service_role;

-- 10. self-check ---------------------------------------------------------------------------------------
do $$
declare n_tpl int; n_cand int;
begin
  select count(*) into n_tpl from public.lot_templates where source_content_id is not null;
  select count(*) into n_cand from public.lot_candidates;
  if n_cand < n_tpl then raise exception '88: % templates but only % candidates', n_tpl, n_cand; end if;
  if public.tag_skills('Write a SQL query with a LEFT JOIN') <> array['SQL'] then raise exception '88: tag_skills SQL'; end if;
  if public.tag_skills('Reverse a linked list in Python') <> array['DSA', 'Python'] then raise exception '88: tag_skills DSA/Python'; end if;
  if cardinality(public.tag_skills('Draw a picture of a cat')) <> 0 then raise exception '88: tag_skills false positive'; end if;
  if has_function_privilege('authenticated', 'public.next_lot_pick(uuid)', 'execute') then raise exception '88: next_lot_pick open'; end if;
  if has_function_privilege('anon', 'public.admin_daily_lots(date,text,integer,integer)', 'execute') then raise exception '88: admin_daily_lots open to anon'; end if;
  if not has_function_privilege('authenticated', 'public.my_todays_lot()', 'execute') then raise exception '88: my_todays_lot closed'; end if;
  if has_table_privilege('authenticated', 'public.lot_candidates', 'select') then raise exception '88: lot_candidates readable'; end if;
  -- Roadmap independence: the new selection code must not read roadmap tables or XP.
  if exists (select 1 from pg_proc where proname in ('next_lot_pick', 'lot_skill_evidence', 'create_lot_for', 'lot_candidate_pool')
                and pronamespace = 'public'::regnamespace
                and prosrc ~* '(student_tracks|student_levels|level_tracks|\mlevels\M|total_xp|xp_logs)') then
    raise exception '88: selection reads roadmap or XP';
  end if;
end $$;

notify pgrst, 'reload schema';
