-- Rollback of 360: the earlier definitions (student_work from migration 168, admin_trace_funnels from 37,
-- admin_content_library as on TEST before 360).
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
     where s.student_id = _student_id
       and (exists (select 1 from public.task_submissions p2
                     where p2.task_id = s.task_id and p2.student_id = _student_id and p2.status = 'passed')
            or t.status in ('pending_voice', 'completed', 'Completed'))
     order by s.task_id, (s.status = 'passed') desc,
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
  with steps(funnel, ord, label, target) as (values
    ('Resume', 1, 'Resume read', 'resume-parser'),
    ('Resume', 2, 'Test built', 'resume-question-generator'),
    ('Resume', 3, 'Test submitted', 'resume-assessment-submit'),
    ('Resume', 4, 'Coding round run', 'resume-code-execute'),
    ('Lessons', 1, 'Lesson opened', 'level-open'),
    ('Lessons', 2, 'Quiz submitted', 'level-quiz-submit'),
    ('Daily task', 1, 'Task explained', 'task-explain'),
    ('Daily task', 2, 'Written answer submitted', 'submit-written-task'),
    ('Daily task', 3, 'Code answer submitted', 'submit-sandbox-task'),
    ('Voice', 1, 'Recording scored', 'voice-score'))
  select s.funnel, s.ord, s.label,
         count(distinct e.student_id) filter (where e.status = 'ok'),
         count(e.id),
         count(e.id) filter (where e.status is distinct from 'ok')
    from steps s
    left join public.app_events e
      on e.kind = 'call' and e.target = s.target and e.created_at > now() - make_interval(days => greatest(1, least(_days, 90)))
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
               'id', sc.id, 'url', sc.url, 'title', sc.title,
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
      select jsonb_agg(jsonb_build_object('site', coalesce(name, domain), 'domain', domain,
                                          'seeds', cardinality(seed_urls), 'rights', rights_flag,
                                          'retired', retired_at is not null) order by domain)
        from public.source_registry), '[]'::jsonb),
    'newest_fetch', (select max(fetched_at) from public.source_content)
  );
end;
$function$;
notify pgrst, 'reload schema';
commit;
