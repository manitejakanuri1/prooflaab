-- 84a: make the two proof-era functions that still exist on production null-safe, so migration 85's
-- self-check passes while migration 66 stays deferred (Stage 7) and the OLD website keeps working.
--
-- WHY. Found on a restored production copy (Stage 0.4 rehearsal, 6 Oct 2026): cosignable_proofs() and
-- set_proof_publicity(uuid,boolean) are SECURITY DEFINER and compare a row owner to auth.uid() with "<>".
-- 85 refuses while any such comparison exists. Staging ran 66 (which drops both) before 85, so staging
-- never saw this. Rehearsal proof: 85 without 84a refused; 84a then 85 passed.
--
-- HOW. Each function is changed by replacing exactly ONE comparison in its own live definition
-- (refuses if that text is not found exactly once), so the rest of the body, the owner, grants,
-- SECURITY DEFINER, search_path, volatility and return type cannot change - checked below.
-- BEHAVIOUR. Unchanged for every real caller: both functions already refuse a signed-out caller earlier
-- (cosignable_proofs only returns rows where mine.student_id = auth.uid(); set_proof_publicity raises
-- 'not signed in' first), so "<>" and "is distinct from" give the same answer.
--
-- ORDER. After 84, before 85 (85 depends on it). 66 (Stage 7) later drops both functions.
-- STAGING. Neither function exists there (66 applied): this file does nothing.
-- Running it twice does nothing the second time. Rollback: 84a-rollback-null-safe-legacy-proof-functions.sql
-- (only before 85, or together with rolling back 85).
begin;

create temp table _84a_before on commit drop as
  select p.oid::regprocedure::text as sig, p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl,
         p.provolatile, p.prorettype
    from pg_proc p
   where p.oid in (select to_regprocedure(x) from unnest(array['public.cosignable_proofs()', 'public.set_proof_publicity(uuid,boolean)']) x);

do $$
declare
  fixes constant text[][] := array[
    ['public.cosignable_proofs()',               'theirs.student_id <> (select auth.uid())', 'theirs.student_id is distinct from (select auth.uid())'],
    ['public.set_proof_publicity(uuid,boolean)', 'if owner <> auth.uid() then',              'if owner is distinct from auth.uid() then']];
  i int; f regprocedure; def text; n int;
begin
  for i in 1 .. array_length(fixes, 1) loop
    f := to_regprocedure(fixes[i][1]);
    if f is null then
      raise notice '84a: % is not present - nothing to do', fixes[i][1];
      continue;
    end if;
    def := pg_get_functiondef(f);
    if position(fixes[i][2] in def) = 0 and position(fixes[i][3] in def) > 0 then
      raise notice '84a: % is already null-safe', fixes[i][1];
      continue;
    end if;
    n := (length(def) - length(replace(def, fixes[i][2], ''))) / length(fixes[i][2]);
    if n <> 1 then
      raise exception '84a: expected the comparison exactly once in %, found % - the function is not the one this file was written for', fixes[i][1], n;
    end if;
    execute replace(def, fixes[i][2], fixes[i][3]);
    raise notice '84a: % made null-safe', fixes[i][1];
  end loop;
end $$;

do $$
declare b record; a record;
begin
  for b in select * from _84a_before loop
    select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype into a
      from pg_proc p where p.oid = b.sig::regprocedure;
    if a.proowner <> b.proowner or a.prosecdef <> b.prosecdef or a.proconfig is distinct from b.proconfig
       or a.acl is distinct from b.acl or a.provolatile <> b.provolatile or a.prorettype <> b.prorettype then
      raise exception '84a self-check: % changed more than one comparison (owner/secdef/search_path/grants/volatility/return type)', b.sig;
    end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef and p.proname in ('cosignable_proofs', 'set_proof_publicity')
                and p.prosrc ~* '(<>|!=)\s*(\(select\s+)?auth\.uid\(\)|auth\.uid\(\)\s*(<>|!=)') then
    raise exception '84a self-check: a proof-era function still compares to auth.uid() with <>';
  end if;
end $$;

commit;
