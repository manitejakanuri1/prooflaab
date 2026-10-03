-- ProofLabAI Step 6: PRODUCTION Cloud SQL READ-ONLY audit (prooflab-db / database prooflab).
-- Prepared 2026-09-30 by Claude. NOT executed by Claude (Claude has no production DB login and must
-- not read the prooflab-db-uri secret). For the OWNER to run in Cloud SQL Studio.
--
-- SAFETY: every statement is a SELECT on catalog views or COUNT(*). It runs inside
-- BEGIN TRANSACTION READ ONLY ... ROLLBACK, so Postgres itself refuses any write.
-- Q0 must show transaction_read_only = on. If it does not, STOP.
-- Output is structure, function definitions, privileges and COUNTS only (no transcripts,
-- no names, no student ids). Same queries as the staging audit (docs/STEP6-CLOUDSQL-READONLY-AUDIT.sql)
-- minus the one staging row that listed ids, plus duplicate-path / NULL-key counts and a
-- version verdict (Q9).
-- If Studio shows only the last result, run the blocks one at a time (each block starts with '=== ').
begin transaction read only;
select '=== Q0 SESSION', current_database(), current_user, current_setting('transaction_read_only'),
       current_setting('default_transaction_read_only'), now(), version();

-- Q1 columns (existence, type, nullability, default) --------------------------
select '=== Q1 COLUMNS';
select 'COL', c.column_name, c.data_type, c.is_nullable, coalesce(c.column_default, '(none)')
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'voice_explanations'
   and c.column_name in ('transcription_status','transcription_claimed_at','transcription_attempts','transcription_error',
                         'transcription_idempotency_key','transcription_lease_token','transcription_enqueued_at',
                         'transcription_reap_claimed_at','transcription_reap_attempts','scoring_claimed_at',
                         'scoring_lease_token','storage_path','status','communication_score','communication_notes')
 order by c.ordinal_position;

-- Q2 constraints and indexes ----------------------------------------------------
select '=== Q2 CONSTRAINTS';
select 'CON', conname, contype, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.voice_explanations'::regclass order by conname;
select 'IDX', indexname, indexdef from pg_indexes
 where schemaname = 'public' and tablename = 'voice_explanations' order by indexname;

-- Q3 functions: signature, result, security definer, config, owner, ACL, body hash -
select '=== Q3 FUNCTION SUMMARY (name | args | result | secdef | config | owner | acl | md5(prosrc) | len)';
select 'FN', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid), p.prosecdef,
       coalesce(array_to_string(p.proconfig, ';'), '(none)'), p.proowner::regrole::text,
       coalesce(p.proacl::text, '(NULL = default PUBLIC EXECUTE)'), md5(p.prosrc), length(p.prosrc)
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('claim_transcription_job','complete_transcription_job','fail_transcription_job',
                     'claim_transcription_recovery','guard_voice_explanations_insert',
                     'claim_voice_scoring','complete_voice_scoring','fail_voice_scoring',
                     'reap_stale_transcription_jobs','protect_columns','activity_from_voice','on_voice_recorded')
 order by p.proname, 3;

