-- Step 6EE: READ-ONLY production pre-check for migration 46. Changes nothing.
--
-- Run in Cloud SQL Studio on prooflab-db / database prooflab, as the user
-- that will run the execution script (expected prooflab_app), BEFORE
-- approval. READ ONLY transaction, ends in ROLLBACK.
-- Part 1: every row must show ok = true, or do not run the execution script.
-- Part 2: impact numbers for the owner's decision (no pass/fail).

begin transaction read only;

-- Part 1: prerequisites
select n, check_name, detail, ok from (
  select 1 as n, 'recruiter_talent is the stage69 body (46 not applied)' as check_name,
         (select md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) from pg_proc
           where oid = to_regprocedure('public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer)')) as detail,
         (select md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) from pg_proc
           where oid = to_regprocedure('public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer)'))
           = 'f7c1eef2f57c8d5b1f961ea76a661fda' as ok
  union all
  select 2, 'recruiter_proof_profile is the stage35c body (46 not applied)',
         (select md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) from pg_proc
           where oid = to_regprocedure('public.recruiter_proof_profile(uuid)')),
         (select md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) from pg_proc
           where oid = to_regprocedure('public.recruiter_proof_profile(uuid)'))
           = 'b467d6f7769c61887d854fb4358cd30e'
  union all
  select 3, 'exactly one of each function',
         (select string_agg(proname || '=' || c, ', ') from (select proname, count(*) c from pg_proc
            where pronamespace = 'public'::regnamespace and proname in ('recruiter_talent', 'recruiter_proof_profile')
            group by 1) x),
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
            and proname in ('recruiter_talent', 'recruiter_proof_profile')) = 2
  union all
  select 4, 'current user owns both functions',
         current_user || ' / owners: ' || (select string_agg(distinct proowner::regrole::text, ',') from pg_proc
            where pronamespace = 'public'::regnamespace and proname in ('recruiter_talent', 'recruiter_proof_profile')),
         (select bool_and(pg_has_role(current_user, proowner, 'MEMBER')) from pg_proc
            where pronamespace = 'public'::regnamespace and proname in ('recruiter_talent', 'recruiter_proof_profile'))
  union all
  select 5, 'transcript_source column + CHECK allowing server', '',
         exists (select 1 from pg_constraint where conrelid = 'public.voice_explanations'::regclass and contype = 'c'
                  and pg_get_constraintdef(oid) like '%transcript_source%' and pg_get_constraintdef(oid) like '%''server''%')
  union all
  select 6, 'task_submissions (stage69) exists', '', to_regclass('public.task_submissions') is not null
  union all
  select 7, 'recruiter helper functions exist', '',
         to_regprocedure('public.my_recruiter_id()') is not null
         and to_regprocedure('public.is_verified_recruiter()') is not null
         and to_regprocedure('public.student_is_discoverable(uuid)') is not null
  union all
  select 8, 'current EXECUTE grants (info: script sets authenticated only)',
         (select string_agg(proname || ': ' || coalesce(proacl::text, 'default'), ' | ') from pg_proc
            where pronamespace = 'public'::regnamespace and proname in ('recruiter_talent', 'recruiter_proof_profile')),
         true
) c order by n;

-- Part 2: impact. After 46, a recruiter sees only server-transcribed scores.
select transcript_source, count(*) as explanations,
       count(communication_score) as scored
  from public.voice_explanations group by 1 order by 1;

select count(*) filter (where s > 0) as students_with_server_scores,
       count(*) filter (where s = 0 and b > 0) as students_whose_recruiter_score_becomes_empty,
       count(*) filter (where s = 0 and b > 0 and public.student_is_discoverable(student_id)) as of_them_discoverable
  from (select student_id,
               count(*) filter (where transcript_source = 'server' and communication_score is not null) s,
               count(*) filter (where transcript_source <> 'server' and communication_score is not null) b
          from public.voice_explanations group by 1) x;

select count(*) as verified_recruiters from public.recruiters where verified;

rollback;
