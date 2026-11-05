-- A fingerprint of every REAL row and all permissions BEFORE any demo data exists. real_cleanup.sh compares against it.
-- Private schema: no website or browser role can reach it. real_cleanup.sh drops it.
create schema qa_demo;
revoke all on schema qa_demo from public;
create table qa_demo.baseline (tbl text not null, h text not null);
create table qa_demo.report (n serial primary key, line text not null);
create table qa_demo.counts_before (tbl text primary key, n bigint not null);
create table qa_demo.users (id uuid primary key, email text not null);
do $b$ begin
  execute format('grant usage on schema qa_demo to %I', current_setting('qa.runner'));
  execute format('grant select on qa_demo.report to %I', current_setting('qa.runner'));
end $b$;
-- This user must count as owner of every table: only then do row rules hide nothing from the fingerprint.
do $b$ begin
  if exists (select 1 from pg_tables where schemaname in ('public', 'auth') and not pg_has_role(current_user, tableowner, 'USAGE'))
     or exists (select 1 from pg_class where relforcerowsecurity and relnamespace in ('public'::regnamespace, 'auth'::regnamespace)) then
    raise exception 'this database user cannot see every row. Nothing was changed.';
  end if;
end $b$;
do $b$ declare t record; begin
  for t in select schemaname s, tablename n from pg_tables where schemaname in ('public', 'auth') loop
    execute format('insert into qa_demo.baseline select %L, md5(x::text) from %I.%I x', t.s || '.' || t.n, t.s, t.n);
  end loop;
end $b$;
insert into qa_demo.baseline select '=policies', md5(p::text) from pg_policies p where schemaname in ('public', 'auth');
insert into qa_demo.baseline select '=table_grants', md5(g::text) from information_schema.role_table_grants g where table_schema in ('public', 'auth');
insert into qa_demo.baseline select '=functions', md5(p.oid::regprocedure::text || p.prosrc || coalesce(p.proacl::text, '') || p.proowner::text) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace);
insert into qa_demo.baseline select '=roles', md5(r.rolname || r.rolsuper || r.rolbypassrls || r.rolcanlogin) from pg_roles r;
create index on qa_demo.baseline (tbl);
