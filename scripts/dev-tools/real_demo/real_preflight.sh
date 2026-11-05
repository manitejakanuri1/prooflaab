#!/usr/bin/env bash
# Step 0, READ ONLY. Changes nothing on REAL. Shows whether the demo scripts can run with REAL's stricter access.
#   bash /c/Users/manit/prooflab-sec-gate/scripts/dev-tools/real_demo/real_preflight.sh
source "$(dirname "$0")/lib.sh"
f=$(mktemp); cat > "$f" <<'SQL'
select 'RUNNER: ' || current_user;
select 'NOT_OWNER: ' || schemaname || '.' || tablename from pg_tables where schemaname in ('public', 'auth') and not pg_has_role('postgres', tableowner, 'USAGE');
select 'FORCED_ROW_RULES: ' || count(*) from pg_class where relforcerowsecurity and relnamespace in ('public'::regnamespace, 'auth'::regnamespace);
select 'POSTGRES_CAN_CREATE_SCHEMA: ' || has_database_privilege('postgres', current_database(), 'CREATE');
select 'NO_RUN: ' || f from unnest(array['record_account(text,text,text,boolean)', 'import_student_record(uuid,uuid,text,text,text,text,text[],text[],text,text,text,text,uuid)', 'provision_college_account(uuid,uuid,text,text,text)', 'provision_company_account(uuid,uuid,text,text,text)', 'ensure_season(uuid,integer)', 'generate_cohort_league(uuid,boolean)', 'recount_season(uuid)', 'season_week(uuid)', 'run_squad_week(uuid,integer)', 'advance_season(uuid)', 'close_season(uuid)']) f where not has_function_privilege('postgres', 'public.' || f, 'execute');
select 'FAST_CLOCK_ON_REAL: ' || count(*) from public.seasons s where public.test_fast_season(s.id);
select 'DEMO_ALREADY_HERE: ' || (select count(*) from auth.users where email like '%@qa-demo.prooflab.invalid') || ' logins, ' || (select count(*) from public.colleges where name = 'ProofLab QA Demo') || ' colleges, ' || (select count(*) from pg_namespace where nspname = 'qa_demo') || ' fingerprint';
SQL
real_read "$f" | grep -E '^[A-Z_]+: |exit='
rm -f "$f"
echo "Done. Nothing was changed. Paste this output to Claude (it holds no passwords)."
