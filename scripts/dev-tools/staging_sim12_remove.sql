-- STAGING ONLY. Removes everything staging_sim12_setup.sql wrote and nothing else (SIM12 markers).
-- Deleting the accounts cascades to profiles, activity, scores and memberships; deleting the
-- college cascades to its season, matches and weekly scores. The 4 staging logins in the
-- isolated Identity project stay (they no longer open any account).
\set ON_ERROR_STOP on
do $$
begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'This is not the staging database. Refusing.';
  end if;
end $$;
begin;
select set_config('app.system_write', 'on', true);
delete from public.squads where college_id = '5112c011-0000-4000-9000-000000000001';
delete from public.account_identities where email like 'sim12.%@staging.prooflab.invalid';
delete from auth.users where email like 'sim12.s%@staging.prooflab.invalid';
delete from public.colleges where id = '5112c011-0000-4000-9000-000000000001';
delete from auth.users where email = 'sim12.tpo@staging.prooflab.invalid';
commit;
select 'SIM12 removed; left: colleges=' || (select count(*) from public.colleges where name = 'SIM12 College')
    || ' students=' || (select count(*) from auth.users where email like 'sim12.%');
