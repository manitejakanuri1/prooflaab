-- ##########################################################################
-- 66: retire the proof-era database objects (Wave 10).
-- PERMANENT. Rehearsed on STAGING only. PRODUCTION NEEDS THE OWNER'S WRITTEN YES
-- and a fresh Cloud SQL backup taken the same hour. Apply only after 59-65 and
-- after the website and functions from this branch are live (the old ones still
-- read these objects).
-- ##########################################################################
--
-- What goes, and why it is safe (each item was searched in: the website, every
-- server function, the Python services, scripts, database functions, triggers,
-- views, policies, foreign keys, Scheduler jobs):
--   tables     proof_uploads, trust_scores, conceptual_tests, conceptual_answer_keys,
--              proof_appeals, ai_verifications, github_verifications, coding_streaks,
--              cosigns, recruiter_links, recruiter_link_views
--   functions  cosign_proof, cosignable_proofs, my_cosigns, set_proof_publicity,
--              activity_from_proof, on_proof_change, on_proof_reviewed,
--              proof_uploads_reject_sandbox
--   columns    student_profiles.trust_score
--   constraint voice_explanations_proof_id_fkey (the column stays, always empty:
--              the recorder still names it; removing it is a separate, later change)
-- What does NOT go: task_assignments and task_applications (live readers), every
-- current table.
--
-- Nothing is thrown away: every row of every dropped table, and every non-zero
-- trust_score, is first copied into legacy_archive (admin-only). Deleting that
-- archive later is a separate decision.
begin;

create table if not exists public.legacy_archive (
  id bigint generated always as identity primary key,
  source_table text not null,
  row_data jsonb not null,
  archived_at timestamptz not null default now()
);
alter table public.legacy_archive enable row level security;
revoke all on public.legacy_archive from public, anon, authenticated;
grant select on public.legacy_archive to service_role;

do $$
declare
  t text; n bigint; total bigint := 0;
  doomed text[] := array['proof_uploads','trust_scores','conceptual_tests','conceptual_answer_keys',
                         'proof_appeals','ai_verifications','github_verifications','coding_streaks',
                         'cosigns','recruiter_links','recruiter_link_views'];
  doomed_fns text[] := array['cosign_proof','cosignable_proofs','my_cosigns','set_proof_publicity',
                             'activity_from_proof','on_proof_change','on_proof_reviewed',
                             'proof_uploads_reject_sandbox'];
  bad text;
begin
  -- 1. Refuse to run if anything that stays still depends on what goes.
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prokind = 'f' and p.proname <> all (doomed_fns)
     and exists (select 1 from unnest(doomed) d where p.prosrc ~ ('\m' || d || '\M'));
  if bad is not null then raise exception '66: functions that stay still read retired tables: %', bad; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prokind = 'f' and p.prosrc ~ '\mtrust_score\M';
  if bad is not null then raise exception '66: functions still read trust_score: %', bad; end if;

  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind in ('v', 'm')
     and exists (select 1 from unnest(doomed || array['trust_score']) d where pg_get_viewdef(c.oid) ~ ('\m' || d || '\M'));
  if bad is not null then raise exception '66: views still read retired objects: %', bad; end if;

  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public' and tablename <> all (doomed)
     and exists (select 1 from unnest(doomed || array['trust_score']) d
                  where (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ ('\m' || d || '\M'));
  if bad is not null then raise exception '66: policies still read retired objects: %', bad; end if;

  select string_agg(conrelid::regclass || '.' || conname, ', ') into bad
    from pg_constraint
   where contype = 'f' and confrelid::regclass::text = any (doomed)
     and conrelid::regclass::text <> all (doomed)
     and conname <> 'voice_explanations_proof_id_fkey';
  if bad is not null then raise exception '66: foreign keys from tables that stay: %', bad; end if;

  -- 2. Keep a copy of every row.
  foreach t in array doomed loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('insert into public.legacy_archive (source_table, row_data) select %L, to_jsonb(x) from public.%I x', t, t);
    get diagnostics n = row_count;
    total := total + n;
    raise notice '66: archived % rows of %', n, t;
  end loop;
  insert into public.legacy_archive (source_table, row_data)
  select 'student_profiles.trust_score', jsonb_build_object('student_id', id, 'trust_score', trust_score)
    from public.student_profiles where coalesce(trust_score, 0) <> 0;
  get diagnostics n = row_count;
  raise notice '66: archived % non-zero trust scores; % table rows in total', n, total;
end $$;

-- 3. Drop. No CASCADE anywhere: an unexpected dependent makes the whole file fail and roll back.
alter table public.voice_explanations drop constraint if exists voice_explanations_proof_id_fkey;
drop table if exists public.recruiter_link_views;
drop table if exists public.recruiter_links;
drop table if exists public.cosigns;
drop table if exists public.proof_appeals;
drop table if exists public.conceptual_answer_keys;
drop table if exists public.conceptual_tests;
drop table if exists public.ai_verifications;
drop table if exists public.github_verifications;
drop table if exists public.trust_scores;
drop table if exists public.coding_streaks;
drop table if exists public.proof_uploads;

drop function if exists public.cosign_proof(uuid, text);
drop function if exists public.cosignable_proofs();
drop function if exists public.my_cosigns();
drop function if exists public.set_proof_publicity(uuid, boolean);
drop function if exists public.activity_from_proof();
drop function if exists public.on_proof_change();
drop function if exists public.on_proof_reviewed();
drop function if exists public.proof_uploads_reject_sandbox();

-- The profile guard listed trust_score among the columns a student cannot change.
drop trigger if exists protect_student_profiles on public.student_profiles;
create trigger protect_student_profiles before update on public.student_profiles
  for each row execute function public.protect_student_profile_columns(
    'total_xp', 'college_id', 'status', 'source', 'profile_completed', 'onboarding_status',
    'calibration_completed', 'first_task_completed', 'invited_at', 'onboarded_at', 'roll_number');
alter table public.student_profiles drop column if exists trust_score;

do $$
declare t text;
begin
  foreach t in array array['proof_uploads','trust_scores','conceptual_tests','conceptual_answer_keys','proof_appeals',
                           'ai_verifications','github_verifications','coding_streaks','cosigns','recruiter_links','recruiter_link_views']
  loop
    if to_regclass('public.' || t) is not null then raise exception '66 self-check: % still exists', t; end if;
  end loop;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'student_profiles' and column_name = 'trust_score') then
    raise exception '66 self-check: trust_score still exists';
  end if;
  if to_regclass('public.task_assignments') is null or to_regclass('public.task_applications') is null
     or to_regclass('public.task_submissions') is null or to_regclass('public.voice_explanations') is null then
    raise exception '66 self-check: a current table went missing';
  end if;
  if has_table_privilege('authenticated', 'public.legacy_archive', 'select') then
    raise exception '66 self-check: the archive is readable from a browser';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
