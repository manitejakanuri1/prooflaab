-- 360 (owner E2E 12 Nov 2026, TEST): admin/college screens say what the data says.
--   F12 student_work() ("All passed work" on college + admin profiles, company proof profile): only Lots with a
--       passed try. It also let in any task in status pending_voice/completed, and a Daily Lot handed in under the
--       pass line sits in pending_voice, so a 1.9/10 answer was listed as passed work.
--   F9  admin_trace_funnels(): the Voice step counted the browser calling voice-score, which the browser no longer
--       does (async voice: it calls transcription-enqueue; the server scores). "Recording scored 0 students" while
--       recordings existed. The step now counts either call and is named for what the browser does.
--   F13 admin_content_library(): each site's chip showed its seed-address count (sum 120) not its pages (167), so
--       "Material added by a ProofLab admin · 0 pages" had 46 pages. Sources now carry 'pages'. Template titles
--       ("Explain your project: {item}", filled per student, migration 236) read "<your resume item>".
-- Rollback: migration/360-rollback-admin-facts-match.sql
begin;

create or replace function public.student_work(_student_id uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select coalesce(jsonb_agg(to_jsonb(w) order by w.submitted_at desc), '[]'::jsonb) from (
    select distinct on (s.task_id)
           s.task_id, t.title,
           case when s.sandbox_config_id is not null then 'code' else 'written' end as kind,
           s.language, s.code as answer, s.passed_count, s.total_count, s.sandbox_score as score,
           s.status, s.created_at as submitted_at,
           (select count(*) from public.task_submissions x where x.student_id = _student_id and x.task_id = s.task_id) as attempts,
           (select jsonb_build_object('id', v.id, 'score', v.communication_score, 'words', v.transcript,
                                      'has_audio', v.storage_path is not null and v.audio_purged_at is null)
              from public.voice_explanations v
             where v.task_id = s.task_id and v.student_id = _student_id and v.status = 'scored' and v.withdrawn_at is null
             order by v.current_authoritative desc, v.created_at limit 1) as voice
      from public.task_submissions s
      join public.tasks t on t.id = s.task_id
     where s.student_id = _student_id and s.status = 'passed'
     order by s.task_id,
              case when s.total_count > 0 then s.passed_count::numeric / s.total_count
                   else coalesce(s.sandbox_score, 0) / 100.0 end desc,
              s.created_at desc
     limit 100
  ) w;
$function$;

create or replace function public.admin_trace_funnels(_days integer default 7)
returns table (funnel text, step_order integer, step_label text, students bigint, calls bigint, errors bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admins only'; end if;
  return query
  with steps(funnel, ord, label, targets) as (values
    ('Resume', 1, 'Resume read', array['resume-parser']),
    ('Resume', 2, 'Test built', array['resume-question-generator']),
    ('Resume', 3, 'Test submitted', array['resume-assessment-submit']),
    ('Resume', 4, 'Coding round run', array['resume-code-execute']),
    ('Lessons', 1, 'Lesson opened', array['level-open']),
    ('Lessons', 2, 'Quiz submitted', array['level-quiz-submit']),
    ('Daily task', 1, 'Task explained', array['task-explain']),
    ('Daily task', 2, 'Written answer submitted', array['submit-written-task']),
    ('Daily task', 3, 'Code answer submitted', array['submit-sandbox-task']),
    ('Voice', 1, 'Recording sent for scoring', array['transcription-enqueue', 'voice-score']))
  select s.funnel, s.ord, s.label,
         count(distinct e.student_id) filter (where e.status = 'ok'),
         count(e.id),
         count(e.id) filter (where e.status is distinct from 'ok')
    from steps s
    left join public.app_events e
      on e.kind = 'call' and e.target = any (s.targets) and e.created_at > now() - make_interval(days => greatest(1, least(_days, 90)))
   group by s.funnel, s.ord, s.label
   order by s.funnel, s.ord;
end $$;

create or replace function public.admin_content_library()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sc.id, 'url', sc.url, 'title', replace(sc.title, '{item}', '<your resume item>'),
               'site', coalesce(r.name, r.domain), 'domain', r.domain,
               'fetch_method', sc.fetch_method, 'fetched_at', sc.fetched_at,
               'chars', length(coalesce(sc.markdown, '')),
               'college', c.name,
               'lot_written', exists (select 1 from public.lot_templates t where t.source_content_id = sc.id),
               'times_given', (select count(*) from public.tasks k where k.source_content_id = sc.id),
               'hidden', sc.hidden_at is not null)
             order by sc.hidden_at nulls first, sc.fetched_at desc)
        from public.source_content sc
        left join public.source_registry r on r.id = sc.source_id
        left join public.colleges c on c.id = sc.submitted_by_college_id
       where sc.bank_question_id is null), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('site', coalesce(sr.name, sr.domain), 'domain', sr.domain,
                                          'seeds', cardinality(sr.seed_urls), 'rights', sr.rights_flag,
                                          'pages', (select count(*) from public.source_content sc
                                                     where sc.source_id = sr.id and sc.bank_question_id is null),
                                          'retired', sr.retired_at is not null) order by sr.domain)
        from public.source_registry sr), '[]'::jsonb),
    'newest_fetch', (select max(fetched_at) from public.source_content)
  );
end;
$function$;

do $$
begin
  if position('t.status in' in pg_get_functiondef('public.student_work(uuid)'::regprocedure)) > 0 then
    raise exception '360 self-check: student_work still lets in unpassed tasks';
  end if;
  if position('transcription-enqueue' in pg_get_functiondef('public.admin_trace_funnels(integer)'::regprocedure)) = 0 then
    raise exception '360 self-check: voice funnel not changed';
  end if;
  if position('''pages'', (select count(*)' in pg_get_functiondef('public.admin_content_library()'::regprocedure)) = 0 then
    raise exception '360 self-check: library sources have no page count';
  end if;
  if exists (select 1 from public.student_profiles p, jsonb_array_elements(public.student_work(p.id)) w
              where w->>'status' <> 'passed') then
    raise exception '360 self-check: a not-passed try is still in student_work';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
