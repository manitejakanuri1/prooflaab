-- PRODUCTION read-only audit. Runs with default_transaction_read_only=on inside BEGIN READ ONLY ... ROLLBACK.
-- Aggregates, ids, statuses, timestamps, definitions and hashes only. No answers, transcripts or personal data.
begin transaction read only;
select 'S0', current_database(), current_user, current_setting('transaction_read_only'), version();
select 'S0db', pg_get_userbyid(d.datdba), pg_size_pretty(pg_database_size(d.datname)) from pg_database d where d.datname = current_database();
select 'S0conn', (select count(*) from pg_stat_activity), current_setting('max_connections'), (select count(*) from pg_stat_activity where state = 'active');
select 'S0ext', string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension;
select 'S0rls', count(*) filter (where c.relrowsecurity), count(*) filter (where not c.relrowsecurity), count(*) filter (where c.relforcerowsecurity)
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r';
select 'S0norls', string_agg(c.relname, ',' order by c.relname) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity;

-- A. Migration 48
select 'A1col', data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='task_rubric_config' and column_name='scratch_language';
select 'A2chk', pg_get_constraintdef(oid) from pg_constraint where conname='task_rubric_config_scratch_language_check';
select 'A3view', md5(prosrc), position('scratch_language' in prosrc) > 0, proacl::text from pg_proc where oid='public.rubric_task_view(uuid)'::regprocedure;
select 'A4dist', coalesce(scratch_language,'NULL'), count(*) from public.task_rubric_config group by 2 order by 2;
select 'A5fallback', id, scratch_language, origin from public.task_rubric_config where is_generic_fallback;
select 'A6python', id, scratch_language, is_generic_fallback, origin from public.task_rubric_config where id='ad5f2c83-558b-4bdc-a0d6-53c6e552e8ee';
select 'A7invalid', count(*) from public.task_rubric_config where scratch_language is not null and scratch_language not in ('python','javascript','java','c','cpp','go','ruby','php');
select 'A8origin', origin, is_generic_fallback, count(*) from public.task_rubric_config group by 2,3 order by 2,3;

-- B/C. submissions (aggregates; smoke student only in detail)
select 'B1sub', status, (rubric_config_id is not null) as written, (sandbox_config_id is not null) as coding, count(*) from public.task_submissions group by 2,3,4 order by 2,3,4;
select 'B2smoke', s.task_id, s.status, s.sandbox_score, s.xp_awarded, (s.rubric_config_id is not null) as written, (position('print(' in coalesce(s.code,'')) > 0 or position('ProofLab runner OK' in coalesce(s.code,'')) > 0) as has_scratch_code, s.created_at
  from public.task_submissions s where s.student_id = '366602c7-90a0-4f3b-8956-82ed35c0dd15' order by s.created_at;