-- Q4 EXECUTE per role (role may not exist: guarded) -----------------------------
select '=== Q4 EXECUTE (function | anon | authenticated | service_role | prooflab_app | PUBLIC in ACL)';
select 'EXEC', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       has_function_privilege('anon', p.oid, 'EXECUTE'),
       has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       has_function_privilege('service_role', p.oid, 'EXECUTE'),
       case when exists (select 1 from pg_roles where rolname = 'prooflab_app')
            then has_function_privilege('prooflab_app', p.oid, 'EXECUTE')::text else '(no such role)' end,
       (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('claim_transcription_job','complete_transcription_job','fail_transcription_job',
                     'claim_transcription_recovery','guard_voice_explanations_insert',
                     'claim_voice_scoring','complete_voice_scoring','fail_voice_scoring')
 order by 2;

-- Q5 full live definitions ------------------------------------------------------
select '=== Q5 DEF claim_transcription_job';      select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='claim_transcription_job';
select '=== Q5 DEF complete_transcription_job';   select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='complete_transcription_job';
select '=== Q5 DEF fail_transcription_job';       select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='fail_transcription_job';
select '=== Q5 DEF claim_transcription_recovery'; select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='claim_transcription_recovery';
select '=== Q5 DEF guard_voice_explanations_insert'; select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='guard_voice_explanations_insert';
select '=== Q5 DEF claim_voice_scoring';          select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='claim_voice_scoring';
select '=== Q5 DEF complete_voice_scoring';       select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='complete_voice_scoring';
select '=== Q5 DEF fail_voice_scoring';           select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='fail_voice_scoring';
select '=== Q5 DEF protect_columns';              select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='protect_columns';
select '=== Q5 DEF activity_from_voice';          select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='activity_from_voice';
select '=== Q5 DEF on_voice_recorded';            select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='on_voice_recorded';
select '=== Q5 END';

-- Q6 triggers -------------------------------------------------------------------
select '=== Q6 TRIGGERS (name | enabled | timing/events/level from def | function)';
select 'TRG', t.tgname, t.tgenabled, pg_get_triggerdef(t.oid), t.tgfoid::regproc::text
  from pg_trigger t where t.tgrelid = 'public.voice_explanations'::regclass and not t.tgisinternal order by t.tgname;

-- Q7 RLS, policies, table privileges -------------------------------------------
select '=== Q7 RLS (enabled | forced | owner)';
select 'RLS', c.relrowsecurity, c.relforcerowsecurity, c.relowner::regrole::text
  from pg_class c where c.oid = 'public.voice_explanations'::regclass;
select 'POL', policyname, permissive, cmd, roles::text, coalesce(qual, '(none)'), coalesce(with_check, '(none)')
  from pg_policies where schemaname = 'public' and tablename = 'voice_explanations' order by policyname;
select '=== Q7 TABLE PRIVILEGES (role | SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER)';
select 'PRIV', r.rolname,
       has_table_privilege(r.oid, 'public.voice_explanations', 'SELECT'),
       has_table_privilege(r.oid, 'public.voice_explanations', 'INSERT'),
       has_table_privilege(r.oid, 'public.voice_explanations', 'UPDATE'),
       has_table_privilege(r.oid, 'public.voice_explanations', 'DELETE'),
       has_table_privilege(r.oid, 'public.voice_explanations', 'TRUNCATE'),
       has_table_privilege(r.oid, 'public.voice_explanations', 'REFERENCES'),
       has_table_privilege(r.oid, 'public.voice_explanations', 'TRIGGER')
  from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'prooflab_app') order by r.rolname;
select 'ROLE-EXISTS prooflab_app', exists (select 1 from pg_roles where rolname = 'prooflab_app');
select 'COLPRIV-UPDATE', grantee, string_agg(column_name, ',' order by column_name)
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'voice_explanations' and privilege_type = 'UPDATE'
   and grantee in ('anon', 'authenticated') group by grantee;

-- Q8 data health: COUNTS ONLY ---------------------------------------------------
select '=== Q8 DATA HEALTH (counts only)';
select 'TOTAL', count(*) from public.voice_explanations;
select 'TSTATUS', s, (select count(*) from public.voice_explanations v where v.transcription_status = s)
  from unnest(array['pending','processing','completed','failed']) s;
select 'STATUS', s, (select count(*) from public.voice_explanations v where v.status = s)
  from unnest(array['recorded','scored','failed']) s;
select 'PENDING_NOT_ENQUEUED', count(*) from public.voice_explanations
 where transcription_status = 'pending' and transcription_enqueued_at is null;
select 'PROCESSING_STALE_180S', count(*) from public.voice_explanations
 where transcription_status = 'processing' and transcription_claimed_at < now() - interval '180 seconds';
select 'REAP_ATTEMPTS_AT_LIMIT_8', count(*) from public.voice_explanations where transcription_reap_attempts >= 8;
select 'SERVER_COMPLETED_STILL_RECORDED', count(*) from public.voice_explanations
 where transcript_source = 'server' and transcription_status = 'completed' and status = 'recorded';
