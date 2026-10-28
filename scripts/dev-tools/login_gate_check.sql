-- MF-006 check (TEST only, owner question 29 Oct 2026): a locked email is never disabled, only refused, and
-- opens again by itself 15 minutes after its last wrong try; the per-address limit is a separate count.
-- Fake emails and documentation addresses (192.0.2.x) inside one transaction that ROLLS BACK: nothing is kept.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/login_gate_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (k text, v text);
-- 5 wrong tries for one email from one address.
insert into public.security_events (event_type, severity, source, email, ip)
select 'login_failed', 'warning', 'server', 'gate.a@invalid.test', '192.0.2.10' from generate_series(1, 5);
insert into r select '1. email A after 5 wrong tries (want account_locked)', public.web_login_gate('gate.a@invalid.test', '192.0.2.99') ->> 'reason';
insert into r select '2. email B, same address (want allowed true)', public.web_login_gate('gate.b@invalid.test', '192.0.2.10') ->> 'allowed';
-- 15 minutes pass: the wrong tries move back 16 minutes.
update public.security_events set created_at = now() - interval '16 minutes' where email = 'gate.a@invalid.test';
insert into r select '3. email A after 16 minutes (want allowed true)', public.web_login_gate('gate.a@invalid.test', '192.0.2.98') ->> 'allowed';
-- 20 wrong tries from one address, each a different email (none reaches 5).
insert into public.security_events (event_type, severity, source, email, ip)
select 'login_failed', 'warning', 'server', 'gate.ip' || g || '@invalid.test', '192.0.2.20' from generate_series(1, 20) g;
insert into r select '4. fresh email from that address (want address_locked)', public.web_login_gate('gate.c@invalid.test', '192.0.2.20') ->> 'reason';
insert into r select '5. same fresh email from another address (want allowed true)', public.web_login_gate('gate.c@invalid.test', '192.0.2.21') ->> 'allowed';
insert into r select '6. gate changes any account (want false)',
  (pg_get_functiondef('public.web_login_gate(text,text)'::regprocedure) ~* '\m(update|delete|disable)')::text;
select k as check, v as value from r order by k;
-- The job log sometimes drops the first table rows; check 1 again on its own line.
select 'ROW1 ' || k || ' = ' || coalesce(v,'NULL') as only_row_1 from r where k like '1.%';
rollback;