select 'C1rts', md5(prosrc), prosecdef, array_to_string(proconfig,';'), proacl::text from pg_proc where proname='record_task_submission' and pronamespace='public'::regnamespace;
select 'C2rts_returns_passed_key', position('''passed'',' in prosrc) > 0, position('''status'', v_status' in prosrc) > 0 from pg_proc where proname='record_task_submission' and pronamespace='public'::regnamespace;

-- D. voice
select 'D1', transcription_status, status, coalesce(transcript_source,'NULL'), count(*) from public.voice_explanations group by 2,3,4 order by 2,3,4;
select 'D2stale', id, transcription_status, status, transcription_attempts, transcription_reap_attempts, created_at, transcription_claimed_at, transcription_enqueued_at
  from public.voice_explanations
 where (transcription_status in ('pending','processing') and created_at < now() - interval '10 minutes')
    or (transcription_status = 'completed' and transcript_source = 'server' and status = 'recorded' and created_at < now() - interval '10 minutes');
select 'D3attempts', count(*) filter (where transcription_attempts >= 3), count(*) filter (where transcription_reap_attempts >= 6) from public.voice_explanations;
select 'D4transcript_no_score', transcript_source, status, count(*) from public.voice_explanations where coalesce(transcript,'') <> '' and communication_score is null group by 2,3;
select 'D5score_no_transcript', count(*) from public.voice_explanations where communication_score is not null and coalesce(transcript,'') = '';
select 'D6score_no_prov', count(*) from public.voice_explanations where communication_score is not null and transcript_source is null;
select 'D7dup_claims', count(*) from (select transcription_lease_token from public.voice_explanations where transcription_status='processing' and transcription_lease_token is not null group by 1 having count(*) > 1) x;
select 'D8smoke', id, transcription_status, status, transcript_source, communication_score, transcription_attempts, length(transcript) > 0 from public.voice_explanations where student_id='366602c7-90a0-4f3b-8956-82ed35c0dd15';

-- Phase 3: Step 6 functions, security definer, search_path, grants
select 'F', p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, coalesce(array_to_string(p.proconfig,';'),'(none)'), md5(p.prosrc),
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as svc_x
  from pg_proc p where p.pronamespace='public'::regnamespace
   and p.proname in ('rubric_task_view','record_task_submission','recruiter_proof_profile','recruiter_talent','claim_transcription_job','complete_transcription_job',
                     'fail_transcription_job','claim_transcription_recovery','guard_voice_explanations_insert','claim_voice_scoring','complete_voice_scoring','fail_voice_scoring',
                     'similar_written_submission','check_rate_limit')
 order by 2,3;
select 'F2secdef_no_path', count(*), string_agg(p.proname, ',' order by p.proname) from pg_proc p
 where p.pronamespace='public'::regnamespace and p.prosecdef and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%'));
select 'F3voice_priv', r, has_table_privilege(r,'public.voice_explanations','SELECT'), has_table_privilege(r,'public.voice_explanations','INSERT'),
       has_table_privilege(r,'public.voice_explanations','UPDATE'), has_table_privilege(r,'public.voice_explanations','DELETE')
  from unnest(array['anon','authenticated','service_role']) r;
select 'F4rubric_priv', r, has_table_privilege(r,'public.task_rubric_config','SELECT'), has_table_privilege(r,'public.task_rubric_config','UPDATE') from unnest(array['anon','authenticated']) r;
select 'F5rls', c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
 where c.oid in ('public.voice_explanations'::regclass,'public.task_rubric_config'::regclass,'public.task_submissions'::regclass,'public.tasks'::regclass,'public.student_profiles'::regclass,'public.user_roles'::regclass);
select 'F6trg', tgname, tgenabled from pg_trigger where tgrelid='public.voice_explanations'::regclass and not tgisinternal order by 2;
select 'F7submissions_client_write', r, has_table_privilege(r,'public.task_submissions','INSERT'), has_table_privilege(r,'public.task_submissions','UPDATE') from unnest(array['anon','authenticated']) r;
select 'F8submission_policies', policyname, cmd, roles::text from pg_policies where tablename='task_submissions' order by 2;

-- Phase 13: references / orphans (counts only)
select 'O1', 'tasks->rubric missing', count(*) from public.tasks t where t.rubric_config_id is not null and not exists (select 1 from public.task_rubric_config c where c.id=t.rubric_config_id);
select 'O1', 'tasks->sandbox missing', count(*) from public.tasks t where t.sandbox_config_id is not null and not exists (select 1 from public.task_sandbox_config c where c.id=t.sandbox_config_id);
select 'O1', 'tasks->student missing', count(*) from public.tasks t where t.student_id is not null and not exists (select 1 from public.student_profiles p where p.id=t.student_id);
select 'O1', 'lot_templates->rubric missing', count(*) from public.lot_templates l where l.rubric_config_id is not null and not exists (select 1 from public.task_rubric_config c where c.id=l.rubric_config_id);
select 'O1', 'submissions->task missing', count(*) from public.task_submissions s where not exists (select 1 from public.tasks t where t.id=s.task_id);
select 'O1', 'submissions->student missing', count(*) from public.task_submissions s where not exists (select 1 from public.student_profiles p where p.id=s.student_id);
select 'O1', 'voice->student missing', count(*) from public.voice_explanations v where not exists (select 1 from public.student_profiles p where p.id=v.student_id);
select 'O1', 'voice->task missing', count(*) from public.voice_explanations v where v.task_id is not null and not exists (select 1 from public.tasks t where t.id=v.task_id);
select 'O1', 'student_profiles->user_roles missing', count(*) from public.student_profiles p where p.user_id is not null and not exists (select 1 from public.user_roles r where r.user_id=p.user_id);
select 'O2', 'rubric configs used by nothing', count(*) from public.task_rubric_config c
 where not c.is_generic_fallback and not exists (select 1 from public.tasks t where t.rubric_config_id=c.id) and not exists (select 1 from public.lot_templates l where l.rubric_config_id=c.id);
select 'O3', 'fk constraints not validated', count(*) from pg_constraint where connamespace='public'::regnamespace and contype='f' and not convalidated;
select 'O4', 'cohorts', coalesce(cohort,'NULL'), count(*) from public.student_profiles group by 3 order by 3;
rollback;
select 'END';