select 'SERVER_COMPLETED_STILL_RECORDED_WITH_SCORING_CLAIM', count(*) from public.voice_explanations
 where transcript_source = 'server' and transcription_status = 'completed' and status = 'recorded' and scoring_claimed_at is not null;
select 'PATH_NULL_OR_EMPTY', count(*) from public.voice_explanations where storage_path is null or storage_path = '';
select 'PATH_SUSPICIOUS (.., //, leading /, whitespace, >1 folder level)', count(*) from public.voice_explanations
 where storage_path like '%..%' or storage_path like '%//%' or storage_path like '/%' or storage_path ~ '\s'
    or storage_path ~ '^[^/]+/[^/]+/';
select 'PATH_NOT_OWN_FOLDER', count(*) from public.voice_explanations where storage_path not like student_id::text || '/%';
select 'SCORE_OUT_OF_RANGE', count(*) from public.voice_explanations
 where communication_score is not null and (communication_score < 0 or communication_score > 100);
select 'SCORED_WITHOUT_SCORE', count(*) from public.voice_explanations where status = 'scored' and communication_score is null;
select 'SCORE_WITHOUT_SCORED', count(*) from public.voice_explanations where status <> 'scored' and communication_score is not null;
select 'NULL_IDEMPOTENCY_KEY', count(*) from public.voice_explanations where transcription_idempotency_key is null;
select 'NULL_IDEMPOTENCY_KEY_SERVER_ROWS', count(*) from public.voice_explanations
 where transcription_idempotency_key is null and transcript_source = 'server';
select 'DUPLICATE_STORAGE_PATHS (paths used by >1 row)', count(*) from (
  select storage_path from public.voice_explanations where storage_path is not null
   group by storage_path having count(*) > 1) d;

-- Q9 VERDICT: which GitHub version each live function body matches (md5 of prosrc) ---
select '=== Q9 VERDICT (function | live md5 | matches)';
select 'MATCH', p.proname, md5(p.prosrc),
       case md5(p.prosrc)
         when '0fba0fd21e115126135bdfad7ff65fb4' then '42 / step6u'
         when 'a451e95260ccb56eba76aaf8f329f707' then '42 / step6u'
         when 'd3e97e6343b3ec374b03979b540b54b5' then '42 / step6u'
         when 'b505fac6abd3a54694969ee901ca9a96' then '41 only (NOT hardened)'
         when '0a84bb06d7803a3f20664574aa4fb95e' then '41 only (NOT hardened)'
         when '34f94ac104c813950985fcf823427f2e' then '41 only (NOT hardened)'
         when 'babb6d5c09198ae2c4446b0b9d5820ce' then 'step6y 43'
         when '37f3b71be1a3351414d8005d505563b4' then 'step6y 43'
         when '1723609d0d2a8acbe6df71919293c9c7' then 'original 43 file'
         when '93a137ad2a6560fee733f4ff94b3088f' then 'original 43 file'
         when '1098048e23867d2cdc914e3a7c916c43' then '44 (claim only)'
         when '8246246163ba025bed98c67738005a63' then 'ORIGINAL 45 (not 6DD)'
         when 'ed6fa7097e73b92ec563559135fb770c' then 'ORIGINAL 45 (not 6DD)'
         when 'ab4cf7b84cbc46ba2de5ab1dbd20dd48' then 'ORIGINAL 45 (not 6DD)'
         when '36e69d5fcb6c972c5a21b01b89f77f46' then 'CORRECTED 6DD 45'
         when '7eab326d7d208b16c3e304c81a92e806' then 'CORRECTED 6DD 45'
         when '56bd2cd2efcc4cce71adb8112f9490b9' then 'CORRECTED 6DD 45'
         else 'UNKNOWN / manual version' end
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('claim_transcription_job','complete_transcription_job','fail_transcription_job',
                     'claim_transcription_recovery','guard_voice_explanations_insert',
                     'claim_voice_scoring','complete_voice_scoring','fail_voice_scoring')
 order by p.proname;
select 'LEGACY reap_stale_transcription_jobs still present (should be false after 43)',
       exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'reap_stale_transcription_jobs');
rollback;
select '=== END (rolled back; read-only)';
